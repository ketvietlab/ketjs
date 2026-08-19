import { KetError } from '../kernel/errors.ts'

export type MultipartPart = {
  name: string
  filename?: string
  type?: string
  body: AsyncIterable<Uint8Array>
}

export type MultipartOptions = {
  maxBytes?: number
  maxParts?: number
  maxHeaderBytes?: number
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const bytesOf = (value: string) => encoder.encode(value)

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array => {
  if (!a.length) return b
  if (!b.length) return a
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

const indexOf = (haystack: Uint8Array, needle: Uint8Array): number => {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) if (haystack[i + j] !== needle[j]) continue outer
    return i
  }
  return -1
}

class Reader {
  private readonly source: AsyncIterator<Uint8Array>
  private readonly maxBytes: number
  buffer: Uint8Array<ArrayBufferLike> = new Uint8Array()
  ended = false
  total = 0

  constructor(source: AsyncIterable<Uint8Array>, maxBytes: number) {
    this.source = source[Symbol.asyncIterator]()
    this.maxBytes = maxBytes
  }

  async fill(minimum: number): Promise<void> {
    while (!this.ended && this.buffer.length < minimum) {
      const next = await this.source.next()
      if (next.done) {
        this.ended = true
        break
      }
      const chunk = next.value instanceof Uint8Array ? next.value : new Uint8Array(next.value)
      this.total += chunk.byteLength
      if (this.total > this.maxBytes) {
        throw new KetError({
          code: 'E_PAYLOAD_TOO_LARGE',
          message: `multipart body exceeds ${this.maxBytes} bytes`,
        })
      }
      this.buffer = concat(this.buffer, chunk)
    }
  }

  take(length: number): Uint8Array {
    const value = this.buffer.slice(0, length)
    this.buffer = this.buffer.slice(length)
    return value
  }

  async exact(expected: Uint8Array): Promise<void> {
    await this.fill(expected.length)
    const actual = this.take(expected.length)
    if (actual.length !== expected.length || indexOf(actual, expected) !== 0)
      throw new KetError({ code: 'E_MULTIPART_SYNTAX', message: 'malformed multipart boundary' })
  }

  async until(marker: Uint8Array, limit: number): Promise<Uint8Array> {
    for (;;) {
      const found = indexOf(this.buffer, marker)
      if (found >= 0) {
        if (found > limit)
          throw new KetError({ code: 'E_MULTIPART_HEADERS', message: 'multipart headers are too large' })
        const value = this.take(found)
        this.take(marker.length)
        return value
      }
      if (this.buffer.length > limit)
        throw new KetError({ code: 'E_MULTIPART_HEADERS', message: 'multipart headers are too large' })
      if (this.ended)
        throw new KetError({ code: 'E_MULTIPART_SYNTAX', message: 'multipart body ended before a boundary' })
      await this.fill(this.buffer.length + 1)
    }
  }
}

const boundaryOf = (contentType: string): string => {
  if (!/^multipart\/form-data\b/i.test(contentType))
    throw new KetError({ code: 'E_MULTIPART_TYPE', message: 'expected multipart/form-data' })
  const match = /(?:^|;)\s*boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)
  const boundary = match?.[1] ?? match?.[2]
  if (!boundary || boundary.length > 200 || /[\r\n]/.test(boundary))
    throw new KetError({ code: 'E_MULTIPART_BOUNDARY', message: 'missing or invalid multipart boundary' })
  return boundary
}

const disposition = (value: string): { name: string; filename?: string } => {
  if (!/^form-data(?:;|$)/i.test(value))
    throw new KetError({ code: 'E_MULTIPART_DISPOSITION', message: 'multipart part is not form-data' })
  const params = new Map<string, string>()
  for (const match of value.matchAll(/;\s*([\w-]+)=(?:"((?:[^"\\]|\\.)*)"|([^;]*))/g)) {
    const raw = match[2] ?? match[3] ?? ''
    params.set((match[1] as string).toLowerCase(), raw.replace(/\\(["\\])/g, '$1'))
  }
  const name = params.get('name')
  if (!name) throw new KetError({ code: 'E_MULTIPART_NAME', message: 'multipart part has no name' })
  const filename = params.get('filename')
  return { name, ...(filename === undefined ? {} : { filename }) }
}

/**
 * Parse multipart sequentially without buffering file bodies. A part body must be
 * consumed before requesting the next part; if a caller stops early, the parser
 * drains only to the next boundary so the remaining parts stay readable.
 */
export async function* multipart(
  source: AsyncIterable<Uint8Array>,
  contentType: string,
  options: MultipartOptions = {},
): AsyncGenerator<MultipartPart> {
  const boundary = boundaryOf(contentType)
  const reader = new Reader(source, options.maxBytes ?? 25 * 1024 * 1024)
  const first = bytesOf(`--${boundary}\r\n`)
  const delimiter = bytesOf(`\r\n--${boundary}`)
  const headerEnd = bytesOf('\r\n\r\n')
  await reader.exact(first)

  let final = false
  let parts = 0
  while (!final) {
    parts++
    if (parts > (options.maxParts ?? 20))
      throw new KetError({ code: 'E_MULTIPART_PARTS', message: 'multipart body has too many parts' })
    const rawHeaders = decoder.decode(await reader.until(headerEnd, options.maxHeaderBytes ?? 16 * 1024))
    const headers = new Map<string, string>()
    for (const line of rawHeaders.split('\r\n')) {
      const colon = line.indexOf(':')
      if (colon <= 0)
        throw new KetError({ code: 'E_MULTIPART_HEADERS', message: 'malformed multipart part header' })
      headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim())
    }
    const meta = disposition(headers.get('content-disposition') ?? '')
    let bodyDone = false

    const readBody = async function* (): AsyncGenerator<Uint8Array> {
      if (bodyDone) return
      for (;;) {
        const found = indexOf(reader.buffer, delimiter)
        if (found >= 0) {
          await reader.fill(found + delimiter.length + 2)
          const suffix = decoder.decode(
            reader.buffer.slice(found + delimiter.length, found + delimiter.length + 2),
          )
          // A file may legally contain "\\r\\n--boundary-like". It is a delimiter
          // only when followed by CRLF or --; keep scanning instead of truncating.
          if (suffix !== '--' && suffix !== '\r\n') {
            yield reader.take(found + 2)
            continue
          }
          if (found) yield reader.take(found)
          reader.take(delimiter.length)
          reader.take(2)
          if (suffix === '--') {
            final = true
            await reader.fill(2)
            if (decoder.decode(reader.buffer.slice(0, 2)) === '\r\n') reader.take(2)
          } else if (suffix !== '\r\n') {
            throw new KetError({ code: 'E_MULTIPART_SYNTAX', message: 'malformed multipart boundary suffix' })
          }
          bodyDone = true
          return
        }
        if (reader.ended)
          throw new KetError({
            code: 'E_MULTIPART_SYNTAX',
            message: 'multipart body ended before a boundary',
          })
        const safe = Math.max(0, reader.buffer.length - delimiter.length + 1)
        if (safe) yield reader.take(safe)
        await reader.fill(reader.buffer.length + 1)
      }
    }

    yield {
      ...meta,
      ...(headers.has('content-type') ? { type: headers.get('content-type') } : {}),
      body: { [Symbol.asyncIterator]: readBody },
    }
    if (!bodyDone) for await (const _ of readBody()) void _
  }
}
