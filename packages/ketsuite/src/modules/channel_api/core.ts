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
export type ChannelIdentityPresentation = 'cookie' | 'bearer'

export const profilePrefix = (profile: ChannelProfile): string => `/api/${profile}/v1/`

type Req = Parameters<Route>[1]
type Params = Parameters<Route>[2]

/**
 * Whether a route needs to know who is calling.
 *
 * Profile-neutral, because the facade already knows which profile a route
 * belongs to and asks that profile's resolver. The first two profiles named the
 * customer in the value — an accident of being written first, and one that would
 * have needed a new pair of names per profile. The old spellings still work.
 */
export type ChannelAuth =
  | 'public'
  | 'optional'
  | 'required'
  /** @deprecated spell it `optional` — the profile is already on the route. */
  | 'optional-customer'
  /** @deprecated spell it `required` — the profile is already on the route. */
  | 'customer'

export const resolves = (auth: ChannelAuth): boolean => auth !== 'public'
export const demands = (auth: ChannelAuth): boolean => auth === 'required' || auth === 'customer'

export type ChannelAccount = {
  id: string
  realmId: string
  partnerId: string
  email: string
  displayName: string
  securityVersion: number
}

/** Who a shopper is: an account in a realm, on a site. */
export type CustomerIdentity = {
  account: ChannelAccount
  accountId: string
  realmId: string
  siteId: string | null
  token: string
  presentation: ChannelIdentityPresentation
}

/** The name every customer route already imports. */
export type ChannelIdentity = CustomerIdentity

/**
 * Who a member of staff is: entirely the verified session.
 *
 * Nothing here comes off the wire. The session is re-resolved from live rows on
 * every request, so revoking a membership or archiving a company takes effect on
 * the next call rather than whenever a token happens to expire — and a staff
 * caller cannot name the company they want to act in, which is the whole point.
 */
export type StaffIdentity = {
  userId: string
  /** The company writes land in. Null when the session has not chosen one. */
  companyId: string | null
  branchId: string | null
  companies: readonly string[]
  branches: readonly string[] | null
  securityVersion: number
  sessionId: string
  presentation: ChannelIdentityPresentation
}

/**
 * Who a POS command is acting as.
 *
 * Every field is resolved from the live device grant and POS session. Routes
 * must not copy company or configuration scope from request input: a terminal
 * can only act inside the scope the server placed on this identity.
 */
export type PosIdentity = {
  operatorId: string
  deviceId: string
  companyId: string
  posConfigId: string
  grantId: string
  sessionId: string
  securityVersion: number
  presentation: 'bearer'
}

/**
 * Which identity a profile hands its routes.
 *
 * `integration` remains `never` on purpose: its prefix is reserved but its
 * identity is not designed, so writing a route for one is a type error rather
 * than a route that silently trusts another profile's session.
 */
export interface ChannelIdentities {
  customer: CustomerIdentity
  staff: StaffIdentity
  pos: PosIdentity
  integration: never
}

export type ChannelIdentityFor<P extends ChannelProfile> = ChannelIdentities[P]

/**
 * What the facade resolved before the handler ran: the caller, and the body it
 * declared. A handler that reads either of these is reading something already
 * checked against its own contract, which is the point of routing through here.
 */
export type ChannelRequest<P extends ChannelProfile = 'customer'> = {
  requestId: string
  identity: ChannelIdentityFor<P> | null
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

export type ChannelRouteSpec<P extends ChannelProfile = 'customer'> = {
  profile: P
  method: HttpRouteContract['method']
  path: string
  operationId: string
  summary?: string
  auth?: ChannelAuth
  /** OpenAPI schemes for credentials verified by the handler's upstream identity boundary. */
  credentials?: string[]
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
    request: ChannelRequest<P>,
  ) => ChannelOutcome | Promise<ChannelOutcome>
}

export type ChannelIdentityResolver<P extends ChannelProfile = ChannelProfile> = (
  ctx: ServeContext,
  url: URL,
  req: Req,
) => Promise<ChannelIdentityFor<P> | null>

export type ChannelCapabilityAuthorizer<P extends ChannelProfile = ChannelProfile> = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  identity: ChannelIdentityFor<P>,
  capability: { key: string; action: string },
) => boolean | Promise<boolean>

export type ChannelCapabilityAuthorizerRegistration<P extends ChannelProfile = ChannelProfile> = {
  /** Stable package/module owner; reloading the same owner is idempotent. */
  owner: string
  authorize: ChannelCapabilityAuthorizer<P>
}

export type ChannelCapability = { key: string; action: string }
export type AuthorizedChannelCapability = { key: string; actions: string[] }

