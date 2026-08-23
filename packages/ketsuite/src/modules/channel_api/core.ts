import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { json, withHeaders } from '@ketvietlab/ketjs'
import type {
  HttpRouteContract,
  JsonSchema,
  Route,
  RouteEntry,
  RouteResult,
  ServeContext,
} from '@ketvietlab/ketjs'

export const CHANNEL_API_VERSION = '1.0.0'
export const CHANNEL_PROFILES = ['customer', 'staff', 'pos', 'integration'] as const
export type ChannelProfile = (typeof CHANNEL_PROFILES)[number]

export const profilePrefix = (profile: ChannelProfile): string => `/api/${profile}/v1/`

type Req = Parameters<Route>[1]
type Params = Parameters<Route>[2]

export type ChannelAuth = 'public' | 'optional-customer' | 'customer'

export type ChannelAccount = {
  id: string
  realmId: string
  partnerId: string
  email: string
  displayName: string
  securityVersion: number
}

export type ChannelIdentity = {
  account: ChannelAccount
  accountId: string
  realmId: string
  siteId: string | null
  token: string
  presentation: 'cookie' | 'bearer'
}

/**
 * What the facade resolved before the handler ran: the caller, and the body it
 * declared. A handler that reads either of these is reading something already
 * checked against its own contract, which is the point of routing through here.
 */
export type ChannelRequest = {
  requestId: string
  identity: ChannelIdentity | null
  body: Record<string, unknown>
}

export type ChannelError = {
  code: string
  messageKey: string
  params: Record<string, unknown>
  message: string
  retryable: boolean
  fieldErrors: Record<string, { code: string; messageKey: string; params: Record<string, unknown> }>
  details: Record<string, unknown>
}

export type ChannelOutcome = {
  status?: number
  data?: unknown
  error?: ChannelError
  headers?: Record<string, string>
  nextCursor?: string | null
}

export type ChannelRouteSpec = {
  profile: ChannelProfile
  method: HttpRouteContract['method']
  path: string
  operationId: string
  summary?: string
  auth?: ChannelAuth
  capability?: { key: string; action: string }
  request?: HttpRouteContract['request']
  responses: Record<string, JsonSchema>
  idempotent?: boolean
  /**
   * A ceiling on how often one caller may repeat this.
   *
   * Keyed by the account when there is one and by the network fingerprint when
   * there is not, so a signed-in customer cannot spend the whole allowance of
   * everyone sharing their address, and an anonymous one cannot hide behind a
   * fresh session.
   */
  rateLimit?: { action: string; limit: number; windowMs: number }
  handler: (
    ctx: ServeContext,
    url: URL,
    req: Req,
    params: Params,
    request: ChannelRequest,
  ) => ChannelOutcome | Promise<ChannelOutcome>
}

export type ChannelIdentityResolver = (
  ctx: ServeContext,
  url: URL,
  req: Req,
) => Promise<ChannelIdentity | null>

/**
 * One resolver per profile, registered by whoever owns that profile's credentials.
 *
 * The facade cannot import the customer identity code directly — that code is
 * built on the facade — so the direction is inverted rather than duplicated. It
 * matters that there is exactly one: an `auth` in a contract is enforced here or
 * it is enforced nowhere, and a route enforcing nothing is an open route to
 * everyone except the person reading the declaration.
 */
const identityResolvers = new Map<ChannelProfile, ChannelIdentityResolver>()

export const registerChannelIdentity = (profile: ChannelProfile, resolve: ChannelIdentityResolver): void => {
  identityResolvers.set(profile, resolve)
}

/**
 * Which realm an unauthenticated request belongs to.
 *
 * Registered the same way an identity resolver is, and for the same reason: the
 * code that knows how to answer is built on this facade, so the facade cannot
 * import it. A rate limit needs the answer even when nobody is signed in, or an
 * anonymous caller would share one allowance across every tenant on the box.
 */
type ChannelRealmResolver = (ctx: ServeContext, url: URL, req: Req) => Promise<string | null>
const realmResolvers = new Map<ChannelProfile, ChannelRealmResolver>()

export const registerChannelRealm = (profile: ChannelProfile, resolve: ChannelRealmResolver): void => {
  realmResolvers.set(profile, resolve)
}

const REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/
const requestIdOf = (req: Req): string => {
  const supplied = String(req.headers['x-request-id'] ?? '').trim()
  return REQUEST_ID.test(supplied) ? supplied : `req_${randomUUID()}`
}

