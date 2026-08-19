// Logging in and out.
//
// These are routes rather than server functions on purpose. A function receives
// `Ctx`, which is data and nothing else — no request, no response, no cookie. That
// is the boundary that keeps handlers testable and keeps HTTP out of the data
// layer, and logging in is exactly the operation that needs the other side of it.
//
// So the split is: `user.authenticate` decides whether the password is right and
// what the account may see, and this decides what to do about it.

import { json, text, withHeaders } from 'ketjs'
import type { Route, ServeContext } from 'ketjs'

type Verdict = { ok: boolean; userId?: string; companies?: string[]; defaultCompanyId?: string | null }

const body = async (req: Parameters<Route>[1]): Promise<Record<string, unknown>> => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  if (!chunks.length) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> } catch { return {} }
}

const needSessions = () => text('this deployment has not turned sessions on', { status: 501 })

export const routes: Record<string, (ctx: ServeContext) => Route> = {
  '/login': (ctx) => async (url, req) => {
    if (!ctx.sessions) return needSessions()
    if (req.method !== 'POST') return text('POST a JSON body with login and password', { status: 405 })
    const { login, password } = await body(req)

    // The call runs with no session — it has to, because there is not one yet —
    // and it is the only function that reads a password hash. It answers a verdict.
    const verdict = await ctx.call('user.authenticate', { login: String(login ?? ''), password: String(password ?? '') },
      url, req) as Verdict

    if (!verdict.ok || !verdict.userId) {
      // One answer for a wrong password, an unknown login and an account with no
      // company: three different reasons, and telling them apart is how someone
      // learns which of the three they hit.
      return json({ ok: false }, { status: 401 })
    }
    const companies = verdict.companies ?? []
    if (!companies.length) return json({ ok: false }, { status: 401 })

    const { record, cookie } = await ctx.sessions.start({
      userId: verdict.userId,
      companies,
      company: verdict.defaultCompanyId ?? null,
    })
    return withHeaders(
      json({ ok: true, userId: record.userId, company: record.company, companies: record.companies }),
      { 'set-cookie': cookie },
    )
  },

  '/logout': (ctx) => async (_url, req) => {
    if (!ctx.sessions) return needSessions()
    await ctx.sessions.end(req)
    // Clearing the cookie as well as the record: leaving the browser holding an id
    // that no longer resolves means every later request pays a lookup to learn so.
    return withHeaders(json({ ok: true }), { 'set-cookie': ctx.sessions.clearCookie() })
  },

  '/whoami': (ctx) => async (_url, req) => {
    if (!ctx.sessions) return needSessions()
    const record = await ctx.sessions.of(req)
    if (!record) return json({ ok: false }, { status: 401 })
    return json({ ok: true, userId: record.userId, company: record.company, companies: record.companies })
  },
}
