import {
  constants,
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify as verifySignature,
} from 'node:crypto'

export type OidcDiscovery = {
  issuer: string
  authorizationEndpoint: string
  tokenEndpoint: string
  jwksUri: string
}

export type OidcProvider = {
  issuer: string
  clientId: string
  clientAuthMethod: 'none' | 'client_secret_basic' | 'client_secret_post'
  clientSecret?: string | null
  allowedAlgorithms: readonly string[]
}

export type OidcClaims = {
  issuer: string
  subject: string
  email?: string
  emailVerified?: boolean
  name?: string
  preferredUsername?: string
  claims: Record<string, unknown>
}

export class OauthProtocolError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'OauthProtocolError'
    this.code = code
  }
}

type Fetch = typeof fetch
type JsonObject = Record<string, unknown>

const MAX_DOCUMENT_BYTES = 1024 * 1024
const DEFAULT_TIMEOUT_MS = 10_000
const CLOCK_SKEW_SECONDS = 60
const SUPPORTED_ALGORITHMS = new Set(['RS256', 'PS256', 'ES256'])

const fail = (code: string, message: string): never => {
  throw new OauthProtocolError(code, message)
}

const object = (value: unknown, code: string): JsonObject => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code, 'expected a JSON object')
  return value as JsonObject
}

const loopback = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1'

/** OIDC endpoints are HTTPS, with loopback HTTP reserved for local development and deterministic tests. */
export const safeOidcUrl = (value: string, field: string): URL => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return fail('oauth.error.endpointInvalid', `${field} is not an absolute URL`)
  }
  if (url.username || url.password || url.hash)
    return fail('oauth.error.endpointInvalid', `${field} contains credentials or a fragment`)
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback(url.hostname)))
    return fail('oauth.error.endpointInsecure', `${field} must use HTTPS outside loopback`)
  return url
}

const json = async (response: Response, code: string): Promise<JsonObject> => {
  const announced = Number(response.headers.get('content-length'))
  if (Number.isFinite(announced) && announced > MAX_DOCUMENT_BYTES)
    fail(code, 'remote JSON document is too large')
  const reader = response.body?.getReader()
  const chunks: Buffer[] = []
  let total = 0
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > MAX_DOCUMENT_BYTES) {
          await reader.cancel()
          fail(code, 'remote JSON document is too large')
        }
        chunks.push(Buffer.from(value))
      }
    } finally {
      reader.releaseLock()
    }
  }
  const body = Buffer.concat(chunks, total).toString('utf8')
  try {
    return object(JSON.parse(body), code)
  } catch (error) {
    if (error instanceof OauthProtocolError) throw error
    return fail(code, 'remote response is not valid JSON')
  }
}

const fetched = async (url: URL, init: RequestInit, code: string, fetcher: Fetch): Promise<Response> => {
  const signal = AbortSignal.timeout(DEFAULT_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetcher(url, { ...init, redirect: 'error', signal })
  } catch {
    return fail(code, 'the identity provider could not be reached')
  }
  if (!response.ok) fail(code, `the identity provider returned HTTP ${response.status}`)
  return response
}

export async function discoverOidc(issuer: string, fetcher: Fetch = fetch): Promise<OidcDiscovery> {
  const configured = safeOidcUrl(issuer.trim(), 'issuer')
  if (configured.search) fail('oauth.error.issuerInvalid', 'the issuer must not contain a query string')
  const discoveryUrl = new URL(`${configured.toString().replace(/\/$/, '')}/.well-known/openid-configuration`)
  const response = await fetched(
    discoveryUrl,
    { headers: { accept: 'application/json' } },
    'oauth.error.discoveryUnavailable',
    fetcher,
  )
  const document = await json(response, 'oauth.error.discoveryInvalid')
  if (document.issuer !== issuer.trim())
    fail('oauth.error.issuerMismatch', 'discovery returned a different issuer')
  const authorizationEndpoint = safeOidcUrl(
    String(document.authorization_endpoint ?? ''),
    'authorization_endpoint',
  )
  const tokenEndpoint = safeOidcUrl(String(document.token_endpoint ?? ''), 'token_endpoint')
  const jwksUri = safeOidcUrl(String(document.jwks_uri ?? ''), 'jwks_uri')
  return {
    issuer: String(document.issuer),
    authorizationEndpoint: authorizationEndpoint.toString(),
    tokenEndpoint: tokenEndpoint.toString(),
    jwksUri: jwksUri.toString(),
  }
}

