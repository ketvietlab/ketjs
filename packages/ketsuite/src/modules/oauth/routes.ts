import { createHash, timingSafeEqual } from 'node:crypto'
import { json, parseCookies, text, withHeaders } from 'ketjs'
import type { Route, RouteEntry, ServeContext } from 'ketjs'
import {
  discoverOidc,
  exchangeOidcCode,
  oidcAuthorizationUrl,
  OauthProtocolError,
  verifyOidcIdToken,
} from './protocol.ts'

type Req = Parameters<Route>[1]
type Provider = {
  id: string
  code: string
  name: string
  issuer: string
  clientId: string
  clientAuthMethod: 'none' | 'client_secret_basic' | 'client_secret_post'
  clientSecretEnv?: string | null
  scopes: string
  redirectUri: string
  allowedAlgorithms: string
  updatedAt: string
}
type Begun = { ok: boolean; state?: string; nonce?: string; codeVerifier?: string; errors?: ErrorRow[] }
type Claimed = {
  ok: boolean
  providerId?: string
  mode?: string
  linkUserId?: string | null
  issuer?: string
  redirectUri?: string
  nonceDigest?: string
  codeVerifier?: string
  discovery?: {
    issuer: string
    authorizationEndpoint: string
    tokenEndpoint: string
    jwksUri: string
  }
  returnTo?: string
  providerUpdatedAt?: string
  errors?: ErrorRow[]
}
type Verdict = {
  ok: boolean
  userId?: string
  companies?: string[]
  defaultCompanyId?: string | null
  branches?: string[]
  defaultBranchId?: string | null
  securityVersion?: number
  linked?: boolean
  errors?: ErrorRow[]
}
type ErrorRow = { code?: string }

const FLOW_COOKIE = 'ket_oauth_flow'
const hash = (value: string): Buffer => createHash('sha256').update(value).digest()
const sameSecret = (left: string, right: string): boolean => timingSafeEqual(hash(left), hash(right))
const decodedCookie = (value: string | undefined): string => {
  try {
    return decodeURIComponent(value ?? '')
  } catch {
    return ''
  }
}
const wantsHtml = (req: Req): boolean => String(req.headers.accept ?? '').includes('text/html')
const hasUnsafePathCharacter = (value: string): boolean =>
  value.includes('\\') ||
  [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })
const safeReturnTo = (value: string | null): string => {
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
const redirect = (to: string, cookie?: string) =>
  withHeaders(text('', { status: 303 }), { location: to, ...(cookie ? { 'set-cookie': cookie } : {}) })
const failurePath = (url: URL, code: string): string => {
  const target = new URL('/login', 'http://ket.local')
  target.searchParams.set('oauth_error', code)
  const lang = url.searchParams.get('lang')
  if (lang) target.searchParams.set('lang', lang)
  return `${target.pathname}${target.search}`
}
const firstError = (value: { errors?: ErrorRow[] } | null | undefined, fallback: string): string =>
  value?.errors?.[0]?.code ?? fallback
const flowCookie = (provider: Provider, state: string): string =>
  [
    `${FLOW_COOKIE}=${encodeURIComponent(`${provider.code}.${state}`)}`,
    'Path=/auth/oauth',
    'HttpOnly',
    'SameSite=Lax',
    ...(provider.redirectUri.startsWith('https://') ? ['Secure'] : []),
    'Max-Age=600',
  ].join('; ')

const errorResponse = (url: URL, req: Req, code: string) =>
  wantsHtml(req) ? redirect(failurePath(url, code)) : json({ ok: false, code }, { status: 401 })

const recordFailure = async (ctx: ServeContext, url: URL, req: Req, provider: string, reason: string) => {
  await ctx
    .call(
      'user.recordSecurityEvent',
      { event: 'oauth.login.failure', metadata: { provider, reason } },
      url,
      req,
    )
    .catch(() => undefined)
}

const start =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const provider = (await ctx.call(
      'oauth.providerForLogin',
      { code: params.code },
      url,
      req,
    )) as Provider | null
    if (!provider) return errorResponse(url, req, 'oauth.error.providerUnavailable')
    const sessions = await ctx.sessionsOf(url, req)
    if (!sessions) return text('this deployment has not turned sessions on', { status: 501 })
    const mode = url.searchParams.get('mode') === 'link' ? 'link' : 'login'
    const current = await sessions.of(req)
    if (mode === 'link' && !current) return errorResponse(url, req, 'oauth.error.linkUnauthorized')
    if (mode === 'login' && current) return redirect(safeReturnTo(url.searchParams.get('next')))
    try {
      const discovery = await discoverOidc(provider.issuer)
      const begun = (await ctx.call(
        'oauth.beginTransaction',
        {
          providerId: provider.id,
          mode,
          ...(current ? { linkUserId: current.userId } : {}),
          returnTo: safeReturnTo(url.searchParams.get('next')),
          discovery,
        },
        url,
        req,
      )) as Begun
      if (!begun.ok || !begun.state || !begun.nonce || !begun.codeVerifier)
        return errorResponse(url, req, firstError(begun, 'oauth.error.transactionInvalid'))
      const location = oidcAuthorizationUrl(discovery, {
        clientId: provider.clientId,
        redirectUri: provider.redirectUri,
        scope: provider.scopes,
        state: begun.state,
        nonce: begun.nonce,
        codeVerifier: begun.codeVerifier,
      })
      return redirect(location, flowCookie(provider, begun.state))
    } catch (error) {
      const code = error instanceof OauthProtocolError ? error.code : 'oauth.error.providerUnavailable'
      await recordFailure(ctx, url, req, provider.code, code)
      return errorResponse(url, req, code)
    }
  }

