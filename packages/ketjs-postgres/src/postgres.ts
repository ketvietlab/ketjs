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
  // Unbounded numeric, as the domain contract uses for quantities and money. The driver hands it
  // back as a string, which is exactly what keeps it exact.
  decimal: 'NUMERIC',
  bool: 'BOOLEAN',
  json: 'JSONB',
  date: 'DATE',
  datetime: 'TIMESTAMPTZ',
  ref: 'TEXT',
}

/**
 * Dates come back as text, the way SQLite hands them back.
 *
 * The driver parses every date and timestamp column into a JS Date. That is a
 * reasonable default and the wrong one here, because it makes the same field a
 * different type depending on which datastore is underneath — and development and
 * test run on SQLite while production runs on Postgres. A `date` fared worse
 * still: `2026-08-22` arrived as an instant at UTC midnight, so it stopped being
 * a calendar date and started being a timestamp that formats to the day before
 * anywhere west of Greenwich.
 *
 * Only `parse` is overridden. Without a `serialize` the driver keeps its own, so
 * writing a Date still works exactly as before.
 */
const TEXT_DATES = {
  // 1082 DATE — already the calendar text the column holds.
  ketDate: { from: [1082], parse: (value: string) => value },
  // 1114 TIMESTAMP, 1184 TIMESTAMPTZ — normalised to the ISO-8601 SQLite stores.
  ketTimestamp: { from: [1114, 1184], parse: (value: string) => new Date(value).toISOString() },
}

/**
 * Postgres has real booleans and real json, so unlike SQLite there is almost
 * nothing to coerce.
 *
 * An object is handed to the driver as an object. Stringifying it first looks
 * like the SQLite path — where JSON really is text a column holds — but the
 * driver already encodes a parameter bound to JSONB, so the string was encoded a
 * second time and the column ended up holding a JSON *string* rather than the
 * object: `jsonb_typeof` said `string`, and every `json` field read back as text.
 * SQLite never showed it, because reads there parse the text back; the Postgres
 * read path does not, trusting the driver to have handed back an object.
 */
const bind = (v: unknown): unknown => (v === undefined ? null : v)

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

  const fromHandle = (handle: Sql): { adapter: Adapter; deactivate: () => void } => {
    let active = true
    const needActive = (): Sql => {
      if (!active) throw new Error('transaction-scoped adapter used after its transaction ended')
      return handle
    }
    return {
      adapter: {
        ...a,
        transaction: true,
        async open() {
          throw new Error('a transaction-scoped adapter is already open')
        },
        async close() {
          throw new Error('a transaction-scoped adapter cannot close its root connection')
        },
        notifications: {
          // pg_notify participates in the transaction on this reserved connection;
          // PostgreSQL delivers it only after COMMIT and drops it on ROLLBACK.
          async publish(channel, payload) {
            await needActive().unsafe('SELECT pg_notify($1, $2)', [channel, payload])
          },
        },
        async exec(text) {
          await needActive().unsafe(text)
        },
        async all(text, params = []) {
          return (await needActive().unsafe(text, params.map(bind))) as Row[]
        },
        async run(text, params = []) {
          const r = (await needActive().unsafe(text, params.map(bind))) as unknown[] & { count?: number }
          return { changes: Number(r.count ?? r.length ?? 0) }
        },
        async tx() {
          needActive()
          throw new Error('nested transactions are not supported')
        },
        async introspect() {
          return introspect(needActive())
        },
      },
      deactivate: () => {
        active = false
      },
    }
  }

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
      sql = factory(url, { max: opts.max ?? 10, onnotice: () => {}, types: TEXT_DATES })
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
        const r = await fn(scoped.adapter)
        scoped.deactivate()
        await conn.unsafe('COMMIT')
        return r
      } catch (e) {
        scoped.deactivate()
        await conn.unsafe('ROLLBACK').catch(() => {})
        throw e
      } finally {
        scoped.deactivate()
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
