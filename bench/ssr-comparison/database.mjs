// Isolated on-disk databases; the raw driver is a baseline, not another business framework.
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import postgres from 'postgres'
import { sqliteAdapter } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'

/**
 * The calls a fixture makes. A KetJS adapter provides them; the raw baselines implement only these.
 * @typedef {{
 *   exec(sql: string): Promise<void>,
 *   all(sql: string, params?: unknown[]): Promise<Row[]>,
 *   run(sql: string, params?: unknown[]): Promise<{ changes: number }>,
 *   tx<T>(fn: (tx: BenchAdapter) => Promise<T>): Promise<T>,
 *   close(): Promise<void>,
 * }} BenchAdapter
 * @typedef {import('@ketvietlab/ketjs').Row} Row
 * @typedef {{
 *   id: string,
 *   title: string,
 *   iterations: number,
 *   warmup: number,
 *   run(i: number): Promise<unknown>,
 *   validate(result: unknown, i: number): void,
 * }} Operation
 */

export const frameworkVersion = JSON.parse(
  readFileSync(new URL('../../packages/ketjs/package.json', import.meta.url), 'utf8'),
).version
export const ROWS = 50000
export const sqlFor = (/** @type {string} */ engine) => ({
  point: `SELECT id, name, qty FROM products WHERE id = ${engine === 'SQLite' ? '?' : '$1'}`,
  range: `SELECT id, name, qty FROM products WHERE tenant = ${engine === 'SQLite' ? '?' : '$1'} AND value >= ${engine === 'SQLite' ? '?' : '$2'} ORDER BY value, id LIMIT 20`,
  insert: `INSERT INTO products (id, tenant, value, name, qty) VALUES (${engine === 'SQLite' ? '?, ?, ?, ?, ?' : '$1, $2, $3, $4, $5'})`,
})
/**
 * @param {string} engine
 * @param {boolean} framework
 */