export const pkceChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url')

export function oidcAuthorizationUrl(
  discovery: OidcDiscovery,
  input: {
    clientId: string
    redirectUri: string
    scope: string
    state: string
    nonce: string
    codeVerifier: string
  },
): string {
  const endpoint = safeOidcUrl(discovery.authorizationEndpoint, 'authorization_endpoint')
  endpoint.searchParams.set('response_type', 'code')
  endpoint.searchParams.set('client_id', input.clientId)
  endpoint.searchParams.set('redirect_uri', input.redirectUri)
  endpoint.searchParams.set('scope', input.scope)
  endpoint.searchParams.set('state', input.state)
  endpoint.searchParams.set('nonce', input.nonce)
  endpoint.searchParams.set('code_challenge', pkceChallenge(input.codeVerifier))
  endpoint.searchParams.set('code_challenge_method', 'S256')
  return endpoint.toString()
}

const basicPart = (value: string): string => encodeURIComponent(value).replace(/%20/g, '+')

export async function exchangeOidcCode(
  discovery: OidcDiscovery,
  provider: OidcProvider,
  input: { code: string; redirectUri: string; codeVerifier: string },
  fetcher: Fetch = fetch,
): Promise<{ idToken: string }> {
  const endpoint = safeOidcUrl(discovery.tokenEndpoint, 'token_endpoint')
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  })
  const headers: Record<string, string> = {
    accept: 'application/json',
    'content-type': 'application/x-www-form-urlencoded',
  }
  if (provider.clientAuthMethod === 'client_secret_basic') {
    const secret = provider.clientSecret
    if (!secret) fail('oauth.error.secretMissing', 'the configured client secret is unavailable')
    headers.authorization = `Basic ${Buffer.from(`${basicPart(provider.clientId)}:${basicPart(secret as string)}`).toString('base64')}`
  } else {
    form.set('client_id', provider.clientId)
    if (provider.clientAuthMethod === 'client_secret_post') {
      const secret = provider.clientSecret
      if (!secret) fail('oauth.error.secretMissing', 'the configured client secret is unavailable')
      form.set('client_secret', secret as string)
    }
  }
  const response = await fetched(
    endpoint,
    { method: 'POST', headers, body: form.toString() },
    'oauth.error.tokenExchange',
    fetcher,
  )
  const document = await json(response, 'oauth.error.tokenInvalid')
  if (
    document.token_type !== undefined &&
    (typeof document.token_type !== 'string' || document.token_type.toLowerCase() !== 'bearer')
  )
    fail('oauth.error.tokenInvalid', 'the token response uses an unsupported token type')
  const idToken = document.id_token
  if (typeof idToken !== 'string' || !idToken)
    fail('oauth.error.idTokenMissing', 'the token response contains no ID token')
  return { idToken: idToken as string }
}

const base64url = (value: string, code: string): Buffer => {
  if (!/^[A-Za-z0-9_-]+$/.test(value) || value.length % 4 === 1) fail(code, 'invalid base64url value')
  const bytes = Buffer.from(value, 'base64url')
  if (bytes.toString('base64url') !== value.replace(/=+$/, '')) fail(code, 'non-canonical base64url value')
  return bytes
}

const segmentJson = (value: string, code: string): JsonObject => {
  try {
    return object(JSON.parse(base64url(value, code).toString('utf8')), code)
  } catch (error) {
    if (error instanceof OauthProtocolError) throw error
    return fail(code, 'invalid JWT JSON')
  }
}

const equalSecret = (left: string, right: string): boolean => {
  const a = createHash('sha256').update(left).digest()
  const b = createHash('sha256').update(right).digest()
  return timingSafeEqual(a, b)
}

const nonceMatches = (claim: string, input: { nonce?: string; nonceDigest?: string }): boolean => {
  if (input.nonce !== undefined) return equalSecret(claim, input.nonce)
  if (!input.nonceDigest || !/^[a-f0-9]{64}$/.test(input.nonceDigest)) return false
  return equalSecret(createHash('sha256').update(claim).digest('hex'), input.nonceDigest)
}

