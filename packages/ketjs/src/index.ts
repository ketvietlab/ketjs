export { defineModule, defineTheme } from './kernel/define.ts'
export { defineDeployment, defineWorkspace, composeWorkspace, explainWorkspace } from './kernel/workspace.ts'
export { resolveWorkspace } from './kernel/modules.ts'
export type {
  ModuleRef,
  ModulePath,
  DeploymentDeclaration,
  DeploymentSpec,
  NavigationSpec,
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
  ModulePermissionsDef,
  PermissionBundleDef,
  PermissionCatalogue,
  PermissionExemptionDef,
  PermissionExemptionReason,
  PermissionFunctionDef,
  PermissionLabels,
  PermissionPosture,
  PermissionRisk,
  RoleTemplateDef,
  CompiledPermissionBundle,
  CompiledRoleTemplate,
} from './types.ts'
export { compose } from './kernel/compose.ts'
export { compilePermissionBundles, permissionDigest } from './kernel/permissions.ts'
export type { CompilePermissionOptions } from './kernel/permissions.ts'
export {
  validateLayout,
  formatLayoutErrors,
  withPlacementIds,
  placementIdErrors,
  diffPlacements,
  isPlacementId,
} from './kernel/layout.ts'
export { buildMenu, activeMenuRoot } from './kernel/menu.ts'
export type { MenuNode, MenuOptions } from './kernel/menu.ts'
export {
  translator,
  missingMessages,
  formatMissing,
  dateTimeFormatter,
  PSEUDO_LOCALE,
} from './kernel/i18n.ts'
export type { Translator, Message, Catalog, Messages } from './kernel/i18n.ts'
export type { Placement, LayoutError, IdentifiedPlacement, PlacementChange } from './kernel/layout.ts'
export { diffManifests, formatDiff } from './kernel/diff.ts'
export { KetError, Diagnostics } from './kernel/errors.ts'
export { isDateText } from './kernel/types.ts'

export { defineFn, callFn, registerFunctions, _resetIdempotency } from './server/fn.ts'
export { enforcePolicy } from './server/policy.ts'
export type { PolicyDecision, PolicyDenialEvidence } from './server/policy.ts'
export { project } from './server/project.ts'
export { createKetServer, statusForError, wantsHtml } from './server/http.ts'
export { bootDeployment, serveDeployment } from './server/boot.ts'
export type {
  ServeSpec,
  ServeContext,
  ClientCompatibilityPolicy,
  SessionResolveContext,
  RequestIdentity,
  RequestIdentityResolveContext,
  PagesSpec,
  BootedDeployment,
  BootDeploymentOptions,
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
export type { RuntimeConfig, OpenStore, PublicStorageConfig } from './server/config.ts'
export {
  storageFromConfig,
  localStorage,
  s3Storage,
  namespacedStorage,
  effectStorage,
  withPublicStorage,
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
export {
  bufferedLog,
  consoleLog,
  CORE_EVENTS,
  createLogger,
  describeError,
  fileLog,
  isolatedLog,
  leveledLog,
  logFromConfig,
  memoryLog,
  MODULE_EVENT,
  multiLog,
  nullLog,
  prettyLog,
  redactLog,
  traceOf,
} from './server/log/index.ts'
export type {
  ConsoleLogOptions,
  CoreEvent,
  FileLogOptions,
  LogContext,
  LogDriver,
  LogEntry,
  LogError,
  LogFields,
  LogLevel,
  LogProcess,
  LogRecord,
  Logger,
  MemoryLog,
  OpenLog,
} from './server/log/index.ts'
export { classificationInventory, formatClassification } from './kernel/classification.ts'
export { MIN_EVERY_MS, parseEvery, tickAt, ticksBetween, validateSchedule } from './kernel/schedule.ts'
export { claimDue } from './server/schedule.ts'
export { claimRateSlot, pruneRateSlots } from './server/ratelimit.ts'
export type { RatePolicy, RateVerdict } from './server/ratelimit.ts'
export type { ScheduleClaim } from './server/schedule.ts'
export type { ClassificationInventory, ClassifiedField } from './kernel/classification.ts'
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
export {
  migrateOne,
  confirmManualMigration,
  verifyPhysicalSchema,
  migrateFleet,
  formatFleet,
  ManualMigrationConfirmationError,
} from './data/fleet.ts'
export type { MigrationResult, PhysicalSchemaVerification } from './data/fleet.ts'
export { physicalSchemaIssues } from './data/physical.ts'
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
  ManualMigrationRequiredError,
} from './data/migrate.ts'
export type { Schema, MigrationOp } from './data/migrate.ts'

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
export {
  reachOf,
  functionsOf,
  formatReach,
  formatInventory,
  permissionInventory,
} from './agent/permissions.ts'
export type {
  Reach,
  GrantedFn,
  ModelReach,
  PermissionInventory,
  PermissionModuleInventory,
  PermissionFunctionInventory,
} from './agent/permissions.ts'
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
