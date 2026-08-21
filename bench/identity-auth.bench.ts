// PostgreSQL benchmark for the Odoo 19 User/Auth slice.
// Migration, fixture creation and password hashing during fixture setup are excluded.

import { performance } from 'node:perf_hooks'
import { pathToFileURL } from 'node:url'
import {
  callFn,
  compose,
  planMigration,
  registerFunctions,
  renderSql,
  schemaFromManifest,
} from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import * as shippedSuite from '@ketvietlab/ketsuite'

const url = process.env.KET_BENCH_PG
if (!url) throw new Error('set KET_BENCH_PG to an explicit PostgreSQL benchmark database')

type Suite = typeof shippedSuite
const suite = process.env.KET_BENCH_KETSUITE_MODULE
  ? ((await import(pathToFileURL(process.env.KET_BENCH_KETSUITE_MODULE).href)) as Suite)
  : shippedSuite
const modules = [suite.address, suite.partner, suite.company, suite.user]
const manifest = compose(modules, { headless: true })
const scope = {
  company: 'company-a',
  companies: ['company-a', 'company-b'],
  branch: 'root:company-a',
  branches: ['root:company-a', 'root:company-b'],
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
  for (let index = 0; index < Math.min(20, count); index++) await run(index)
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

await adapter.open()
try {
  const schema = schemaFromManifest(manifest)
  for (const tableName of Object.keys(schema.tables))
    await adapter.exec(`DROP TABLE IF EXISTS "${tableName}" CASCADE`)
  for (const sql of renderSql(planMigration(null, schema), adapter)) await adapter.exec(sql)
  registerFunctions(modules)

  for (const [id, code, name] of [
    ['company-a', 'KET', 'Kết Việt'],
    ['company-b', 'GLX', 'Globex'],
  ] as const) {
    expectOk(
      'partner.savePartner',
      (await call('partner.savePartner', { id: `partner:${id}`, kind: 'company', name }, null)).value,
    )
    expectOk(
      'company.saveCompany',
      (await call('company.saveCompany', { id, code, partnerId: `partner:${id}`, currency: 'VND' }, null))
        .value,
    )
  }

  const users = [
    ['bench-admin', 'bench-admin', true],
    ['bench-worker', 'bench-worker', false],
    ...Array.from(
      { length: 30 },
      (_, index) => [`concurrent-${index}`, `concurrent-${index}`, false] as const,
    ),
  ] as const
  for (const [id, login, superuser] of users) {
    expectOk(
      'user.createUser',
      (
        await call(
          'user.createUser',
          {
            id,
            login,
            ...(login.startsWith('concurrent-') ? {} : { password: 'benchmark-password' }),
            name: `Benchmark ${login}`,
            superuser,
          },
          null,
        )
      ).value,
    )
    for (const companyId of ['company-a', 'company-b'])
      expectOk(
        'user.grantCompany',
        (
          await call('user.grantCompany', {
            id: `membership:${id}:${companyId}`,
            userId: id,
            companyId,
          })
        ).value,
      )
  }

  expectOk('user.saveRole', (await call('user.saveRole', { id: 'bench-role', name: 'Benchmark role' })).value)
  expectOk(
    'user.grantFunction',
    (
      await call('user.grantFunction', {
        id: 'bench-role:list-users',
        roleId: 'bench-role',
        fnKey: 'user.listUsers',
      })
    ).value,
  )
  expectOk(
    'user.assignRole',
    (
      await call('user.assignRole', {
        id: 'bench-worker:bench-role',
        userId: 'bench-worker',
        roleId: 'bench-role',
      })
    ).value,
  )

  await measure('authenticated user list', 300, async () => {
    await call('user.listUsers', {}, 'bench-worker')
  })
  await measure('permission resolution', 300, async () => {
    await call('user.permitted', { userId: 'bench-worker' })
  })
  await measure('live session resolution', 300, async () => {
    await call('user.resolveSessionContext', {
      userId: 'bench-worker',
      companyId: 'company-a',
      companies: ['company-a', 'company-b'],
      branchId: 'root:company-a',
      branches: ['root:company-a', 'root:company-b'],
      securityVersion: 0,
    })
  })
  await measure('successful login KDF', 30, async () => {
    await call(
      'user.authenticate',
      {
        login: 'bench-worker',
        password: 'benchmark-password',
        ...('networkFingerprint' in (manifest.functions['user.authenticate']?.input ?? {})
          ? { networkFingerprint: 'bench-success' }
          : {}),
      },
      null,
    )
  })
  await measure('existing role assignment', 300, async (index) => {
    await call('user.assignRole', {
      id: `repeat-assignment:${index}`,
      userId: 'bench-worker',
      roleId: 'bench-role',
    })
  })

  const assignmentHasUnique = Boolean(
    Object.values(manifest.models['user.Assignment']?.indexes ?? {}).some((index) => index.unique),
  )
  if (assignmentHasUnique) {
    await measureConcurrent(
      'concurrent role membership',
      30,
      8,
      async () => {},
      async (round, index) => {
        expectOk(
          'user.assignRole',
          (
            await call('user.assignRole', {
              id: `race-assignment:${round}:${index}`,
              userId: `concurrent-${round}`,
              roleId: 'bench-role',
            })
          ).value,
        )
      },
    )
  } else {
    console.log('concurrent role membership'.padEnd(40), 'not safe in baseline')
  }

  if (manifest.functions['user.issueAuthToken'] && manifest.functions['user.consumeAuthToken']) {
    const tokens = new Map<number, string>()
    await measureConcurrent(
      'single-use token CAS',
      10,
      4,
      async (round) => {
        const result = await call('user.issueAuthToken', {
          userId: `concurrent-${round}`,
          kind: 'reset',
        })
        const token = String((result.value as { token?: string }).token ?? '')
        if (!token) throw new Error('user.issueAuthToken did not return a token')
        tokens.set(round, token)
      },
      async (round) => {
        await call(
          'user.consumeAuthToken',
          {
            token: tokens.get(round),
            kind: 'reset',
            password: `changed-password-${round}`,
          },
          null,
        )
      },
    )
  } else {
    console.log('single-use token CAS'.padEnd(40), 'not available in baseline')
  }
} finally {
  await adapter.close()
}
