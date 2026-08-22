import { randomBytes, randomUUID } from 'node:crypto'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import {
  CHANNEL_API_VERSION,
  bearerOf,
  channelError,
  csrfTokenFor,
  defineChannelRoute,
  hostOf,
  registerChannelIdentity,
  routesOf,
  sameOrigin,
  sha256,
  stableHash,
} from './core.ts'
import type { ChannelAccount, ChannelIdentity } from './core.ts'

type Req = Parameters<Route>[1]
type Account = ChannelAccount
type Identity = ChannelIdentity

const COOKIE = 'ket_customer_session'
const schema = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  ...(required.length ? { required } : {}),
})
const string = { type: 'string' }
const authBody = schema({ email: { type: 'string', format: 'email' }, password: string }, [
  'email',
  'password',
])
const registerBody = schema(
  { displayName: string, email: { type: 'string', format: 'email' }, password: string },
  ['displayName', 'email', 'password'],
)
const envelope = schema({ data: {}, error: {}, meta: { type: 'object' } })

const hostnameOf = (req: Req): string => {
  try {
    return new URL(`http://${hostOf(req)}`).hostname.toLowerCase()
  } catch {
    return ''
  }
}
const cookieOf = (req: Req): string | null => {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [name, ...value] = part.trim().split('=')
    if (name === COOKIE) return decodeURIComponent(value.join('='))
  }
  return null
}
const cookieHeader = (req: Req, token: string, maxAge: number): string => {
  const forwarded = String(req.headers['x-forwarded-proto'] ?? '').toLowerCase()
  const secure = forwarded === 'https' || (req.socket as { encrypted?: boolean }).encrypted === true
  return [
    `${COOKIE}=${encodeURIComponent(token)}`,
    'Path=/api/customer/v1',
    'HttpOnly',
    'SameSite=Lax',
    ...(secure ? ['Secure'] : []),
    `Max-Age=${Math.max(0, Math.floor(maxAge))}`,
  ].join('; ')
}
const publicAccount = (account: Account) => ({
  id: account.id,
  displayName: account.displayName,
  email: account.email,
})

/**
 * Which realm — and so which site — this request belongs to.
 *
 * The host answers for a browser. A native client has no meaningful Host, so it
 * names the realm outright and the realm's primary site answers instead. Both
 * paths are needed by every profile route that reads site-scoped data, which is
 * why this is exported rather than kept for authentication.
 */
export const channelRealmContext = async (ctx: ServeContext, url: URL, req: Req) => {
  const host = hostnameOf(req)
  if (host) {
    const site = (await ctx.callUnchecked('website.resolveSite', { host }, url, req)) as {
      id?: string
    } | null
    if (site?.id) {
      const realm = (await ctx.callUnchecked(
        'website.customerRealmForSite',
        { siteId: site.id },
        url,
        req,
      )) as {
        id?: string
        key?: string
      } | null
      if (realm?.id)
        return { siteId: String(site.id), realmId: String(realm.id), realmKey: String(realm.key ?? realm.id) }
    }
  }
  const key = String(req.headers['x-channel-realm'] ?? '').trim()
  if (!key) return null
  const realm = (await ctx.callUnchecked('website.customerRealmByKey', { key }, url, req)) as {
    id?: string
    key?: string
  } | null
  if (!realm?.id) return null
  const link = (await ctx.callUnchecked(
    'website.primaryCustomerSiteForRealm',
    { realmId: realm.id },
    url,
    req,
  )) as {
    siteId?: string
  } | null
  return {
    siteId: link?.siteId ? String(link.siteId) : null,
    realmId: String(realm.id),
    realmKey: String(realm.key ?? key),
  }
}

