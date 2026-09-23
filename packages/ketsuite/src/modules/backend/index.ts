// The backend UI.
//
// Deliberately NOT a theme. A storefront theme is a stranger's code, so it is
// written in a restricted language that cannot run (D3, D18). A backend screen is
// ours: it needs forms, filters and real interaction, so it uses trusted view helpers
// with islands like any trusted view. Letting a third party replace a backend
// template is precisely the mechanism that made the domain contract's upgrades painful.
//
// What a third party — or a design team — does own here is the stylesheet and the
// tokens. See design/HANDOFF.md.

import { defineModule } from '@ketvietlab/ketjs'
import { messages } from './messages.ts'
import { routes } from './routes.ts'
import { joints } from './joints.ts'
import { islands } from './islands.ts'
import { menus } from './menus.ts'
import { savedSearchFunctions, savedSearchModels } from './saved-searches.ts'

const designSystemStyles = new URL(import.meta.resolve('@ketvietlab/design-system/styles.css'))

export default defineModule({
  name: 'backend',
  version: '0.2.0',
  title: 'Quản trị',
  summary: 'Khung quản trị và cấu hình hệ thống.',
  category: 'Hệ thống',
  // Its own files, stylesheets, and routes stay together so a deployment only
  // selects this module; it never reaches into the module's file layout.
  assets: new URL('./design/', import.meta.url),
  styles: [
    designSystemStyles,
    'tokens.css',
    'foundation.css',
    'lists.css',
    'responsive.css',
    'auth.css',
    'controls.css',
    'record.css',
    'forms.css',
    'user-workflow.css',
    'content.css',
    'charts.css',
  ],
  routes,
  models: savedSearchModels,
  functions: savedSearchFunctions,
  menus,
  joints,
  islands,
  behaviors: {
    'backend.shell': {
      client: 'client/backend-shell.mjs',
      export: 'backendShell',
      when: '[data-kv-design-system] [data-ui="app-shell"]',
    },
  },
  fills: {
    'backend:relation.select': `{% island "backend.relation-select" %}`,
    'backend:screen.chart': `{% island "backend.chart" %}`,
    'backend:table.grid': `{% island "backend.ket-table" %}`,
    'backend:search.filter': `{% island "backend.search-filter" %}`,
  },
  messages,
})

// The screens this module owns: data assembly, no markup.
export { pagesScreen, pageColumns } from './screens.tsx'
export type { PageRow, Screen } from './screens.tsx'
export { PAGE_SIZE, colsHref, colsOf, pageOf, pager, searchOf, withParam } from './paging.ts'
export { joints } from './joints.ts'
export { menus } from './menus.ts'
export { CASES, cataloguePage } from './catalogue.ts'
export { messages } from './messages.ts'
export { routes } from './routes.ts'
/**
 * The shell every backend screen sits in, and the small helpers a route needs
 * before it can render one. A module composes these instead of writing its own
 * frame: see the note at the top of `screen.ts` for what went wrong when it did.
 */
export {
  adminPage,
  choices,
  frameOf,
  inLocale,
  localeQuery,
  localized,
  optional,
  resultErrors,
  screen,
  selectionLabel,
  selectionOptions,
  timezoneOf,
  viewerOf,
} from './screen.ts'
export type { AnyRow, FrameOptions, Req, ScreenOptions } from './screen.ts'
export { relationControl, relationLabels } from './relation-select.ts'
export type {
  RelationEditorField,
  RelationManager,
  RelationOption,
  RelationSelectConfig,
  RelationSelectLabels,
} from './relation-select.ts'
export { formRefusal, readForm, seeOther } from './forms.ts'
export type { FormRefusal } from './forms.ts'

/**
 * The collection controls, for a module that is not in this package.
 *
 * `joints.ts` already publishes the two islands a modern list is made of —
 * `backend:search.filter` and `backend:table.grid` — so a deployment's own
 * module can mount them. What it could not reach was the half that decides what
 * goes in them: turning a `ListSearchShape` into the bar's configuration,
 * reading the viewer's saved searches, and declaring the functions the bar
 * calls back into. Those are policy, not markup, and a module that cannot
 * import them has to copy them, which is how two lists stop agreeing about what
 * a preset or a saved search means.
 *
 * Nothing here is new work: these are the same entry points product_backend,
 * sale_backend and the rest already use, named on the boundary so a private
 * vertical adopts the collection instead of reproducing it.
 */
