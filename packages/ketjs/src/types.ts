// The vocabulary of the whole framework. Everything else is derived from these.

/**
 * `decimal` and `float` differ in storage, not in arithmetic.
 *
 * Odoo takes this split and it is the right one: a quantity or a price is stored
 * as exact decimal and computed as a binary float, with explicit rounding helpers
 * standing between the two. Storing it as a float instead means every trip through
 * the database can put back the error the rounding just took out — 0.1 written to
 * a double comes back as 0.1000000000000000055.
 */
/**
 * A route, and whether a stranger may reach it.
 *
 * The bare function form is the common case and stays terse. Anything a request
 * with no session may see has to say so — a login form is the obvious one, and
 * everything else defaults to closed, because a default of open is a default
 * nobody notices until it is on the internet.
 */
export type RouteEntry =
  | ((ctx: import('./server/boot.ts').ServeContext) => import('./server/boot.ts').Route)
  | { anonymous?: boolean; handler: (ctx: import('./server/boot.ts').ServeContext) => import('./server/boot.ts').Route }

export type Scalar = 'id' | 'text' | 'int' | 'float' | 'decimal' | 'bool' | 'json' | 'datetime'
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
  /**
   * Callable by a request carrying no session.
   *
   * Default false, and the default is the point. A request that has not logged in
   * is not an unrestricted caller, it is a stranger — treating "no identity" as
   * "no limits" is how logging in became optional. The exceptions are real and
   * few: the function that checks a password (there is no session yet), and
   * whatever a public storefront reads.
   */
  anonymous?: boolean
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
  anonymous: boolean
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
  /**
   * The boundary between what a module permits and what an operator chooses.
   *
   *   'manual' — installed only when someone asks for it by name (the default)
   *   'auto'   — installs itself as soon as everything it depends on is installed
   *   'never'  — cannot be installed on its own at all; it arrives only by being
   *              depended on, which is how machinery stays out of the app list
   *
   * A module says what it permits. Whether 'auto' actually fires is the
   * deployment's call — see RuntimeConfig.autoInstall, which a developer turns off
   * when they want to watch each install happen rather than arrive.
   */
  install?: InstallPolicy
  /**
   * Whether an operator may remove this module once it is installed.
   *
   * `install` draws the boundary on the way in; this one draws it on the way out,
   * and they are genuinely different axes. The case that forces it: the backend is
   * the screen you would use to put something back, so a deployment that let you
   * remove it would let you remove your way out of ever fixing it. Default true —
   * refusing removal is the exception and has to be argued for.
   */
  removable?: boolean
  /** The older spelling of `install: 'auto'`. Normalised away by defineModule. */
  autoInstall?: boolean
}

export type InstallPolicy = 'manual' | 'auto' | 'never'

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
  /**
   * Static files this module ships — stylesheets, icons, fonts. Served under
   * /_ket/asset/<module>/, namespaced so two modules may both ship tokens.css,
   * and only for as long as the module is installed.
   */
  assets?: URL | string
  /**
   * Stylesheets for the head of every page, relative to `assets`, in the order
   * written. Across modules the order is dependency order, so a module that
   * extends another loads after it and can override it.
   *
   * Declared rather than linked by hand: an app that names another module's
   * stylesheet has to know that module's file layout, and goes on linking it long
   * after the module is uninstalled.
   */
  styles?: string[]
  /**
   * Routes this module serves, one factory per path.
   *
   * The path is data so composition can settle ownership — two modules claiming
   * one path is an error at build, not a race at boot. The handler is a factory
   * because it needs the running server, which does not exist yet. Dispatch checks
   * the live manifest, so a route belonging to an uninstalled module is 404 rather
   * than quietly still answering.
   */
  routes?: Record<string, RouteEntry>
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
  readonly assets: string | URL | null
  readonly styles: readonly string[]
  readonly routes: Record<string, RouteEntry>
  readonly islands: Record<string, import('ketjs-view').IslandView>
  readonly sections: Record<string, SectionDef>
  readonly relations: Record<string, Record<string, RelationDef>>
  readonly messages: Record<string, Record<string, import('./kernel/i18n.ts').Message>>
}

export type Manifest = {
  ket: string
  order: string[]
  modules: Record<string, { version: string; kind: string; depends: string[]; install: InstallPolicy; removable: boolean } & AppMeta>
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
  /** Static file directories, per module, behind /_ket/asset/<module>/. */
  assets: Record<string, string>
  /** Stylesheets in dependency order. A disabled module's are dropped by restrictManifest. */
  styles: Array<{ by: string; href: string }>
  /** Path -> the module that owns it and the factory that builds its handler. */
  routes: Record<string, { by: string; anonymous: boolean; make: (ctx: import('./server/boot.ts').ServeContext) => import('./server/boot.ts').Route }>
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
  /** The company a new row is stamped with. Writes are always to exactly one. */
  company: string | null
  /**
   * Companies this request may READ. Absent means just `company` — the safe
   * default, because widening what you can see should take saying so.
   *
   * Reads use the set and writes use `company`, which is Odoo's split between
   * allowed_company_ids and company_id, and the split is right: a report may span
   * three legal entities, but an invoice belongs to exactly one.
   */
  companies?: string[] | null

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
