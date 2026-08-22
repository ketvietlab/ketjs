export { defineModule, defineTheme } from './kernel/define.ts'
export { defineApp, defineWorkspace, composeWorkspace, explainWorkspace } from './kernel/workspace.ts'
export { resolveWorkspace } from './kernel/modules.ts'
export type {
  ModuleRef,
  ModulePath,
  AppDeclaration,
  AppSpec,
  WorkspaceDeclaration,
} from './kernel/workspace.ts'
export type {
  ModuleSource,
  ResolvedModuleInfo,
  ResolvedWorkspace,
  ResolveWorkspaceOptions,
} from './kernel/modules.ts'
export type {
  ContentTypeDef,
  TaxonomyDef,
  ComposedContentType,
  ComposedTaxonomy,
  RouteEntry,
  HttpRouteContract,
  JsonSchema,
  Manifest,
} from './types.ts'
export { compose } from './kernel/compose.ts'
export { validateLayout, formatLayoutErrors } from './kernel/layout.ts'
export { createAppRegistry, restrictManifest } from './kernel/apps.ts'
export { buildMenu, activeApp } from './kernel/menu.ts'
export type { MenuNode, MenuOptions } from './kernel/menu.ts'
export { translator, missingMessages, formatMissing, PSEUDO_LOCALE } from './kernel/i18n.ts'
export type { Translator, Message, Catalog, Messages } from './kernel/i18n.ts'
export type { AppRegistry, AppInfo, AppState } from './kernel/apps.ts'
export type { Placement, LayoutError } from './kernel/layout.ts'
export { diffManifests, formatDiff } from './kernel/diff.ts'
export { KetError, Diagnostics } from './kernel/errors.ts'
export { isDateText } from './kernel/types.ts'

export { defineFn, callFn, registerFunctions, _resetIdempotency } from './server/fn.ts'
export { project } from './server/project.ts'
export { createKetServer } from './server/http.ts'
export { bootApp, serveApp } from './server/boot.ts'
export type {
  ServeSpec,
  ServeContext,
  SessionResolveContext,
  PagesSpec,
  BootedApp,
  BootAppOptions,
  Route,
} from './server/boot.ts'
export { bootRuntime } from './server/runtime.ts'
export type { BootedRuntime } from './server/runtime.ts'
export { bootWorker, serveWorker } from './server/worker.ts'
export type { BootedWorker, WorkerLog } from './server/worker.ts'
export { defineJob, registerJobs } from './server/jobs.ts'
export type { RouteParams } from './kernel/routes.ts'
export {
  page,
  fragment,
  navigablePage,
  isNavigationRequest,
  NAVIGATION_HEADER,
  NAVIGATION_VERSION,
  NAVIGATION_TYPE,
  json,
  text,
  bytes,
  streamed,
  raw,
  document,
  withHeaders,
} from './server/respond.ts'
export type { Html, ResponseBody, RouteResult } from './server/respond.ts'
export { readConfig, sqliteStore } from './server/config.ts'
export type { RuntimeConfig, OpenStore } from './server/config.ts'
export {
  storageFromConfig,
  localStorage,
  s3Storage,
  namespacedStorage,
  effectStorage,
} from './server/storage/index.ts'
export { signRequest, presignUrl, sha256 } from './server/storage/index.ts'
export type { Storage, Stored, OpenStorage, S3StorageOptions, StorageEffect } from './server/storage/index.ts'
export type { SigV4Credentials } from './server/storage/index.ts'
export {
  effectTransport,
  memoryTransport,
  unavailableTransport,
  validateOutboundMessage,
} from './server/transport/index.ts'
export type {
  MemoryTransport,
  OpenTransport,
  OutboundMessage,
  OutboundTransport,
  TransportAddress,
  TransportEffect,
  TransportReceipt,
} from './server/transport/index.ts'
export { multipart } from './server/multipart.ts'
export type { MultipartPart, MultipartOptions } from './server/multipart.ts'
export { createStreams, memoryStreamStore, dbStreamStore } from './server/stream.ts'
export {
  createSessions,
  memorySessionStore,
  dbSessionStore,
  parseCookies,
  SESSION_COOKIE,
} from './server/session.ts'
export type {
  Sessions,
  SessionOptions,
  SessionContext,
  SessionStore,
  SessionRecord,
} from './server/session.ts'
export type { StreamStore, Writer } from './server/stream.ts'
export { createQueue, queueFor, JOB_CHANNEL } from './server/queue.ts'
export type { DurableJob, JobState, Queue, QueueListOptions } from './server/queue.ts'
export { createIdempotency } from './server/idem.ts'
export {
  FormValidationError,
  assertForm,
  invalidForm,
  issuesFromFieldErrors,
} from './server/form.ts'

export {
  compileReportTemplate,
  interFontUrl,
  parseImage,
  parseReportMarkup,
  parseTrueType,
  renderPdf,
  renderReportHtml,
} from './pdf/index.ts'
export type {
  PdfImage,
  PdfRenderOptions,
  ReportDocument,
  ReportElement,
  ReportNode,
  ReportTag,
  TrueTypeFont,
} from './pdf/index.ts'

