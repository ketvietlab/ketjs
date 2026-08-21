import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { json, text, withHeaders } from 'ketjs'
import type { Route, RouteEntry, RouteResult, ServeContext } from 'ketjs'

type Req = Parameters<Route>[1]
type Account = {
  id: string
  realmId: string
  partnerId: string
  email: string
  displayName: string
  securityVersion: number
}
type CustomerSession = Account & {
  accountId: string
  idleExpiresAt: string
  absoluteExpiresAt: string
}

const COOKIE = 'ket_customer_session'
const BODY_LIMIT = 16 * 1024
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const csrfToken = (token: string): string => digest(`website-customer-csrf\n${token}`)
const privateHeaders = { 'cache-control': 'private, no-store' }

const bodyOf = async (req: Req): Promise<Record<string, unknown>> => {
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > BODY_LIMIT) throw new Error('payload_too_large')
  if (
    !String(req.headers['content-type'] ?? '')
      .toLowerCase()
      .includes('application/json')
  )
    throw new Error('unsupported_media_type')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk as Uint8Array)
    size += bytes.byteLength
    if (size > BODY_LIMIT) throw new Error('payload_too_large')
    chunks.push(bytes)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  const parsed = raw ? (JSON.parse(raw) as unknown) : {}
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {}
}

const hostOf = (req: Req): string =>
  String(req.headers.host ?? '')
    .trim()
    .toLowerCase()
const siteHostOf = (req: Req): string => {
  try {
    return new URL(`http://${hostOf(req)}`).hostname.toLowerCase()
  } catch {
    return ''
  }
}
const sameOrigin = (req: Req): boolean => {
  const origin = String(req.headers.origin ?? '')
  if (!origin) return true
  try {
    return new URL(origin).host.toLowerCase() === hostOf(req)
  } catch {
    return false
  }
}

const cookieOf = (req: Req): string | null => {
  const raw = String(req.headers.cookie ?? '')
  for (const part of raw.split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === COOKIE) return decodeURIComponent(value.join('='))
  }
  return null
}

const cookie = (req: Req, token: string, maxAge: number): string => {
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '').toLowerCase()
  const secure = forwarded === 'https' || (req.socket as { encrypted?: boolean }).encrypted === true
  return [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ].join('; ')
}

const clearCookie = (req: Req): string => cookie(req, '', 0)
const networkFingerprint = (req: Req): string =>
  digest(`${req.socket.remoteAddress ?? 'unknown'}\n${String(req.headers['user-agent'] ?? '').slice(0, 300)}`)

const safeEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

const siteAndRealm = async (ctx: ServeContext, url: URL, req: Req) => {
  const site = (await ctx.call('website.resolveSite', { host: siteHostOf(req) }, url, req)) as {
    id?: string
  } | null
  if (!site?.id) return null
  const realm = (await ctx.call('website.customerRealmForSite', { siteId: site.id }, url, req)) as {
    id?: string
    sessionAbsoluteSeconds?: number
  } | null
  return realm?.id ? { siteId: site.id, realmId: realm.id, realm } : null
}

const startSession = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  account: Account,
): Promise<{ session: CustomerSession; token: string; cookie: string } | null> => {
  const token = randomBytes(32).toString('base64url')
  const session = (await ctx.call(
    'website.startCustomerSession',
    {
      id: randomUUID(),
      accountId: account.id,
      tokenDigest: digest(token),
      networkFingerprint: networkFingerprint(req),
    },
    url,
    req,
  )) as CustomerSession | null
  if (!session) return null
  const maxAge = Math.max(0, Math.floor((new Date(session.absoluteExpiresAt).getTime() - Date.now()) / 1000))
  return { session, token, cookie: cookie(req, token, maxAge) }
}

const currentSession = async (ctx: ServeContext, url: URL, req: Req) => {
  const context = await siteAndRealm(ctx, url, req)
  const token = cookieOf(req)
  if (!context || !token || token.length < 32 || token.length > 200) return null
  const session = (await ctx.call(
    'website.resolveCustomerSession',
    { siteId: context.siteId, tokenDigest: digest(token) },
    url,
    req,
  )) as CustomerSession | null
  return session ? { ...context, session, token } : null
}

const publicAccount = (account: Account | CustomerSession) => ({
  id: 'accountId' in account ? account.accountId : account.id,
  displayName: account.displayName,
  email: account.email,
})

