// SQLite adapter on node:sqlite. Zero dependencies - this ships inside Node.
import { DatabaseSync } from 'node:sqlite'
import { assertAdapter } from './adapter.ts'
import type { Adapter, FieldBase, Row } from '../types.ts'
import { dateBucket } from './time.ts'

// Binding rules belong to the adapter, not to the layers above it: SQLite has no
// boolean and no JSON, Postgres has both. Normalising here means every call path —
// query builder, changeset, raw run — is covered once.
const bind = (v: unknown): unknown => {
  if (typeof v === 'boolean') return v ? 1 : 0
  if (v === undefined) return null
  if (v !== null && typeof v === 'object') return JSON.stringify(v)
  return v
}

const SQL: Record<FieldBase, string> = {
  id: 'TEXT PRIMARY KEY',
  text: 'TEXT',
  int: 'INTEGER',
  float: 'REAL',
  decimal: 'TEXT',
  bool: 'INTEGER',
  json: 'TEXT',
  date: 'TEXT',
  datetime: 'TEXT',
  ref: 'TEXT',
}

export function sqliteAdapter(path = ':memory:'): Adapter {
  let db: DatabaseSync | null = null
  let inTransaction = false
  let transactionTail: Promise<void> = Promise.resolve()
  const need = (): DatabaseSync => {
    if (!db) throw new Error('adapter is not open()')
    return db
  }

  const a: Adapter = {
    name: 'sqlite',
    get transaction() {
      return inTransaction
    },
    async open() {
      db = new DatabaseSync(path)
      db.function('ket_date_bucket', (value, interval, timezone) =>
        dateBucket(value, String(interval) as Parameters<typeof dateBucket>[1], String(timezone)),
      )
      db.exec('PRAGMA journal_mode = WAL')
      db.exec('PRAGMA foreign_keys = ON')
    },
    async close() {
      db?.close()
      db = null
    },
    async exec(sql) {
      need().exec(sql)
    },
    async all(sql, params = []) {
      return need()
        .prepare(sql)
        .all(...(params.map(bind) as never[])) as Row[]
    },
    async run(sql, params = []) {
      const r = need()
        .prepare(sql)
        .run(...(params.map(bind) as never[]))
      return { changes: Number(r.changes) }
    },
    async tx(fn) {
      const previous = transactionTail
      let release!: () => void
      transactionTail = new Promise<void>((resolve) => {
        release = resolve
      })
      await previous
      let began = false
      try {
        const d = need()
        d.exec('BEGIN')
        began = true
        inTransaction = true
        const r = await fn(a)
        d.exec('COMMIT')
        return r
      } catch (e) {
        if (began) need().exec('ROLLBACK')
        throw e
      } finally {
        inTransaction = false
        release()
      }
    },
    quoteIdent(n) {
      return `"${String(n).replace(/"/g, '""')}"`
    },
    columnSql(c) {
      return SQL[c.base] ?? 'TEXT'
    },
    async introspect() {
      const tables: Record<string, Record<string, string>> = {}
      const names = need()
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
        .all() as Array<{ name: string }>
      for (const t of names) {
        tables[t.name] = {}
        const cols = need()
          .prepare(`PRAGMA table_info(${a.quoteIdent(t.name)})`)
          .all() as Array<{ name: string; type: string }>
        for (const c of cols) tables[t.name]![c.name] = c.type
      }
      return tables
    },
  }
  return assertAdapter(a)
}