export { sqliteAdapter } from './data/sqlite.ts'
export { assertAdapter, ADAPTER_METHODS } from './data/adapter.ts'
export { createAdapterPool } from './data/pool.ts'
export type { AdapterPool, PoolOptions } from './data/pool.ts'
export { migrateOne, migrateFleet, formatFleet } from './data/fleet.ts'
export type { MigrationResult } from './data/fleet.ts'
export { from, deleteFrom, table, asc, desc, Query } from './data/query.ts'
export type {
  Dialect,
  Sql,
  Table,
  Order,
  GroupSpec,
  AggregateSpec,
  GroupOrder,
  GroupRow,
} from './data/query.ts'
export {
  dateBucket,
  isTimezone,
  assertTimezone,
  localDateTimeToUtc,
  localDayRange,
  GROUP_INTERVALS,
  isGroupInterval,
  assertGroupInterval,
} from './data/time.ts'
export type { GroupInterval } from './data/time.ts'
export {
  eq,
  ne,
  gt,
  lt,
  gte,
  lte,
  numericCompare,
  like,
  ilike,
  inArray,
  isNull,
  isNotNull,
  bucketEq,
  and,
  or,
  not,
} from './data/expr.ts'
export type { Col, Expr } from './data/expr.ts'
export {
  defineListSearch,
  parseListState,
  encodeListState,
  validateListState,
  compileListFilter,
} from './data/list-search.ts'
export type {
  ListFieldType,
  FilterOperator,
  FilterRule,
  FilterGroup,
  FilterNode,
  SearchFieldSpec,
  FilterFieldSpec,
  GroupFieldSpec,
  SortFieldSpec,
  PresetFilterSpec,
  ListSearchSpec,
  ListGroup,
  ListSort,
  ListState,
  ParsedListState,
  ListSearchLimits,
} from './data/list-search.ts'
export { changeset, Changeset } from './data/changeset.ts'
export type { FieldError, Validator } from './data/changeset.ts'
export {
  schemaFromManifest,
  planMigration,
  renderSql,
  tableNameFor,
  DestructiveMigrationError,
} from './data/migrate.ts'

// Re-exported whole; the view layer is its own package and can be installed alone
// by a client that never touches the server half, but an app that has both should
// not have to know which half a name lives in.
//
// It used to be eight names picked by hand, and the set was not usable on its own:
// `mount` was there while `domHost` — the host every call to it needs — was not, so
// "convenience" meant importing from both packages anyway and guessing which.
export {
  signal,
  computed,
  effect,
  batch,
  html,
  each,
  when,
  isResult,
  isEach,
  createRoot,
  hydrateRoot,
  EVENT_PREFIX,
  mount,
  mountHydrated,
  countingHost,
  domHost,
  escapeHtml,
  renderToString,
  HydrationMismatch,
  HOLE_MARKER,
  HOLE_OPEN,
  trustedMarkup,
  isMarkup,
  renderIsland,
  hydrateIslands,
  createIslandManager,
  IslandError,
  ISLAND_TAG,
  validationIssue,
  fieldErrorsOf,
  formErrorsOf,
  validationProblem,
  valuesFromFormData,
  defineFormSchema,
  validateForm,
  createForm,
} from '@ketvietlab/ketjs-view'
export type {
  Signal,
  Computed,
  TemplateResult,
  EachResult,
  Renderable,
  Root,
  Mounted,
  Host,
  HostNode,
  Markup,
  IslandView,
  IslandController,
  IslandFactory,
  IslandDefinition,
  IslandRegistry,
  IslandProps,
  HydratedIsland,
  IslandElement,
  IslandManager,
  FormValues,
  FormFieldType,
  ValidationIssue,
  ValidationIssueInput,
  ValidationVerdict,
  FormFieldRule,
  FormSchema,
  FormValidationResult,
  FormValidationProblem,
  ReadonlySignal,
  FormController,
  JSXChild,
  JSXComponent,
  IntrinsicProps,
} from '@ketvietlab/ketjs-view'
export { createTheme } from './theme/render.ts'
export { reachOf, functionsOf, formatReach, formatInventory } from './agent/permissions.ts'
export type { Reach, GrantedFn, ModelReach } from './agent/permissions.ts'
export { compileKtl } from './theme/ktl/compile.ts'
export { loadTemplates } from './theme/templates.ts'
export { createJoints } from './theme/joints.ts'
export type { Joints } from './theme/joints.ts'
export { makeDrop, makeDrops, sealScope } from './theme/viewmodel.ts'
export type { Drop } from './theme/viewmodel.ts'
export { tokensToCss, scopedCss, LAYER_ORDER } from './theme/tokens.ts'

export { agentTools, agentDescriptor, compositionSchema } from './agent/capabilities.ts'
export { generateDts } from './codegen/dts.ts'

export type * from './types.ts'
