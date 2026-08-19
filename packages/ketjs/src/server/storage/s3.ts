import { storageKey } from './types.ts'
import type { Storage, Stored } from './types.ts'
import { presignUrl, signRequest } from './sigv4.ts'
import type { SigV4Credentials } from './sigv4.ts'

export type S3StorageOptions = SigV4Credentials & {
  endpoint: string
  bucket: string
  pathStyle?: boolean
  fetch?: typeof globalThis.fetch
  now?: () => Date
}

type SignedRequestInit = Omit<RequestInit, 'body'> & {
  body?: BodyInit | AsyncIterable<Uint8Array>
}

const encodeKey = (key: string) =>
  storageKey(key)
    .split('/')
    .map((part) => encodeURIComponent(part))
    .join('/')

const xml = (value: string): string =>
  value.replace(/&(lt|gt|amp|quot|apos);/g, (_, entity: string) => {
    const found: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }
    return found[entity] as string
  })

export function s3Storage(options: S3StorageOptions): Storage {
  const request = options.fetch ?? globalThis.fetch
  const endpoint = new URL(options.endpoint)
  const credentials: SigV4Credentials = {
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    region: options.region,
    service: 's3',
  }
  const urlOf = (key?: string): URL => {
    const url = new URL(endpoint)
    const suffix = key ? `/${encodeKey(key)}` : ''
    if (options.pathStyle) url.pathname = `/${encodeURIComponent(options.bucket)}${suffix}`
    else {
      url.hostname = `${options.bucket}.${url.hostname}`
      url.pathname = suffix || '/'
    }
    return url
  }

  const signedFetch = async (
    method: string,
    url: URL,
    init: SignedRequestInit = {},
    payloadHash = method === 'PUT'
      ? 'UNSIGNED-PAYLOAD'
      : 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  ): Promise<Response> => {
    const headers = signRequest({
      method,
      url,
      headers: init.headers,
      payloadHash,
      credentials,
      now: options.now?.(),
    })
    return request(url, {
      ...init,
      method,
      headers,
      ...(init.body ? { duplex: 'half' } : {}),
    } as unknown as RequestInit)
  }

  const checked = async (response: Response, operation: string): Promise<Response> => {
    if (response.ok) return response
    const detail = (await response.text()).slice(0, 1_000)
    throw new Error(`S3 ${operation} failed (${response.status}): ${detail}`)
  }

  const meta = (key: string, headers: Headers): Stored => ({
    key,
    size: Number(headers.get('content-length') ?? 0),
    type: headers.get('content-type') ?? 'application/octet-stream',
    ...(headers.get('etag') ? { etag: (headers.get('etag') as string).replace(/^"|"$/g, '') } : {}),
    ...(headers.get('last-modified') ? { modifiedAt: headers.get('last-modified') as string } : {}),
  })

  return {
    name: 's3',
    async put(key, body, o) {
      // Without a declared length fetch frames the body as chunked, which S3 answers
      // with 411; refuse here rather than at the far end with an opaque error.
      if (o.size === undefined)
        throw new Error(`S3 PUT of "${key}" requires a declared size; S3 rejects a body sent without content-length`)
      const url = urlOf(key)
      const headers = new Headers({ 'content-type': o.type, 'content-length': String(o.size) })
      const response = await checked(await signedFetch('PUT', url, { headers, body }), 'PUT')
      return {
        key,
        size: o.size,
        type: o.type,
        ...(response.headers.get('etag')
          ? { etag: (response.headers.get('etag') as string).replace(/^"|"$/g, '') }
          : {}),
      }
    },
    async get(key) {
      const response = await signedFetch('GET', urlOf(key))
      if (response.status === 404) {
        await response.body?.cancel()
        return null
      }
      await checked(response, 'GET')
      if (!response.body) throw new Error('S3 GET returned no body')
      return {
        body: response.body as unknown as AsyncIterable<Uint8Array>,
        meta: meta(key, response.headers),
      }
    },
    async head(key) {
      const response = await signedFetch('HEAD', urlOf(key))
      // Without s3:ListBucket S3 answers 403, not 404, for a key that is not there,
      // so treating only 404 as absent breaks every first upload of new content.
      if (response.status === 404 || response.status === 403) return null
      await checked(response, 'HEAD')
      return meta(key, response.headers)
    },
    async remove(key) {
      await checked(await signedFetch('DELETE', urlOf(key)), 'DELETE')
    },
    async list(prefix, o = {}) {
      const url = urlOf()
      url.searchParams.set('list-type', '2')
      url.searchParams.set('prefix', prefix)
      url.searchParams.set('max-keys', String(Math.max(1, Math.min(1_000, o.limit ?? 100))))
      if (o.after) url.searchParams.set('start-after', o.after)
      // URLSearchParams serialises a space as "+" but SigV4 signs it as %20, and the
      // two must agree or the request is refused.
      url.search = url.search.replace(/\+/g, '%20')
      const response = await checked(await signedFetch('GET', url), 'LIST')
      const body = await response.text()
      const keys = [...body.matchAll(/<Key>([\s\S]*?)<\/Key>/g)].map((match) => xml(match[1] as string))
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(body)
      return { keys, ...(truncated && keys.length ? { next: keys[keys.length - 1] as string } : {}) }
    },
    async signedUrl(key, o) {
      return presignUrl({
        url: urlOf(key),
        expiresIn: o.expiresIn,
        credentials,
        now: options.now?.(),
      })
    },
  }
}