/**
 * One resolver per profile, registered by whoever owns that profile's credentials.
 *
 * The facade cannot import the customer identity code directly — that code is
 * built on the facade — so the direction is inverted rather than duplicated. It
 * matters that there is exactly one: an `auth` in a contract is enforced here or
 * it is enforced nowhere, and a route enforcing nothing is an open route to
 * everyone except the person reading the declaration.
 */
const identityResolvers = new Map<ChannelProfile, ChannelIdentityResolver<ChannelProfile>>()
const capabilityAuthorizers = new Map<
  ChannelProfile,
  ChannelCapabilityAuthorizerRegistration<ChannelProfile>
>()

/**
 * Enforce capability metadata for one channel profile at the same boundary that
 * resolves its identity. Profiles opt in because their role stores are owned by
 * different modules; once registered, every capability-declared route in that
 * profile is fail-closed through this authorizer.
 */
export const registerChannelCapabilityAuthorizer = <P extends ChannelProfile>(
  profile: P,
  registration: ChannelCapabilityAuthorizerRegistration<P>,
): void => {
  const existing = capabilityAuthorizers.get(profile)
  if (existing?.owner === registration.owner) return
  if (existing)
    throw new Error(
      `channel capability authorizer for "${profile}" is owned by "${existing.owner}", not "${registration.owner}"`,
    )
  capabilityAuthorizers.set(profile, registration as ChannelCapabilityAuthorizerRegistration<ChannelProfile>)
}

/**
 * Discover only capabilities the composed deployment serves and this live
 * identity may use. The same authorizer that guards each route is the source of
 * truth, so bootstrap cannot advertise an action that the next request rejects.
 */
export const authorizedChannelCapabilities = async <P extends ChannelProfile>(
  profile: P,
  ctx: ServeContext,
  url: URL,
  req: Req,
  identity: ChannelIdentityFor<P>,
): Promise<AuthorizedChannelCapability[]> => {
  const declared = new Map<string, ChannelCapability>()
  for (const entry of Object.values((await ctx.live(req)).routes)) {
    const contract = entry.contract
    if (contract?.profile !== profile || !contract.capability) continue
    const capability = contract.capability
    declared.set(`${capability.key}\0${capability.action}`, capability)
  }
  const authorizer = capabilityAuthorizers.get(profile)
  const allowed = authorizer
    ? (
        await Promise.all(
          [...declared.values()].map(async (capability) => ({
            capability,
            allowed: await authorizer.authorize(ctx, url, req, identity, capability),
          })),
        )
      )
        .filter((result) => result.allowed)
        .map((result) => result.capability)
    : [...declared.values()]
  const grouped = new Map<string, Set<string>>()
  for (const capability of allowed) {
    const actions = grouped.get(capability.key) ?? new Set<string>()
    actions.add(capability.action)
    grouped.set(capability.key, actions)
  }
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, actions]) => ({ key, actions: [...actions].sort() }))
}

export type ChannelIdentityPresentationResolver<P extends ChannelProfile = ChannelProfile> = {
  /** Stable package/module owner; reloading the same owner is idempotent. */
  owner: string
  presentation: ChannelIdentityPresentation
  presented: (req: Req) => boolean
  resolve: ChannelIdentityResolver<P>
}

const identityPresentationResolvers = new Map<
  ChannelProfile,
  Map<ChannelIdentityPresentation, ChannelIdentityPresentationResolver<ChannelProfile>>
>()

export const registerChannelIdentity = <P extends ChannelProfile>(
  profile: P,
  resolve: ChannelIdentityResolver<P>,
): void => {
  identityResolvers.set(profile, resolve as ChannelIdentityResolver<ChannelProfile>)
}

/**
 * Add one credential presentation without replacing another profile resolver.
 *
 * A private deployment can register its staff Bearer resolver beside the public
 * cookie resolver. Registration order cannot choose a winner: duplicate
 * presentations are rejected, and a request presenting more than one kind of
 * credential fails before either resolver sees it.
 */
export const registerChannelIdentityPresentation = <P extends ChannelProfile>(
  profile: P,
  registration: ChannelIdentityPresentationResolver<P>,
): void => {
  const registered =
    identityPresentationResolvers.get(profile) ??
    new Map<ChannelIdentityPresentation, ChannelIdentityPresentationResolver<ChannelProfile>>()
  const existing = registered.get(registration.presentation)
  if (existing?.owner === registration.owner) return
  if (existing)
    throw new Error(
      `channel identity presentation "${registration.presentation}" for "${profile}" is owned by "${existing.owner}", not "${registration.owner}"`,
    )
  registered.set(
    registration.presentation,
    registration as ChannelIdentityPresentationResolver<ChannelProfile>,
  )
  identityPresentationResolvers.set(profile, registered)
}

export type ChannelCredentialFailure = 'invalid' | 'expired' | 'revoked' | 'identity-context'

