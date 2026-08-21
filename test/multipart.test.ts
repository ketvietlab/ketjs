import assert from 'node:assert/strict'
import { test } from 'node:test'
import { multipart } from '@ketvietlab/ketjs'

const split = async function* (value: Buffer, sizes: number[]): AsyncGenerator<Uint8Array> {
  let at = 0
  for (const size of sizes) {
    yield value.subarray(at, at + size)
    at += size
  }
  if (at < value.length) yield value.subarray(at)
}

const collect = async (body: AsyncIterable<Uint8Array>): Promise<string> => {
  const chunks: Uint8Array[] = []
  for await (const chunk of body) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

test('multipart: boundaries may split across arbitrary network chunks', async () => {
  const boundary = 'ket-boundary-42'
  const raw = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nXin chào\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="ảnh nhỏ.txt"\r\n` +
      `Content-Type: text/plain\r\n\r\nabc\r\n--${boundary}--\r\n`,
  )
  const found: Array<{ name: string; filename?: string; value: string }> = []
  for await (const part of multipart(
    split(raw, [1, 2, 7, 3, 19, 1, 31, 2, 5, 1]),
    `multipart/form-data; boundary=${boundary}`,
  )) {
    found.push({
      name: part.name,
      ...(part.filename ? { filename: part.filename } : {}),
      value: await collect(part.body),
    })
  }
  assert.deepEqual(found, [
    { name: 'title', value: 'Xin chào' },
    { name: 'file', filename: 'ảnh nhỏ.txt', value: 'abc' },
  ])
})

test('multipart: an unconsumed part is drained and an empty file stays empty', async () => {
  const boundary = 'empty'
  const raw = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="ignored"\r\n\r\nvalue\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="empty.txt"\r\n\r\n` +
      `\r\n--${boundary}--\r\n`,
  )
  const values: string[] = []
  let index = 0
  for await (const part of multipart(split(raw, [raw.length]), `multipart/form-data; boundary=${boundary}`)) {
    if (index++ > 0) values.push(await collect(part.body))
  }
  assert.deepEqual(values, [''])
})

test('multipart: a boundary-like byte sequence inside a file is ordinary content', async () => {
  const boundary = 'almost'
  const value = `before\r\n--${boundary}X-not-a-delimiter\r\nafter`
  const raw = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x"\r\n\r\n${value}\r\n--${boundary}--\r\n`,
  )
  const found: string[] = []
  for await (const part of multipart(split(raw, [77, 2, 3, 1]), `multipart/form-data; boundary=${boundary}`))
    found.push(await collect(part.body))
  assert.deepEqual(found, [value])
})

test('multipart: total request limit is enforced while streaming', async () => {
  const boundary = 'limited'
  const raw = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="x"\r\n\r\nlarge body\r\n--${boundary}--\r\n`,
  )
  await assert.rejects(
    async () => {
      for await (const part of multipart(
        split(raw, [20, 20, 20]),
        `multipart/form-data; boundary=${boundary}`,
        { maxBytes: raw.length - 1 },
      ))
        await collect(part.body)
    },
    (error: unknown) => (error as { code?: string }).code === 'E_PAYLOAD_TOO_LARGE',
  )
})