export {
  listSearchChrome,
  listSearchFilterConfig,
  loadListFavorites,
  searchFilterBar,
  searchFilterLabels,
} from './search-filter.ts'
export type { ListFavorite, ListSearchFilterOptions } from './search-filter.ts'
export type {
  CustomFilterField,
  SearchFacet,
  SearchFavorite,
  SearchFilterConfig,
  SearchFilterCustomRule,
  SearchFilterLabels,
  SearchFilterManager,
  SearchFilterOption,
  SearchFilterSize,
  SearchGroupByOption,
} from './search-filter.ts'
export {
  emptyListState,
  listSearchFilterFunctions,
  searchFilterHref,
  stateFromPayload,
} from './search-filter-state.ts'
export type { ListSearchBinding, SearchPayload } from './search-filter-state.ts'
export { tableGrid } from './ket-table.ts'
export type {
  KetTableCellFormat,
  KetTableColumn,
  KetTableConfig,
  KetTableGroup,
  KetTableManager,
  KetTableSelection,
} from './ket-table.ts'
/** The same bar over a collection a module already holds in memory. */
export {
  applyRowListState,
  defineRowList,
  ROW_LIST_PAGE_SIZE,
  rowGroupKey,
  rowListGroups,
  rowListSearch,
} from './row-list.ts'
export type { RowListSpec, RowPreset } from './row-list.ts'

/**
 * The kit, re-exported.
 *
 * It is not this module's — it lives in `@ketvietlab/ketsuite/ui` so a module can use a button
 * without depending on the admin. These are here so an existing caller keeps
 * working and so `import backend, { badge } from '@ketvietlab/ketsuite/backend'` still reads
 * naturally on a backend screen.
 */
export {
  backendPage,
  shell,
  formatDateTime,
  formatMoney,
  Framed,
  ListScreen,
  RecordScreen,
  WorkspaceScreen,
  listChrome,
  timeframeFilter,
  topbarSearch,
  emptyState,
  liveRegion,
  errorState,
  dataTable,
  visibleColumns,
  badge,
  avatar,
  thumbnail,
  person,
  initials,
  icon,
  hasIcon,
  definitionList,
  DataMatrix,
  progressBar,
  gantt,
  chart,
  barChart,
  delta,
  changeOf,
  axisCeiling,
  code,
  qrCode,
  inline,
  button,
  linkButton,
  iconButton,
  actionGroup,
  tag,
  countBadge,
  notice,
  loadingState,
  loginScreen,
  stack,
  columns,
  section,
  surface,
  cardGrid,
  contentCard,
  metric,
  docTree,
  kanbanCard,
  kanbanGrid,
  deadline,
  recordList,
  recordWorkspace,
  recordToggle,
  readonlyField,
  readonlyTextarea,
  recordFieldGrid,
  recordRail,
  recordHeaderActions,
  breadcrumbs,
  pageContext,
  tabs,
  mediaPanel,
  attachmentPanel,
  modalForm,
  modalSheet,
  recordForm,
  formCluster,
  recordActions,
  datePicker,
  scheduleBoard,
  HOOKS,
  OWNERS,
  mailContractCases,
  activityContractCases,
  calendarContractCases,
} from '../../ui/index.ts'
export type {
  Cell,
  ChartBar,
  ChartKey,
  Column,
  DataTable,
  DataMatrixColumn,
  DataMatrixProps,
  DataMatrixRow,
  TableGroup,
  Tone,
  Frame,
  Extras,
  Facet,
  ListChrome,
  Pager,
  ViewKind,
  SearchMenu,
  SearchMenuItem,
  TailMenu,
  Indicator,
  Viewer,
  ActionVariant,
  ActionSize,
  ButtonSpec,
  LinkButtonSpec,
  NoticeTone,
  Breadcrumb,
  Tab,
  MediaItem,
  MediaLabels,
  RecordFormOptions,
  MediaPanelProps,
  FormField,
  FormOption,
  DatePickerField,
  DatePickerOptions,
  ScheduleDay,
  ScheduleEvent,
  ScheduleRow,
  ScheduleTone,
  RecordSummaryItem,
  RecordWorkspaceSlots,
  RecordRailFact,
  RecordRailSwitch,
  RecordRailActivity,
} from '../../ui/index.ts'
