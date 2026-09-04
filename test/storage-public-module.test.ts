import assert from 'node:assert/strict'
import { mkdtemp, rm, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  bootDeployment,
  bootWorker,
  callFn,
  createQueue,
  defineDeployment,
  localStorage,
  namespacedStorage,
  sha256,
  storageFromConfig,
  withPublicStorage,
} from '@ketvietlab/ketjs'
import type { Storage } from '@ketvietlab/ketjs'
import { address, company, partner, storage as storageModule } from '@ketvietlab/ketsuite'

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZxkAAAAASUVORK5CYII=',
  'base64',
)
type Attachment = { id: string; storeKey: string; publicStoreKey?: string | null; checksum: string }

test('split attachments: worker publishes isolated projections; private copies and unsafe content never use the public backend', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-public-module-'))
  const env = {
    KET_LOG: 'null',
    KET_SQLITE: join(dir, 'app.db'),
    KET_STORAGE_DIR: join(dir, 'private'),
    KET_STORAGE_PUBLIC_DIR: join(dir, 'public'),
    KET_STORAGE_PUBLIC_URL: 'https://cdn.example/assets',
    KET_COMPANY: 'acme',
  }
  const app = defineDeployment({
    name: 'splitfiles',
    modules: [address, partner, company, storageModule],
    worker: { queues: { maintenance: 1 } },
  })
  let server: Awaited<ReturnType<typeof bootDeployment>> | undefined
  let worker: Awaited<ReturnType<typeof bootWorker>> | undefined
  try {
    server = await bootDeployment(app, { port: 0, env })
    const at = `http://127.0.0.1:${server.port}`
    const call = (name: string, args: Record<string, unknown>) =>
      callFn(name, args, {
        adapter: server!.adapter!,
        manifest: server!.manifest,
        scope: { company: 'acme' },
      })
    const upload = async (isPublic: boolean, type = 'image/png') => {
      const form = new FormData()
      form.set('public', String(isPublic))
      form.set('file', new File([png], 'image.png', { type }))
      const response = await fetch(`${at}/files`, { method: 'POST', body: form })
      assert.equal(response.status, 201, await response.clone().text())
      return (await response.json()) as Attachment
    }
    const privateFile = await upload(false)
    const published1 = await upload(true)
    const published2 = await upload(true)
    const unsafe = await upload(true, 'text/html')
    assert.equal(privateFile.storeKey, published1.storeKey)
    const objects = namespacedStorage(storageFromConfig(server.config), 'splitfiles')
    assert.deepEqual(
      (await objects.public!.list('')).keys,
      [],
      'HTTP request writes only the canonical private source',
    )
    const before = await fetch(`${at}/files/${published1.id}`, { redirect: 'manual' })
    assert.equal(before.status, 200, 'public attachments still work before the worker publishes')
    assert.deepEqual(Buffer.from(await before.arrayBuffer()), png)
    worker = await bootWorker(app, { env, log: () => {} })
    assert.equal(await worker.drain(), 2)
    const one = (await call('storage.getAttachment', { id: published1.id })).value as Attachment
    const two = (await call('storage.getAttachment', { id: published2.id })).value as Attachment
    assert.ok(one.publicStoreKey)
    assert.notEqual(one.publicStoreKey, two.publicStoreKey)
    assert.notEqual(one.publicStoreKey, privateFile.storeKey)
    assert.equal((await objects.list('')).keys.length, 1)
    assert.equal((await objects.public!.list('')).keys.length, 2)
    const direct = await fetch(`${at}/files/${one.id}`, { redirect: 'manual' })
    assert.equal(direct.status, 302)
    assert.equal(
      direct.headers.get('location'),
      `https://cdn.example/assets/splitfiles/${one.publicStoreKey}`,
    )
    const head = await fetch(`${at}/files/${one.id}`, { method: 'HEAD' })
    assert.equal(head.status, 200)
    assert.equal(Number(head.headers.get('content-length')), png.length)
    const privateResponse = await fetch(`${at}/files/${privateFile.id}`, { redirect: 'manual' })
    assert.equal(privateResponse.status, 200)
    assert.equal(privateResponse.headers.get('location'), null)
    assert.equal(privateResponse.headers.get('cache-control'), 'private, no-store')
    const unsafeResponse = await fetch(`${at}/files/${unsafe.id}`, { redirect: 'manual' })
    assert.equal(unsafeResponse.status, 200)
    assert.equal(unsafeResponse.headers.get('content-type'), 'application/octet-stream')
    assert.match(unsafeResponse.headers.get('content-disposition')!, /^attachment;/)
    // One public copy can be collected without deleting a private duplicate or another publication.
    await call('storage.removeAttachment', { id: one.id })
    const aged = new Date(Date.now() - 2 * 60 * 60 * 1000)
    await utimes(join(env.KET_STORAGE_PUBLIC_DIR, 'splitfiles', one.publicStoreKey!), aged, aged)
    await utimes(join(env.KET_STORAGE_DIR, 'splitfiles', privateFile.storeKey), aged, aged)
    await call('storage.requestSweep', {})
    await worker.drain()
    assert.equal(await objects.public!.head(one.publicStoreKey!), null)
    assert.ok(await objects.public!.head(two.publicStoreKey!))
    assert.ok(await objects.head(privateFile.storeKey))
  } finally {
    await worker?.close()
    await server?.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('split attachments: failed publication is retryable and does not break the original download', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-public-retry-'))
  let fail = true
  const privateStore = localStorage({ dir: join(dir, 'private') })
  const publicStore = localStorage({ dir: join(dir, 'public') })
  const unstable: Storage = {
    ...publicStore,
    async put(key, body, options) {
      if (fail) throw new Error('publication backend unavailable')
      return publicStore.put(key, body, options)
    },
  }
  const app = defineDeployment({
    name: 'retryfiles',
    modules: [address, partner, company, storageModule],
    worker: { queues: { maintenance: 1 } },
    serve: {
      openStorage: () => withPublicStorage(privateStore, unstable),
    },
  })
  const env = { KET_LOG: 'null', KET_SQLITE: join(dir, 'app.db'), KET_COMPANY: 'acme' }
  let server: Awaited<ReturnType<typeof bootDeployment>> | undefined
  let worker: Awaited<ReturnType<typeof bootWorker>> | undefined
  try {
    server = await bootDeployment(app, { port: 0, env })
    const at = `http://127.0.0.1:${server.port}`
    const form = new FormData()
    form.set('public', 'true')
    form.set('file', new File([png], 'image.png', { type: 'image/png' }))
    const response = await fetch(`${at}/files`, { method: 'POST', body: form })
    assert.equal(response.status, 201)
    const attachment = (await response.json()) as Attachment
    worker = await bootWorker(app, { env, log: () => {} })
    await worker.runOnce()
    await worker.drain()
    const queue = await createQueue(server.adapter!)
    const jobs = await queue.list({ state: 'retryable' })
    assert.equal(jobs.length, 1)
    assert.equal((await fetch(`${at}/files/${attachment.id}`)).status, 200)
    fail = false
    await queue.retryNow(jobs[0]!.id)
    await worker.drain()
    assert.equal((await queue.get(jobs[0]!.id))?.state, 'completed')
    const result = await fetch(`${at}/files/${attachment.id}`, { redirect: 'manual' })
    assert.equal(result.status, 200, 'without a CDN base URL the application reads the publication backend')
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), png)
    assert.equal((await namespacedStorage(publicStore, 'retryfiles').list('')).keys.length, 1)
  } finally {
    await worker?.close()
    await server?.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('split attachments: opt-in sweep backfills multiple pages; disabling split storage preserves downloads', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-public-backfill-'))
  const env = {
    KET_LOG: 'null',
    KET_SQLITE: join(dir, 'app.db'),
    KET_STORAGE_DIR: join(dir, 'private'),
    KET_COMPANY: 'acme',
  }
  const splitEnv = {
    ...env,
    KET_STORAGE_PUBLIC_DIR: join(dir, 'public'),
    KET_STORAGE_PUBLIC_URL: 'https://cdn.example',
  }
  const app = defineDeployment({
    name: 'legacyfiles',
    modules: [address, partner, company, storageModule],
    worker: { queues: { maintenance: 1 } },
  })
  let server: Awaited<ReturnType<typeof bootDeployment>> | undefined
  let worker: Awaited<ReturnType<typeof bootWorker>> | undefined
  try {
    server = await bootDeployment(app, { port: 0, env })
    const call = (name: string, args: Record<string, unknown>) =>
      callFn(name, args, {
        adapter: server!.adapter!,
        manifest: server!.manifest,
        scope: { company: 'acme' },
      })
    const form = new FormData()
    form.set('public', 'true')
    form.set('file', new File([png], 'legacy.png', { type: 'image/png' }))
    const uploaded = await fetch(`http://127.0.0.1:${server.port}/files`, { method: 'POST', body: form })
    assert.equal(uploaded.status, 201)
    const first = (await uploaded.json()) as Attachment
    const data = {
      name: 'legacy.png',
      kind: 'stored',
      storeKey: first.storeKey,
      checksum: first.checksum,
      mimetype: 'image/png',
      size: png.length,
      public: true,
      createdAt: new Date().toISOString(),
    }
    for (let i = 0; i < 251; i++)
      await call('storage.createAttachment', { ...data, id: `legacy-${String(i).padStart(3, '0')}` })
    const queue = await createQueue(server.adapter!)
    assert.equal(
      await queue.pending('maintenance'),
      0,
      'single-bucket public writes require no publication worker',
    )
    await server.close()
    server = await bootDeployment(app, { port: 0, env: splitEnv })
    const objects = namespacedStorage(storageFromConfig(server.config), 'legacyfiles')
    assert.deepEqual(
      (await objects.public!.list('')).keys,
      [],
      'enabling the second backend does not migrate at boot',
    )
    await call('storage.requestSweep', {})
    worker = await bootWorker(app, { env: splitEnv, log: () => {} })
    assert.equal(await worker.drain(), 253, 'one sweep and 252 publications, including the second page')
    for (const id of [first.id, 'legacy-000', 'legacy-250']) {
      const row = (await call('storage.getAttachment', { id })).value as Attachment
      assert.ok(row.publicStoreKey)
      assert.ok(await objects.public!.head(row.publicStoreKey))
      assert.equal(row.storeKey, first.storeKey)
    }
    assert.ok(await objects.head(first.storeKey))
    await worker.close()
    worker = undefined
    await server.close()
    server = await bootDeployment(app, { port: 0, env })
    const fallback = await fetch(`http://127.0.0.1:${server.port}/files/${first.id}`, { redirect: 'manual' })
    assert.equal(fallback.status, 200)
    assert.equal(fallback.headers.get('location'), null)
    assert.deepEqual(Buffer.from(await fallback.arrayBuffer()), png)
  } finally {
    await worker?.close()
    await server?.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('split attachments: deletion during publication cannot resurrect a public copy', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-public-race-'))
  const privateStore = localStorage({ dir: join(dir, 'private') })
  const publicStore = localStorage({ dir: join(dir, 'public') })
  let afterCopy: () => Promise<void> = async () => {}
  const racing: Storage = {
    ...publicStore,
    async put(key, body, options) {
      const stored = await publicStore.put(key, body, options)
      await afterCopy()
      return stored
    },
  }
  const app = defineDeployment({
    name: 'racefiles',
    modules: [address, partner, company, storageModule],
    worker: { queues: { maintenance: 1 } },
    serve: { openStorage: () => withPublicStorage(privateStore, racing) },
  })
  const env = { KET_LOG: 'null', KET_SQLITE: join(dir, 'app.db'), KET_COMPANY: 'acme' }
  let server: Awaited<ReturnType<typeof bootDeployment>> | undefined
  let worker: Awaited<ReturnType<typeof bootWorker>> | undefined
  try {
    server = await bootDeployment(app, { port: 0, env })
    const call = (name: string, args: Record<string, unknown>) =>
      callFn(name, args, {
        adapter: server!.adapter!,
        manifest: server!.manifest,
        scope: { company: 'acme' },
      })
    const form = new FormData()
    form.set('public', 'true')
    form.set('file', new File([png], 'race.png', { type: 'image/png' }))
    const uploaded = await fetch(`http://127.0.0.1:${server.port}/files`, { method: 'POST', body: form })
    assert.equal(uploaded.status, 201)
    const attachment = (await uploaded.json()) as Attachment
    afterCopy = async () => {
      await call('storage.removeAttachment', { id: attachment.id })
    }
    worker = await bootWorker(app, { env, log: () => {} })
    assert.equal(await worker.drain(), 1)
    assert.equal((await call('storage.getAttachment', { id: attachment.id })).value, null)
    assert.deepEqual((await publicStore.list('')).keys, [])
    assert.ok(await namespacedStorage(privateStore, 'racefiles').head(attachment.storeKey))
  } finally {
    await worker?.close()
    await server?.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('split attachments: large downloads sign the selected backend without caching expiring URLs', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-public-signed-'))
  const privateStore = localStorage({ dir: join(dir, 'private') })
  const publicStore = localStorage({ dir: join(dir, 'public') })
  const signed = (backend: Storage, label: string): Storage => ({
    ...backend,
    async signedUrl(key, options) {
      assert.equal(options.expiresIn, 60)
      return `https://${label}.example/${key}?signature=test-only`
    },
  })
  const app = defineDeployment({
    name: 'signedfiles',
    modules: [address, partner, company, storageModule],
    worker: { queues: { maintenance: 1 } },
    serve: {
      openStorage: () => withPublicStorage(signed(privateStore, 'private'), signed(publicStore, 'public')),
    },
  })
  const env = { KET_LOG: 'null', KET_SQLITE: join(dir, 'app.db'), KET_COMPANY: 'acme' }
  let server: Awaited<ReturnType<typeof bootDeployment>> | undefined
  let worker: Awaited<ReturnType<typeof bootWorker>> | undefined
  try {
    server = await bootDeployment(app, { port: 0, env })
    const at = `http://127.0.0.1:${server.port}`
    const upload = async (isPublic: boolean) => {
      const form = new FormData()
      form.set('public', String(isPublic))
      form.set('file', new File([png, Buffer.alloc(1024 * 1024)], 'large.png', { type: 'image/png' }))
      const response = await fetch(`${at}/files`, { method: 'POST', body: form })
      assert.equal(response.status, 201)
      return (await response.json()) as Attachment
    }
    const privateFile = await upload(false)
    const publicFile = await upload(true)
    const check = async (id: string, backend: string) => {
      const response = await fetch(`${at}/files/${id}`, { redirect: 'manual' })
      assert.equal(response.status, 302)
      assert.equal(response.headers.get('cache-control'), 'private, no-store')
      assert.equal(new URL(response.headers.get('location')!).host, `${backend}.example`)
    }
    await check(privateFile.id, 'private')
    await check(publicFile.id, 'private')
    worker = await bootWorker(app, { env, log: () => {} })
    assert.equal(await worker.drain(), 1)
    await check(privateFile.id, 'private')
    await check(publicFile.id, 'public')
  } finally {
    await worker?.close()
    await server?.close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('split attachments: anonymous requests and jobs in another company cannot publish private attachments', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-public-auth-'))
  const env = {
    KET_LOG: 'null',
    KET_SQLITE: join(dir, 'app.db'),
    KET_STORAGE_DIR: join(dir, 'private'),
    KET_STORAGE_PUBLIC_DIR: join(dir, 'public'),
    KET_STORAGE_PUBLIC_URL: 'https://cdn.example',
    KET_SECRET: 'test-only-secret',
  }
  const app = defineDeployment({
    name: 'authfiles',
    modules: [address, partner, company, storageModule],
    worker: { queues: { maintenance: 1 } },
    serve: { sessions: { anonymous: { company: 'acme' } } },
  })
  let server: Awaited<ReturnType<typeof bootDeployment>> | undefined
  let worker: Awaited<ReturnType<typeof bootWorker>> | undefined
  try {
    server = await bootDeployment(app, { port: 0, env })
    const call = (name: string, args: Record<string, unknown>) =>
      callFn(name, args, {
        adapter: server!.adapter!,
        manifest: server!.manifest,
        scope: { company: 'acme' },
      })
    const checksum = sha256(png)
    const key = `blobs/acme/${checksum.slice(0, 2)}/${checksum}`
    const objects = namespacedStorage(storageFromConfig(server.config), 'authfiles')
    await objects.put(
      key,
      (async function* () {
        yield png
      })(),
      { type: 'image/png' },
    )
    const data = {
      name: 'image.png',
      kind: 'stored',
      storeKey: key,
      checksum,
      mimetype: 'image/png',
      size: png.length,
      createdAt: new Date().toISOString(),
    }
    await call('storage.createAttachment', { ...data, id: 'private', public: false })
    await call('storage.createAttachment', { ...data, id: 'public', public: true })
    await assert.rejects(
      () =>
        call('storage.createAttachment', { ...data, id: 'forged-copy', public: false, publishCopy: true }),
      /public stored attachment/,
    )
    await assert.rejects(() =>
      call('storage.createAttachment', {
        ...data,
        id: 'forged-key',
        public: true,
        publicStoreKey: 'someone-elses-copy',
      }),
    )
    const queue = await createQueue(server.adapter!)
    await queue.enqueue(
      'storage.publish',
      { id: 'public' },
      { queue: 'maintenance', scope: { company: 'other', companies: ['acme', 'other'] } },
    )
    await queue.enqueue(
      'storage.publish',
      { id: 'private' },
      { queue: 'maintenance', scope: { company: 'acme' } },
    )
    worker = await bootWorker(app, { env, log: () => {} })
    assert.equal(await worker.drain(), 2)
    assert.deepEqual((await objects.public!.list('')).keys, [])
    const at = `http://127.0.0.1:${server.port}`
    assert.equal((await fetch(`${at}/files/private`)).status, 404)
    const form = new FormData()
    form.set('public', 'true')
    form.set('file', new File([png], 'anonymous.png', { type: 'image/png' }))
    assert.equal((await fetch(`${at}/files`, { method: 'POST', body: form })).status, 401)
    assert.equal(await queue.pending('maintenance'), 0)
    await queue.enqueue(
      'storage.publish',
      { id: 'public' },
      { queue: 'maintenance', scope: { company: 'acme' } },
    )
    assert.equal(await worker.drain(), 1)
    assert.equal((await fetch(`${at}/files/public`, { redirect: 'manual' })).status, 302)
    assert.equal((await fetch(`${at}/files/private`)).status, 404)
  } finally {
    await worker?.close()
    await server?.close()
    await rm(dir, { recursive: true, force: true })
  }
})
