// Logging in and out.
//
// These are routes rather than server functions on purpose. A function receives
// `Ctx`, which is data and nothing else — no request, no response, no cookie. That
// boundary is what keeps handlers testable and HTTP out of the data layer, and
// logging in is exactly the operation that needs the other side of it.
//
// So the split is: `user.authenticate` decides whether the password is right and
// what the account may see, and this decides what to do about it.

import { json, page, sha256, text, withHeaders } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { loginScreen } from './login.ts'
import { authTokenScreen } from '../../ui/auth.tsx'

type Verdict = {
  ok: boolean
  userId?: string
  companies?: string[]
  defaultCompanyId?: string | null
  branches?: string[]
  defaultBranchId?: string | null
  securityVersion?: number
}
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
  } catch {
    return {}
  }
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
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

/** Where to land after signing in. Only ever a path on this site. */
const hasUnsafePathCharacter = (value: string): boolean =>
  value.includes('\\') ||
  [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })
const safeNext = (value: string | undefined): string => {
  if (
    !value?.startsWith('/') ||
    value.startsWith('//') ||
    hasUnsafePathCharacter(value) ||
    /%5c/i.test(value)
  )
    return '/admin'
  const parsed = new URL(value, 'http://ket.local')
  return parsed.origin === 'http://ket.local' ? `${parsed.pathname}${parsed.search}${parsed.hash}` : '/admin'
}

const seeOther = (to: string, cookie?: string) =>
  withHeaders(text('', { status: 303 }), { location: to, ...(cookie ? { 'set-cookie': cookie } : {}) })

const needSessions = () => text('this deployment has not turned sessions on', { status: 501 })
const networkFingerprint = (req: Req): string =>
  sha256(`${req.socket.remoteAddress ?? 'unknown'}\n${String(req.headers['user-agent'] ?? '')}`)

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

      const form = async (o: { next?: string; failed?: boolean; oauthFailed?: boolean }) => {
        const providers = ctx.manifest.functions['oauth.publicProviders']
          ? (
              (await ctx.call('oauth.publicProviders', {}, url, req)) as Array<{
                code: string
                name: string
              }>
            ).map((provider) => {
              const target = new URL(
                `/auth/oauth/${encodeURIComponent(provider.code)}/start`,
                'http://ket.local',
              )
              if (o.next) target.searchParams.set('next', safeNext(o.next))
              if (locale) target.searchParams.set('lang', locale)
              return { ...provider, href: `${target.pathname}${target.search}` }
            })
          : []
        return page({
          status: o.failed ? 401 : 200,
          body: ctx.document({
            lang: locale,
            title: _('user.login.title'),
            // Every installed module's stylesheets, exactly as the backend screens
            // get them. Passing nothing here shipped a sign-in page with no CSS at
            // all: the markup was right and the page looked broken.
            head: styles,
            body: loginScreen(_, { ...o, providers, locales, locale }),
          }),
        })
      }

      if (req.method === 'GET') {
        // Already signed in: sending someone to a login form they do not need is
        // how they end up signing in twice and wondering which one took.
        if (await sessions.of(req)) return seeOther(safeNext(url.searchParams.get('next') ?? undefined))
        const requestedNext = url.searchParams.get('next') ?? undefined
        return wantsHtml(req)
          ? form({
              next: requestedNext ? safeNext(requestedNext) : undefined,
              oauthFailed: url.searchParams.has('oauth_error'),
            })
          : text('POST a JSON body with login and password', { status: 405 })
      }
      if (req.method !== 'POST') return text('POST a JSON body with login and password', { status: 405 })
      if (crossSite(req)) return json({ ok: false }, { status: 403 })

      const { login, password, next } = await body(req)
      const html = wantsHtml(req)

      const verdict = (await ctx.call(
        'user.authenticate',
        {
          login: login ?? '',
          password: password ?? '',
          networkFingerprint: networkFingerprint(req),
        },
        url,
        req,
      )) as Verdict

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
        branches: verdict.branches ?? [],
        branch: verdict.defaultBranchId ?? null,
        securityVersion: verdict.securityVersion ?? 0,
      })
      return html
        ? seeOther(safeNext(next), cookie)
        : withHeaders(
            json({
              ok: true,
              userId: record.userId,
              company: record.company,
              companies: record.companies,
              branch: record.branch,
              branches: record.branches,
            }),
            { 'set-cookie': cookie },
          )
    },
  },

  '/logout': {
    anonymous: true,
    handler: (ctx: ServeContext) => async (url, req) => {
      const sessions = await ctx.sessionsOf(url, req)
      if (!sessions) return needSessions()
      if (req.method !== 'POST') return text('POST', { status: 405 })
      if (crossSite(req)) return json({ ok: false }, { status: 403 })
      const record = await sessions.of(req)
      if (record)
        await ctx.call(
          'user.recordSecurityEvent',
          { event: 'session.logout', userId: record.userId, networkFingerprint: networkFingerprint(req) },
          url,
          req,
        )
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
      // /whoami is anonymous at the routing layer so it can answer 401. Explicitly
      // resolve the live scope first; otherwise reading the store directly would
      // bypass membership and active-state revocation for this one route.
      await ctx.scopeOf(url, req)
      const record = await sessions.of(req)
      if (!record) return json({ ok: false }, { status: 401 })
      return json({
        ok: true,
        userId: record.userId,
        company: record.company,
        companies: record.companies,
        branch: record.branch,
        branches: record.branches,
      })
    },
  },
  ...Object.fromEntries(
    (['invitation', 'reset'] as const).map((kind) => [
      `/auth/${kind}`,
      {
        anonymous: true,
        handler:
          (ctx: ServeContext): Route =>
          async (url, req) => {
            const locale = ctx.localeOf(url, req)
            const _ = ctx.translate(locale)
            const render = async (token: string, errors?: string[], complete = false) =>
              page({
                body: ctx.document({
                  lang: locale,
                  title: _(`user.token.${kind}Title`),
                  head: await ctx.styles(req),
                  body: authTokenScreen(_, { kind, token, errors, complete }),
                }),
              })
            if (req.method === 'GET') return render(url.searchParams.get('token') ?? '')
            if (req.method !== 'POST') return text('GET or POST', { status: 405 })
            if (crossSite(req)) return text('Forbidden', { status: 403 })
            const form = await body(req)
            if (form.password !== form.confirmPassword)
              return render(form.token ?? '', [_('user.token.mismatch')])
            const result = (await ctx.call(
              'user.consumeAuthToken',
              { token: form.token ?? '', kind, realm: 'backend', password: form.password ?? '' },
              url,
              req,
            )) as { ok?: boolean; userId?: string; errors?: Array<{ code?: string }> }
            if (!result.ok || !result.userId)
              return render(
                form.token ?? '',
                (result.errors ?? []).map((error) => _(error.code ?? 'user.error.tokenInvalid')),
              )
            await (await ctx.sessionsOf(url, req))?.endUser(result.userId)
            return render('', undefined, true)
          },
      },
    ]),
  ),
}