const jwksCache = new Map<string, { expiresAt: number; keys: JsonObject[] }>()

const cacheSeconds = (response: Response): number => {
  const match = /(?:^|,)\s*max-age=(\d+)/i.exec(response.headers.get('cache-control') ?? '')
  const value = match ? Number(match[1]) : 300
  return Math.max(30, Math.min(Number.isFinite(value) ? value : 300, 3600))
}

const loadJwks = async (uri: string, fetcher: Fetch, force = false): Promise<JsonObject[]> => {
  const endpoint = safeOidcUrl(uri, 'jwks_uri')
  const held = jwksCache.get(endpoint.toString())
  if (!force && held && held.expiresAt > Date.now()) return held.keys
  const response = await fetched(
    endpoint,
    { headers: { accept: 'application/json' } },
    'oauth.error.jwksUnavailable',
    fetcher,
  )
  const document = await json(response, 'oauth.error.jwksInvalid')
  const documentKeys = document.keys
  if (!Array.isArray(documentKeys) || documentKeys.length > 64)
    fail('oauth.error.jwksInvalid', 'JWKS must contain at most 64 keys')
  const keys = (documentKeys as unknown[]).map((key: unknown) => object(key, 'oauth.error.jwksInvalid'))
  jwksCache.set(endpoint.toString(), { keys, expiresAt: Date.now() + cacheSeconds(response) * 1000 })
  return keys
}

const verifyJwtSignature = (
  algorithm: string,
  signingInput: Buffer,
  signature: Buffer,
  jwk: JsonObject,
): boolean => {
  let key: ReturnType<typeof createPublicKey>
  try {
    key = createPublicKey({ key: jwk as never, format: 'jwk' })
  } catch {
    return fail('oauth.error.jwksInvalid', 'the selected JWK is invalid')
  }
  if (algorithm === 'RS256') return verifySignature('RSA-SHA256', signingInput, key, signature)
  if (algorithm === 'PS256')
    return verifySignature(
      'sha256',
      signingInput,
      { key, padding: constants.RSA_PKCS1_PSS_PADDING, saltLength: 32 },
      signature,
    )
  if (algorithm === 'ES256')
    return verifySignature('sha256', signingInput, { key, dsaEncoding: 'ieee-p1363' }, signature)
  return false
}

const audienceIncludes = (audience: unknown, clientId: string): { matches: boolean; multiple: boolean } => {
  if (typeof audience === 'string') return { matches: audience === clientId, multiple: false }
  if (!Array.isArray(audience) || audience.some((item) => typeof item !== 'string'))
    return { matches: false, multiple: false }
  return { matches: audience.includes(clientId), multiple: audience.length > 1 }
}

