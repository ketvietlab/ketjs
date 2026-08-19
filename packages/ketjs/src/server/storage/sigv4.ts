import { createHash, createHmac } from 'node:crypto'

export type SigV4Credentials = {
  accessKeyId: string
  secretAccessKey: string
  region: string
  service?: string
}

export const sha256 = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex')

const hmac = (key: string | Uint8Array, value: string): Buffer =>
  createHmac('sha256', key).update(value).digest()

const encode = (value: string): string =>
  encodeURIComponent(value).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

const canonicalPath = (pathname: string): string =>
  pathname
    .split('/')
    .map((part) => encode(decodeURIComponent(part)))
    .join('/') || '/'

const canonicalQuery = (params: URLSearchParams): string =>
  [...params.entries()]
    .map(([key, value]) => [encode(key), encode(value)] as const)
    // SigV4 orders by code point, not by collation: localeCompare reorders case
    // and ignores punctuation, which yields a canonical request S3 will not rebuild.
    .sort(([ak, av], [bk, bv]) => (ak < bk ? -1 : ak > bk ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([key, value]) => `${key}=${value}`)
    .join('&')

const timestamp = (date: Date): { short: string; long: string } => {
  const long = date.toISOString().replace(/[:-]|\.\d{3}/g, '')
  return { long, short: long.slice(0, 8) }
}

const signingKey = (credentials: SigV4Credentials, date: string): Buffer =>
  hmac(
    hmac(
      hmac(hmac(`AWS4${credentials.secretAccessKey}`, date), credentials.region),
      credentials.service ?? 's3',
    ),
    'aws4_request',
  )

const signature = (
  canonical: string,
  credentials: SigV4Credentials,
  date: { short: string; long: string },
): { scope: string; value: string } => {
  const scope = `${date.short}/${credentials.region}/${credentials.service ?? 's3'}/aws4_request`
  const toSign = `AWS4-HMAC-SHA256\n${date.long}\n${scope}\n${sha256(canonical)}`
  return {
    scope,
    value: createHmac('sha256', signingKey(credentials, date.short)).update(toSign).digest('hex'),
  }
}

export function signRequest(options: {
  method: string
  url: URL
  headers?: HeadersInit
  payloadHash: string
  credentials: SigV4Credentials
  now?: Date
}): Headers {
  const date = timestamp(options.now ?? new Date())
  const headers = new Headers(options.headers)
  headers.set('host', options.url.host)
  headers.set('x-amz-date', date.long)
  headers.set('x-amz-content-sha256', options.payloadHash)
  headers.delete('authorization')
  const entries = [...headers.entries()]
    .map(([key, value]) => [key.toLowerCase(), value.trim().replace(/\s+/g, ' ')] as const)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const signedHeaders = entries.map(([key]) => key).join(';')
  const canonicalHeaders = entries.map(([key, value]) => `${key}:${value}\n`).join('')
  const canonical = [
    options.method.toUpperCase(),
    canonicalPath(options.url.pathname),
    canonicalQuery(options.url.searchParams),
    canonicalHeaders,
    signedHeaders,
    options.payloadHash,
  ].join('\n')
  const signed = signature(canonical, options.credentials, date)
  headers.set(
    'authorization',
    `AWS4-HMAC-SHA256 Credential=${options.credentials.accessKeyId}/${signed.scope},SignedHeaders=${signedHeaders},Signature=${signed.value}`,
  )
  headers.delete('host') // fetch owns Host; it still matches the value used above.
  return headers
}

export function presignUrl(options: {
  method?: string
  url: URL
  expiresIn: number
  credentials: SigV4Credentials
  now?: Date
}): string {
  if (!Number.isInteger(options.expiresIn) || options.expiresIn < 1 || options.expiresIn > 604_800)
    throw new Error('SigV4 expiry must be between 1 and 604800 seconds')
  const url = new URL(options.url)
  const date = timestamp(options.now ?? new Date())
  const scope = `${date.short}/${options.credentials.region}/${options.credentials.service ?? 's3'}/aws4_request`
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256')
  url.searchParams.set('X-Amz-Credential', `${options.credentials.accessKeyId}/${scope}`)
  url.searchParams.set('X-Amz-Date', date.long)
  url.searchParams.set('X-Amz-Expires', String(options.expiresIn))
  url.searchParams.set('X-Amz-SignedHeaders', 'host')
  const canonical = [
    (options.method ?? 'GET').toUpperCase(),
    canonicalPath(url.pathname),
    canonicalQuery(url.searchParams),
    `host:${url.host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n')
  url.searchParams.set('X-Amz-Signature', signature(canonical, options.credentials, date).value)
  // Emit the encoding the signature was taken over; URLSearchParams would write a
  // space as "+", which SigV4 does not accept.
  url.search = url.search.replace(/\+/g, '%20')
  return url.toString()
}
