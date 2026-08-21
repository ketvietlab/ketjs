import { createHash } from 'node:crypto'
import { eq, from, inArray, KetError } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { postMessage } from '../mail/index.ts'
import { jsonValue } from '../mail_transport/index.ts'
import { INBOUND_KINDS } from './types.ts'
import type { InboundAttachment, InboundInput, InboundResult } from './types.ts'

const fail = (code: string, message: string): never => {
  throw new KetError({ code, module: 'mail_inbound', message })
}

export const tokenDigest = (token: string): string => createHash('sha256').update(token).digest('hex')

const stringArray = (value: unknown, field: string, limit = 100): string[] => {
  const parsed = jsonValue<unknown>(value, [])
  if (!Array.isArray(parsed)) return fail('E_INBOUND_INPUT', `${field} must be an array`)
  if (parsed.length > limit) return fail('E_INBOUND_INPUT', `${field} exceeds ${limit} entries`)
  return [
    ...new Set(
      parsed
        .map(String)
        .map((row) => row.trim())
        .filter(Boolean),
    ),
  ]
}

const attachmentsOf = (value: unknown): InboundAttachment[] => {
  const parsed = jsonValue<unknown>(value, [])
  if (!Array.isArray(parsed) || parsed.length > 20)
    return fail('E_INBOUND_ATTACHMENT', 'inbound attachments must be an array of at most 20 files')
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry))
      return fail('E_INBOUND_ATTACHMENT', `attachment ${index} is invalid`)
    const row = entry as Record<string, unknown>
    const checksum = String(row.checksum ?? '')
    const storeKey = String(row.storeKey ?? '')
    if (!/^[a-f0-9]{64}$/.test(checksum))
      return fail('E_INBOUND_ATTACHMENT', `attachment ${index} checksum is invalid`)
    if (!storeKey.endsWith(`/${checksum.slice(0, 2)}/${checksum}`) || !storeKey.startsWith('blobs/'))
      return fail('E_INBOUND_ATTACHMENT', `attachment ${index} key is invalid`)
    const mimetype = String(row.mimetype ?? '').toLowerCase()
    if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(mimetype))
      return fail('E_INBOUND_ATTACHMENT', `attachment ${index} type is invalid`)
    const size = Number(row.size)
    if (!Number.isSafeInteger(size) || size < 0)
      return fail('E_INBOUND_ATTACHMENT', `attachment ${index} size is invalid`)
    const id = String(row.id ?? '').trim()
    const createdAt = String(row.createdAt ?? '')
    if (!id) return fail('E_INBOUND_ATTACHMENT', `attachment ${index} id is empty`)
    if (Number.isNaN(new Date(createdAt).getTime()))
      return fail('E_INBOUND_ATTACHMENT', `attachment ${index} createdAt is invalid`)
    return {
      id,
      name: String(row.name || 'attachment')
        .replace(/[\r\n]/g, ' ')
        .slice(0, 500),
      storeKey,
      mimetype,
      size,
      checksum,
      createdAt,
    }
  })
}

const decodeEntities = (value: string): string =>
  value.replace(/&(#\d+|#x[a-f0-9]+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase()
    if (lower === 'amp') return '&'
    if (lower === 'lt') return '<'
    if (lower === 'gt') return '>'
    if (lower === 'quot') return '"'
    if (lower === 'apos') return "'"
    if (lower === 'nbsp') return ' '
    const numeric = lower.startsWith('#x')
      ? Number.parseInt(lower.slice(2), 16)
      : Number.parseInt(lower.slice(1), 10)
    return Number.isSafeInteger(numeric) && numeric > 0 ? String.fromCodePoint(numeric) : match
  })

