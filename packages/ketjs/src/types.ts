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
  | {
      anonymous?: boolean
      handler: (ctx: import('./server/boot.ts').ServeContext) => import('./server/boot.ts').Route
    }

export type Scalar = 'id' | 'text' | 'int' | 'float' | 'decimal' | 'bool' | 'json' | 'date' | 'datetime'
export type FieldBase = Scalar | 'ref'

export type ParsedType = { base: FieldBase; optional: boolean; target?: string }
export type TypeParse = ({ ok: true } & ParsedType) | { ok: false; reason: string }

export type Field = ParsedType & { by: string }
export type IndexDef = { fields: string[]; unique?: boolean }
export type ComposedIndex = { fields: string[]; unique: boolean; by: string }
export type ComposedModel = {
  owner: string
  scope: ModelScope
  timestamps: boolean
  fields: Record<string, Field>
  indexes: Record<string, ComposedIndex>
}

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

export type ModelDef = {
  scope: ModelScope
  /** Add optional createdAt/updatedAt fields and maintain them on every write path. */
  timestamps?: boolean
  fields: Record<string, string>
  /** Named database indexes. Names are local to the model and remain stable across migrations. */
  indexes?: Record<string, IndexDef>
}
export type JointDef = { props?: Record<string, string>; multiple?: boolean }

/**
 * One entry in the navigation tree — an app, a section inside it, or a link.
 *
 * Declared by the module that owns the screen, not stored as rows. Odoo keeps
 * `ir.ui.menu` in the database so a customer can rearrange it, and pays for that
 * with a menu that can point at a module nobody installed. Here a menu entry is
 * checked when the deployment is composed: an unknown parent is a build error, and
 * a link to a function nobody ships cannot be saved because there is nothing to
 * save it in.
 *
 * `needs` is what keeps the tree honest. A menu item whose function the viewer may
 * not call does not render — a menu that offers what it cannot deliver is a menu
 * that lies, and the 401 arrives after the click rather than instead of it.
 */
export type MenuDef = {
  /** A message key, resolved against the owning module. Falls back to itself. */
  label: string
  /** The entry above this one. Absent means it is an app: a root of the tree. */
  parent?: string
  /** Where it goes. Absent means it is a heading rather than a link. */
  path?: string
  /** A function key the viewer must be permitted to call for this to appear. */
  needs?: string
  /** Lower sorts first. Ties fall back to the label. */
  sequence?: number
  /**
   * The glyph shown beside this entry, by semantic name. The declaring module
   * owns the choice; the theme owns the drawing and fallback. An unknown name
   * loses its glyph, not its row.
   */
  icon?: string
}

/**
 * A section is a renderable a page composes by data. The settings schema is what
 * makes that data checkable — and it is the same schema an agent is handed.
 */
export type SectionDef = { title?: string; settings?: Record<string, string> }
export type ViewDef = { of: string; fields: string[] }

/** A printable document owned by the business module that owns its data. */
export type ReportDef = {
  /** Message key, resolved against the declaring module. */
  title: string
  /** Model whose record id is accepted by the report source. */
  target: string
  /** Read-only function receiving `{ id }` and returning a JSON view model. */
  source: string
  /** KTL which must render the constrained report markup accepted by `@ketvietlab/ketjs/pdf`. */
  template: string
  filename?: string
  paper?: 'A4' | 'A5'
  orientation?: 'portrait' | 'landscape'
  margins?: { top?: number; right?: number; bottom?: number; left?: number }
}

export type ComposedReport = ReportDef & { by: string; id: string }

/**
 * A CMS content type is a composition-time contract, not a row created by an
 * administrator. Modules register the shape they own; website data stores the
 * values after validating them against this registry. Keeping the registry in the
 * manifest gives themes, agents and backend editors the same closed vocabulary.
 */
export type ContentTypeDef = {
  /** Message key local to the declaring module. */
  label: string
  /** Message key local to the declaring module. */
  pluralLabel: string
  /** Custom fields stored with a revision. Values use the ordinary Ket scalar syntax. */
  fields?: Record<string, string>
  /** Local names or fully-qualified taxonomy names this type accepts. */
  taxonomies?: string[]
  archivePath?: string
  /** A route pattern containing `{slug}` for one persisted or adapted record. */
  detailPath?: string
  /** Optional public functions for content backed by a business module rather than website.Entry. */
  source?: { list: string; get: string }
}

export type TaxonomyDef = {
  /** Message key local to the declaring module. */
  label: string
  /** Message key local to the declaring module. */
  pluralLabel: string
  hierarchical?: boolean
  /** Local names or fully-qualified content type names this taxonomy accepts. */
  contentTypes: string[]
}

export type ComposedContentType = Omit<ContentTypeDef, 'taxonomies'> & {
  by: string
  fields: Record<string, string>
  taxonomies: string[]
}

export type ComposedTaxonomy = Omit<TaxonomyDef, 'contentTypes'> & {
  by: string
  hierarchical: boolean
  contentTypes: string[]
}