const startCookieSession = async (ctx: ServeContext, url: URL, req: Req, account: Account) => {
  const token = randomBytes(32).toString('base64url')
  const session = (await ctx.callUnchecked(
    'website.startCustomerSession',
    { id: randomUUID(), accountId: account.id, tokenDigest: sha256(token), networkFingerprint: null },
    url,
    req,
  )) as { absoluteExpiresAt?: string } | null
  if (!session?.absoluteExpiresAt) return null
  const maxAge = (new Date(session.absoluteExpiresAt).getTime() - Date.now()) / 1000
  return { token, cookie: cookieHeader(req, token, maxAge), csrfToken: csrfTokenFor(token) }
}

const issueTokens = async (ctx: ServeContext, url: URL, req: Req, account: Account) => {
  const accessToken = randomBytes(32).toString('base64url')
  const refreshToken = randomBytes(48).toString('base64url')
  const grant = (await ctx.callUnchecked(
    'website.issueCustomerTokenGrant',
    {
      id: randomUUID(),
      accountId: account.id,
      accessDigest: sha256(accessToken),
      refreshDigest: sha256(refreshToken),
    },
    url,
    req,
  )) as { accessExpiresAt?: string; refreshExpiresAt?: string } | null
  return grant?.accessExpiresAt
    ? {
        tokenType: 'Bearer',
        accessToken,
        refreshToken,
        accessExpiresAt: grant.accessExpiresAt,
        refreshExpiresAt: grant.refreshExpiresAt,
      }
    : null
}

export const customerIdentity = async (ctx: ServeContext, url: URL, req: Req): Promise<Identity | null> => {
  const bearer = bearerOf(req)
  if (bearer) {
    const grant = (await ctx.callUnchecked(
      'website.resolveCustomerAccessToken',
      { accessDigest: sha256(bearer) },
      url,
      req,
    )) as { realmId?: string; account?: Account } | null
    if (!grant?.account || !grant.realmId) return null
    const link = (await ctx.callUnchecked(
      'website.primaryCustomerSiteForRealm',
      { realmId: grant.realmId },
      url,
      req,
    )) as {
      siteId?: string
    } | null
    return {
      account: grant.account,
      accountId: grant.account.id,
      realmId: String(grant.realmId),
      siteId: link?.siteId ? String(link.siteId) : null,
      token: bearer,
      presentation: 'bearer',
    }
  }
  const token = cookieOf(req)
  const context = await channelRealmContext(ctx, url, req)
  if (!token || !context?.siteId) return null
  const session = (await ctx.callUnchecked(
    'website.resolveCustomerSession',
    { siteId: context.siteId, tokenDigest: sha256(token) },
    url,
    req,
  )) as (Account & { accountId: string }) | null
  if (!session) return null
  return {
    account: { ...session, id: session.accountId },
    accountId: session.accountId,
    realmId: session.realmId,
    siteId: context.siteId,
    token,
    presentation: 'cookie',
  }
}

registerChannelIdentity('customer', customerIdentity)

const authFailure = (ctx: ServeContext, url: URL, req: Req, result: unknown, status = 422) => {
  const errors = Array.isArray((result as { errors?: unknown })?.errors)
    ? ((result as { errors: Array<{ field?: string; message?: string; params?: Record<string, unknown> }> })
        .errors ?? [])
    : []
  const first = errors[0]
  const messageKey = first?.message ?? 'website.customer.error.invalidRequest'
  return {
    status: messageKey === 'website.customer.error.rateLimit' ? 429 : status,
    error: channelError(ctx, url, req, messageKey, {
      messageKey,
      params: first?.params ?? {},
      retryable: messageKey === 'website.customer.error.rateLimit',
      fieldErrors: Object.fromEntries(
        errors
          .filter((error) => error.field)
          .map((error) => [
            String(error.field),
            {
              code: error.message ?? messageKey,
              messageKey: error.message ?? messageKey,
              params: error.params ?? {},
            },
          ]),
      ),
    }),
  }
}

/**
 * Registration and sign-in mint the cookie, so there is no session for the facade
 * to key a CSRF check on yet. The origin check is the one that applies here: it
 * stops a third-party page from silently logging a visitor into an account it
 * controls.
 */