const errorResult = (ctx: ServeContext, url: URL, req: Req, result: unknown, fallbackStatus = 422) => {
  const errors =
    result && typeof result === 'object' && Array.isArray((result as { errors?: unknown }).errors)
      ? ((result as { errors: Array<{ field?: string; message?: string }> }).errors ?? [])
      : []
  const code = errors[0]?.message ?? 'website.customer.error.invalidRequest'
  const status = code === 'website.customer.error.rateLimit' ? 429 : fallbackStatus
  const translate = ctx.translate(ctx.localeOf(url, req))
  return withHeaders(
    json(
      {
        ok: false,
        code,
        message: translate(code),
        errors: errors.map((error) => ({
          field: error.field ?? null,
          code: error.message ?? code,
          message: translate(error.message ?? code),
        })),
      },
      { status },
    ),
    privateHeaders,
  )
}

const requestError = (error: unknown) => {
  const code = error instanceof Error ? error.message : 'invalid_request'
  const status = code === 'payload_too_large' ? 413 : code === 'unsupported_media_type' ? 415 : 400
  return withHeaders(json({ ok: false, code }, { status }), privateHeaders)
}

const forbidden = (code = 'website.customer.error.csrf') =>
  withHeaders(json({ ok: false, code }, { status: 403 }), privateHeaders)

const authorizedMutation = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
): Promise<{ response: RouteResult } | { held: NonNullable<Awaited<ReturnType<typeof currentSession>>> }> => {
  if (!sameOrigin(req)) return { response: forbidden('website.customer.error.originMismatch') }
  const held = await currentSession(ctx, url, req)
  if (!held)
    return {
      response: withHeaders(
        json({ ok: false, code: 'website.customer.error.sessionExpired' }, { status: 401 }),
        privateHeaders,
      ),
    }
  const supplied = String(req.headers['x-csrf-token'] ?? '')
  if (!supplied || !safeEqual(supplied, csrfToken(held.token))) return { response: forbidden() }
  return { held }
}

const route = (handler: (ctx: ServeContext, url: URL, req: Req) => ReturnType<Route>): RouteEntry => ({
  anonymous: true,
  handler:
    (ctx: ServeContext): Route =>
    (url, req) =>
      handler(ctx, url, req),
})

