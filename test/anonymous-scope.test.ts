import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { bootDeployment, defineDeployment, json } from '@ketvietlab/ketjs'
import { address, company, partner } from '@ketvietlab/ketsuite'

test('anonymous scope: the tenant names the company a request without identity reads as', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-anonymous-scope-'))
  const consulted: string[] = []
  const app = defineDeployment({
    name: 'anonymousscope',
    modules: [address, partner, company],
    serve: {
      sessions: { anonymous: { company: 'default' } },
      resolveIdentity: async ({ req }) =>
        req.headers['x-test-verified-identity'] === 'linh'
          ? { userId: 'linh', companies: ['acme'], company: 'acme' }
          : null,
      resolveAnonymousScope: async ({ adapter, req }) => {
        consulted.push(adapter.name)
        const company = String(req.headers['x-test-tenant-company'] ?? '')
        return company ? { company, companies: [company], branches: null } : null
      },
      routes: (ctx) => ({
        '/probe': async (url, req) => json(await ctx.scopeOf(url, req)),
      }),
    },
  })
  const server = await bootDeployment(app, {
    port: 0,
    env: { KET_LOG: 'null', KET_SQLITE: join(dir, 'app.db'), KET_SECRET: 'test-only-secret' },
  })
  const probe = async (headers: Record<string, string>) =>
    (await (await fetch(`http://127.0.0.1:${server.port}/probe`, { headers })).json()) as {
      company: string | null
      companies?: string[] | null
    }
  try {
    const tenant = await probe({ 'x-test-tenant-company': 'yolo-company' })
    assert.equal(tenant.company, 'yolo-company', 'the tenant decides')
    assert.deepEqual(tenant.companies, ['yolo-company'])
    assert.equal(consulted.at(-1), 'sqlite', 'the hook reads the tenant datastore')

    const fallback = await probe({})
    assert.equal(fallback.company, 'default', 'no answer keeps the deployment-wide anonymous scope')

    const before = consulted.length
    const signedIn = await probe({
      'x-test-verified-identity': 'linh',
      'x-test-tenant-company': 'yolo-company',
    })
    assert.equal(signedIn.company, 'acme', 'an identity keeps its own company')
    assert.equal(consulted.length, before, 'the hook is not asked about a request with an identity')
  } finally {
    await server.close()
    await rm(dir, { recursive: true, force: true })
  }
})