/**
 * A relation between two models, declared by a module that depends on both.
 *
 * There is no lazy side. Nothing loads itself when touched, so the N+1 that makes
 * ORMs slow in ways nobody can see is not expressible: a caller either asks for the
 * related rows with preload(), or does not get them.
 */
export type RelationDef = { belongsTo: string; by: string } | { hasMany: string; by: string }

export type ComposedRelation = {
  kind: 'belongsTo' | 'hasMany'
  target: string
  by: string
  declaredBy: string
}

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
  /**
   * Whether the generic `/_ket/fn/*` transport may call this function.
   *
   * `internal` functions remain callable by trusted application/module routes and
   * in-process code, but they are absent from the public HTTP and agent surfaces.
   * Authentication checks and one-time credential issuance belong here: their
   * route owns rate limiting, origin checks and response shaping.
   */
  exposure?: 'http' | 'internal'
  /**
   * Allow the one-shot `ket provision` command to invoke this internal function.
   * Provisioning is opt-in and never makes a function HTTP- or agent-callable.
   */
  provision?: boolean
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
  exposure: 'http' | 'internal'
  provision: boolean
  input: Record<string, string>
  output: Record<string, string>
  effects: string[]
  crossCompany: boolean
  idempotent: boolean
  dryRun: boolean
  agent: boolean
}

/**
 * A durable background operation. Jobs deliberately reuse the function effect
 * vocabulary, including enqueue: moving work out of an HTTP request or chaining
 * it to another job must not become a way around the operation boundary.
 */
export type JobSpec = {
  queue?: string
  input?: Record<string, string>
  effects?: string[]
  crossCompany?: boolean
  /** At-least-once delivery makes acknowledging idempotency mandatory. */
  idempotent: true
  maxAttempts?: number
  timeoutMs?: number
  handler: (ctx: JobContext, args: Record<string, unknown>) => Promise<void>
}

export type JobMeta = {
  by: string
  queue: string
  input: Record<string, string>
  effects: string[]
  crossCompany: boolean
  idempotent: true
  maxAttempts: number
  timeoutMs: number
}

export type JobEnqueueOptions = {
  runAt?: Date
  uniqueKey?: string
  /** Zero is highest priority. */
  priority?: number
}

export type JobEnqueueResult = { id: string; existing: boolean }

export type JobExecution = {
  id: string
  key: string
  queue: string
  attempt: number
  maxAttempts: number
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
  /** Navigation entries this module contributes. Keys are ids other menus parent onto. */
  menus?: Record<string, MenuDef>
  joints?: Record<string, JointDef>
  fills?: Record<string, string>
  /**
   * Joints this module wants gone — "owner:joint" keys, as fills use.
   *
   * Removing rather than hiding, because CSS hides at the wrong layer: the data
   * still travels, and the tab order still walks through what nobody can see. A
   * column a business does not track should not be in the HTML at all.
   *
   * It needs the same depends as a fill. Omitting something you never declared a
   * dependency on is a decision about somebody else's screen made by a module that
   * may not even be installed with it.
   */
  omits?: string[]
  functions?: Record<string, FnSpec>
  jobs?: Record<string, JobSpec>
  views?: Record<string, ViewDef>
  reports?: Record<string, ReportDef>
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
   * Routes this module serves, one factory per path or dynamic segment pattern.
   *
   * A parameter occupies one whole segment (`/products/{slug}`), and its decoded
   * value reaches the handler in the route params. The path is data so composition
   * can settle ownership — two modules claiming one path is an error at build, not
   * a race at boot. The handler is a factory because it needs the running server,
   * which does not exist yet. Dispatch checks the live manifest, so a route belonging
   * to an uninstalled module is 404 rather than quietly still answering.
   */
  routes?: Record<string, RouteEntry>
  /** Interactive views a theme may place but never write. */
  islands?: Record<string, import('@ketvietlab/ketjs-view').IslandDefinition>
  sections?: Record<string, SectionDef>
  contentTypes?: Record<string, ContentTypeDef>
  taxonomies?: Record<string, TaxonomyDef>
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
  readonly menus: Record<string, MenuDef>
  readonly joints: Record<string, JointDef>
  readonly omits: readonly string[]
  readonly fills: Record<string, string>
  readonly functions: Record<string, FnSpec>
  readonly jobs: Record<string, JobSpec>
  readonly views: Record<string, ViewDef>
  readonly reports: Record<string, ReportDef>
  readonly requires: readonly string[]
  readonly tokens: Record<string, string>
  readonly templates: Record<string, string>
  readonly provides: readonly string[]
  readonly assets: string | URL | null
  readonly styles: readonly string[]
  readonly routes: Record<string, RouteEntry>
  readonly islands: Record<string, import('@ketvietlab/ketjs-view').IslandDefinition>
  readonly sections: Record<string, SectionDef>
  readonly contentTypes: Record<string, ContentTypeDef>
  readonly taxonomies: Record<string, TaxonomyDef>
  readonly relations: Record<string, Record<string, RelationDef>>
  readonly messages: Record<string, Record<string, import('./kernel/i18n.ts').Message>>
}

