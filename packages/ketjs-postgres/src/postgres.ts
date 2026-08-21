// The one file permitted to import an external package (decision D4a).
//
// The driver is an optionalDependency, so it is imported dynamically: an app that
// only ever uses SQLite never loads it and never needs it installed.

import { assertAdapter } from '@ketvietlab/ketjs'
import type { Adapter, FieldBase, Row } from '@ketvietlab/ketjs'

const SQL: Record<FieldBase, string> = {
  id: 'TEXT PRIMARY KEY',
  text: 'TEXT',
  int: 'BIGINT',
  float: 'DOUBLE PRECISION',
  // Unbounded numeric, as Odoo uses for quantities and money. The driver hands it
  // back as a string, which is exactly what keeps it exact.
  decimal: 'NUMERIC',
  bool: 'BOOLEAN',
  json: 'JSONB',
  date: 'DATE',
  datetime: 'TIMESTAMPTZ',
  ref: 'TEXT',
}

// Postgres has real booleans and real json, so unlike SQLite there is almost
// nothing to coerce. Objects still go over as JSON text for JSONB to parse.
const bind = (v: unknown): unknown => {
  if (v === undefined) return null
  if (v !== null && typeof v === 'object' && !(v instanceof Date)) return JSON.stringify(v)
  return v
}

type Sql = {
  unsafe(text: string, params?: unknown[]): Promise<unknown[]> & { count?: number }
  reserve(): Promise<Sql & { release(): void }>
  end(opts?: { timeout?: number }): Promise<void>
  listen?(
    channel: string,
    onMessage: (payload: string) => void,
    onReady?: () => void,
  ): Promise<{ unlisten(): Promise<void> }>
}

export type PostgresOptions = {
  url?: string
  max?: number
  /** Injected in tests; production resolves the real driver. */
  connect?: (url: string, opts: Record<string, unknown>) => Sql
}

export function postgresAdapter(url = process.env.DATABASE_URL ?? '', opts: PostgresOptions = {}): Adapter {
  let sql: Sql | null = null
  const need = (): Sql => {
    if (!sql) throw new Error('adapter is not open()')
    return sql
  }

  const introspect = async (handle: Sql): Promise<Record<string, Record<string, string>>> => {
    const rows = (await handle.unsafe(
      `SELECT table_name, column_name, data_type FROM information_schema.columns
       WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`,
    )) as Array<{ table_name: string; column_name: string; data_type: string }>
    const tables: Record<string, Record<string, string>> = {}
    for (const r of rows) (tables[r.table_name] ??= {})[r.column_name] = r.data_type
    return tables
  }

  const fromHandle = (handle: Sql): Adapter => ({
    ...a,
    transaction: true,
    notifications: {
      // pg_notify participates in the transaction on this reserved connection;
      // PostgreSQL delivers it only after COMMIT and drops it on ROLLBACK.
      async publish(channel, payload) {
        await handle.unsafe('SELECT pg_notify($1, $2)', [channel, payload])
      },
    },
    async exec(text) {
      await handle.unsafe(text)
    },
    async all(text, params = []) {
      return (await handle.unsafe(text, params.map(bind))) as Row[]
    },
    async run(text, params = []) {
      const r = (await handle.unsafe(text, params.map(bind))) as unknown[] & { count?: number }
      return { changes: Number(r.count ?? r.length ?? 0) }
    },
    async tx() {
      throw new Error('nested transactions are not supported')
    },
    async introspect() {
      return introspect(handle)
    },
  })

  const a: Adapter = {
    name: 'postgres',

    async open() {
      if (!url) throw new Error('postgresAdapter needs a connection URL (or DATABASE_URL)')
      const connect =
        opts.connect ??
        ((u, o) => {
          // Dynamic so the optional dependency is only required when actually used.
          throw new Error(
            `postgres driver not loaded; pass opts.connect or install "postgres" (${u}, ${JSON.stringify(o)})`,
          )
        })
      if (opts.connect) {
        sql = connect(url, { max: opts.max ?? 10 })
        return
      }
      const mod = await import('postgres')
      const factory = (mod.default ?? mod) as unknown as (u: string, o: Record<string, unknown>) => Sql
      sql = factory(url, { max: opts.max ?? 10, onnotice: () => {} })
    },

    async close() {
      await sql?.end({ timeout: 5 })
      sql = null
    },
    async exec(text) {
      await need().unsafe(text)
    },
    async all(text, params = []) {
      return (await need().unsafe(text, params.map(bind))) as Row[]
    },
    async run(text, params = []) {
      const r = (await need().unsafe(text, params.map(bind))) as unknown[] & { count?: number }
      return { changes: Number(r.count ?? r.length ?? 0) }
    },
    notifications: {
      async publish(channel, payload) {
        await need().unsafe('SELECT pg_notify($1, $2)', [channel, payload])
      },
      async subscribe(channel, onMessage, onReady) {
        const listen = need().listen
        if (!listen) throw new Error('this injected postgres handle does not support LISTEN')
        // postgres.js owns a dedicated listener connection and reconnects it. Its
        // onReady callback also runs after a reconnect, so the worker drains any
        // notifications missed during the gap.
        const request = await listen.call(need(), channel, onMessage, onReady)
        return () => request.unlisten()
      },
    },

    // A reserved connection, so BEGIN and the body are guaranteed to be the same
    // session rather than two arbitrary members of the pool.
    async tx(fn) {
      const conn = await need().reserve()
      const scoped = fromHandle(conn)
      try {
        await conn.unsafe('BEGIN')
        const r = await fn(scoped)
        await conn.unsafe('COMMIT')
        return r
      } catch (e) {
        await conn.unsafe('ROLLBACK').catch(() => {})
        throw e
      } finally {
        conn.release()
      }
    },

    quoteIdent(n) {
      return `"${String(n).replace(/"/g, '""')}"`
    },
    columnSql(c) {
      return SQL[c.base] ?? 'TEXT'
    },

    async introspect() {
      return introspect(need())
    },
  }

  return assertAdapter(a)
}
