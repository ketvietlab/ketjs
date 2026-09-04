import { json } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'

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

/** Every encoding a browser or client may use for a ticked consent box. */
const CONSENT_GIVEN = new Set(['true', 'on', 'yes', '1'])

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
          // The version travels as a hidden input on a form-encoded post, so its
          // transport name has to be reserved — otherwise it lands in the payload
          // and is reported back as a field the form should not have.
          //
          // `_schemaVersion`, not `schemaVersion`: a form field name must start
          // with a letter (see validateSchema), so a leading underscore is a name
          // no form can declare. Reserving the bare name instead would have made
          // a form with a `schemaVersion` question answer 409 for ever — its
          // answer stripped from the payload and reparsed as a contract number.
          const reserved = new Set([
            'payload',
            'consent',
            'honeypot',
            'source',
            'submissionKey',
            '_schemaVersion',
          ])
          const payload = isJsonPayload
            ? body.payload
            : Object.fromEntries(Object.entries(body).filter(([key]) => !reserved.has(key)))
          const remote = `${req.socket.remoteAddress ?? 'unknown'}:${String(req.headers['user-agent'] ?? '').slice(0, 200)}`
          // A form post carries strings. Only a well-formed version opts into the
          // staleness check; anything else behaves as it did before versioning.
          const declaredVersion = Number(body._schemaVersion)
          const schemaVersion =
            Number.isInteger(declaredVersion) && declaredVersion > 0 ? declaredVersion : null
          const result = (await ctx.call(
            'website_form.submitForm',
            {
              formId: params.id,
              payload,
              // A checked checkbox named `consent`, with no value attribute,
              // posts "on" — the HTML default. Rejecting it told a visitor who
              // had ticked the box that they must agree. (Spelling the tag out
              // here would trip the repository's autocomplete contract scan,
              // which reads source text rather than markup.)
              consent: CONSENT_GIVEN.has(
                typeof body.consent === 'boolean'
                  ? String(body.consent)
                  : String(body.consent ?? '').toLowerCase(),
              ),
              honeypot: String(body.honeypot ?? ''),
              source: String(body.source ?? req.headers.referer ?? url.pathname).slice(0, 2_048),
              rateKey: remote,
              submissionKey: String(req.headers['idempotency-key'] ?? body.submissionKey ?? '') || null,
              schemaVersion,
            },
            url,
            req,
          )) as { ok?: boolean; errors?: Array<{ message?: string }> }
          const limited = result.errors?.some((error) => error.message === 'website_form.error.rateLimit')
          // 409, not 422: nothing is wrong with what the visitor typed, the form
          // they typed it into moved. The client should reload, not edit.
          const stale = result.errors?.some(
            (error) =>
              error.message === 'website_form.error.staleForm' ||
              error.message === 'website_form.error.consentVersionRequired',
          )
          return json(result, { status: result.ok ? 200 : limited ? 429 : stale ? 409 : 422 })
        } catch (error) {
          const code = error instanceof Error ? error.message : 'invalid_request'
          if (code === 'payload_too_large') return json({ ok: false, code }, { status: 413 })
          if (code === 'unsupported_media_type') return json({ ok: false, code }, { status: 415 })
          return json({ ok: false, code: 'invalid_request' }, { status: 400 })
        }
      },
  },
}