export async function openDatabase(engine, framework) {
  const dir = mkdtempSync(join(tmpdir(), 'ketjs-db-bench-'))
  /** @type {BenchAdapter | undefined} */
  let adapter
  /** @type {import('postgres').Sql | undefined} */
  let admin
  /** @type {string | undefined} */
  let name
  try {
    if (engine === 'SQLite') {
      if (framework) {
        const ket = sqliteAdapter(join(dir, 'bench.db'))
        await ket.open()
        adapter = ket
      } else {
        const db = new DatabaseSync(join(dir, 'bench.db'))
        db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON')
        /** @param {unknown[]} params */
        const values = (params) => /** @type {import('node:sqlite').SQLInputValue[]} */ (params)
        /** @type {BenchAdapter} */
        const raw = {
          exec: async (text) => db.exec(text),
          all: async (text, params = []) => db.prepare(text).all(...values(params)),
          run: async (text, params = []) => ({
            changes: Number(db.prepare(text).run(...values(params)).changes),
          }),
          tx: async (fn) => {
            db.exec('BEGIN')
            try {
              const result = await fn(raw)
              db.exec('COMMIT')
              return result
            } catch (error) {
              db.exec('ROLLBACK')
              throw error
            }
          },
          close: async () => db.close(),
        }
        adapter = raw
      }
    } else {
      assert.ok(process.env.KET_BENCH_PG, 'KET_BENCH_PG must point at a local PostgreSQL server')
      const base = new URL(process.env.KET_BENCH_PG)
      assert.equal(base.hostname, '127.0.0.1', 'Benchmark PostgreSQL must be local')
      name = `ketjs_bench_${process.pid}_${Date.now()}_${framework ? 'ket' : 'raw'}`
      base.pathname = '/postgres'
      admin = postgres(base.href, { max: 1, onnotice: () => {} })
      await admin.unsafe(`CREATE DATABASE "${name}"`)
      base.pathname = `/${name}`
      if (framework) {
        const ket = postgresAdapter(base.href, { max: 1 })
        await ket.open()
        adapter = ket
      } else {
        const client = postgres(base.href, { max: 1, onnotice: () => {} })
        /** @param {unknown[]} params */
        const values = (params) => /** @type {import('postgres').ParameterOrJSON<never>[]} */ (params)
        /**
         * @param {import('postgres').Sql | import('postgres').TransactionSql} sql
         * @returns {BenchAdapter}
         */
        const wrap = (sql) => ({
          exec: async (text) => {
            await sql.unsafe(text)
          },
          all: async (text, params = []) => await sql.unsafe(text, values(params)),
          run: async (text, params = []) => ({
            changes: Number((await sql.unsafe(text, values(params))).count),
          }),
          // postgres types begin() as unwrapping arrays in the result; the fixtures return scalars.
          tx: (fn) => /** @type {Promise<any>} */ (client.begin((tx) => fn(wrap(tx)))),
          close: () => client.end({ timeout: 5 }),
        })
        adapter = wrap(client)
      }
    }
    await adapter.exec(
      'CREATE TABLE products (id INTEGER PRIMARY KEY, tenant INTEGER NOT NULL, value INTEGER NOT NULL, name TEXT NOT NULL, qty INTEGER NOT NULL)',
    )
    await adapter.exec('CREATE INDEX products_tenant_value ON products(tenant, value, id)')
    await adapter.exec('CREATE TABLE balances (id INTEGER PRIMARY KEY, qty INTEGER NOT NULL)')
    await adapter.run('INSERT INTO balances VALUES (1, 1000000), (2, 1000000)')
    await adapter.tx(async (tx) => {
      for (let first = 0; first < ROWS; first += 1000) {
        const values = [],
          parameters = []
        for (let id = first; id < first + 1000; id++) {
          const at = parameters.length
          values.push(
            `(${engine === 'SQLite' ? '?, ?, ?, ?, ?' : Array.from({ length: 5 }, (_, index) => `$${at + index + 1}`).join(', ')})`,
          )
          parameters.push(id, id % 10, id % 1000, `Product ${id}`, id % 20)
        }
        await tx.run(`INSERT INTO products VALUES ${values.join(', ')}`, parameters)
      }
    })
    const version =
      engine === 'SQLite'
        ? (await adapter.all('SELECT sqlite_version() AS version'))[0].version
        : (await adapter.all('SHOW server_version'))[0].server_version
    const settings =
      engine === 'SQLite'
        ? {
            journalMode: (await adapter.all('PRAGMA journal_mode'))[0].journal_mode,
            synchronous: (await adapter.all('PRAGMA synchronous'))[0].synchronous,
          }
        : {
            synchronousCommit: (await adapter.all('SHOW synchronous_commit'))[0].synchronous_commit,
            poolMax: 1,
          }
    const opened = adapter
    const close = async () => {
      try {
        await opened.close()
      } finally {
        try {
          if (admin && name) await admin.unsafe(`DROP DATABASE "${name}"`)
        } finally {
          if (admin) await admin.end({ timeout: 5 })
          rmSync(dir, { recursive: true, force: true })
        }
      }
    }
    return { adapter, engine, version, settings, close }
  } catch (error) {
    await adapter?.close().catch(() => {})
    if (admin) {
      if (name) await admin.unsafe(`DROP DATABASE IF EXISTS "${name}"`).catch(() => {})
      await admin.end({ timeout: 5 })
    }
    rmSync(dir, { recursive: true, force: true })
    throw error
  }
}
export const driverVersion = JSON.parse(
  readFileSync(new URL('../../node_modules/postgres/package.json', import.meta.url), 'utf8'),
).version