export const customerRoutes: Record<string, RouteEntry> = {
  '/api/website/v1/customer/auth/register': route(async (ctx, url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (!sameOrigin(req)) return forbidden('website.customer.error.originMismatch')
    try {
      const context = await siteAndRealm(ctx, url, req)
      if (!context)
        return errorResult(ctx, url, req, {
          errors: [{ field: 'realm', message: 'website.customer.error.realmUnavailable' }],
        })
      const body = await bodyOf(req)
      const result = (await ctx.call(
        'website.registerCustomer',
        {
          realmId: context.realmId,
          displayName: body.displayName,
          email: body.email,
          password: body.password,
          rateKey: networkFingerprint(req),
        },
        url,
        req,
      )) as { ok?: boolean; account?: Account; errors?: unknown }
      if (!result.ok || !result.account) {
        const emailInUse = Array.isArray(result.errors)
          ? result.errors.some(
              (error: { message?: string }) => error.message === 'website.customer.error.emailInUse',
            )
          : false
        return errorResult(ctx, url, req, result, emailInUse ? 409 : 422)
      }
      const started = await startSession(ctx, url, req, result.account)
      if (!started)
        return errorResult(ctx, url, req, {
          errors: [{ field: 'session', message: 'website.customer.error.sessionExpired' }],
        })
      return withHeaders(
        json(
          {
            ok: true,
            customer: publicAccount(started.session),
            csrfToken: csrfToken(started.token),
          },
          { status: 201 },
        ),
        { ...privateHeaders, 'set-cookie': started.cookie },
      )
    } catch (error) {
      return requestError(error)
    }
  }),

  '/api/website/v1/customer/auth/login': route(async (ctx, url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (!sameOrigin(req)) return forbidden('website.customer.error.originMismatch')
    try {
      const context = await siteAndRealm(ctx, url, req)
      if (!context)
        return errorResult(
          ctx,
          url,
          req,
          {
            errors: [{ field: 'email', message: 'website.customer.error.invalidCredentials' }],
          },
          401,
        )
      const body = await bodyOf(req)
      const result = (await ctx.call(
        'website.authenticateCustomer',
        {
          realmId: context.realmId,
          email: body.email,
          password: body.password,
          rateKey: networkFingerprint(req),
        },
        url,
        req,
      )) as { ok?: boolean; account?: Account; errors?: unknown }
      if (!result.ok || !result.account) return errorResult(ctx, url, req, result, 401)
      const started = await startSession(ctx, url, req, result.account)
      if (!started) return errorResult(ctx, url, req, result, 401)
      return withHeaders(
        json({
          ok: true,
          customer: publicAccount(started.session),
          csrfToken: csrfToken(started.token),
        }),
        { ...privateHeaders, 'set-cookie': started.cookie },
      )
    } catch (error) {
      return requestError(error)
    }
  }),

  '/api/website/v1/customer/session': route(async (ctx, url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const held = await currentSession(ctx, url, req)
    return withHeaders(
      json(
        held
          ? {
              authenticated: true,
              customer: publicAccount(held.session),
              csrfToken: csrfToken(held.token),
            }
          : { authenticated: false },
      ),
      privateHeaders,
    )
  }),

  '/api/website/v1/customer/auth/logout': route(async (ctx, url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    if (!sameOrigin(req)) return forbidden('website.customer.error.originMismatch')
    const held = await currentSession(ctx, url, req)
    if (held) {
      const supplied = String(req.headers['x-csrf-token'] ?? '')
      if (!supplied || !safeEqual(supplied, csrfToken(held.token))) return forbidden()
      await ctx.call(
        'website.revokeCustomerSession',
        { tokenDigest: digest(held.token), reason: 'logout' },
        url,
        req,
      )
    }
    return withHeaders(text('', { status: 204 }), {
      ...privateHeaders,
      'set-cookie': clearCookie(req),
    })
  }),

  '/api/website/v1/customer/auth/logout-all': route(async (ctx, url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    const auth = await authorizedMutation(ctx, url, req)
    if ('response' in auth) return auth.response
    await ctx.call(
      'website.revokeAllCustomerSessions',
      { accountId: auth.held.session.accountId, reason: 'logout-all' },
      url,
      req,
    )
    return withHeaders(text('', { status: 204 }), {
      ...privateHeaders,
      'set-cookie': clearCookie(req),
    })
  }),

  '/api/website/v1/customer/profile': route(async (ctx, url, req) => {
    if (req.method === 'GET') {
      const held = await currentSession(ctx, url, req)
      if (!held)
        return withHeaders(
          json({ ok: false, code: 'website.customer.error.sessionExpired' }, { status: 401 }),
          privateHeaders,
        )
      return withHeaders(json({ ok: true, customer: publicAccount(held.session) }), privateHeaders)
    }
    if (req.method !== 'PATCH') return text('GET or PATCH', { status: 405 })
    const auth = await authorizedMutation(ctx, url, req)
    if ('response' in auth) return auth.response
    try {
      const body = await bodyOf(req)
      const result = (await ctx.call(
        'website.updateCustomerProfile',
        { accountId: auth.held.session.accountId, displayName: body.displayName },
        url,
        req,
      )) as { ok?: boolean; account?: Account }
      if (!result.ok || !result.account) return errorResult(ctx, url, req, result)
      return withHeaders(json({ ok: true, customer: publicAccount(result.account) }), privateHeaders)
    } catch (error) {
      return requestError(error)
    }
  }),

  '/api/website/v1/customer/password/change': route(async (ctx, url, req) => {
    if (req.method !== 'POST') return text('POST', { status: 405 })
    const auth = await authorizedMutation(ctx, url, req)
    if ('response' in auth) return auth.response
    try {
      const body = await bodyOf(req)
      const result = (await ctx.call(
        'website.changeCustomerPassword',
        {
          accountId: auth.held.session.accountId,
          currentPassword: body.currentPassword,
          newPassword: body.newPassword,
        },
        url,
        req,
      )) as { ok?: boolean; account?: Account }
      if (!result.ok || !result.account) return errorResult(ctx, url, req, result)
      const started = await startSession(ctx, url, req, result.account)
      if (!started) return errorResult(ctx, url, req, result, 401)
      return withHeaders(
        json({
          ok: true,
          customer: publicAccount(started.session),
          csrfToken: csrfToken(started.token),
        }),
        { ...privateHeaders, 'set-cookie': started.cookie },
      )
    } catch (error) {
      return requestError(error)
    }
  }),
}
