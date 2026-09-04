// What the Flow project screens cost to open, at the size the plan asks about.
//
// Twenty projects, twenty thousand issues, six hundred documents. Every figure
// below is a render across the real HTTP boundary with a real datastore behind
// it, so it includes the query, the serialization and the markup.
//
// Run:  KET_BENCH_PG=postgres://dev:devpassword@127.0.0.1:5435/postgres npm run bench:flow
// Without KET_BENCH_PG it runs on SQLite, which is useful for a relative
// reading and useless for an absolute one.

import { performance } from 'node:perf_hooks'
import { defineDeployment, tableNameFor } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import * as suite from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'
import { openStore } from '../apps/ketsuite/config.ts'

const PROJECTS = Number(process.env.KET_BENCH_FLOW_PROJECTS ?? 20)
const PER_PROJECT = Number(process.env.KET_BENCH_FLOW_ISSUES ?? 1000)
const PAGES = Number(process.env.KET_BENCH_FLOW_PAGES ?? 600)
const ROUNDS = Number(process.env.KET_BENCH_FLOW_ROUNDS ?? 7)

const app = defineDeployment({
  name: 'flow_bench',
  modules: [
    suite.website,
    suite.address,
    suite.partner,
    suite.company,
    suite.user,
    suite.storage,
    suite.mail,
    suite.activity,
    backend,
    suite.livedoc,
    suite.flow,
    suite.flowBackend,
  ],
  theme: suite.paperTheme,
  serve: {
    // The driver comes from the app rather than the framework, which cannot
    // depend on one without becoming a cycle.
    openStore,
    defaults: { defaultCompany: 'kv', defaultLocale: 'vi', fallbackLocale: 'vi' },
    sessions: { anonymous: { company: 'kv' } },
  },
})

const percentile = (values: number[], point: number): number => {
  const ordered = [...values].sort((a, b) => a - b)
  return ordered[Math.min(ordered.length - 1, Math.floor(ordered.length * point))] ?? 0
}

const databaseUrl = process.env.KET_BENCH_PG?.trim()
const bench = await createTestDeployment(app, {
  worker: false,
  ...(databaseUrl ? { env: { DATABASE_URL: databaseUrl } } : {}),
})

const stamp = '2026-09-01T00:00:00.000Z'
const scope = { company: 'kv', companies: ['kv'], branches: null }
const seed = (name: string, input: Record<string, unknown>) => bench.fixture.call(name, input, { scope })

/**
 * Rows straight into the store, in the placeholder dialect the driver speaks.
 *
 * PostgreSQL numbers its parameters and SQLite does not, and this is the one
 * place in the file that writes SQL by hand — the point of the bench is what
 * the screens read, not what a thousand saves cost.
 */
const bulk = async (
  adapter: Adapter,
  model: string,
  columns: readonly string[],
  rows: readonly unknown[][],
): Promise<void> => {
  const numbered = adapter.name.includes('postgres')
  // Written by concatenation rather than interpolation: the build collapses a
  // doubled dollar in a template literal, which turned $1 into 1.
  const holders = columns.map((_, index) => (numbered ? '$' + (index + 1) : '?')).join(', ')
  const sql = `INSERT INTO ${adapter.quoteIdent(tableNameFor(model))} (${columns
    .map((name) => adapter.quoteIdent(name))
    .join(', ')}) VALUES (${holders})`
  try {
    for (const row of rows) await adapter.run(sql, row as never[])
  } catch (error) {
    throw new Error(`${model}: ${(error as Error).message} — ${sql}`, { cause: error })
  }
}

