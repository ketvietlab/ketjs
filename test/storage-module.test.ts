import assert from 'node:assert/strict'
import { mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  bootDeployment,
  bootWorker,
  callFn,
  defineDeployment,
  localStorage,
  namespacedStorage,
} from '@ketvietlab/ketjs'
import { company, partner, storage as storageModule } from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'

test('storage module: upload, safe download, deduplication and queued GC work end to end', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-storage-module-'))
  const sqliteFile = join(dir, 'app.db')
  const storageDir = join(dir, 'objects')
  const app = defineDeployment({
    name: 'storageapp',
    modules: [address, partner, company, storageModule],
    worker: { queues: { maintenance: 1 } },
    serve: {
      defaults: { sqliteFile, storageDir, defaultCompany: 'acme' },
    },
  })

  let server: Awaited<ReturnType<typeof bootDeployment>> | null = null
  let worker: Awaited<ReturnType<typeof bootWorker>> | null = null
  try {
    server = await bootDeployment(app, {
      port: 0,
      env: { KET_SQLITE: sqliteFile, KET_STORAGE_DIR: storageDir, KET_COMPANY: 'acme' },
    })
    const at = `http://127.0.0.1:${server.port}`
    const upload = async () => {
      const form = new FormData()
      form.set('resModel', 'notes.Note')
      form.set('resId', 'note-1')
      form.set('file', new File(['<script>alert(1)</script>'], 'bằng chứng.html', { type: 'text/html' }))
      const response = await fetch(`${at}/files`, { method: 'POST', body: form })
      const body = await response.text()
      assert.equal(response.status, 201, body)
      return JSON.parse(body) as { id: string; storeKey: string; checksum: string }
    }

    const first = await upload()
    const second = await upload()
    assert.notEqual(first.id, second.id)
    assert.equal(first.storeKey, second.storeKey, 'content-addressing deduplicates the bytes')
    assert.equal(first.checksum, second.checksum)

    const download = await fetch(`${at}/files/${first.id}`)
    assert.equal(download.status, 200)
    assert.equal(download.headers.get('content-type'), 'application/octet-stream')
    assert.match(download.headers.get('content-disposition') ?? '', /^attachment;/)
    assert.equal(download.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(await download.text(), '<script>alert(1)</script>')

    const root = namespacedStorage(localStorage({ dir: storageDir }), 'storageapp')
    assert.deepEqual((await root.list('blobs/acme/')).keys, [first.storeKey])

    for (const id of [first.id, second.id]) {
      const response = await fetch(`${at}/_ket/fn/storage.removeAttachment`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-ket-company': 'acme' },
        body: JSON.stringify({ id }),
      })
      const body = await response.text()
      assert.equal(response.status, 200, body)
    }
    // Sweep on the real default grace period rather than switching it off, and give
    // it one orphan of each age: only the one older than the window may be taken.
    const fresh = `blobs/acme/ff/${'f'.repeat(64)}`
    await root.put(
      fresh,
      (async function* () {
        yield Buffer.from('a young orphan')
      })(),
      { type: 'text/plain' },
    )
    const aged = new Date(Date.now() - 2 * 60 * 60 * 1_000)
    await utimes(join(storageDir, 'storageapp', String(first.storeKey)), aged, aged)
    const queued = await fetch(`${at}/_ket/fn/storage.requestSweep`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-ket-company': 'acme' },
      body: JSON.stringify({}),
    })
    const queuedBody = await queued.text()
    assert.equal(queued.status, 200, queuedBody)

    await server.close()
    server = null
    worker = await bootWorker(app, {
      env: { KET_SQLITE: sqliteFile, KET_STORAGE_DIR: storageDir, KET_COMPANY: 'acme' },
      log: () => {},
    })
    assert.equal(await worker.drain(), 1)
    // The aged orphan is collected; the one written moments ago is still protected.
    assert.deepEqual((await root.list('blobs/acme/')).keys, [fresh])
  } finally {
    await worker?.close()
    await server?.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('storage module: a stranger sees only attachments explicitly marked public', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-storage-public-'))
  const sqliteFile = join(dir, 'app.db')
  const storageDir = join(dir, 'objects')
  const app = defineDeployment({
    name: 'publicfiles',
    modules: [address, partner, company, storageModule],
    serve: {
      sessions: { anonymous: { company: 'acme' } },
      defaults: { sqliteFile, storageDir },
    },
  })
  const server = await bootDeployment(app, {
    port: 0,
    env: { KET_SQLITE: sqliteFile, KET_STORAGE_DIR: storageDir, KET_SECRET: 'test-only-secret' },
  })
  try {
    const checksum = 'a'.repeat(64)
    const key = `blobs/acme/aa/${checksum}`
    const objects = namespacedStorage(localStorage({ dir: storageDir }), 'publicfiles')
    await objects.put(
      key,
      (async function* () {
        yield Buffer.from('visible bytes')
      })(),
      { type: 'text/plain' },
    )
    for (const [id, isPublic] of [
      ['public-id', true],
      ['private-id', false],
    ] as const) {
      await callFn(
        'storage.createAttachment',
        {
          id,
          name: `${id}.txt`,
          kind: 'stored',
          storeKey: key,
          mimetype: 'text/plain',
          size: 13,
          checksum,
          public: isPublic,
          createdAt: new Date().toISOString(),
        },
        { adapter: server.adapter!, manifest: server.manifest, scope: { company: 'acme' } },
      )
    }

    const at = `http://127.0.0.1:${server.port}`
    const publicResponse = await fetch(`${at}/files/public-id`)
    assert.equal(publicResponse.status, 200)
    assert.equal(await publicResponse.text(), 'visible bytes')
    assert.equal((await fetch(`${at}/files/private-id`)).status, 404)
    assert.equal((await fetch(`${at}/files`, { method: 'POST' })).status, 401)
  } finally {
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
})