const authenticate = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  body: Record<string, unknown>,
  register: boolean,
  presentation: 'cookie' | 'bearer',
) => {
  if (presentation === 'cookie' && !sameOrigin(req))
    return {
      status: 403,
      error: channelError(ctx, url, req, 'website.customer.error.originMismatch'),
    }
  const context = await channelRealmContext(ctx, url, req)
  if (!context)
    return { status: 404, error: channelError(ctx, url, req, 'website.customer.error.realmUnavailable') }
  const rateKey = sha256(
    `${req.socket.remoteAddress ?? 'unknown'}\n${String(req.headers['user-agent'] ?? '')}`,
  )
  const result = (await ctx.callUnchecked(
    register ? 'website.registerCustomer' : 'website.authenticateCustomer',
    register
      ? {
          realmId: context.realmId,
          displayName: body.displayName,
          email: body.email,
          password: body.password,
          rateKey,
        }
      : { realmId: context.realmId, email: body.email, password: body.password, rateKey },
    url,
    req,
  )) as { ok?: boolean; account?: Account; errors?: unknown }
  if (!result.ok || !result.account) return authFailure(ctx, url, req, result, register ? 422 : 401)
  if (presentation === 'cookie') {
    const session = await startCookieSession(ctx, url, req, result.account)
    if (!session) return authFailure(ctx, url, req, {}, 401)
    return {
      status: register ? 201 : 200,
      data: { customer: publicAccount(result.account), csrfToken: session.csrfToken },
      headers: { 'set-cookie': session.cookie },
    }
  }
  const tokens = await issueTokens(ctx, url, req, result.account)
  if (!tokens) return authFailure(ctx, url, req, {}, 401)
  return { status: register ? 201 : 200, data: { customer: publicAccount(result.account), ...tokens } }
}

