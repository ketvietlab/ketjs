import { json } from 'ketjs'
import type { Route, RouteEntry, ServeContext } from 'ketjs'

type Req = Parameters<Route>[1]

const bodyOf = async (req: Req): Promise<unknown> => {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > 64 * 1024) throw new Error('payload_too_large')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk as Uint8Array)
    size += bytes.byteLength
    if (size > 64 * 1024) throw new Error('payload_too_large')
    chunks.push(bytes)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  const type = String(req.headers['content-type'] ?? '').toLowerCase()
  if (type.includes('application/json')) return raw ? JSON.parse(raw) : {}
  if (type.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw))
  throw new Error('unsupported_media_type')
}

const sameOrigin = (req: Req): boolean => {
  const origin = String(req.headers.origin ?? '')
  if (!origin) return true
  try {
    return new URL(origin).host.toLowerCase() === String(req.headers.host ?? '').toLowerCase()
  } catch {
    return false
  }
}

export const routes: Record<string, RouteEntry> = {
  '/website/forms/{id}/submit': {
    anonymous: true,
    handler:
      (ctx: ServeContext): Route =>
      async (url, req, params) => {
        if (req.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, { status: 405 })
        if (!sameOrigin(req)) return json({ ok: false, code: 'origin_mismatch' }, { status: 403 })
        try {
          const raw = await bodyOf(req)
          const body =
            raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
          const isJsonPayload =
            body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload)
          const reserved = new Set(['payload', 'consent', 'honeypot', 'source', 'submissionKey'])
          const payload = isJsonPayload
            ? body.payload
            : Object.fromEntries(Object.entries(body).filter(([key]) => !reserved.has(key)))
          const remote = `${req.socket.remoteAddress ?? 'unknown'}:${String(req.headers['user-agent'] ?? '').slice(0, 200)}`
          const result = (await ctx.call(
            'website_form.submitForm',
            {
              formId: params.id,
              payload,
              consent: body.consent === true || body.consent === 'true' || body.consent === '1',
              honeypot: String(body.honeypot ?? ''),
              source: String(body.source ?? req.headers.referer ?? url.pathname).slice(0, 2_048),
              rateKey: remote,
              submissionKey: String(req.headers['idempotency-key'] ?? body.submissionKey ?? '') || null,
            },
            url,
            req,
          )) as { ok?: boolean; errors?: Array<{ message?: string }> }
          const limited = result.errors?.some((error) => error.message === 'website_form.error.rateLimit')
          return json(result, { status: result.ok ? 200 : limited ? 429 : 422 })
        } catch (error) {
          const code = error instanceof Error ? error.message : 'invalid_request'
          if (code === 'payload_too_large') return json({ ok: false, code }, { status: 413 })
          if (code === 'unsupported_media_type') return json({ ok: false, code }, { status: 415 })
          return json({ ok: false, code: 'invalid_request' }, { status: 400 })
        }
      },
  },
}
