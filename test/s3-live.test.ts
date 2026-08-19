import assert from 'node:assert/strict'
import { test } from 'node:test'
import { s3Storage, signRequest, sha256 } from 'ketjs'

const endpoint = process.env.KET_TEST_S3_ENDPOINT ?? 'http://127.0.0.1:19000'
const bucket = process.env.KET_TEST_S3_BUCKET ?? 'ketjs-storage-live'
const credentials = {
  accessKeyId: process.env.KET_TEST_S3_KEY ?? 'ketjsminio',
  secretAccessKey: process.env.KET_TEST_S3_SECRET ?? 'ketjsminiosecret',
  region: process.env.KET_TEST_S3_REGION ?? 'us-east-1',
  service: 's3',
}

const chunks = async function* (...values: string[]): AsyncGenerator<Uint8Array> {
  for (const value of values) yield Buffer.from(value)
}

const collect = async (body: AsyncIterable<Uint8Array>): Promise<string> => {
  const values: Uint8Array[] = []
  for await (const chunk of body) values.push(chunk)
  return Buffer.concat(values).toString()
}

const createBucket = async (): Promise<void> => {
  const url = new URL(`/${bucket}`, endpoint)
  const headers = signRequest({ method: 'PUT', url, payloadHash: sha256(''), credentials })
  const response = await fetch(url, { method: 'PUT', headers })
  if (!response.ok && response.status !== 409)
    throw new Error(`cannot create MinIO bucket (${response.status}): ${await response.text()}`)
}

test('S3 storage: MinIO live API streams, lists, presigns and deletes', async (t) => {
  try {
    const health = await fetch(new URL('/minio/health/live', endpoint), {
      signal: AbortSignal.timeout(1_000),
    })
    if (!health.ok) return t.skip(`MinIO is not healthy at ${endpoint}`)
  } catch {
    return t.skip(`MinIO is not running at ${endpoint}`)
  }

  await createBucket()
  const storage = s3Storage({ endpoint, bucket, pathStyle: true, ...credentials })
  const prefix = `live/${Date.now()}-${Math.random().toString(16).slice(2)}`
  const key = `${prefix}/ảnh nhỏ.txt`
  try {
    const put = await storage.put(key, chunks('hello ', 'MinIO'), { type: 'text/plain', size: 11 })
    assert.equal(put.key, key)
    assert.ok(put.etag)

    const head = await storage.head(key)
    assert.equal(head?.size, 11)
    assert.equal(head?.type, 'text/plain')
    const found = await storage.get(key)
    assert.ok(found)
    assert.equal(await collect(found.body), 'hello MinIO')
    assert.deepEqual((await storage.list(`${prefix}/`)).keys, [key])

    const signed = await storage.signedUrl(key, { expiresIn: 60 })
    assert.ok(signed)
    const direct = await fetch(signed)
    assert.equal(direct.status, 200)
    assert.equal(await direct.text(), 'hello MinIO')
  } finally {
    await storage.remove(key)
  }
  assert.equal(await storage.head(key), null)
})
