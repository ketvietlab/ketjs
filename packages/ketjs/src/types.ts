// The vocabulary of the whole framework. Everything else is derived from these.

/**
 * `decimal` and `float` differ in storage, not in arithmetic.
 *
 * the domain contract takes this split and it is the right one: a quantity or a price is stored
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
      /**
       * A published route-prefix owner this route contributes through.
       *
       * Reserved prefixes are closed to ordinary routes. An extension must name
       * the owner explicitly, depend on it, and use the owner's route factory.
       */
      through?: string
      /** Machine-readable HTTP contract used by facades such as channel_api. */
      contract?: HttpRouteContract
      handler: (ctx: import('./server/boot.ts').ServeContext) => import('./server/boot.ts').Route
    }

export type JsonSchema = Record<string, unknown>

export type HttpRouteContract = {
  profile: string
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  operationId: string
  summary?: string
  /** Application-defined authentication policy interpreted by the contract facade. */
  auth?: string
  /** Additional credential schemes documented for a route whose handler resolves another trust boundary. */
  credentials?: string[]
  capability?: { key: string; action: string }
  request?: {
    params?: JsonSchema
    query?: JsonSchema
    headers?: JsonSchema
    body?: JsonSchema
  }
  responses: Record<string, JsonSchema>
  idempotent?: boolean
}

export type Scalar = 'id' | 'text' | 'int' | 'float' | 'decimal' | 'bool' | 'json' | 'date' | 'datetime'
export type FieldBase = Scalar | 'ref'

export type ParsedType = { base: FieldBase; optional: boolean; target?: string }
export type TypeParse = ({ ok: true } & ParsedType) | { ok: false; reason: string }

/**
 * What a module may say about a field beyond its type.
 *
 * A field was a type string and nothing else, which left nowhere to record the two
 * questions every deployment holding customer data eventually has to answer: which
 * columns are personal data, and which must never leave the system at all. Both are
 * properties of the data, not of its storage — the schema snapshot deliberately
 * ignores them, so classifying a field is never a migration.
 *
 * The vocabulary is closed and an unknown key is a build error. Adding a key later
 * is additive and safe; accepting anything today and narrowing later is not, which
 * is the same argument D1 makes about joints.
 */
export type FieldDef = {
  type: string
  /**
   * This column holds personal data about an identifiable person.
   *
   * Recorded so it can be enumerated: an obligation to export or erase somebody's
   * data cannot be met against a schema nobody has classified. `ket classification`
   * prints the inventory.
   */
  personal?: boolean
  /**
   * This value must never leave the system.
   *
   * Enforced, not advisory: the value is masked in the write records that reach the
   * idempotency store and a dry-run preview, and the field is withheld from the
   * agent capability descriptor. Secrets, tokens, card data.
   */
  sensitive?: boolean
}

export type FieldClassification = { personal?: boolean; sensitive?: boolean }

export type Field = ParsedType & { by: string } & FieldClassification
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
  /**
   * A type string, or an object when the field has something to declare beyond it.
   * `'text'` and `{ type: 'text' }` compose identically.
   */
  fields: Record<string, string | FieldDef>
  /** Named database indexes. Names are local to the model and remain stable across migrations. */
  indexes?: Record<string, IndexDef>
}
export type JointDef = { props?: Record<string, string>; multiple?: boolean }

/**
 * One entry in the navigation tree — a root section, a nested section, or a link.
 *
 * Declared by the module that owns the screen, not stored as rows. the domain contract keeps
 * `ir.ui.menu` in the database so a customer can rearrange it, and pays for that
 * with a menu that can point at a module outside the deployment. Here a menu entry is
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
  /** The entry above this one. Absent means it is a root of the tree. */
  parent?: string
  /** Where it goes. Absent means it is a heading rather than a link. */
  path?: string
  /** A function key the viewer must be permitted to call for this to appear. */
  needs?: string
  /**
   * Function keys that mean "this surface is your work", as opposed to `needs`,
   * which only means "opening it will not 401".
   *
   * The distinction matters because a read capability is often granted so some
   * other screen can resolve a dropdown, and the menu then reads that grant as an
   * invitation. Declaring the writes a person would perform here says who the
   * surface is for. Anyone permitted but not intended keeps the entry — it moves
   * out of the main list and stays reachable by search and by link.
   *
   * Absent means the entry is primary for everyone `needs` admits, which is what
   * every entry did before this existed.
   */
  for?: readonly string[]
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
/**
 * When a job runs on its own, with nobody asking.
 *
 * Two forms, because they answer different questions and the second one costs a
 * timezone. `every` is an interval and has no wall clock in it at all. `dailyAt`
 * is a wall-clock time somewhere, which is the only way to say "after the shop
 * closes" and the reason a timezone has to be named.
 */
