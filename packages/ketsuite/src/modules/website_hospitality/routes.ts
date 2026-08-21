import { json } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'

type Req = Parameters<Route>[1]

const bodyOf = async (req: Req): Promise<Record<string, unknown>> => {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > 32 * 1024) throw new Error('payload_too_large')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk as Uint8Array)
    size += bytes.byteLength
    if (size > 32 * 1024) throw new Error('payload_too_large')
    chunks.push(bytes)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  const type = String(req.headers['content-type'] ?? '').toLowerCase()
  if (type.includes('application/json')) {
    const parsed = raw ? (JSON.parse(raw) as unknown) : {}
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {}
  }
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
  '/website/hospitality/{siteId}/booking': {
    anonymous: true,
    handler:
      (ctx: ServeContext): Route =>
      async (url, req, params) => {
        if (req.method !== 'POST') return json({ ok: false, code: 'method_not_allowed' }, { status: 405 })
        if (!sameOrigin(req)) return json({ ok: false, code: 'origin_mismatch' }, { status: 403 })
        try {
          const body = await bodyOf(req)
          const remote = `${req.socket.remoteAddress ?? 'unknown'}:${String(req.headers['user-agent'] ?? '').slice(0, 200)}`
          const result = (await ctx.call(
            'website_hospitality.requestBooking',
            {
              siteId: params.siteId,
              roomTypeId: body.roomTypeId || null,
              guestName: body.guestName,
              email: body.email,
              phone: body.phone || null,
              checkIn: body.checkIn,
              checkOut: body.checkOut,
              adults: body.adults == null || body.adults === '' ? null : Number(body.adults),
              children: body.children == null || body.children === '' ? null : Number(body.children),
              note: body.note || null,
              requestKey: String(req.headers['idempotency-key'] ?? body.requestKey ?? '') || null,
              rateKey: remote,
              honeypot: String(body.honeypot ?? ''),
            },
            url,
            req,
          )) as { ok?: boolean; errors?: Array<{ message?: string }> }
          const limited = result.errors?.some(
            (error) => error.message === 'website_hospitality.error.rateLimit',
          )
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
