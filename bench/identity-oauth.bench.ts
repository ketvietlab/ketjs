// PostgreSQL benchmark for the provider-neutral OAuth/OIDC slice.
// Migration, fixture creation and password hashing during setup are excluded.

import { performance } from 'node:perf_hooks'
import {
  callFn,
  compose,
  planMigration,
  registerFunctions,
  renderSql,
  schemaFromManifest,
} from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { company, oauth, partner, user } from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'

const url = process.env.KET_BENCH_PG
if (!url) throw new Error('set KET_BENCH_PG to an explicit PostgreSQL benchmark database')

const modules = [address, partner, company, user, oauth]
const manifest = compose(modules, { headless: true })
const scope = {
  company: 'company-a',
  companies: ['company-a'],
  branch: 'root:company-a',
  branches: ['root:company-a'],
}
const adapter = postgresAdapter(url)
const call = (name: string, args: Record<string, unknown>, actor: string | null = 'bench-admin') =>
  callFn(name, args, { adapter, manifest, scope, actor: actor ?? undefined })

const percentile = (samples: number[], ratio: number): number => {
  const ordered = [...samples].sort((a, b) => a - b)
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * ratio))] ?? 0
}

const report = (label: string, samples: number[], elapsed: number) => {
  console.log(
    `${label.padEnd(40)} p50=${percentile(samples, 0.5).toFixed(3)}ms  p95=${percentile(samples, 0.95).toFixed(3)}ms  throughput=${((samples.length / elapsed) * 1000).toFixed(0)} ops/s`,
  )
}

const measure = async (label: string, count: number, run: (index: number) => Promise<void>) => {
  for (let index = 0; index < Math.min(20, count); index++) await run(-index - 1)
  const samples: number[] = []
  const started = performance.now()
  for (let index = 0; index < count; index++) {
    const before = performance.now()
    await run(index)
    samples.push(performance.now() - before)
  }
  report(label, samples, performance.now() - started)
}

const measureConcurrent = async (
  label: string,
  rounds: number,
  concurrency: number,
  prepare: (round: number) => Promise<void>,
  run: (round: number, index: number) => Promise<void>,
) => {
  const samples: number[] = []
  const started = performance.now()
  for (let round = 0; round < rounds; round++) {
    await prepare(round)
    await Promise.all(
      Array.from({ length: concurrency }, async (_, index) => {
        const before = performance.now()
        await run(round, index)
        samples.push(performance.now() - before)
      }),
    )
  }
  report(label, samples, performance.now() - started)
}

const expectOk = (name: string, value: unknown) => {
  if ((value as { ok?: boolean } | null)?.ok === false) throw new Error(`${name}: ${JSON.stringify(value)}`)
}

const discovery = {
  issuer: 'https://identity.example.test',
  authorizationEndpoint: 'https://identity.example.test/oauth/v2/authorize',
  tokenEndpoint: 'https://identity.example.test/oauth/v2/token',
  jwksUri: 'https://identity.example.test/oauth/v2/keys',
}

await adapter.open()
try {
  const schema = schemaFromManifest(manifest)
  for (const tableName of Object.keys(schema.tables))
    await adapter.exec(`DROP TABLE IF EXISTS "${tableName}" CASCADE`)
  for (const sql of renderSql(planMigration(null, schema), adapter)) await adapter.exec(sql)
  registerFunctions(modules)

  expectOk(
    'partner.savePartner',
    (await call('partner.savePartner', { id: 'company-partner', kind: 'company', name: 'Kết Việt' }, null))
      .value,
  )
  expectOk(
    'company.saveCompany',
    (
      await call(
        'company.saveCompany',
        { id: 'company-a', code: 'KET', partnerId: 'company-partner', currency: 'VND' },
        null,
      )
    ).value,
  )
  for (const id of ['bench-admin', 'bench-user']) {
    expectOk(
      'user.createUser',
      (
        await call(
          'user.createUser',
          {
            id,
            login: id,
            password: 'benchmark-password',
            name: id === 'bench-admin' ? 'Benchmark administrator' : 'Benchmark user',
            superuser: id === 'bench-admin',
            defaultCompanyId: 'company-a',
            defaultBranchId: 'root:company-a',
          },
          null,
        )
      ).value,
    )
    expectOk(
      'user.grantCompany',
      (
        await call('user.grantCompany', {
          id: `${id}:company-a`,
          userId: id,
          companyId: 'company-a',
        })
      ).value,
    )
  }
  expectOk(
    'oauth.saveProvider',
    (
      await call('oauth.saveProvider', {
        id: 'provider-main',
        code: 'main',
        name: 'Identity Cloud',
        protocol: 'oidc',
        issuer: discovery.issuer,
        clientId: 'ket-client',
        clientAuthMethod: 'none',
        scopes: 'openid profile email',
        redirectUri: 'https://suite.example.test/auth/oauth/main/callback',
        allowedAlgorithms: 'RS256',
        allowLinking: true,
        autoProvision: false,
        requireVerifiedEmail: true,
        active: true,
      })
    ).value,
  )
  expectOk(
    'oauth.linkIdentity',
    (
      await call('oauth.linkIdentity', {
        id: 'identity-main',
        providerId: 'provider-main',
        userId: 'bench-user',
        subject: 'benchmark-subject',
        email: 'benchmark@example.test',
      })
    ).value,
  )
  const provider = (await call('oauth.getProvider', { id: 'provider-main' })).value as {
    updatedAt: string | Date
  }
  const providerUpdatedAt = new Date(provider.updatedAt).toISOString()

  await measure('public provider list', 300, async () => {
    await call('oauth.publicProviders', {}, null)
  })
  await measure('live session with OAuth installed', 300, async () => {
    await call('user.resolveSessionContext', {
      userId: 'bench-user',
      companyId: 'company-a',
      companies: ['company-a'],
      branchId: 'root:company-a',
      branches: ['root:company-a'],
      securityVersion: 0,
    })
  })
  await measure('linked OAuth login resolution', 300, async () => {
    await call(
      'oauth.resolveLogin',
      {
        providerId: 'provider-main',
        providerUpdatedAt,
        mode: 'login',
        issuer: discovery.issuer,
        subject: 'benchmark-subject',
        email: 'benchmark@example.test',
        emailVerified: true,
      },
      null,
    )
  })
  await measure('transaction begin and claim', 100, async (index) => {
    const begun = (
      await call(
        'oauth.beginTransaction',
        { providerId: 'provider-main', mode: 'login', returnTo: `/admin?sample=${index}`, discovery },
        null,
      )
    ).value as { state: string }
    expectOk(
      'oauth.claimTransaction',
      (await call('oauth.claimTransaction', { providerId: 'provider-main', state: begun.state }, null)).value,
    )
  })

  const states = new Map<number, string>()
  await measureConcurrent(
    'concurrent transaction CAS',
    20,
    8,
    async (round) => {
      const begun = (
        await call(
          'oauth.beginTransaction',
          { providerId: 'provider-main', mode: 'login', returnTo: `/admin?round=${round}`, discovery },
          null,
        )
      ).value as { state: string }
      states.set(round, begun.state)
    },
    async (round) => {
      await call('oauth.claimTransaction', { providerId: 'provider-main', state: states.get(round) }, null)
    },
  )
} finally {
  await adapter.close()
}