export type Manifest = {
  ket: string
  order: string[]
  modules: Record<
    string,
    { version: string; kind: string; depends: string[]; install: InstallPolicy; removable: boolean } & AppMeta
  >
  models: Record<string, ComposedModel>
  menus: Record<string, MenuDef & { by: string }>
  joints: Record<
    string,
    { owner: string; props: Record<string, string>; multiple: boolean; omittedBy: string[] }
  >
  fills: Array<{ joint: string; by: string; template: string }>
  functions: Record<string, FnMeta>
  jobs: Record<string, JobMeta>
  views: Record<string, ViewDef & { by: string }>
  reports: Record<string, ComposedReport>
  regions: { required: string[]; provided: Record<string, string[]> }
  islands: Record<
    string,
    { by: string; props: Record<string, string>; key?: string[]; client?: { src: string; export: string } }
  >
  sections: Record<string, SectionDef & { by: string }>
  contentTypes: Record<string, ComposedContentType>
  taxonomies: Record<string, ComposedTaxonomy>
  relations: Record<string, Record<string, ComposedRelation>>
  messages?: import('./kernel/i18n.ts').Messages
  tokens: Record<string, string>
  /** Static file directories, per module, behind /_ket/asset/<module>/. */
  assets: Record<string, string>
  /** Stylesheets in dependency order. A disabled module's are dropped by restrictManifest. */
  styles: Array<{ by: string; href: string }>
  /** Path -> the module that owns it and the factory that builds its handler. */
  routes: Record<
    string,
    {
      by: string
      anonymous: boolean
      make: (ctx: import('./server/boot.ts').ServeContext) => import('./server/boot.ts').Route
    }
  >
  patches: Array<{ by: string; target: string; reason: string }>
  /** Set by restrictManifest: modules this deployment ships but this database has off. */
  disabledModules?: string[]
  disabledSections?: string[]
  disabledIslands?: string[]
  diagnostics?: Diagnostic[]
}

export type Diagnostic = {
  code: string
  message: string
  module?: string | null
  hint?: string | null
  at?: string | null
}

export type WriteRecord = { op: 'insert' | 'update'; model: string; row?: Row; where?: Row; patch?: Row }
export type Row = Record<string, unknown>
export type WriteResult = { changes: number }
export type InsertIfAbsentResult = WriteResult & { inserted: boolean }
export type CompareAndSetResult = WriteResult & { matched: boolean }

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

  /** The branch a new company+branch row is stamped with. */
  branch?: string | null

  /** Branches this request may read. Null means every branch of its companies. */
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
  jobs: {
    enqueue(
      name: string,
      args: Record<string, unknown>,
      options?: JobEnqueueOptions,
    ): Promise<JobEnqueueResult>
  }
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
    group(q: import('./data/query.ts').Query): Promise<import('./data/query.ts').GroupRow[]>
    del(q: import('./data/query.ts').Query): Promise<{ changes: number }>
    /** Write a changeset. An invalid one is refused with its structured errors. */
    commit(
      cs: import('./data/changeset.ts').Changeset,
      where?: Row,
    ): Promise<{ changes: number } | { dryRun: true }>
    select(model: string, where?: Row): Promise<Row[]>
    insert(model: string, row: Row): Promise<WriteResult | { dryRun: true }>
    /** Insert atomically, returning inserted=false when any declared unique constraint wins the race. */
    insertIfAbsent(model: string, row: Row): Promise<InsertIfAbsentResult | { dryRun: true }>
    update(model: string, where: Row, patch: Row): Promise<WriteResult | { dryRun: true }>
    /** Update only when both identity (`where`) and the expected old values still match. */
    compareAndSet(
      model: string,
      where: Row,
      expected: Row,
      patch: Row,
    ): Promise<CompareAndSetResult | { dryRun: true }>
  }
}

export type JobContext = Ctx & {
  job: JobExecution
  signal: AbortSignal
  storage: import('./server/storage/types.ts').Storage
  transport: import('./server/transport/types.ts').OutboundTransport
}

// The adapter contract is asynchronous because a network database has no other
// option. SQLite is synchronous underneath and simply resolves immediately; making
// the shared contract match the harder case is cheaper than having two contracts.
// Only quoteIdent and columnSql stay synchronous: they are pure string functions.
export type Adapter = {
  name: string
  /** True when this adapter is already bound to an open transaction. */
  readonly transaction?: boolean
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
  /** Optional because SQLite and third-party adapters may rely on polling. */
  notifications?: DatabaseNotifications
}

export type DatabaseNotifications = {
  /** Publish on this adapter's current connection, and therefore its transaction. */
  publish(channel: string, payload: string): Promise<void>
  /** Root adapters may keep a dedicated listener connection. */
  subscribe?(
    channel: string,
    onMessage: (payload: string) => void,
    onReady: () => void,
  ): Promise<() => Promise<void>>
}
