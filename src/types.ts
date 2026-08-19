// The vocabulary of the whole framework. Everything else is derived from these.

export type Scalar = 'id' | 'text' | 'int' | 'float' | 'bool' | 'json' | 'datetime'
export type FieldBase = Scalar | 'ref'

export type ParsedType = { base: FieldBase; optional: boolean; target?: string }
export type TypeParse = ({ ok: true } & ParsedType) | { ok: false; reason: string }

export type Field = ParsedType & { by: string }
export type ComposedModel = { owner: string; fields: Record<string, Field> }

export type ModelDef = { fields: Record<string, string> }
export type JointDef = { props?: Record<string, string>; multiple?: boolean }
export type ViewDef = { of: string; fields: string[] }

export type FnSpec = {
  input?: Record<string, string>
  output?: Record<string, string>
  effects?: string[]
  idempotent?: boolean
  dryRun?: boolean
  agent?: boolean
  handler: (ctx: Ctx, args: Record<string, unknown>) => unknown
}

export type FnMeta = {
  by: string
  input: Record<string, string>
  output: Record<string, string>
  effects: string[]
  idempotent: boolean
  dryRun: boolean
  agent: boolean
}

export type ModuleSpec = {
  kind?: 'module' | 'theme'
  name: string
  version?: string
  depends?: string[]
  models?: Record<string, ModelDef>
  extend?: Record<string, Record<string, string>>
  joints?: Record<string, JointDef>
  fills?: Record<string, string>
  functions?: Record<string, FnSpec>
  views?: Record<string, ViewDef>
  requires?: string[]
  tokens?: Record<string, string>
  templates?: Record<string, string>
  provides?: string[]
}

export type KetModule = {
  readonly kind: 'module' | 'theme'
  readonly name: string
  readonly version: string
  readonly depends: readonly string[]
  readonly models: Record<string, ModelDef>
  readonly extend: Record<string, Record<string, string>>
  readonly joints: Record<string, JointDef>
  readonly fills: Record<string, string>
  readonly functions: Record<string, FnSpec>
  readonly views: Record<string, ViewDef>
  readonly requires: readonly string[]
  readonly tokens: Record<string, string>
  readonly templates: Record<string, string>
  readonly provides: readonly string[]
}

export type Manifest = {
  ket: string
  order: string[]
  modules: Record<string, { version: string; kind: string; depends: string[] }>
  models: Record<string, ComposedModel>
  joints: Record<string, { owner: string; props: Record<string, string>; multiple: boolean }>
  fills: Array<{ joint: string; by: string; template: string }>
  functions: Record<string, FnMeta>
  views: Record<string, ViewDef & { by: string }>
  regions: { required: string[]; provided: Record<string, string[]> }
  tokens: Record<string, string>
  patches: Array<{ by: string; target: string; reason: string }>
  diagnostics?: Diagnostic[]
}

export type Diagnostic = { code: string; message: string; module?: string | null; hint?: string | null; at?: string | null }

export type WriteRecord = { op: 'insert' | 'update'; model: string; row?: Row; where?: Row; patch?: Row }
export type Row = Record<string, unknown>

export type Ctx = {
  fnKey: string
  actor: string | null
  dryRun: boolean
  effects: string[]
  writes: WriteRecord[]
  /** Column handles for a model, for building queries. */
  table(model: string): import('./data/query.ts').Table
  /** A changeset bound to this app's manifest. */
  change(model: string, params: Row, base?: Row | null): import('./data/changeset.ts').Changeset
  db: {
    all(q: import('./data/query.ts').Query): Promise<Row[]>
    one(q: import('./data/query.ts').Query): Promise<Row | null>
    count(q: import('./data/query.ts').Query): Promise<number>
    del(q: import('./data/query.ts').Query): Promise<{ changes: number }>
    /** Write a changeset. An invalid one is refused with its structured errors. */
    commit(cs: import('./data/changeset.ts').Changeset, where?: Row): Promise<{ changes: number } | { dryRun: true }>
    select(model: string, where?: Row): Promise<Row[]>
    insert(model: string, row: Row): Promise<unknown>
    update(model: string, where: Row, patch: Row): Promise<unknown>
  }
}

// The adapter contract is asynchronous because a network database has no other
// option. SQLite is synchronous underneath and simply resolves immediately; making
// the shared contract match the harder case is cheaper than having two contracts.
// Only quoteIdent and columnSql stay synchronous: they are pure string functions.
export type Adapter = {
  name: string
  open(): Promise<void>
  close(): Promise<void>
  exec(sql: string): Promise<void>
  all(sql: string, params?: unknown[]): Promise<Row[]>
  run(sql: string, params?: unknown[]): Promise<{ changes: number }>
  /**
   * The callback receives an adapter scoped to the transaction. Without it a
   * network driver would run the body on a different pooled connection than the
   * BEGIN — a bug SQLite could never have shown us.
   */
  tx<T>(fn: (tx: Adapter) => Promise<T>): Promise<T>
  quoteIdent(name: string): string
  columnSql(c: { base: FieldBase }): string
  introspect(): Promise<Record<string, Record<string, string>>>
}
