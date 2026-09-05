import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  effectStorage,
  localStorage,
  namespacedStorage,
  readConfig,
  storageFromConfig,
  withPublicStorage,
} from '@ketvietlab/ketjs'

const body = async function* (value: string) {
  yield Buffer.from(value)
}
const env = {
  KET_STORAGE: 's3',
  KET_S3_ENDPOINT: 'https://objects.example',
  KET_S3_BUCKET: 'private-assets',
  KET_S3_KEY: 'private-key',
  KET_S3_SECRET: 'private-secret',
  KET_S3_REGION: 'auto',
  KET_S3_PATH_STYLE: '1',
}
const publicEnv = {
  KET_S3_PUBLIC_BUCKET: 'public-assets',
  KET_S3_PUBLIC_KEY: 'publisher-key',
  KET_S3_PUBLIC_SECRET: 'publisher-secret',
  KET_STORAGE_PUBLIC_URL: 'https://cdn.example/assets/',
}

test('split storage: old configuration remains private-only; public signing uses its own bucket and credential', async () => {
  const old = storageFromConfig(readConfig(env))
  assert.equal(old.public, undefined)
  assert.equal(old.publicUrl, undefined)
  const root = namespacedStorage(storageFromConfig(readConfig({ ...env, ...publicEnv })), 'tenant-a')
  const privateUrl = new URL((await root.signedUrl('same/key', { expiresIn: 60 }))!)
  const publicUrl = new URL((await root.public!.signedUrl('same/key', { expiresIn: 60 }))!)
  assert.equal(privateUrl.pathname, '/private-assets/tenant-a/same/key')
  assert.match(privateUrl.searchParams.get('X-Amz-Credential')!, /^private-key\//)
  assert.equal(publicUrl.pathname, '/public-assets/tenant-a/same/key')
  assert.match(publicUrl.searchParams.get('X-Amz-Credential')!, /^publisher-key\//)
  assert.equal(root.publicUrl, undefined)
  assert.equal(
    root.public!.publicUrl!('images/ảnh #1.png'),
    'https://cdn.example/assets/tenant-a/images/%E1%BA%A3nh%20%231.png',
  )
  assert.throws(() => root.public!.publicUrl!('../tenant-b/key'), /unsafe storage key/)
})

test('split storage: public endpoint can differ; no public setting silently falls back to private credentials', async () => {
  const root = storageFromConfig(
    readConfig({
      ...env,
      ...publicEnv,
      KET_S3_PUBLIC_ENDPOINT: 'https://other.example',
      KET_S3_PUBLIC_REGION: 'other-region',
    }),
  )
  const url = new URL((await root.public!.signedUrl('key', { expiresIn: 60 }))!)
  assert.equal(url.host, 'other.example')
  assert.match(url.searchParams.get('X-Amz-Credential')!, /other-region/)
  assert.throws(
    () => storageFromConfig(readConfig({ ...env, KET_S3_PUBLIC_BUCKET: 'public-assets' })),
    /KET_S3_PUBLIC_KEY, KET_S3_PUBLIC_SECRET/,
  )
  assert.throws(
    () => storageFromConfig(readConfig({ ...env, KET_STORAGE_PUBLIC_URL: 'https://cdn.example' })),
    /KET_S3_PUBLIC_BUCKET/,
  )
  assert.throws(
    () => storageFromConfig(readConfig({ ...env, ...publicEnv, KET_S3_PUBLIC_BUCKET: env.KET_S3_BUCKET })),
    /must be distinct/,
  )
  assert.throws(
    () =>
      storageFromConfig(
        readConfig({
          ...env,
          ...publicEnv,
          KET_S3_PUBLIC_BUCKET: env.KET_S3_BUCKET,
          KET_S3_PUBLIC_ENDPOINT: 'https://objects.example/',
        }),
      ),
    /must be distinct/,
  )
  for (const endpoint of [
    'https://objects.example/ignored-path',
    'https://objects.example/?ignored=1#fragment',
  ])
    assert.throws(
      () =>
        storageFromConfig(
          readConfig({
            ...env,
            ...publicEnv,
            KET_S3_PUBLIC_BUCKET: env.KET_S3_BUCKET,
            KET_S3_PUBLIC_ENDPOINT: endpoint,
          }),
        ),
      /must be distinct/,
    )
  assert.throws(() => readConfig({ ...publicEnv }), /requires KET_STORAGE=s3/)
  assert.throws(() => readConfig({ ...env, KET_STORAGE_PUBLIC_DIR: '/tmp/public' }), /cannot use/)
  for (const baseUrl of [
    'javascript:alert(1)',
    'https://user:password@cdn.example',
    'https://cdn.example/?token=secret',
    'https://cdn.example/#hash',
    '',
  ])
    assert.throws(
      () => storageFromConfig(readConfig({ ...env, ...publicEnv, KET_STORAGE_PUBLIC_URL: baseUrl })),
      /public storage URL/,
    )
})

test('split storage: public defaults can be overridden without exposing private storage', () => {
  const config = readConfig(
    { KET_STORAGE_PUBLIC_URL: 'https://new.example' },
    {
      storageKind: 'local',
      storageDir: '/tmp/private-assets',
      publicStorage: { kind: 'local', dir: '/tmp/public-assets', baseUrl: 'https://old.example' },
    },
  )
  assert.equal(storageFromConfig(config).public!.publicUrl!('key'), 'https://new.example/key')
  for (const dir of ['/tmp/private-assets', '/tmp/private-assets/nested', '/tmp', '/'])
    assert.throws(
      () =>
        storageFromConfig(
          readConfig({ KET_STORAGE_DIR: '/tmp/private-assets', KET_STORAGE_PUBLIC_DIR: dir }),
        ),
      /must not overlap/,
    )
  assert.throws(
    () => storageFromConfig(readConfig({ KET_STORAGE_PUBLIC_URL: 'https://cdn.example' })),
    /KET_STORAGE_PUBLIC_DIR/,
  )
})

test('split storage: both backends retain tenant isolation and declared-effect boundaries', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-storage-split-'))
  try {
    const root = withPublicStorage(
      localStorage({ dir: join(dir, 'private') }),
      localStorage({ dir: join(dir, 'public') }),
      { baseUrl: 'https://cdn.example' },
    )
    const a = namespacedStorage(root, 'tenant-a')
    const b = namespacedStorage(root, 'tenant-b')
    await a.put('same/key', body('private-a'), { type: 'text/plain' })
    await a.public!.put('same/key', body('public-a'), { type: 'text/plain' })
    await b.public!.put('same/key', body('public-b'), { type: 'text/plain' })
    assert.equal((await a.head('same/key'))!.size, 9)
    assert.equal((await a.public!.head('same/key'))!.size, 8)
    assert.deepEqual((await a.public!.list('same/')).keys, ['same/key'])
    assert.equal(await b.head('same/key'), null)
    assert.notEqual(a.public!.publicUrl!('same/key'), b.public!.publicUrl!('same/key'))
    await a.public!.remove('same/key')
    assert.ok(await a.head('same/key'))
    assert.ok(await b.public!.head('same/key'))
    const writeOnly = effectStorage(a, ['storage:write'], 'media.publish')
    assert.throws(() => writeOnly.public!.get('same/key'), /storage:read/)
    assert.throws(() => writeOnly.public!.publicUrl!('same/key'), /storage:read/)
    const readOnly = namespacedStorage(effectStorage(root, ['storage:read'], 'media.inspect'), 'tenant-a')
    assert.throws(() => readOnly.public!.put('same/key', body('x'), { type: 'text/plain' }), /storage:write/)
    assert.throws(() => readOnly.public!.remove('same/key'), /storage:remove/)
    assert.throws(
      () => a.public!.put('../tenant-b/key', body('x'), { type: 'text/plain' }),
      /unsafe storage key/,
    )
    assert.throws(() => withPublicStorage(root, b), /distinct leaf/)
    assert.throws(() => withPublicStorage(b, b), /distinct leaf/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