export type JobSchedule = { every: string } | { dailyAt: string; timezone?: string }

export type JobSpec = {
  queue?: string
  /**
   * Run this job on a schedule as well as on demand.
   *
   * Once per tenant database, with no company: the framework knows which tenants
   * exist and does not know what a company is. A job that has per-company work to
   * do declares `crossCompany` to see them and enqueues per company from there.
   *
   * A tick missed while nothing was running is skipped, not replayed. Three days
   * of downtime produce one run, not three, and the record says how many ticks
   * were passed over — a job that needs to know what it missed can read its own
   * ledger, which is more truthful than three identical runs.
   */
  schedule?: JobSchedule
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
  schedule?: JobSchedule
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
  /**
   * Enqueue into one company other than the caller's.
   *
   * Only an operation that declares `crossCompany` may do this, because only that
   * operation was allowed to see more than one company in the first place. It
   * exists for the fan-out a scheduled job has to perform: the schedule itself runs
   * once per tenant with no company, and the work is per legal entity.
   */
  company?: string
}

export type JobEnqueueResult = { id: string; existing: boolean }

export type JobExecution = {
  id: string
  key: string
  queue: string
  attempt: number
  maxAttempts: number
}

export type ModuleMeta = {
  /** Human-readable module metadata for manifests, diagnostics, and tooling. */
  title?: string
  summary?: string
  category?: string
}

export type PermissionRisk = 'read' | 'operate' | 'approve' | 'configure' | 'sensitive' | 'security'

export type PermissionPosture =
  | 'permission-bearing'
  | 'projection/bridge'
  | 'session/device'
  | 'internal/headless'

export type PermissionLabels = { en: string; vi: string }

export type PermissionBundleDef = {
  labels: PermissionLabels
  summary?: PermissionLabels
  includes?: string[]
}

export type PermissionFunctionDef = {
  risk: PermissionRisk
  bundles: string[]
  owner: string
  policy?: string
}

export type PermissionExemptionReason =
  | 'anonymous'
  | 'bootstrap-only'
  | 'internal-route'
  | 'worker'
  | 'service-boundary'
  | 'projection-only'
  | 'non-grantable'

export type PermissionExemptionDef = {
  reason: PermissionExemptionReason
  authority: string
}

export type ModulePermissionsDef = {
  posture: PermissionPosture
  owner: string
  bundles: Record<string, PermissionBundleDef>
  functions: Record<string, PermissionFunctionDef>
  exemptions: Record<string, PermissionExemptionDef>
}

export type RoleTemplateDef = {
  version: number
  labels: PermissionLabels
  summary?: PermissionLabels
  bundles: string[]
}

export type CompiledPermissionBundle = PermissionBundleDef & {
  key: string
  owner: string
  includes: string[]
  directFunctions: string[]
  functions: string[]
}

export type CompiledRoleTemplate = RoleTemplateDef & {
  key: string
  bundles: string[]
  functions: string[]
  functionPaths: Record<string, string[][]>
  digest: string
}

export type PermissionCatalogue = {
  version: 1
  digest: string
  coverageRequired: boolean
  modules: Record<string, { posture: PermissionPosture; owner: string }>
  bundles: Record<string, CompiledPermissionBundle>
  functions: Record<string, PermissionFunctionDef>
  exemptions: Record<string, PermissionExemptionDef & { owner: string }>
  roleTemplates: Record<string, CompiledRoleTemplate>
}

