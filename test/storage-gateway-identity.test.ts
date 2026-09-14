import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { bootDeployment, callFn, defineDeployment, localStorage, namespacedStorage } from '@ketvietlab/ketjs'
import { address, company, partner, storage } from '@ketvietlab/ketsuite'

test('private downloads honor resolved gateway identity, permission and company without a local cookie', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-storage-gateway-'))
  const app = defineDeployment({
    name: 'gatewayfiles',
    modules: [address, partner, company, storage],
    serve: {
      sessions: { anonymous: { company: 'acme' } },
      resolveIdentity: async ({ req }) => {
        const identity = req.headers['x-test-verified-identity']
        return ['reader', 'denied', 'other-company'].includes(String(identity))
          ? {
              userId: String(identity),
              companies: [identity === 'other-company' ? 'other' : 'acme'],
              company: identity === 'other-company' ? 'other' : 'acme',
            }
          : null
      },
      permissions: async (_ctx, userId) => (userId === 'denied' ? [] : ['storage.getAttachment']),
    },
  })
  const server = await bootDeployment(app, {
    port: 0,
    env: {
      KET_LOG: 'null',
      KET_SQLITE: join(dir, 'app.db'),
      KET_STORAGE_DIR: join(dir, 'objects'),
      KET_SECRET: 'test-only-secret',
    },
  })
  try {
    const key = 'blobs/acme/aa/' + 'a'.repeat(64)
    const objects = namespacedStorage(localStorage({ dir: join(dir, 'objects') }), 'gatewayfiles')
    await objects.put(
      key,
      (async function* () {
        yield Buffer.from('private evidence')
      })(),
      { type: 'text/plain' },
    )
    await callFn(
      'storage.createAttachment',
      {
        id: 'private',
        name: 'evidence.txt',
        kind: 'stored',
        storeKey: key,
        mimetype: 'text/plain',
        size: 16,
        checksum: 'a'.repeat(64),
        public: false,
        createdAt: new Date().toISOString(),
      },
      { adapter: server.adapter!, manifest: server.manifest, scope: { company: 'acme' } },
    )
    const url = `http://127.0.0.1:${server.port}/files/private`
    for (const identity of ['', 'invalid', 'denied', 'other-company']) {
      const response = await fetch(url, { headers: { 'x-test-verified-identity': identity } })
      assert.equal(response.status, 404, identity || 'anonymous')
    }
    const headers = { 'x-test-verified-identity': 'reader' }
    const response = await fetch(url, { headers })
    assert.equal(response.status, 200)
    assert.equal(await response.text(), 'private evidence')
    assert.equal(response.headers.get('cache-control'), 'private, no-store')
    assert.equal((await fetch(url, { method: 'HEAD', headers })).status, 200)
  } finally {
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
})