try {
  await seed('partner.savePartner', { id: 'kv-company', kind: 'company', name: 'Két Việt' })
  await seed('partner.savePartner', { id: 'kv-person', kind: 'person', name: 'Lê Minh' })
  await seed('company.saveCompany', { id: 'kv', code: 'KV', partnerId: 'kv-company', currency: 'VND' })
  await seed('user.createUser', {
    id: 'bench',
    login: 'bench',
    password: 'bench-password',
    name: 'Lê Minh',
    partnerId: 'kv-person',
    defaultCompanyId: 'kv',
    superuser: true,
  })
  await seed('user.grantCompany', { id: 'bench:kv', userId: 'bench', companyId: 'kv' })

  const seeding = performance.now()
  await bench.fixture.withTenant('', async ({ adapter }) => {
    await bulk(
      adapter,
      'flow.Project',
      ['companyId', 'id', 'key', 'name', 'active'],
      Array.from({ length: PROJECTS }, (_, index) => [
        'kv',
        `p${index}`,
        `K${index}`,
        `Project ${String(index).padStart(3, '0')}`,
        true,
      ]),
    )
    await bulk(
      adapter,
      'flow.Column',
      ['companyId', 'id', 'projectId', 'code', 'name', 'sequence', 'terminalState', 'active'],
      Array.from({ length: PROJECTS }, (_, index) => [
        'kv',
        `c-open-${index}`,
        `p${index}`,
        'todo',
        'To do',
        10,
        false,
        true,
      ]).concat(
        Array.from({ length: PROJECTS }, (_, index) => [
          'kv',
          `c-done-${index}`,
          `p${index}`,
          'done',
          'Done',
          20,
          true,
          true,
        ]),
      ),
    )
    await bulk(
      adapter,
      'flow.Issue',
      [
        'companyId',
        'id',
        'projectId',
        'columnId',
        'title',
        'priority',
        'threadId',
        'assigneeUserId',
        'startDate',
        'dueDate',
        'active',
        'version',
        'createdAt',
        'updatedAt',
      ],
      Array.from({ length: PROJECTS * PER_PROJECT }, (_, index) => {
        const owner = Math.floor(index / PER_PROJECT)
        const done = index % 4 === 0
        const day = new Date(Date.parse(stamp) + (index % 90) * 86_400_000).toISOString().slice(0, 10)
        return [
          'kv',
          `i${index}`,
          `p${owner}`,
          done ? `c-done-${owner}` : `c-open-${owner}`,
          `Issue ${index}`,
          'normal',
          `thread:flow.Issue:i${index}`,
          // Every third issue is the bench user's, so "my work" has a real share.
          index % 3 === 0 ? 'bench' : null,
          day,
          day,
          true,
          1,
          stamp,
          new Date(Date.parse(stamp) + index * 1000).toISOString(),
        ]
      }),
    )
    await bulk(
      adapter,
      'flow.Page',
      ['companyId', 'id', 'projectId', 'title', 'sequence', 'active', 'version', 'createdAt', 'updatedAt'],
      Array.from({ length: PAGES }, (_, index) => [
        'kv',
        `pg${index}`,
        `p${index % PROJECTS}`,
        `Doc ${index}`,
        10,
        true,
        1,
        stamp,
        new Date(Date.parse(stamp) + index * 1000).toISOString(),
      ]),
    )
  })

  await bench.client.login({ login: 'bench', password: 'bench-password' })
  console.log(
    `Flow read costs — ${PROJECTS} projects, ${PROJECTS * PER_PROJECT} issues, ${PAGES} documents` +
      ` on ${databaseUrl ? 'PostgreSQL' : 'SQLite'} (seeded in ${((performance.now() - seeding) / 1000).toFixed(1)}s)`,
  )

  const screens = [
    ['projects', '/admin/flow/projects?lang=vi'],
    ['mine', '/admin/flow/mine?lang=vi'],
    ['issues', '/admin/flow/issues?lang=vi'],
    ['backlog', '/admin/flow/projects/p0/issues?lang=vi'],
    ['gantt', '/admin/flow/projects/p0/gantt?lang=vi'],
    ['pages', '/admin/flow/pages?lang=vi'],
  ] as const

  for (const [label, path] of screens) {
    const times: number[] = []
    let bytes = 0
    for (let round = 0; round < ROUNDS; round += 1) {
      const at = performance.now()
      const response = await bench.client.get(path)
      const html = await response.text()
      times.push(performance.now() - at)
      bytes = html.length
      if (response.status !== 200) throw new Error(`${label} answered ${response.status}`)
    }
    // The first round pays for whatever the process caches; the rest is the read.
    const warm = times.slice(1)
    const mean = warm.reduce((sum, value) => sum + value, 0) / warm.length
    console.log(
      `  ${label.padEnd(9)} mean=${mean.toFixed(1).padStart(8)} ms  p50=${percentile(warm, 0.5)
        .toFixed(1)
        .padStart(
          8,
        )} ms  p95=${percentile(warm, 0.95).toFixed(1).padStart(8)} ms  html=${String(bytes).padStart(7)} B`,
    )
  }
} finally {
  await bench.close()
}
