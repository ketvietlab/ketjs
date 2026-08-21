import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { json, KetError, text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, RouteResult, ServeContext } from '@ketvietlab/ketjs'

const MAX_BODY = 12 * 1024 * 1024
const MAX_CLOCK_SKEW_SECONDS = 5 * 60

const readBounded = async (req: Parameters<Route>[1]): Promise<Buffer> => {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk as Uint8Array)
    size += bytes.length
    if (size > MAX_BODY)
      throw new KetError({
        code: 'E_INBOUND_SIZE',
        module: 'mail_inbound',
        message: `webhook body exceeds ${MAX_BODY} bytes`,
      })
    chunks.push(bytes)
  }
  return Buffer.concat(chunks)
}

const signatureValid = (
  secret: string,
  timestamp: string,
  path: string,
  raw: Buffer,
  provided: string,
): boolean => {
  if (!/^\d{10,13}$/.test(timestamp)) return false
  const value = Number(timestamp)
  const seconds = timestamp.length === 13 ? Math.floor(value / 1_000) : value
  if (
    !Number.isSafeInteger(seconds) ||
    Math.abs(Math.floor(Date.now() / 1_000) - seconds) > MAX_CLOCK_SKEW_SECONDS
  )
    return false
  const wanted = createHmac('sha256', secret)
    .update(timestamp)
    .update('.')
    .update(path)
    .update('.')
    .update(raw)
    .digest()
  const hex = provided.startsWith('sha256=') ? provided.slice(7) : provided
  if (!/^[a-f0-9]{64}$/i.test(hex)) return false
  const got = Buffer.from(hex, 'hex')
  return got.length === wanted.length && timingSafeEqual(got, wanted)
}

type ProviderAttachment = {
  name?: unknown
  mimetype?: unknown
  contentBase64?: unknown
}

const safeType = (value: unknown): string => {
  const type = String(value ?? 'application/octet-stream')
    .split(';')[0]!
    .trim()
    .toLowerCase()
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type) ? type : 'application/octet-stream'
}

const byteStream = async function* (bytes: Buffer): AsyncGenerator<Uint8Array> {
  yield bytes
}

const persistAttachments = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  payload: Record<string, unknown>,
): Promise<Array<Record<string, unknown>>> => {
  const raw = payload.attachments ?? []
  if (!Array.isArray(raw) || raw.length > 20)
    throw new KetError({
      code: 'E_INBOUND_ATTACHMENT',
      module: 'mail_inbound',
      message: 'provider attachments must be an array of at most 20 files',
    })
  const scope = await ctx.scopeOf(url, req)
  if (!scope.company)
    throw new KetError({
      code: 'E_INBOUND_SCOPE',
      module: 'mail_inbound',
      message: 'inbound webhook requires a company scope',
    })
  const storage = await ctx.storageOf(url, req)
  const provider = String(payload.provider ?? '').replace(/[^a-zA-Z0-9_.-]/g, '_')
  const event = String(payload.providerEventId ?? '').replace(/[^a-zA-Z0-9_.-]/g, '_')
  const stored: Array<Record<string, unknown>> = []
  let total = 0
  for (const [index, item] of raw.entries()) {
    if (!item || typeof item !== 'object' || Array.isArray(item))
      throw new KetError({
        code: 'E_INBOUND_ATTACHMENT',
        module: 'mail_inbound',
        message: `provider attachment ${index} is invalid`,
      })
    const attachment = item as ProviderAttachment
    const encoded = String(attachment.contentBase64 ?? '')
    if (!encoded || !/^[a-zA-Z0-9+/]*={0,2}$/.test(encoded))
      throw new KetError({
        code: 'E_INBOUND_ATTACHMENT',
        module: 'mail_inbound',
        message: `provider attachment ${index} has invalid base64`,
      })
    const bytes = Buffer.from(encoded, 'base64')
    total += bytes.length
    if (total > ctx.config.uploadMax)
      throw new KetError({
        code: 'E_INBOUND_ATTACHMENT_SIZE',
        module: 'mail_inbound',
        message: 'provider attachments exceed the configured upload limit',
      })
    const checksum = createHash('sha256').update(bytes).digest('hex')
    const storeKey = `blobs/${scope.company}/${checksum.slice(0, 2)}/${checksum}`
    const mimetype = safeType(attachment.mimetype)
    await storage.put(storeKey, byteStream(bytes), { type: mimetype, size: bytes.length })
    stored.push({
      id: `inbound:${provider}:${event}:attachment:${index + 1}`,
      name: String(attachment.name ?? `attachment-${index + 1}`),
      storeKey,
      mimetype,
      size: bytes.length,
      checksum,
      createdAt: new Date().toISOString(),
    })
  }
  return stored
}

export const signedInboundRoute =
  (
    functionName: string,
    extra: (params: Record<string, string>) => Record<string, unknown> = () => ({}),
  ): ((ctx: ServeContext) => Route) =>
  (ctx: ServeContext): Route =>
  async (url, req, params): Promise<RouteResult> => {
    if (req.method !== 'POST') return text('POST application/json', { status: 405 })
    if (!ctx.config.webhookSecret)
      return json(
        {
          ok: false,
          code: 'E_INBOUND_SECRET',
          message: 'KET_WEBHOOK_SECRET is not configured',
        },
        { status: 503 },
      )
    const raw = await readBounded(req)
    const timestamp = String(req.headers['x-ket-webhook-timestamp'] ?? '')
    const signature = String(req.headers['x-ket-webhook-signature'] ?? '')
    if (!signatureValid(ctx.config.webhookSecret, timestamp, url.pathname, raw, signature))
      return json({ ok: false, code: 'E_INBOUND_SIGNATURE' }, { status: 401 })
    let payload: Record<string, unknown>
    try {
      const parsed = JSON.parse(raw.toString('utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object')
      payload = parsed as Record<string, unknown>
    } catch {
      return json({ ok: false, code: 'E_INBOUND_JSON' }, { status: 400 })
    }
    const attachments = await persistAttachments(ctx, url, req, payload)
    const result = await ctx.callUnchecked(
      functionName,
      {
        provider: payload.provider ?? '',
        providerEventId: payload.providerEventId ?? '',
        kind: payload.kind ?? 'message',
        fromAddress: payload.fromAddress,
        recipients: payload.recipients ?? [],
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
        references: payload.references ?? [],
        replyToken: payload.replyToken,
        attachments,
        receivedAt: payload.receivedAt ?? new Date().toISOString(),
        ...extra(params),
      },
      url,
      req,
    )
    return json(result, { status: 202 })
  }

export const routes: Record<string, RouteEntry> = {
  '/mail/inbound/reply': { anonymous: true, handler: signedInboundRoute('mail_inbound.receiveReply') },
}