/** Conservative conversion only; the HTML source is never persisted or rendered. */
export const inboundPlainText = (text: unknown, html: unknown): string => {
  const plain = String(text ?? '').trim()
  if (plain) return plain.slice(0, 100_000)
  const source = String(html ?? '')
  return decodeEntities(
    source
      .replace(/<(script|style|template)[^>]*>[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<br\s*\/?>|<\/p\s*>|<\/div\s*>|<\/li\s*>/gi, '\n')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .trim()
    .slice(0, 100_000)
}

type AliasTarget = { threadId: string; targetId?: string }
export type AliasResolver = (ctx: Ctx, alias: Row, input: InboundInput) => Promise<AliasTarget>

const attachmentRows = async (
  ctx: Ctx,
  attachments: InboundAttachment[],
  messageId: string,
): Promise<string[]> => {
  const company = ctx.scope.company
  if (!company) return fail('E_INBOUND_SCOPE', 'inbound email requires an active company')
  for (const attachment of attachments) {
    const expected = `blobs/${company}/${attachment.checksum.slice(0, 2)}/${attachment.checksum}`
    if (attachment.storeKey !== expected)
      return fail('E_INBOUND_ATTACHMENT', 'attachment key does not match the active company')
    await ctx.db.insertIfAbsent('storage.Attachment', {
      ...attachment,
      resModel: 'mail.Message',
      resId: messageId,
      kind: 'stored',
      public: false,
    })
  }
  return attachments.map((row) => row.id)
}

const resolveReply = async (
  ctx: Ctx,
  input: InboundInput,
  references: string[],
): Promise<{ threadId: string; parentMessageId?: string; invalidToken?: boolean } | null> => {
  if (input.replyToken) {
    const R = ctx.table('mail_inbound.ReplyToken')
    const token = await ctx.db.one(from(R).where(eq(R.tokenDigest, tokenDigest(input.replyToken))))
    if (!token?.active || String(token.expiresAt) <= new Date().toISOString())
      return { threadId: '', invalidToken: true }
    return {
      threadId: String(token.threadId),
      ...(token.parentMessageId ? { parentMessageId: String(token.parentMessageId) } : {}),
    }
  }
  const D = ctx.table('mail_transport.Delivery')
  for (const reference of references) {
    const delivery = await ctx.db.one(from(D).where(eq(D.providerMessageId, reference)))
    if (!delivery?.messageId) continue
    const M = ctx.table('mail.Message')
    const message = await ctx.db.one(from(M).where(eq(M.id, delivery.messageId)))
    if (message) return { threadId: String(message.threadId), parentMessageId: String(message.id) }
  }
  return null
}

const reconcileBounce = async (ctx: Ctx, references: string[], reason: string): Promise<string | null> => {
  const D = ctx.table('mail_transport.Delivery')
  for (const reference of references) {
    const delivery = await ctx.db.one(from(D).where(eq(D.providerMessageId, reference)))
    if (!delivery) continue
    await ctx.db.update(
      'mail_transport.Delivery',
      { id: delivery.id },
      { state: 'failed', lastError: reason.slice(0, 4_000), updatedAt: new Date().toISOString() },
    )
    const J = ctx.table('mail_transport.DeliveryNotification')
    const joins = await ctx.db.all(from(J).where(eq(J.deliveryId, delivery.id)))
    for (const join of joins)
      await ctx.db.update(
        'mail.Notification',
        { id: join.notificationId },
        { state: 'failed', failureReason: reason.slice(0, 4_000) },
      )
    return String(delivery.id)
  }
  return null
}

export async function receiveInbound(
  ctx: Ctx,
  input: InboundInput,
  options: { aliasBridge?: string; resolveAlias?: AliasResolver } = {},
): Promise<InboundResult> {
  const provider = input.provider.trim().slice(0, 100)
  const providerEventId = input.providerEventId.trim().slice(0, 500)
  if (!provider || !providerEventId) return fail('E_INBOUND_ID', 'provider event identity is required')
  if (!INBOUND_KINDS.includes(input.kind as never))
    return fail('E_INBOUND_KIND', `unknown inbound kind "${input.kind}"`)
  if (input.fromAddress && /[\r\n]/.test(input.fromAddress))
    return fail('E_INBOUND_ADDRESS', 'sender address contains a newline')
  if (input.kind === 'message' && input.fromAddress && !input.fromAddress.includes('@'))
    return fail('E_INBOUND_ADDRESS', 'message sender is not an email address')
  const recipients = stringArray(input.recipients, 'recipients')
  if (recipients.some((recipient) => /[\r\n]/.test(recipient)))
    return fail('E_INBOUND_ADDRESS', 'recipient contains a newline')
  const references = stringArray(input.references, 'references', 20)
  const attachments = attachmentsOf(input.attachments)
  const id = `inbound:${provider}:${providerEventId}`
  const I = ctx.table('mail_inbound.InboundEvent')
  const existing = await ctx.db.one(
    from(I).where(eq(I.provider, provider), eq(I.providerEventId, providerEventId)),
  )
  if (existing)
    return {
      id: String(existing.id),
      duplicate: true,
      state: String(existing.state),
      ...(existing.threadId ? { threadId: String(existing.threadId) } : {}),
      ...(existing.messageId ? { messageId: String(existing.messageId) } : {}),
    }

  const now = new Date().toISOString()
  await ctx.db.insert('mail_inbound.InboundEvent', {
    id,
    provider,
    providerEventId,
    kind: input.kind,
    ...(input.fromAddress ? { fromAddress: input.fromAddress.slice(0, 500) } : {}),
    recipients,
    ...(input.subject ? { subject: input.subject.replace(/[\r\n]/g, ' ').slice(0, 1_000) } : {}),
    references,
    state: 'failed',
    diagnostic: 'route not resolved',
    attempts: 1,
    receivedAt: input.receivedAt,
  })

  if (input.kind === 'bounce') {
    const reason = inboundPlainText(input.text, input.html) || 'provider bounce'
    const deliveryId = await reconcileBounce(ctx, references, reason)
    const state = deliveryId ? 'processed' : 'ignored'
    await ctx.db.update(
      'mail_inbound.InboundEvent',
      { id },
      {
        state,
        diagnostic: deliveryId ? `delivery:${deliveryId}` : 'bounce reference did not match a delivery',
        processedAt: now,
      },
    )
    return { id, duplicate: false, state }
  }

  let target = await resolveReply(ctx, input, references)
  if (target?.invalidToken) {
    await ctx.db.update(
      'mail_inbound.InboundEvent',
      { id },
      { state: 'failed', diagnostic: 'reply token is invalid or expired', processedAt: now },
    )
    return { id, duplicate: false, state: 'failed' }
  }
  let alias: Row | null = null
  let targetId: string | undefined
  if (!target && input.alias) {
    const A = ctx.table('mail_inbound.Alias')
    alias = await ctx.db.one(from(A).where(eq(A.localPart, input.alias), eq(A.active, true)))
    if (!alias || !options.resolveAlias || alias.bridge !== options.aliasBridge) {
      const state = alias ? 'pending_alias' : 'failed'
      const diagnostic = alias
        ? `alias requires bridge:${String(alias.bridge)}`
        : `unknown alias:${String(input.alias).slice(0, 200)}`
      await ctx.db.update('mail_inbound.InboundEvent', { id }, { state, diagnostic, processedAt: now })
      return { id, duplicate: false, state }
    }
    const resolved = await options.resolveAlias(ctx, alias, input)
    target = { threadId: resolved.threadId }
    targetId = resolved.targetId
  }
  if (!target) {
    await ctx.db.update(
      'mail_inbound.InboundEvent',
      { id },
      { state: 'failed', diagnostic: 'no valid reply token, reference or alias', processedAt: now },
    )
    return { id, duplicate: false, state: 'failed' }
  }

  const body = inboundPlainText(input.text, input.html)
  if (!body && !attachments.length) {
    await ctx.db.update(
      'mail_inbound.InboundEvent',
      { id },
      { state: 'failed', diagnostic: 'message has no safe text or attachment', processedAt: now },
    )
    return { id, duplicate: false, state: 'failed' }
  }
  const attachmentIds = await attachmentRows(ctx, attachments, id)
  await postMessage(ctx, {
    id,
    threadId: target.threadId,
    ...(target.parentMessageId ? { parentId: target.parentMessageId } : {}),
    ...(input.fromAddress ? { emailFrom: input.fromAddress } : {}),
    kind: 'email',
    direction: 'incoming',
    ...(input.subject ? { subject: input.subject.replace(/[\r\n]/g, ' ').slice(0, 1_000) } : {}),
    body,
    attachmentIds,
    createdAt: input.receivedAt,
  })
  await ctx.db.update(
    'mail_inbound.InboundEvent',
    { id },
    {
      ...(alias ? { aliasId: alias.id } : {}),
      threadId: target.threadId,
      messageId: id,
      state: 'processed',
      diagnostic: null,
      processedAt: now,
    },
  )
  return {
    id,
    duplicate: false,
    state: 'processed',
    threadId: target.threadId,
    messageId: id,
    ...(targetId ? { targetId } : {}),
  }
}

export const attachmentIdsForEvents = async (ctx: Ctx, messageIds: string[]): Promise<string[]> => {
  if (!messageIds.length) return []
  const A = ctx.table('storage.Attachment')
  return (await ctx.db.all(from(A).where(eq(A.resModel, 'mail.Message'), inArray(A.resId, messageIds)))).map(
    (row) => String(row.id),
  )
}
