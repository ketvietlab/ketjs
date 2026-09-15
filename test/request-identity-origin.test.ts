import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { bootDeployment, defineDeployment, json } from '@ketvietlab/ketjs'
import { address, company, partner } from '@ketvietlab/ketsuite'

test('request identity: a gateway identity says so and carries the declared sign-out path', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-request-identity-'))
  const app = defineDeployment({
    name: 'gatewayviewer',
    modules: [address, partner, company],
    serve: {
      sessions: { anonymous: { company: 'acme' } },
      resolveIdentity: async ({ req }) =>
        req.headers['x-test-verified-identity'] === 'linh'
          ? { userId: 'linh', companies: ['acme'], company: 'acme' }
          : null,
      signOutPath: '/auth/logout',
      routes: (ctx) => ({
        '/probe': async (url, req) =>
          json({ identity: await ctx.requestIdentityOf(url, req), signOutPath: ctx.signOutPath }),
      }),
    },
  })
  const server = await bootDeployment(app, {
    port: 0,
    env: { KET_LOG: 'null', KET_SQLITE: join(dir, 'app.db'), KET_SECRET: 'test-only-secret' },
  })
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/probe`, {
      headers: { 'x-test-verified-identity': 'linh' },
    })
    assert.equal(response.status, 200)
    const body = (await response.json()) as {
      identity: { userId: string; origin: string; company: string } | null
      signOutPath: string | null
    }
    // No KetJS cookie was sent: the identity is the one the gateway asserted.
    assert.equal(body.identity?.userId, 'linh')
    assert.equal(body.identity?.company, 'acme')
    assert.equal(body.identity?.origin, 'request')
    assert.equal(body.signOutPath, '/auth/logout')
  } finally {
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
})