const callback =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const provider = (await ctx.call(
      'oauth.providerForLogin',
      { code: params.code },
      url,
      req,
    )) as Provider | null
    if (!provider) return errorResponse(url, req, 'oauth.error.providerUnavailable')
    const state = url.searchParams.get('state') ?? ''
    const heldCookie = decodedCookie(parseCookies(req.headers.cookie as string | undefined)[FLOW_COOKIE])
    if (!state || !sameSecret(heldCookie, `${provider.code}.${state}`)) {
      await recordFailure(ctx, url, req, provider.code, 'oauth.error.transactionInvalid')
      return errorResponse(url, req, 'oauth.error.transactionInvalid')
    }
    const claimed = (await ctx.call(
      'oauth.claimTransaction',
      { providerId: provider.id, state },
      url,
      req,
    )) as Claimed
    if (!claimed.ok || !claimed.discovery || !claimed.codeVerifier || !claimed.nonceDigest) {
      const code = firstError(claimed, 'oauth.error.transactionInvalid')
      await recordFailure(ctx, url, req, provider.code, code)
      return errorResponse(url, req, code)
    }
    const sessions = await ctx.sessionsOf(url, req)
    if (!sessions) return text('this deployment has not turned sessions on', { status: 501 })
    if (claimed.mode === 'login' && (await sessions.of(req)))
      return redirect(safeReturnTo(claimed.returnTo ?? null))
    if (url.searchParams.has('error')) {
      await recordFailure(ctx, url, req, provider.code, 'oauth.error.providerDenied')
      return errorResponse(url, req, 'oauth.error.providerDenied')
    }
    const code = url.searchParams.get('code') ?? ''
    if (!code || code.length > 8192) return errorResponse(url, req, 'oauth.error.authorizationCode')

    try {
      const secret = provider.clientSecretEnv ? process.env[provider.clientSecretEnv] : null
      const exchanged = await exchangeOidcCode(
        claimed.discovery,
        {
          issuer: provider.issuer,
          clientId: provider.clientId,
          clientAuthMethod: provider.clientAuthMethod,
          clientSecret: secret,
          allowedAlgorithms: provider.allowedAlgorithms.split(/\s+/).filter(Boolean),
        },
        {
          code,
          redirectUri: String(claimed.redirectUri),
          codeVerifier: claimed.codeVerifier,
        },
      )
      const identity = await verifyOidcIdToken(
        exchanged.idToken,
        claimed.discovery,
        {
          clientId: provider.clientId,
          allowedAlgorithms: provider.allowedAlgorithms.split(/\s+/).filter(Boolean),
        },
        { nonceDigest: claimed.nonceDigest },
      )
      const verdict = (await ctx.call(
        'oauth.resolveLogin',
        {
          providerId: provider.id,
          providerUpdatedAt: claimed.providerUpdatedAt,
          mode: claimed.mode,
          ...(claimed.linkUserId ? { linkUserId: claimed.linkUserId } : {}),
          issuer: identity.issuer,
          subject: identity.subject,
          ...(identity.email ? { email: identity.email } : {}),
          ...(identity.emailVerified !== undefined ? { emailVerified: identity.emailVerified } : {}),
          ...(identity.name ? { displayName: identity.name } : {}),
          ...(identity.preferredUsername ? { preferredUsername: identity.preferredUsername } : {}),
        },
        url,
        req,
      )) as Verdict
      if (!verdict.ok || !verdict.userId) {
        const reason = firstError(verdict, 'oauth.error.identityUnlinked')
        await recordFailure(ctx, url, req, provider.code, reason)
        return errorResponse(url, req, reason)
      }
      if (verdict.linked) return redirect(safeReturnTo(claimed.returnTo ?? null))
      const companies = verdict.companies ?? []
      if (!companies.length) return errorResponse(url, req, 'oauth.error.userUnavailable')
      const { cookie } = await sessions.start({
        userId: verdict.userId,
        companies,
        company: verdict.defaultCompanyId ?? null,
        branches: verdict.branches ?? [],
        branch: verdict.defaultBranchId ?? null,
        securityVersion: verdict.securityVersion ?? 0,
      })
      return redirect(safeReturnTo(claimed.returnTo ?? null), cookie)
    } catch (error) {
      const reason = error instanceof OauthProtocolError ? error.code : 'oauth.error.loginFailed'
      await recordFailure(ctx, url, req, provider.code, reason)
      return errorResponse(url, req, reason)
    }
  }

export const routes: Record<string, RouteEntry> = {
  '/auth/oauth/{code}/start': { anonymous: true, handler: start },
  '/auth/oauth/{code}/callback': { anonymous: true, handler: callback },
}