const privateHeaders = {
  'cache-control': 'private, no-store',
  vary: 'Accept-Language, Authorization, Cookie',
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS'])

export const channelError = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  code: string,
  options: {
    messageKey?: string
    params?: Record<string, unknown>
    retryable?: boolean
    fieldErrors?: ChannelError['fieldErrors']
    details?: Record<string, unknown>
  } = {},
): ChannelError => {
  const messageKey = options.messageKey ?? code
  const params = options.params ?? {}
  return {
    code,
    messageKey,
    params,
    message: ctx.translate(ctx.localeOf(url, req))(messageKey, params),
    retryable: options.retryable === true,
    fieldErrors: options.fieldErrors ?? {},
    details: options.details ?? {},
  }
}

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex')

export const hostOf = (req: Req): string =>
  String(req.headers.host ?? '')
    .trim()
    .toLowerCase()

/** No Origin is a non-browser caller; a browser sends one on every request that could forge. */
export const sameOrigin = (req: Req): boolean => {
  const origin = String(req.headers.origin ?? '')
  if (!origin) return true
  try {
    return new URL(origin).host.toLowerCase() === hostOf(req)
  } catch {
    return false
  }
}

export const csrfTokenFor = (sessionToken: string): string =>
  sha256(`channel-api-customer-csrf\n${sessionToken}`)

export const safeEqual = (left: string, right: string): boolean => {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export const bearerOf = (req: Req): string | null => {
  const match = /^Bearer\s+([^\s]+)$/i.exec(String(req.headers.authorization ?? '').trim())
  return match?.[1] && match[1].length >= 32 && match[1].length <= 512 ? match[1] : null
}

export const stableHash = (value: unknown): string => {
  const canonical = (held: unknown): string => {
    if (held === null || typeof held !== 'object') return JSON.stringify(held)
    if (Array.isArray(held)) return `[${held.map(canonical).join(',')}]`
    return `{${Object.entries(held as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(',')}}`
  }
  return sha256(canonical(value))
}

export const readJson = async (req: Req, limit = 32 * 1024): Promise<Record<string, unknown>> => {
  const type = String(req.headers['content-type'] ?? '').toLowerCase()
  if (!type.includes('application/json'))
    throw Object.assign(new Error('unsupported media type'), { code: 'E_MEDIA_TYPE' })
  const declared = Number(req.headers['content-length'] ?? 0)
  if (Number.isFinite(declared) && declared > limit)
    throw Object.assign(new Error('payload too large'), { code: 'E_PAYLOAD_TOO_LARGE' })
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk as Uint8Array)
    size += bytes.byteLength
    if (size > limit) throw Object.assign(new Error('payload too large'), { code: 'E_PAYLOAD_TOO_LARGE' })
    chunks.push(bytes)
  }
  let value: unknown
  try {
    value = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
  } catch {
    throw Object.assign(new Error('body must be valid JSON'), { code: 'E_INVALID_BODY' })
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Object.assign(new Error('body must be an object'), { code: 'E_INVALID_BODY' })
  return value as Record<string, unknown>
}

// --- request body validation ----------------------------------------------
//
// The published schema is the contract, so it is also the check. Generating an
// OpenAPI document from a schema nothing enforces produces a document that is
// wrong in the one direction that matters: stricter than the server.

type FieldIssue = { path: string; messageKey: string; params: Record<string, unknown> }

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const jsonTypeOf = (value: unknown): string => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  if (typeof value === 'number') return Number.isInteger(value) ? 'integer' : 'number'
  return typeof value
}

const childPath = (path: string, name: string): string => (path ? `${path}.${name}` : name)

const invalidField = (path: string, params: Record<string, unknown> = {}): FieldIssue => ({
  path,
  messageKey: 'channel_api.error.fieldInvalid',
  params,
})

/**
 * The subset of JSON Schema the channel contracts actually use. Keywords outside
 * it are not silently approximated — they are simply not enforced, and adding one
 * here is the only way to make it mean something.
 */
