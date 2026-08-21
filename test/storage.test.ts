import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { effectStorage, localStorage, namespacedStorage } from '@ketvietlab/ketjs'

const chunks = async function* (...values: Array<string | Uint8Array>): AsyncGenerator<Uint8Array> {
  for (const value of values) yield typeof value === 'string' ? Buffer.from(value) : value
}

const collect = async (body: AsyncIterable<Uint8Array>): Promise<Buffer> => {
  const found: Uint8Array[] = []
  for await (const chunk of body) found.push(chunk)
  return Buffer.concat(found)
}

test('local storage: streams atomically, preserves metadata and pages in key order', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-storage-'))
  try {
    const storage = localStorage({ dir })
    const stored = await storage.put('blob/hello.txt', chunks('hel', 'lo'), {
      type: 'text/plain',
      size: 5,
    })
    assert.equal(stored.size, 5)
    assert.equal(stored.type, 'text/plain')
    assert.match(stored.etag ?? '', /^[a-f0-9]{64}$/)

    const found = await storage.get('blob/hello.txt')
    assert.ok(found)
    assert.equal((await collect(found.body)).toString(), 'hello')
    assert.equal(found.meta.type, 'text/plain')

    await storage.put('blob/a.txt', chunks('a'), { type: 'text/plain' })
    await storage.put('blob/z.txt', chunks('z'), { type: 'text/plain' })
    const first = await storage.list('blob/', { limit: 2 })
    assert.deepEqual(first.keys, ['blob/a.txt', 'blob/hello.txt'])
    assert.equal(first.next, 'blob/hello.txt')
    assert.deepEqual((await storage.list('blob/', { after: first.next })).keys, ['blob/z.txt'])

    await storage.remove('blob/hello.txt')
    assert.equal(await storage.head('blob/hello.txt'), null)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('storage namespace: the caller cannot see or escape another tenant', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-storage-ns-'))
  try {
    const root = localStorage({ dir })
    const a = namespacedStorage(root, 'tenant-a')
    const b = namespacedStorage(root, 'tenant-b')
    await a.put('same/key', chunks('a'), { type: 'text/plain' })
    await b.put('same/key', chunks('b'), { type: 'text/plain' })
    assert.equal((await collect((await a.get('same/key'))!.body)).toString(), 'a')
    assert.equal((await collect((await b.get('same/key'))!.body)).toString(), 'b')
    assert.deepEqual((await a.list('same/')).keys, ['same/key'])
    assert.throws(() => a.put('../tenant-b/same/key', chunks('x'), { type: 'text/plain' }))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('local storage: a declared size mismatch never publishes a partial object', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-storage-size-'))
  try {
    const storage = localStorage({ dir })
    await assert.rejects(() => storage.put('bad/object', chunks('short'), { type: 'text/plain', size: 99 }))
    assert.equal(await storage.head('bad/object'), null)
    assert.deepEqual((await storage.list('')).keys, [])
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('job storage: every operation needs its own declared effect', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-storage-effect-'))
  try {
    const raw = localStorage({ dir })
    const writeOnly = effectStorage(raw, ['storage:write'], 'files.generate')
    await writeOnly.put('made/file', chunks('ok'), { type: 'text/plain' })
    assert.throws(
      () => writeOnly.get('made/file'),
      (error: unknown) => (error as { code?: string }).code === 'E_EFFECT_NOT_DECLARED',
    )
    const readOnly = effectStorage(raw, ['storage:read'], 'files.inspect')
    assert.ok(await readOnly.head('made/file'))
    assert.throws(
      () => readOnly.remove('made/file'),
      (error: unknown) => (error as { code?: string }).code === 'E_EFFECT_NOT_DECLARED',
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
