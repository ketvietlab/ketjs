// Logging in and out.
//
// These are routes rather than server functions on purpose. A function receives
// `Ctx`, which is data and nothing else — no request, no response, no cookie. That
// boundary is what keeps handlers testable and HTTP out of the data layer, and
// logging in is exactly the operation that needs the other side of it.
//
// So the split is: `user.authenticate` decides whether the password is right and
// what the account may see, and this decides what to do about it.

import { json, page, text, withHeaders } from 'ketjs'
import type { Route, RouteEntry, ServeContext } from 'ketjs'
import { loginScreen } from './login.ts'

type Verdict = { ok: boolean; userId?: string; companies?: string[]; defaultCompanyId?: string | null }
type Req = Parameters<Route>[1]

const read = async (req: Req): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * A browser posts a form; everything else posts JSON. Accepting both is what lets
 * the same route serve a sign-in page and an API without either pretending to be
 * the other.
 */
const body = async (req: Req): Promise<Record<string, string>> => {
  const raw = await read(req)
  if (!raw) return {}
  const type = String(req.headers['content-type'] ?? '')
  if (type.includes('form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw))
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(Object.entries(parsed).map(([k, v]) => [k, String(v ?? '')]))
  } catch { return {} }
}

const wantsHtml = (req: Req): boolean => String(req.headers.accept ?? '').includes('text/html')

/**
 * A cross-site POST cannot be allowed to log someone in.
 *
 * SameSite protects the session cookie once it exists, but not the request that
 * creates it — an attacker who can make your browser sign in as *their* account
 * then watches what you do in it. Browsers send Origin on any cross-site POST;
 * anything else (curl, a server, an SDK) sends none, so absence is not suspicious
 * and presence has to match.
 */
const crossSite = (req: Req): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try { return new URL(origin).host !== String(req.headers.host ?? '') } catch { return true }
}

/** Where to land after signing in. Only ever a path on this site. */
const safeNext = (value: string | undefined): string =>
  value && value.startsWith('/') && !value.startsWith('//') ? value : '/admin'

const seeOther = (to: string, cookie?: string) =>
  withHeaders(text('', { status: 303 }), { location: to, ...(cookie ? { 'set-cookie': cookie } : {}) })

const needSessions = () => text('this deployment has not turned sessions on', { status: 501 })

export const routes: Record<string, RouteEntry> = {
  // The three a stranger has to be able to reach. /whoami answering 401 is the
  // answer, not a refusal.
  '/login': {
    anonymous: true,
    handler: (ctx: ServeContext) => async (url, req) => {
      const sessions = await ctx.sessionsOf(url, req)
      if (!sessions) return needSessions()
      const locale = ctx.localeOf(url, req)
      const _ = ctx.translate(locale)
      const locales = Object.keys(ctx.manifest.messages ?? {})
      const styles = await ctx.styles(req)

      const form = (o: { next?: string; failed?: boolean }) => page({
        status: o.failed ? 401 : 200,
        body: ctx.document({
          lang: locale,
          title: _('user.login.title'),
          // Every installed module's stylesheets, exactly as the backend screens
          // get them. Passing nothing here shipped a sign-in page with no CSS at
          // all: the markup was right and the page looked broken.
          head: styles,
          body: loginScreen(_, { ...o, locales, locale }),
        }),
      })

      if (req.method === 'GET') {
        // Already signed in: sending someone to a login form they do not need is
        // how they end up signing in twice and wondering which one took.
        if (await sessions.of(req)) return seeOther(safeNext(url.searchParams.get('next') ?? undefined))
        return wantsHtml(req)
          ? form({ next: url.searchParams.get('next') ?? undefined })
          : text('POST a JSON body with login and password', { status: 405 })
      }
      if (req.method !== 'POST') return text('POST a JSON body with login and password', { status: 405 })
      if (crossSite(req)) return json({ ok: false }, { status: 403 })

      const { login, password, next } = await body(req)
      const html = wantsHtml(req)

      const verdict = await ctx.call('user.authenticate', { login: login ?? '', password: password ?? '' },
        url, req) as Verdict

      // One answer for a wrong password, an unknown login and an account with no
      // company: three different reasons, and telling them apart is how someone
      // learns which of the three they hit.
      const companies = verdict.companies ?? []
      if (!verdict.ok || !verdict.userId || !companies.length) {
        return html ? form({ next, failed: true }) : json({ ok: false }, { status: 401 })
      }

      const { record, cookie } = await sessions.start({
        userId: verdict.userId,
        companies,
        company: verdict.defaultCompanyId ?? null,
      })
      return html
        ? seeOther(safeNext(next), cookie)
        : withHeaders(
            json({ ok: true, userId: record.userId, company: record.company, companies: record.companies }),
            { 'set-cookie': cookie },
          )
    },
  },

  '/logout': {
    anonymous: true,
    handler: (ctx: ServeContext) => async (url, req) => {
      const sessions = await ctx.sessionsOf(url, req)
      if (!sessions) return needSessions()
      if (req.method === 'POST' && crossSite(req)) return json({ ok: false }, { status: 403 })
      await sessions.end(req)
      // Clearing the cookie as well as the record: leaving the browser holding an
      // id that no longer resolves means every later request pays a lookup to
      // learn so.
      return wantsHtml(req)
        ? seeOther('/login', sessions.clearCookie())
        : withHeaders(json({ ok: true }), { 'set-cookie': sessions.clearCookie() })
    },
  },

  '/whoami': {
    anonymous: true,
    handler: (ctx: ServeContext) => async (url, req) => {
      const sessions = await ctx.sessionsOf(url, req)
      if (!sessions) return needSessions()
      const record = await sessions.of(req)
      if (!record) return json({ ok: false }, { status: 401 })
      return json({ ok: true, userId: record.userId, company: record.company, companies: record.companies })
    },
  },
}