export type ModuleSpec = ModuleMeta & {
  kind?: 'module' | 'theme'
  name: string
  version?: string
  depends?: string[]
  /** Version ranges required at compose time for published extension contracts. */
  compatible?: Record<string, string>
  models?: Record<string, ModelDef>
  extend?: Record<string, Record<string, string | FieldDef>>
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
  /** Exact permission classification owned by this module. */
  permissions?: ModulePermissionsDef
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
   * and only when the module belongs to the deployment composition.
   */
  assets?: URL | string
  /**
   * Stylesheets for the head of every page, relative to `assets`, in the order
   * written. Across modules the order is dependency order, so a module that
   * extends another loads after it and can override it.
   *
   * Declared rather than linked by hand: a deployment that names another module's
   * stylesheet has to know that module's file layout, and goes on linking it long
   * after the module leaves the composition.
   */
  styles?: string[]
  /**
   * Routes this module serves, one factory per path or dynamic segment pattern.
   *
   * A parameter occupies one whole segment (`/products/{slug}`), and its decoded
   * value reaches the handler in the route params. The path is data so composition
   * can settle ownership — two modules claiming one path is an error at build, not
   * a race at boot. The handler is a factory because it needs the running server,
   * which does not exist yet. Dispatch uses the composed manifest, so undeclared
   * module routes never mount.
   */
  routes?: Record<string, RouteEntry>
  /** Absolute path prefixes this module owns and exposes only via published contributors. */
  reserves?: string[]
  /** Interactive views a theme may place but never write. */
  islands?: Record<string, import('@ketvietlab/ketjs-view').IslandDefinition>
  sections?: Record<string, SectionDef>
  contentTypes?: Record<string, ContentTypeDef>
  taxonomies?: Record<string, TaxonomyDef>
  relations?: Record<string, Record<string, RelationDef>>
  /** Strings this module owns, per locale. Keys get the module name prefixed. */
  messages?: Record<string, Record<string, import('./kernel/i18n.ts').Message>>
}

export type KetModule = Readonly<ModuleMeta> & {
  readonly kind: 'module' | 'theme'
  readonly name: string
  readonly version: string
  readonly depends: readonly string[]
  readonly compatible: Readonly<Record<string, string>>
  readonly models: Record<string, ModelDef>
  readonly extend: Record<string, Record<string, string | FieldDef>>
  readonly menus: Record<string, MenuDef>
  readonly joints: Record<string, JointDef>
  readonly omits: readonly string[]
  readonly fills: Record<string, string>
  readonly functions: Record<string, FnSpec>
  readonly permissions: ModulePermissionsDef | null
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
  readonly reserves: readonly string[]
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
  modules: Record<string, { version: string; kind: string; depends: string[] } & ModuleMeta>
  models: Record<string, ComposedModel>
  menus: Record<string, MenuDef & { by: string }>
  joints: Record<
    string,
    { owner: string; props: Record<string, string>; multiple: boolean; omittedBy: string[] }
  >
  fills: Array<{ joint: string; by: string; template: string }>
  functions: Record<string, FnMeta>
  permissions: PermissionCatalogue
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
  /** Stylesheets in dependency order. */
  styles: Array<{ by: string; href: string }>
  /** Path -> the module that owns it and the factory that builds its handler. */
  routes: Record<
    string,
    {
      by: string
      anonymous: boolean
      through?: string
      contract?: HttpRouteContract
      make: (ctx: import('./server/boot.ts').ServeContext) => import('./server/boot.ts').Route
    }
  >
  /** Prefix -> owning module. Longest prefix wins, though overlapping claims are rejected. */
  routePrefixes: Record<string, string>
  patches: Array<{ by: string; target: string; reason: string }>
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
   * Reads use the set and writes use `company`, which is the domain contract's split between
   * readable company set and company_id, and the split is right: a report may span
   * three legal entities, but an invoice belongs to exactly one.
   */
  companies?: string[] | null

  /** The branch a new company+branch row is stamped with. */
  branch?: string | null

  /** Branches this request may read. Null means every branch; an empty array means none. */
  branches?: string[] | null
}

export type Ctx = {
  fnKey: string
  /** Ephemeral request/command correlation. Domains must hash it before persistence. */
  correlationId: string | null
  /**
   * Operational logging for this call, already carrying tenant, function, hashed
   * correlation, hashed actor and company.
   *
   * This is not an audit trail. A record written here leaves the process
   * immediately, is never readable by the application, and — unlike an audit row —
   * survives a transaction that rolls back, because the attempt was real.
   */
  log: import('./server/log/logger.ts').Logger
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
  /**
   * Take the next number in a named sequence, counted per company by default.
   *
   * Returns a number: turning it into "S00001" is the domain's decision, and a
   * framework that chose the format would be choosing an invoice format for a tax
   * authority it has never heard of.
   *
   * A dry run reads the sequence without consuming a number, so a preview cannot
   * make the real command that follows skip one.
   */
  sequence(name: string, options?: import('./server/sequence.ts').SequenceOptions): Promise<number>
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