export const customerRoutes = routesOf(
  defineChannelRoute({
    profile: 'customer',
    method: 'GET',
    path: 'bootstrap',
    operationId: 'customer.bootstrap',
    summary: 'Resolve the customer channel context and live capabilities.',
    auth: 'optional-customer',
    responses: { '200': envelope },
    handler: async (ctx, url, req, _params, request) => {
      const context = await channelRealmContext(ctx, url, req)
      const identity = request.identity
      const live = await ctx.live(req)
      const grouped = new Map<string, { actions: Set<string>; blocked: Set<string> }>()
      for (const entry of Object.values(ctx.manifest.routes)) {
        const contract = entry.contract
        if (contract?.profile !== 'customer' || !contract.capability) continue
        const current = grouped.get(contract.capability.key) ?? {
          actions: new Set<string>(),
          blocked: new Set<string>(),
        }
        // A capability can be served by more than one module, so "blocked" is a
        // property of an action, not of the group: one switched-off module must
        // not hide what the others still answer.
        if (live.disabledModules?.includes(entry.by)) current.blocked.add(contract.capability.action)
        else current.actions.add(contract.capability.action)
        grouped.set(contract.capability.key, current)
      }
      const capabilities = [...grouped.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => ({
          key,
          mode: item.actions.size ? 'enabled' : 'blocked',
          actions: [...item.actions].sort(),
          ...(item.blocked.size ? { reason: 'MODULE_NOT_INSTALLED' } : {}),
        }))
      return {
        data: {
          contractVersion: CHANNEL_API_VERSION,
          clientPolicy: null,
          tenant: {
            realmId: context?.realmId ?? identity?.realmId ?? null,
            siteId: context?.siteId ?? identity?.siteId ?? null,
          },
          customer: identity ? publicAccount(identity.account) : null,
          capabilities,
          capabilityRevision: stableHash(capabilities),
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'POST',
    path: 'auth/session/register',
    operationId: 'customer.auth.session.register',
    request: { body: registerBody },
    responses: { '201': envelope },
    handler: (ctx, url, req, _params, request) => authenticate(ctx, url, req, request.body, true, 'cookie'),
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'POST',
    path: 'auth/session/login',
    operationId: 'customer.auth.session.login',
    request: { body: authBody },
    responses: { '200': envelope },
    handler: (ctx, url, req, _params, request) => authenticate(ctx, url, req, request.body, false, 'cookie'),
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'POST',
    path: 'auth/token/register',
    operationId: 'customer.auth.token.register',
    request: { body: registerBody },
    responses: { '201': envelope },
    handler: (ctx, url, req, _params, request) => authenticate(ctx, url, req, request.body, true, 'bearer'),
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'POST',
    path: 'auth/token',
    operationId: 'customer.auth.token.issue',
    request: { body: authBody },
    responses: { '200': envelope },
    handler: (ctx, url, req, _params, request) => authenticate(ctx, url, req, request.body, false, 'bearer'),
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'POST',
    path: 'auth/token/refresh',
    operationId: 'customer.auth.token.refresh',
    request: { body: schema({ refreshToken: string }, ['refreshToken']) },
    responses: { '200': envelope },
    idempotent: true,
    handler: async (ctx, url, req, _params, request) => {
      const key = String(req.headers['idempotency-key'] ?? '').trim()
      if (!key)
        return {
          status: 400,
          error: channelError(ctx, url, req, 'channel_api.idempotencyRequired', {
            messageKey: 'channel_api.error.idempotencyRequired',
          }),
        }
      const refreshToken = String(request.body.refreshToken ?? '')
      // Deterministic for this old-token/key pair so an ambiguous response can be
      // retried and return credentials matching the domain-level replay record.
      const accessToken = Buffer.from(sha256(`access\n${refreshToken}\n${key}`), 'hex').toString('base64url')
      const nextRefreshToken = Buffer.from(
        `${sha256(`refresh:1\n${refreshToken}\n${key}`)}${sha256(`refresh:2\n${refreshToken}\n${key}`)}`,
        'hex',
      ).toString('base64url')
      const result = (await ctx.callUnchecked(
        'website.rotateCustomerTokenGrant',
        {
          refreshDigest: sha256(refreshToken),
          nextAccessDigest: sha256(accessToken),
          nextRefreshDigest: sha256(nextRefreshToken),
        },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: `customer:refresh:${sha256(refreshToken)}` },
      )) as { account?: Account; accessExpiresAt?: string; refreshExpiresAt?: string } | null
      if (!result?.account)
        return {
          status: 401,
          error: channelError(ctx, url, req, 'channel_api.invalidRefreshToken', {
            messageKey: 'channel_api.error.invalidRefreshToken',
          }),
        }
      return {
        data: {
          customer: publicAccount(result.account),
          tokenType: 'Bearer',
          accessToken,
          refreshToken: nextRefreshToken,
          accessExpiresAt: result.accessExpiresAt,
          refreshExpiresAt: result.refreshExpiresAt,
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'POST',
    path: 'auth/logout',
    operationId: 'customer.auth.logout',
    auth: 'customer',
    responses: { '200': envelope },
    handler: async (ctx, url, req, _params, request) => {
      const identity = request.identity!
      if (identity.presentation === 'cookie') {
        await ctx.callUnchecked(
          'website.revokeCustomerSession',
          { tokenDigest: sha256(identity.token), reason: 'logout' },
          url,
          req,
        )
        return { data: { loggedOut: true }, headers: { 'set-cookie': cookieHeader(req, '', 0) } }
      }
      await ctx.callUnchecked(
        'website.revokeCustomerTokenGrant',
        { accessDigest: sha256(identity.token), reason: 'logout' },
        url,
        req,
      )
      return { data: { loggedOut: true } }
    },
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'GET',
    path: 'me',
    operationId: 'customer.me',
    auth: 'customer',
    responses: { '200': envelope },
    capability: { key: 'channel_api.customer_account', action: 'read' },
    handler: (_ctx, _url, _req, _params, request) => ({
      data: { customer: publicAccount(request.identity!.account) },
    }),
  }),
)
