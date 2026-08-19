import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { json, KetError, localStorage, multipart, streamed, text, withHeaders } from 'ketjs'
import type { MultipartPart, Route, RouteEntry, ServeContext } from 'ketjs'

type Attachment = {
  id: string
  name: string
  kind: string
  url?: string
  storeKey?: string
  mimetype: string
  size: number
  public: boolean
}

const field = async (part: MultipartPart): Promise<string> => {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of part.body) {
    size += chunk.byteLength
    if (size > 64 * 1024)
      throw new KetError({
        code: 'E_MULTIPART_FIELD',
        message: `multipart field "${part.name}" is too large`,
      })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks).toString('utf8')
}

const safeType = (value: string | undefined): string => {
  const type = (value ?? 'application/octet-stream').split(';')[0]!.trim().toLowerCase()
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(type) ? type : 'application/octet-stream'
}

const inline = new Set([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
])

const disposition = (name: string, showInline: boolean): string => {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\\r\n]/g, '_') || 'download'
  return `${showInline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

const upload =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST multipart/form-data', { status: 405 })
    const type = String(req.headers['content-type'] ?? '')
    const dir = await mkdtemp(join(tmpdir(), 'ket-upload-'))
    const spool = localStorage({ dir })
    try {
      let uploadPart: { filename: string; type: string; size: number; checksum: string } | null = null
      const fields: Record<string, string> = {}
      for await (const part of multipart(req, type, { maxBytes: ctx.config.uploadMax, maxParts: 64 })) {
        if (part.filename !== undefined) {
          if (uploadPart)
            throw new KetError({
              code: 'E_UPLOAD_FILES',
              message: 'only one file may be uploaded per request',
            })
          const stored = await spool.put('body', part.body, { type: safeType(part.type) })
          if (!stored.etag)
            throw new KetError({
              code: 'E_UPLOAD_CHECKSUM',
              message: 'the upload spool returned no checksum',
              hint: 'its temporary metadata could not be read back — check disk health and open file limits',
            })
          uploadPart = {
            filename: part.filename || 'upload',
            type: safeType(part.type),
            size: stored.size,
            checksum: stored.etag,
          }
        } else fields[part.name] = await field(part)
      }
      if (!uploadPart)
        return json({ code: 'E_UPLOAD_FILE', message: 'multipart request has no file' }, { status: 400 })
      const scope = await ctx.scopeOf(url, req)
      if (!scope.company)
        return json({ code: 'E_UPLOAD_SCOPE', message: 'upload requires a company' }, { status: 400 })
      const key = `blobs/${scope.company}/${uploadPart.checksum.slice(0, 2)}/${uploadPart.checksum}`
      const storage = await ctx.storageOf(url, req)
      // Write even when the key is already present. Trusting head() lets the sweep
      // collect the object between the probe and the row insert, leaving an
      // attachment whose bytes are gone for good; re-writing also refreshes mtime.
      const source = await spool.get('body')
      if (!source) throw new Error('temporary upload disappeared')
      await storage.put(key, source.body, { type: uploadPart.type, size: uploadPart.size })
      const id = randomUUID()
      const created = await ctx.call(
        'storage.createAttachment',
        {
          id,
          name: fields.name || uploadPart.filename,
          ...(fields.resModel ? { resModel: fields.resModel } : {}),
          ...(fields.resId ? { resId: fields.resId } : {}),
          ...(fields.resField ? { resField: fields.resField } : {}),
          kind: 'stored',
          storeKey: key,
          mimetype: uploadPart.type,
          size: uploadPart.size,
          checksum: uploadPart.checksum,
          public: fields.public === 'true' || fields.public === '1',
          createdAt: new Date().toISOString(),
        },
        url,
        req,
      )
      return json(created, { status: 201 })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }

const download =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return text('GET or HEAD', { status: 405 })
    const sessions = await ctx.sessionsOf(url, req)
    const authenticated = sessions ? Boolean(await sessions.of(req)) : true
    const publicAttachment = (await ctx
      .call('storage.getPublicAttachment', { id: params.id }, url, req)
      .catch((error: unknown) => {
        // A caller granted only storage.getAttachment must still be able to
        // download: refusal here means "not public", not that the request failed.
        if ((error as { code?: string }).code === 'E_FN_NOT_PERMITTED') return null
        throw error
      })) as Attachment | null
    const attachment =
      publicAttachment ??
      (authenticated
        ? ((await ctx.call('storage.getAttachment', { id: params.id }, url, req)) as Attachment | null)
        : null)
    if (!attachment) return text('not found', { status: 404 })
    const cacheControl = attachment.public ? 'public, max-age=3600' : 'private, no-store'
    // A redirect carries no body but still hands out a capability, so it needs the
    // same cache and sniff directives the proxied path sets.
    const redirect = { 'x-content-type-options': 'nosniff', 'cache-control': cacheControl }
    if (attachment.kind === 'url' && attachment.url)
      return withHeaders(text('', { status: 302 }), { ...redirect, location: attachment.url })
    if (!attachment.storeKey) return text('attachment has no stored object', { status: 404 })
    const storage = await ctx.storageOf(url, req)
    const showInline = inline.has(attachment.mimetype)
    const headers = {
      'x-content-type-options': 'nosniff',
      'content-disposition': disposition(attachment.name, showInline),
      'cache-control': cacheControl,
    }
    if (req.method === 'HEAD') {
      const found = await storage.head(attachment.storeKey)
      return found
        ? withHeaders(text('', { type: showInline ? attachment.mimetype : 'application/octet-stream' }), {
            ...headers,
            'content-length': String(found.size),
          })
        : text('not found', { status: 404 })
    }
    // A signed URL avoids proxying large, browser-safe files. Unknown active content
    // always passes through the app so it receives attachment + nosniff headers.
    if (showInline && attachment.size >= 1024 * 1024) {
      const signed = await storage.signedUrl(attachment.storeKey, { expiresIn: 60 })
      if (signed) return withHeaders(text('', { status: 302 }), { ...redirect, location: signed })
    }
    const found = await storage.get(attachment.storeKey)
    if (!found) return text('not found', { status: 404 })
    return withHeaders(
      streamed(found.body, { type: showInline ? attachment.mimetype : 'application/octet-stream' }),
      { ...headers, 'content-length': String(found.meta.size) },
    )
  }

const sweep =
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    const queued = await ctx.call('storage.requestSweep', {}, url, req)
    return json(queued, { status: 202 })
  }

export const routes: Record<string, RouteEntry> = {
  '/files': { handler: upload },
  '/files/sweep': { handler: sweep },
  '/files/{id}': { anonymous: true, handler: download },
}