if (process.argv[1] === new URL(import.meta.url).pathname) {
  const rotation = Number(process.argv[2] ?? 0) % 2
  for (const engine of ['SQLite', 'PostgreSQL'])
    for (const framework of rotation ? [false, true] : [true, false]) {
      const database = await openDatabase(engine, framework)
      const { adapter } = database
      try {
        const sql = sqlFor(engine)
        let next = ROWS
        /** @type {Operation[]} */
        const operations = [
          {
            id: 'point',
            title: 'Primary-key lookup',
            iterations: 5000,
            warmup: 500,
            run: (i) => adapter.all(sql.point, [i % ROWS]),
            validate: (/** @type {Row[]} */ result, /** @type {number} */ i) =>
              assert.deepEqual(
                { ...result[0] },
                { id: i % ROWS, name: `Product ${i % ROWS}`, qty: (i % ROWS) % 20 },
              ),
          },
          {
            id: 'range',
            title: 'Indexed tenant read: 20 rows',
            iterations: 3000,
            warmup: 300,
            run: () => adapter.all(sql.range, [3, 100]),
            validate: (/** @type {Row[]} */ result) => {
              assert.equal(result.length, 20)
              assert.deepEqual(
                result.map((row) => ({ ...row })),
                Array.from({ length: 20 }, (_, index) => ({
                  id: 103 + index * 1000,
                  name: `Product ${103 + index * 1000}`,
                  qty: 3,
                })),
              )
            },
          },
          {
            id: 'insert',
            title: 'Single committed insert',
            iterations: 1000,
            warmup: 100,
            run: () => adapter.run(sql.insert, [next++, 0, -1, 'Inserted', 1]),
            validate: (/** @type {{ changes: number }} */ result) => assert.equal(result.changes, 1),
          },
          {
            id: 'batch',
            title: 'Transaction: 25 inserts',
            iterations: 100,
            warmup: 10,
            run: () =>
              adapter.tx(async (tx) => {
                for (let i = 0; i < 25; i++) await tx.run(sql.insert, [next++, 0, -1, 'Batch', 1])
                return 25
              }),
            validate: (result) => assert.equal(result, 25),
          },
          {
            id: 'transfer',
            title: 'Transaction: two balance updates',
            iterations: 1000,
            warmup: 100,
            run: () =>
              adapter.tx(async (tx) => {
                await tx.run('UPDATE balances SET qty = qty - 1 WHERE id = 1')
                await tx.run('UPDATE balances SET qty = qty + 1 WHERE id = 2')
                return true
              }),
            validate: (result) => assert.equal(result, true),
          },
        ]
        for (const operation of operations) {
          operation.validate(await operation.run(0), 0)
          for (let i = 0; i < operation.warmup; i++) await operation.run(i)
          const start = performance.now()
          /** @type {unknown} */
          let result
          for (let i = 0; i < operation.iterations; i++) result = await operation.run(i)
          const milliseconds = performance.now() - start
          operation.validate(result, operation.iterations - 1)
          console.log(
            JSON.stringify({
              framework: framework ? 'KetJS adapter' : 'Raw driver baseline',
              version: framework ? frameworkVersion : engine === 'SQLite' ? process.version : driverVersion,
              engine,
              databaseVersion: database.version,
              settings: database.settings,
              operation: operation.id,
              title: operation.title,
              iterations: operation.iterations,
              milliseconds,
              perSecond: (operation.iterations * 1000) / milliseconds,
              millisecondsPerOperation: milliseconds / operation.iterations,
            }),
          )
        }
        assert.equal(Number((await adapter.all('SELECT COUNT(*) AS n FROM products'))[0].n), next)
        assert.equal(Number((await adapter.all('SELECT SUM(qty) AS n FROM balances'))[0].n), 2000000)
        await assert.rejects(
          adapter.tx(async (tx) => {
            await tx.run('UPDATE balances SET qty = qty - 1 WHERE id = 1')
            throw new Error('expected rollback')
          }),
          /expected rollback/,
        )
        assert.equal(Number((await adapter.all('SELECT SUM(qty) AS n FROM balances'))[0].n), 2000000)
      } finally {
        await database.close()
      }
    }
}