const collectIssues = (schema: JsonSchema, value: unknown, path: string, issues: FieldIssue[]): void => {
  const expected = schema.type
  if (typeof expected === 'string') {
    const actual = jsonTypeOf(value)
    const matches = actual === expected || (expected === 'number' && actual === 'integer')
    if (!matches) {
      issues.push(invalidField(path, { expected, actual }))
      return
    }
  }
  if (Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
    issues.push(invalidField(path))
    return
  }
  if (typeof value === 'string') {
    if (schema.format === 'email' && !EMAIL.test(value)) issues.push(invalidField(path, { format: 'email' }))
    if (typeof schema.minLength === 'number' && value.length < schema.minLength)
      issues.push(invalidField(path, { minLength: schema.minLength }))
    if (typeof schema.maxLength === 'number' && value.length > schema.maxLength)
      issues.push(invalidField(path, { maxLength: schema.maxLength }))
  }
  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum)
      issues.push(invalidField(path, { minimum: schema.minimum }))
    if (typeof schema.maximum === 'number' && value > schema.maximum)
      issues.push(invalidField(path, { maximum: schema.maximum }))
  }
  if (Array.isArray(value) && schema.items && typeof schema.items === 'object') {
    const items = schema.items as JsonSchema
    value.forEach((item, index) => {
      collectIssues(items, item, childPath(path, String(index)), issues)
    })
    return
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const held = value as Record<string, unknown>
  const properties = (schema.properties as Record<string, JsonSchema> | undefined) ?? {}
  for (const name of (schema.required as string[] | undefined) ?? [])
    if (held[name] === undefined)
      issues.push({ path: childPath(path, name), messageKey: 'channel_api.error.fieldRequired', params: {} })
  for (const [name, item] of Object.entries(held)) {
    const property = properties[name]
    if (!property) {
      if (schema.additionalProperties === false)
        issues.push({ path: childPath(path, name), messageKey: 'channel_api.error.fieldUnknown', params: {} })
      continue
    }
    if (item !== undefined) collectIssues(property, item, childPath(path, name), issues)
  }
}

const bodyIssues = (schema: JsonSchema, body: Record<string, unknown>): FieldIssue[] => {
  const issues: FieldIssue[] = []
  collectIssues(schema, body, '', issues)
  return issues
}

// --- failure mapping -------------------------------------------------------

const FAILURES: Record<string, { status: number; code: string; messageKey: string; retryable?: boolean }> = {
  E_MEDIA_TYPE: {
    status: 415,
    code: 'channel_api.unsupportedMediaType',
    messageKey: 'channel_api.unsupportedMediaType.error',
  },
  E_PAYLOAD_TOO_LARGE: {
    status: 413,
    code: 'channel_api.payloadTooLarge',
    messageKey: 'channel_api.payloadTooLarge.error',
  },
  E_INVALID_BODY: {
    status: 400,
    code: 'channel_api.invalidBody',
    messageKey: 'channel_api.invalidBody.error',
  },
  E_IDEMPOTENCY_CONFLICT: {
    status: 409,
    code: 'channel_api.idempotencyConflict',
    messageKey: 'channel_api.error.idempotencyConflict',
  },
  // The first attempt is still running. A retry is the correct client response,
  // and answering 500 told it the opposite.
  E_IDEMPOTENCY_IN_FLIGHT: {
    status: 409,
    code: 'channel_api.idempotencyInFlight',
    messageKey: 'channel_api.error.idempotencyInFlight',
    retryable: true,
  },
}

