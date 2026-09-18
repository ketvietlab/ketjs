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
  namespacedStorage,
  storageFromConfig,
} from '@ketvietlab/ketjs'
import { address, company, partner, storage as storageModule } from '@ketvietlab/ketsuite'
import sharp from 'sharp'

type Attachment = { id: string; storeKey: string; checksum: string }
type Rendition = { size: string; width: number; height: number; storeKey: string; mimetype: string }

test('storage renditions: the media worker resizes an uploaded image to WebP, the file route serves it, and removal lets the sweep collect it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-renditions-'))
  const env = {
    KET_LOG: 'null',
    KET_SQLITE: join(dir, 'app.db'),
    KET_STORAGE_DIR: join(dir, 'files'),
    KET_COMPANY: 'acme',
  }
  const app = defineDeployment({
    name: 'renditions',
    modules: [address, partner, company, storageModule],
    worker: { queues: { maintenance: 1, media: 1 } },
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
    const renditionsOf = async (attachmentId: string) =>
      (await server!.adapter!.all(
        'SELECT size, width, height, "storeKey", mimetype FROM storage_attachment_rendition WHERE "attachmentId" = ? ORDER BY size',
        [attachmentId],
      )) as unknown as Rendition[]
    const upload = async (bytes: Uint8Array, name: string, type: string) => {
      const form = new FormData()
      form.set('public', 'true')
      form.set('file', new File([new Uint8Array(bytes)], name, { type }))
      const response = await fetch(`${at}/files`, { method: 'POST', body: form })
      assert.equal(response.status, 201, await response.clone().text())
      return (await response.json()) as Attachment
    }

    const photo = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#336699' } })
      .jpeg()
      .toBuffer()
    const image = await upload(photo, 'photo.jpg', 'image/jpeg')
    // Mislabelled bytes are queued too, and must finish without a rendition rather than retry forever.
    const broken = await upload(Buffer.from('not an image'), 'broken.png', 'image/png')
    // Not a raster image: never queued.
    await upload(Buffer.from('%PDF-1.4'), 'doc.pdf', 'application/pdf')

    // Before the worker runs, asking for a size still answers — with the original.
    const early = await fetch(`${at}/files/${image.id}?size=thumb`)
    assert.equal(early.status, 200)
    assert.equal(early.headers.get('content-type'), 'image/jpeg')
    await early.arrayBuffer()

    worker = await bootWorker(app, { env, log: () => {} })
    assert.equal(await worker.drain(), 2, 'one render job per raster upload, none for the PDF')

    const objects = namespacedStorage(storageFromConfig(server.config), 'renditions')
    const renditions = await renditionsOf(image.id)
    assert.deepEqual(
      renditions.map((row) => [row.size, Number(row.width), Number(row.height), row.mimetype]),
      [
        ['large', 1920, 960, 'image/webp'],
        ['medium', 960, 480, 'image/webp'],
        ['thumb', 320, 320, 'image/webp'],
      ],
    )
    assert.deepEqual(await renditionsOf(broken.id), [])

    const thumb = await fetch(`${at}/files/${image.id}?size=thumb`)
    assert.equal(thumb.status, 200)
    assert.equal(thumb.headers.get('content-type'), 'image/webp')
    const served = await sharp(Buffer.from(await thumb.arrayBuffer())).metadata()
    assert.equal(served.format, 'webp')
    assert.equal(served.width, 320)
    // An unknown size is ignored, not an error: the original comes back.
    const unknown = await fetch(`${at}/files/${image.id}?size=huge`)
    assert.equal(unknown.headers.get('content-type'), 'image/jpeg')
    await unknown.arrayBuffer()

    // Removing the attachment drops its rendition rows; the aged objects then go with the sweep.
    await call('storage.removeAttachment', { id: image.id })
    assert.deepEqual(await renditionsOf(image.id), [])
    const aged = new Date(Date.now() - 2 * 60 * 60 * 1000)
    for (const row of renditions)
      await utimes(join(env.KET_STORAGE_DIR, 'renditions', row.storeKey), aged, aged)
    await call('storage.requestSweep', {})
    await worker.drain()
    for (const row of renditions) assert.equal(await objects.head(row.storeKey), null)
  } finally {
    await worker?.close()
    await server?.close()
    await rm(dir, { recursive: true, force: true })
  }
})