/** A credential rejection safe to map without logging or reflecting its secret. */
export const channelCredentialFailure = (reason: ChannelCredentialFailure): Error =>
  Object.assign(new Error('channel credential rejected'), {
    code: `E_CHANNEL_CREDENTIAL_${reason.replace('-', '_').toUpperCase()}`,
  })

const resolveChannelIdentity = async <P extends ChannelProfile>(
  profile: P,
  ctx: ServeContext,
  url: URL,
  req: Req,
): Promise<ChannelIdentityFor<P> | null> => {
  const registered = identityPresentationResolvers.get(profile)
  if (!registered) {
    const resolve = identityResolvers.get(profile)
    if (!resolve)
      throw Object.assign(new Error(`no identity resolver registered for the "${profile}" profile`), {
        code: 'E_CHANNEL_IDENTITY',
      })
    return (await resolve(ctx, url, req)) as ChannelIdentityFor<P> | null
  }

  const presented = new Set<ChannelIdentityPresentation>()
  if (String(req.headers.authorization ?? '').trim()) presented.add('bearer')
  for (const registration of registered.values())
    if (registration.presented(req)) presented.add(registration.presentation)
  if (presented.size > 1)
    throw Object.assign(new Error('ambiguous channel credential presentations'), {
      code: 'E_CHANNEL_CREDENTIAL_CONFLICT',
    })

  const presentation = presented.values().next().value as ChannelIdentityPresentation | undefined
  if (!presentation) return null
  const registration = registered.get(presentation)
  if (!registration) return null
  const identity = (await registration.resolve(ctx, url, req)) as ChannelIdentityFor<P> | null
  if (identity && identity.presentation !== presentation)
    throw Object.assign(new Error('channel identity presentation does not match its resolver'), {
      code: 'E_CHANNEL_IDENTITY',
    })
  return identity
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

/**
 * The three things the facade needs from an identity, whichever profile it came
 * from: the secret only the real caller holds, who they are, and which tenant
 * they are in. Everything else is the profile's own business.
 */
type AnyIdentity = CustomerIdentity | StaffIdentity | PosIdentity
const secretOf = (identity: AnyIdentity): string =>
  'token' in identity ? identity.token : identity.sessionId
const subjectOf = (identity: AnyIdentity): string =>
  'accountId' in identity ? identity.accountId : 'deviceId' in identity ? identity.deviceId : identity.userId
const tenantOf = (identity: AnyIdentity): string | null =>
  'realmId' in identity ? identity.realmId : identity.companyId

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

/**
 * The id a channel command writes under, derived once so no route invents its own.
 *
 * An `Idempotency-Key` is chosen by the client and travels in a header, so it is
 * neither secret nor unique across callers. Two customers are free to send the
 * same one. Anything derived from it must therefore carry who is asking, or the
 * two commands collide on a single row — and a domain command that replays an
 * existing id will hand the second caller the first one's record rather than
 * fail. Hashing also keeps a caller-supplied string out of a primary key.
 */
export const channelCommandId = (
  prefix: string,
  identity:
    | Pick<CustomerIdentity, 'realmId' | 'accountId'>
    | Pick<PosIdentity, 'companyId' | 'posConfigId' | 'deviceId'>,
  key: string,
): string => {
  const scope =
    'accountId' in identity
      ? `${identity.realmId}\n${identity.accountId}`
      : `${identity.companyId}\n${identity.posConfigId}\n${identity.deviceId}`
  return `${prefix}_${sha256(`${scope}\n${key}`).slice(0, 32)}`
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

/**
 * A query string carries no types. Every value arrives as text, so a schema
 * saying `integer` would reject "20" and the check would be worse than none:
 * values are coerced to the declared type first, and anything that will not
 * convert is left as text so the type check is what reports it.
 *
 * An empty value counts as absent, because that is already how the handlers
 * read one — `?state=` means the caller sent no filter, not an invalid one.
 */
const queryValue = (schema: JsonSchema, params: URLSearchParams, name: string): unknown => {
  const expected = schema.type
  if (expected === 'array') return params.getAll(name).filter((item) => item !== '')
  const raw = params.get(name)
  if (raw === null || raw === '') return undefined
  if (expected === 'integer' || expected === 'number') {
    const number = Number(raw)
    return Number.isFinite(number) ? number : raw
  }
  if (expected === 'boolean') {
    if (raw === 'true') return true
    if (raw === 'false') return false
  }
  return raw
}

const queryIssues = (schema: JsonSchema, url: URL): FieldIssue[] => {
  const properties = (schema.properties as Record<string, JsonSchema> | undefined) ?? {}
  const held: Record<string, unknown> = {}
  for (const name of new Set(url.searchParams.keys())) {
    const property = properties[name]
    const value = property
      ? queryValue(property, url.searchParams, name)
      : queryValue({}, url.searchParams, name)
    if (value !== undefined) held[name] = value
  }
  const issues: FieldIssue[] = []
  collectIssues(schema, held, '', issues)
  return issues
}

type FieldError = { code: string; messageKey: string; params: Record<string, unknown> }

const fieldErrorsOf = (issues: FieldIssue[]): Record<string, FieldError> =>
  Object.fromEntries(
    issues.map((issue) => [
      issue.path,
      { code: 'channel_api.invalidField', messageKey: issue.messageKey, params: issue.params },
    ]),
  )

// --- failure mapping -------------------------------------------------------

const FAILURES: Record<string, { status: number; code: string; messageKey: string; retryable?: boolean }> = {
  E_CHANNEL_CREDENTIAL_CONFLICT: {
    status: 401,
    code: 'channel_api.credentialConflict',
    messageKey: 'channel_api.error.credentialConflict',
  },
  E_CHANNEL_CREDENTIAL_INVALID: {
    status: 401,
    code: 'channel_api.unauthenticated',
    messageKey: 'channel_api.error.unauthenticated',
  },
  E_CHANNEL_CREDENTIAL_EXPIRED: {
    status: 401,
    code: 'channel_api.unauthenticated',
    messageKey: 'channel_api.error.unauthenticated',
  },
  E_CHANNEL_CREDENTIAL_REVOKED: {
    status: 401,
    code: 'channel_api.unauthenticated',
    messageKey: 'channel_api.error.unauthenticated',
  },
  E_CHANNEL_CREDENTIAL_IDENTITY_CONTEXT: {
    status: 401,
    code: 'channel_api.unauthenticated',
    messageKey: 'channel_api.error.unauthenticated',
  },
  E_FN_NOT_PERMITTED: {
    status: 403,
    code: 'channel_api.forbidden',
    messageKey: 'channel_api.error.forbidden',
  },
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

export const defineChannelRoute = <P extends ChannelProfile>(
  spec: ChannelRouteSpec<P>,
): [string, RouteEntry] => {
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
    ...(spec.credentials?.length ? { credentials: [...spec.credentials] } : {}),
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
                    contractVersion: CHANNEL_API_VERSION,
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
            let identity: ChannelIdentityFor<P> | null = null
            if (resolves(auth)) {
              identity = await resolveChannelIdentity(spec.profile, ctx, url, req)
              if (!identity && demands(auth))
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
              if (!safeEqual(String(req.headers['x-csrf-token'] ?? ''), csrfTokenFor(secretOf(identity))))
                return fail(403, 'channel_api.csrf', 'channel_api.error.csrf')
            }
            const capabilityAuthorizer = capabilityAuthorizers.get(spec.profile)
            if (
              identity &&
              spec.capability &&
              capabilityAuthorizer &&
              !(await capabilityAuthorizer.authorize(ctx, url, req, identity, spec.capability))
            )
              return fail(403, 'channel_api.forbidden', 'channel_api.error.forbidden')
            if (spec.rateLimit) {
              const realm =
                (identity ? tenantOf(identity) : null) ??
                (await realmResolvers.get(spec.profile)?.(ctx, url, req))
              // No realm means no site answered for this host, and there is
              // nothing to meter against; the route below will refuse it anyway.
              if (realm) {
                const who =
                  (identity ? subjectOf(identity) : null) ??
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
                  return envelope(
                    {
                      status: 429,
                      error: channelError(ctx, url, req, 'channel_api.rateLimited', {
                        messageKey: 'channel_api.error.rateLimited',
                        retryable: true,
                      }),
                    },
                    { 'retry-after': String(Math.max(1, Math.ceil(spec.rateLimit.windowMs / 1_000))) },
                  )
              }
            }
            if (spec.request?.query) {
              const issues = queryIssues(spec.request.query, url)
              if (issues.length)
                return fail(
                  422,
                  'channel_api.invalidRequest',
                  'channel_api.error.invalidRequest',
                  fieldErrorsOf(issues),
                )
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
                  fieldErrorsOf(issues),
                )
            }
            return envelope(await spec.handler(ctx, url, req, params, { requestId, identity, body }))
          } catch (cause) {
            const failure = FAILURES[String((cause as { code?: string }).code ?? '')]
            /**
             * A mapped failure is a known answer. Anything else is this server
             * being wrong, and the caller gets a code that deliberately says
             * nothing — so unless it is written down here, the only record of it
             * is a 500 nobody can trace back. The request id is the thread
             * between the two.
             */
            if (!failure)
              console.error(
                `[channel_api] ${spec.operationId} ${requestId} ${String((cause as Error)?.stack ?? cause)}`,
              )
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