export const defineChannelRoute = (spec: ChannelRouteSpec): [string, RouteEntry] => {
  const prefix = profilePrefix(spec.profile)
  const local = spec.path.replace(/^\/+/, '')
  if (!local || local.includes('..')) throw new Error(`invalid channel route path: ${spec.path}`)
  if (!spec.operationId.startsWith(`${spec.profile}.`))
    throw new Error(`channel operationId must start with "${spec.profile}."`)
  if (spec.capability && !/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$/.test(spec.capability.key))
    throw new Error(`invalid capability key: ${spec.capability.key}`)
  const auth: ChannelAuth = spec.auth ?? 'public'
  const path = `${prefix}${local}`
  const contract: HttpRouteContract = {
    profile: spec.profile,
    method: spec.method,
    operationId: spec.operationId,
    ...(spec.summary ? { summary: spec.summary } : {}),
    auth,
    ...(spec.capability ? { capability: spec.capability } : {}),
    ...(spec.request ? { request: spec.request } : {}),
    responses: spec.responses,
    ...(spec.idempotent ? { idempotent: true } : {}),
  }
  return [
    path,
    {
      anonymous: true,
      through: 'channel_api',
      contract,
      handler:
        (ctx: ServeContext): Route =>
        async (url, req, params) => {
          const requestId = requestIdOf(req)
          const envelope = (outcome: ChannelOutcome, extra: Record<string, string> = {}): RouteResult =>
            withHeaders(
              json(
                {
                  data: outcome.error ? null : (outcome.data ?? null),
                  error: outcome.error ?? null,
                  meta: {
                    requestId,
                    serverTime: new Date().toISOString(),
                    nextCursor: outcome.nextCursor ?? null,
                  },
                },
                { status: outcome.status ?? (outcome.error ? 400 : 200) },
              ),
              { ...privateHeaders, 'x-request-id': requestId, ...(outcome.headers ?? {}), ...extra },
            )
          const fail = (
            status: number,
            code: string,
            messageKey: string,
            fieldErrors?: ChannelError['fieldErrors'],
          ): RouteResult =>
            envelope({
              status,
              error: channelError(ctx, url, req, code, {
                messageKey,
                ...(fieldErrors ? { fieldErrors } : {}),
              }),
            })

          if (req.method !== spec.method)
            return envelope(
              {
                status: 405,
                error: channelError(ctx, url, req, 'channel_api.methodNotAllowed', {
                  messageKey: 'channel_api.error.methodNotAllowed',
                  params: { method: spec.method },
                }),
              },
              { allow: spec.method },
            )
          try {
            let identity: ChannelIdentity | null = null
            if (auth !== 'public') {
              const resolve = identityResolvers.get(spec.profile)
              if (!resolve)
                throw Object.assign(
                  new Error(`no identity resolver registered for the "${spec.profile}" profile`),
                  { code: 'E_CHANNEL_IDENTITY' },
                )
              identity = await resolve(ctx, url, req)
              if (!identity && auth === 'customer')
                return fail(401, 'channel_api.unauthenticated', 'channel_api.error.unauthenticated')
            }
            /**
             * A cookie travels on a cross-site request whether or not the caller
             * meant to send it; a Bearer token does not. So the CSRF check follows
             * how the caller proved who they are, not which route they reached —
             * which is what kept it from being remembered per mutation.
             */
            if (identity?.presentation === 'cookie' && !SAFE_METHODS.has(String(req.method))) {
              if (!sameOrigin(req))
                return fail(403, 'channel_api.originMismatch', 'channel_api.error.originMismatch')
              if (!safeEqual(String(req.headers['x-csrf-token'] ?? ''), csrfTokenFor(identity.token)))
                return fail(403, 'channel_api.csrf', 'channel_api.error.csrf')
            }
            if (spec.rateLimit) {
              const realm = identity?.realmId ?? (await realmResolvers.get(spec.profile)?.(ctx, url, req))
              // No realm means no site answered for this host, and there is
              // nothing to meter against; the route below will refuse it anyway.
              if (realm) {
                const who =
                  identity?.accountId ??
                  `net:${sha256(`${req.socket.remoteAddress ?? 'unknown'}\n${String(req.headers['user-agent'] ?? '')}`)}`
                const claimed = (await ctx.callUnchecked(
                  'website.claimChannelRateSlot',
                  {
                    realmId: realm,
                    action: spec.rateLimit.action,
                    key: who,
                    limit: spec.rateLimit.limit,
                    windowMs: spec.rateLimit.windowMs,
                  },
                  url,
                  req,
                )) as { ok?: boolean } | null
                if (claimed?.ok !== true)
                  return envelope({
                    status: 429,
                    error: channelError(ctx, url, req, 'channel_api.rateLimited', {
                      messageKey: 'channel_api.error.rateLimited',
                      retryable: true,
                    }),
                  })
              }
            }
            let body: Record<string, unknown> = {}
            if (spec.request?.body) {
              body = await readJson(req)
              const issues = bodyIssues(spec.request.body, body)
              if (issues.length)
                return fail(
                  422,
                  'channel_api.invalidRequest',
                  'channel_api.error.invalidRequest',
                  Object.fromEntries(
                    issues.map((issue) => [
                      issue.path,
                      {
                        code: 'channel_api.invalidField',
                        messageKey: issue.messageKey,
                        params: issue.params,
                      },
                    ]),
                  ),
                )
            }
            return envelope(await spec.handler(ctx, url, req, params, { requestId, identity, body }))
          } catch (cause) {
            const failure = FAILURES[String((cause as { code?: string }).code ?? '')]
            return envelope({
              status: failure?.status ?? 500,
              error: channelError(ctx, url, req, failure?.code ?? 'channel_api.internalError', {
                messageKey: failure?.messageKey ?? 'channel_api.error.internal',
                retryable: failure ? failure.retryable === true : spec.idempotent === true,
              }),
            })
          }
        },
    },
  ]
}

/**
 * Collect contributed routes, refusing to let one quietly replace another.
 *
 * The framework routes on path alone, so two specs sharing one path are not two
 * endpoints — the later simply wins and the earlier answers 405 forever. That is
 * a composition mistake and it should read as one at startup, not as a puzzling
 * status code much later.
 */
export const routesOf = (...routes: Array<[string, RouteEntry]>): Record<string, RouteEntry> => {
  const named = (entry: RouteEntry): string =>
    typeof entry === 'function' ? 'an unnamed route' : (entry.contract?.operationId ?? 'an unnamed route')
  const collected: Record<string, RouteEntry> = {}
  for (const [path, entry] of routes) {
    const taken = collected[path]
    if (taken)
      throw new Error(
        `two channel routes claim "${path}": ${named(taken)} and ${named(entry)} — one path is one operation, so give them separate paths`,
      )
    collected[path] = entry
  }
  return collected
}

export type { RouteResult }