export async function verifyOidcIdToken(
  token: string,
  discovery: OidcDiscovery,
  provider: Pick<OidcProvider, 'clientId' | 'allowedAlgorithms'>,
  input: { nonce?: string; nonceDigest?: string; now?: number },
  fetcher: Fetch = fetch,
): Promise<OidcClaims> {
  if (token.length > 64 * 1024) fail('oauth.error.idTokenInvalid', 'the ID token is too large')
  const parts = token.split('.')
  if (parts.length !== 3) fail('oauth.error.idTokenInvalid', 'the ID token is not a signed JWT')
  const header = segmentJson(parts[0]!, 'oauth.error.idTokenInvalid')
  const claims = segmentJson(parts[1]!, 'oauth.error.idTokenInvalid')
  if (
    header.b64 === false ||
    (header.crit !== undefined && (!Array.isArray(header.crit) || header.crit.length > 0))
  )
    fail('oauth.error.idTokenInvalid', 'the ID token uses unsupported critical headers')
  const algorithm = String(header.alg ?? '')
  const allowed = new Set(provider.allowedAlgorithms)
  if (!SUPPORTED_ALGORITHMS.has(algorithm) || !allowed.has(algorithm))
    fail('oauth.error.algorithmRejected', 'the ID token uses a disallowed signature algorithm')
  if (typeof header.kid !== 'string' || !header.kid)
    fail('oauth.error.idTokenInvalid', 'the ID token has no key id')

  let keys = await loadJwks(discovery.jwksUri, fetcher)
  let jwk = keys.find((key) => key.kid === header.kid && (!key.use || key.use === 'sig'))
  if (!jwk) {
    keys = await loadJwks(discovery.jwksUri, fetcher, true)
    jwk = keys.find((key) => key.kid === header.kid && (!key.use || key.use === 'sig'))
  }
  if (!jwk) fail('oauth.error.signingKeyMissing', 'the signing key is not present in JWKS')
  const selected = jwk as JsonObject
  if (selected.alg && selected.alg !== algorithm)
    fail('oauth.error.algorithmRejected', 'the JWK algorithm does not match the ID token')
  if (
    (algorithm === 'ES256' && (selected.kty !== 'EC' || selected.crv !== 'P-256')) ||
    ((algorithm === 'RS256' || algorithm === 'PS256') && selected.kty !== 'RSA')
  )
    fail('oauth.error.algorithmRejected', 'the JWK type does not match the ID token algorithm')
  if (
    selected.key_ops !== undefined &&
    (!Array.isArray(selected.key_ops) || !selected.key_ops.includes('verify'))
  )
    fail('oauth.error.jwksInvalid', 'the selected JWK does not permit signature verification')
  let verified = false
  try {
    verified = verifyJwtSignature(
      algorithm,
      Buffer.from(`${parts[0]}.${parts[1]}`),
      base64url(parts[2]!, 'oauth.error.idTokenInvalid'),
      selected,
    )
  } catch (error) {
    if (error instanceof OauthProtocolError) throw error
    fail('oauth.error.signatureInvalid', 'the ID token signature could not be verified')
  }
  if (!verified) fail('oauth.error.signatureInvalid', 'the ID token signature is invalid')

  if (claims.iss !== discovery.issuer)
    fail('oauth.error.issuerMismatch', 'the ID token issuer does not match')
  const audience = audienceIncludes(claims.aud, provider.clientId)
  if (!audience.matches) fail('oauth.error.audienceMismatch', 'the ID token audience does not match')
  if ((audience.multiple || claims.azp !== undefined) && claims.azp !== provider.clientId)
    fail('oauth.error.authorizedPartyMismatch', 'the ID token authorized party does not match')
  if (
    typeof claims.sub !== 'string' ||
    !claims.sub ||
    Buffer.byteLength(claims.sub) > 255 ||
    !/^[\x20-\x7e]+$/.test(claims.sub)
  )
    fail('oauth.error.subjectInvalid', 'the ID token subject is not a valid OIDC subject')
  if (typeof claims.nonce !== 'string' || !nonceMatches(claims.nonce, input))
    fail('oauth.error.nonceMismatch', 'the ID token nonce does not match')

  const now = Math.floor((input.now ?? Date.now()) / 1000)
  if (typeof claims.exp !== 'number' || !Number.isFinite(claims.exp) || claims.exp < now - CLOCK_SKEW_SECONDS)
    fail('oauth.error.idTokenExpired', 'the ID token has expired')
  if (typeof claims.iat !== 'number' || !Number.isFinite(claims.iat) || claims.iat > now + CLOCK_SKEW_SECONDS)
    fail('oauth.error.idTokenTime', 'the ID token issue time is invalid')
  if (
    claims.nbf !== undefined &&
    (typeof claims.nbf !== 'number' || !Number.isFinite(claims.nbf) || claims.nbf > now + CLOCK_SKEW_SECONDS)
  )
    fail('oauth.error.idTokenTime', 'the ID token is not valid yet')

  return {
    issuer: String(claims.iss),
    subject: String(claims.sub),
    ...(typeof claims.email === 'string' ? { email: claims.email } : {}),
    ...(typeof claims.email_verified === 'boolean' ? { emailVerified: claims.email_verified } : {}),
    ...(typeof claims.name === 'string' ? { name: claims.name } : {}),
    ...(typeof claims.preferred_username === 'string'
      ? { preferredUsername: claims.preferred_username }
      : {}),
    claims,
  }
}

export const clearOidcCachesForTest = (): void => jwksCache.clear()
