// The backend UI.
//
// Deliberately NOT a theme. A storefront theme is a stranger's code, so it is
// written in a restricted language that cannot run (D3, D18). A backend screen is
// ours: it needs forms, filters and real interaction, so it is written in `html`
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

export default defineModule({
  name: 'backend',
  version: '0.1.0',
  title: 'Quản trị',
  summary: 'Khung quản trị và cấu hình hệ thống.',
  category: 'Hệ thống',
  // Its own files, stylesheets, and routes stay together so a deployment only
  // selects this module; it never reaches into the module's file layout.
  assets: new URL('./design/', import.meta.url),
  styles: ['tokens.css', 'admin.css'],
  routes,
  models: savedSearchModels,
  functions: savedSearchFunctions,
  menus,
  joints,
  islands,
  fills: { 'backend:relation.select': `{% island "backend.relation-select" %}` },
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
export { readForm, seeOther } from './forms.ts'

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
  formatMoney,
  Framed,
  listChrome,
  topbarSearch,
  emptyState,
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
  section,
  surface,
  cardGrid,
  contentCard,
  metric,
  kanbanCard,
  kanbanGrid,
  recordList,
  recordWorkspace,
  recordToggle,
  breadcrumbs,
  tabs,
  mediaPanel,
  attachmentPanel,
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
  Column,
  DataTable,
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
} from '../../ui/index.ts'
