// The vocabulary of the whole framework. Everything else is derived from these.

export type Scalar = 'id' | 'text' | 'int' | 'float' | 'bool' | 'json' | 'datetime'
export type FieldBase = Scalar | 'ref'

export type ParsedType = { base: FieldBase; optional: boolean; target?: string }
export type TypeParse = ({ ok: true } & ParsedType) | { ok: false; reason: string }

export type Field = ParsedType & { by: string }
export type ComposedModel = { owner: string; scope: ModelScope; fields: Record<string, Field> }

/**
 * Where a model's rows live in the two isolation dimensions.
 *
 *   'shared'          tenant-wide. Master data: products, partners, price lists.
 *   'company'         one legal entity's rows. The filter is mandatory and a module
 *                     cannot widen it — a mistake here leaks between legal entities
 *                     that share a table, which no database boundary would catch.
 *   'company+branch'  additionally carries a branch. Branch is an operational
 *                     dimension, not an isolation boundary: aggregating across the
 *                     branches of one company is ordinary and needs no permission.
 *
 * There is no default. A model that does not say is a build error, because the
 * safe-looking default — 'shared' — is the one that leaks.
 */
export type ModelScope = 'shared' | 'company' | 'company+branch'

export type ModelDef = { scope: ModelScope; fields: Record<string, string> }
export type JointDef = { props?: Record<string, string>; multiple?: boolean }

/**
 * A section is a renderable a page composes by data. The settings schema is what
 * makes that data checkable — and it is the same schema an agent is handed.
 */
export type SectionDef = { title?: string; settings?: Record<string, string> }
export type ViewDef = { of: string; fields: string[] }

/**
 * A relation between two models, declared by a module that depends on both.
 *
 * There is no lazy side. Nothing loads itself when touched, so the N+1 that makes
 * ORMs slow in ways nobody can see is not expressible: a caller either asks for the
 * related rows with preload(), or does not get them.
 */
export type RelationDef =
  | { belongsTo: string; by: string }
  | { hasMany: string; by: string }

export type ComposedRelation = { kind: 'belongsTo' | 'hasMany'; target: string; by: string; declaredBy: string }

export type FnSpec = {
  input?: Record<string, string>
  output?: Record<string, string>
  effects?: string[]
  /**
   * Read across legal entities. Consolidated reporting needs it; almost nothing
   * else does. Declaring it puts the function in the manifest, the upgrade diff and
   * the agent descriptor, so a cross-company read is visible rather than lost among
   * ordinary queries.
   */
  crossCompany?: boolean
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
  crossCompany: boolean
  idempotent: boolean
  dryRun: boolean
  agent: boolean
}

export type AppMeta = {
  /** Shown in the app list. A module without this is machinery, not an app. */
  app?: boolean
  title?: string
  summary?: string
  category?: string
  /** Install itself as soon as everything it depends on is installed. */
  autoInstall?: boolean
}

export type ModuleSpec = AppMeta & {
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
  /** Interactive views a theme may place but never write. */
  islands?: Record<string, import('ketjs-view').IslandView>
  sections?: Record<string, SectionDef>
  relations?: Record<string, Record<string, RelationDef>>
  /** Strings this module owns, per locale. Keys get the module name prefixed. */
  messages?: Record<string, Record<string, import('./kernel/i18n.ts').Message>>
}

export type KetModule = Readonly<AppMeta> & {
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
  readonly islands: Record<string, import('ketjs-view').IslandView>
  readonly sections: Record<string, SectionDef>
  readonly relations: Record<string, Record<string, RelationDef>>
  readonly messages: Record<string, Record<string, import('./kernel/i18n.ts').Message>>
}

export type Manifest = {
  ket: string
  order: string[]
  modules: Record<string, { version: string; kind: string; depends: string[] } & AppMeta>
  models: Record<string, ComposedModel>
  joints: Record<string, { owner: string; props: Record<string, string>; multiple: boolean }>
  fills: Array<{ joint: string; by: string; template: string }>
  functions: Record<string, FnMeta>
  views: Record<string, ViewDef & { by: string }>
  regions: { required: string[]; provided: Record<string, string[]> }
  islands: Record<string, { by: string }>
  sections: Record<string, SectionDef & { by: string }>
  relations: Record<string, Record<string, ComposedRelation>>
  messages?: import('./kernel/i18n.ts').Messages
  tokens: Record<string, string>
  patches: Array<{ by: string; target: string; reason: string }>
  /** Set by restrictManifest: modules this deployment ships but this database has off. */
  disabledModules?: string[]
  disabledSections?: string[]
  disabledIslands?: string[]
  diagnostics?: Diagnostic[]
}

export type Diagnostic = { code: string; message: string; module?: string | null; hint?: string | null; at?: string | null }

export type WriteRecord = { op: 'insert' | 'update'; model: string; row?: Row; where?: Row; patch?: Row }
export type Row = Record<string, unknown>

/** Which company, and which of its branches, this request is acting within. */
export type Scope = {
  company: string | null
  /** Null means every branch of the company — ordinary, not privileged. */
  branches?: string[] | null
}

export type Ctx = {
  fnKey: string
  scope: Scope
  /** The composed manifest, so a module can check data against what is installed. */
  manifest: Manifest
  actor: string | null
  dryRun: boolean
  effects: string[]
  writes: WriteRecord[]
  /** Column handles for a model, for building queries. */
  table(model: string): import('./data/query.ts').Table
  /** A changeset bound to this app's manifest. */
  change(model: string, params: Row, base?: Row | null): import('./data/changeset.ts').Changeset
  /** Run several writes atomically. Stock reservation is unsafe without it. */
  tx<T>(fn: (ctx: Ctx) => Promise<T>): Promise<T>
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
