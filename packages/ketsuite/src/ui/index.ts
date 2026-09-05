// The KetSuite component kit.
//
// A module composes these and never writes a tag or a `data-ui` attribute itself —
// `tools/ui-audit.ts` enforces exactly that. The point is not that markup is ugly
// in TypeScript; it is that markup spread across forty screens has no single place
// to change, and the stylesheet's contract drifts one screen at a time.
//
// Every component is a plain `(props) => TemplateResult`. No runtime, no lifecycle,
// no client state: the backend renders on the server and keeps what it knows in the
// URL (D43). Interactivity, where a screen genuinely needs it, is an island.
//
// The public foundation lives in @ketvietlab/design-system. The backend module
// loads its CSS first, then this compatibility kit while screens migrate to the
// public components. New shared UI must enter through that public contract.

export * as designSystem from '@ketvietlab/design-system'
export {
  Disclosure,
  LinkButton,
  Tabs as CollectionTabs,
} from '@ketvietlab/design-system'
export type {
  FormPageSlots,
  LinkButtonProps,
  TabItem as CollectionTabItem,
} from '@ketvietlab/design-system'
export { FormPage } from './form-page.tsx'
export type { FormPageProps } from './form-page.tsx'
export { RecordPage } from './record-page.tsx'
export type { RecordPageProps } from './record-page.tsx'
export { WorkspacePage } from './workspace-page.tsx'
export type { WorkspacePageProps } from './workspace-page.tsx'
export { DashboardPage } from './dashboard-page.tsx'
export type { DashboardPageProps } from './dashboard-page.tsx'
export { BoardPage } from './board-page.tsx'
export type { BoardPageProps } from './board-page.tsx'
export { ListPage } from './list-page.tsx'
export type { ListPageProps } from './list-page.tsx'

/**
 * Public components a screen uses directly, with no compatibility copy here.
 *
 * The rule in the header is that new shared UI enters through the public
 * contract; a mirror of it in this file would be a second place for the markup
 * to drift. `Pipeline` owns its own hooks, stylesheet and catalogue specimen in
 * `@ketvietlab/design-system`, and the backend already loads that stylesheet and
 * marks its root with `data-kv-design-system`.
 */
export { Pipeline } from '@ketvietlab/design-system'
export type { PipelineStep } from '@ketvietlab/design-system'

export { icon, hasIcon } from './icons.ts'
export { formatDateTime, formatMoney } from './format.ts'
export { button, linkButton, iconButton, actionGroup } from './actions.tsx'
export type { ActionVariant, ActionSize, ButtonSpec, LinkButtonSpec } from './actions.tsx'
export {
  inline,
  badge,
  deadline,
  tag,
  countBadge,
  avatar,
  thumbnail,
  person,
  initials,
  code,
  qrCode,
} from './primitives.tsx'
export type { Tone } from './primitives.tsx'
export { notice, emptyState, errorState, loadingState } from './state.tsx'
export type { NoticeTone } from './state.tsx'
export {
  stack,
  columns,
  section,
  surface,
  cardGrid,
  contentCard,
  metric,
} from './surfaces.tsx'
export { dataTable, visibleColumns } from './table.tsx'
export type { Cell, Column, DataTable, TableGroup, TableSelection } from './table.tsx'
export { scheduleBoard } from './schedule.tsx'
export type { ScheduleDay, ScheduleEvent, ScheduleRow, ScheduleTone } from './schedule.tsx'
export { docTree, kanbanCard, kanbanGrid, progressBar, recordList } from './data.tsx'
export { gantt, ganttSpan } from './gantt.tsx'
export type { GanttItem, GanttLabels } from './gantt.tsx'
export { axisCeiling, barChart, changeOf, chart, CHART_SERIES, delta } from './charts.tsx'
export type { ChartBar, ChartKey } from './charts.tsx'
export { mediaPanel } from './media.tsx'
export type { MediaItem, MediaLabels, MediaPanelProps } from './media.tsx'
export { attachmentPanel } from './attachments.tsx'
export type { AttachmentItem } from './attachments.tsx'
export { productVariantManagement } from './product-variants.tsx'
export type {
  ProductAttributeLineView,
  ProductVariantManagementOptions,
  ProductVariantRowView,
} from './product-variants.tsx'
export { productMediaManagement } from './product-media.tsx'
export type {
  ProductMediaManagementOptions,
  ProductMediaVariantView,
} from './product-media.tsx'
export { recordForm, recordActions, formCluster } from './form.tsx'
export { authTokenScreen, loginScreen } from './auth.tsx'
export type { FormField, FormOption, RecordFormOptions } from './form.tsx'
export { datePicker } from './date-picker.tsx'
export type { DatePickerField, DatePickerOptions } from './date-picker.tsx'
export { breadcrumbs, pageContext, tabs } from './navigation.tsx'
export type { Breadcrumb, Tab } from './navigation.tsx'
export { recordWorkspace, recordToggle } from './record.tsx'
export {
  readonlyField,
  readonlyTextarea,
  recordFieldGrid,
  recordRail,
  recordHeaderActions,
  recordMore,
} from './record-detail.tsx'
export type { RecordRailFact, RecordRailSwitch, RecordRailActivity } from './record-detail.tsx'
export { modalForm, modalSheet, modalWorkspace } from './modal.tsx'
export type {
  RecordBreadcrumbs,
  RecordSummaryItem,
  RecordWorkspaceOptions,
  RecordWorkspaceSlots,
} from './record.tsx'
export { sidebar, sidebarMain, sidebarFoot, navGroup } from './nav.tsx'
export type { Indicator, SidebarOptions, Viewer } from './nav.tsx'
export { bulkActions, listChrome, topbarSearch } from './chrome.tsx'
export { timeframeFilter } from './timeframe.tsx'
export { timeframeFilter as TimeframeFilter } from './timeframe.tsx'
export type { TimeframeFilterOptions, TimeframeOption } from './timeframe.tsx'
export type {
  Facet,
  ListChrome,
  Pager,
  ViewKind,
  SearchMenu,
  SearchMenuItem,
  TailMenu,
} from './chrome.tsx'
export {
  backendPage,
  shell,
  framedPage,
  listScreen,
  recordScreen,
  workspaceScreen,
  definitionList,
} from './layout.tsx'
export type { OperationalScreenOptions } from './layout.tsx'
export type { Extras, Frame } from './layout.tsx'
export { HOOKS, OWNERS } from './hooks.ts'
export { mailContractCases } from './mail.ts'
export { activityContractCases } from './activity.ts'
export { calendarContractCases } from './calendar.ts'
export {
  PartnerFacts,
  PartnerInitials,
  PartnerPanel,
} from './partner.tsx'
export type { PartnerFact } from './partner.tsx'

/**
 * The same components, under the names JSX wants.
 *
 * `tools/ui-audit.ts` requires a screen to write `<Section />` rather than
 * `section(...)`, because a screen that calls the function can quietly grow an
 * argument the JSX form cannot express. But the kit only exported camelCase, so
 * every screen opened with the same five lines of aliasing — `framedPage as
 * Framed` in fifty-five files, `recordForm as RecordForm` in forty-nine — and the
 * rule cost more to obey than it was worth.
 *
 * These are the same functions, not wrappers: a component here takes one options
 * object, which is exactly what JSX hands it. That is also the entry rule — a
 * positional helper (`stack(items, gap)`, `emptyState(message, hint)`,
 * `dataTable(_, table)`) has no PascalCase name, because JSX would hand it a props
 * object where it wants a list. `backend-ui.test.ts` checks the arity.
 */
export { framedPage as Framed } from './layout.tsx'
export {
  listScreen as ListScreen,
  recordScreen as RecordScreen,
  workspaceScreen as WorkspaceScreen,
} from './layout.tsx'
export { section as Section, surface as Surface, contentCard as ContentCard } from './surfaces.tsx'
export { cardGrid as CardGrid, metric as Metric } from './surfaces.tsx'
export { recordForm as RecordForm, formCluster as FormCluster } from './form.tsx'
export { recordActions as RecordActions } from './form.tsx'
export { recordWorkspace as RecordWorkspace, recordToggle as RecordToggle } from './record.tsx'
export {
  readonlyField as ReadonlyField,
  readonlyTextarea as ReadonlyTextarea,
  recordFieldGrid as RecordFieldGrid,
  recordRail as RecordRail,
  recordHeaderActions as RecordHeaderActions,
  recordMore as RecordMore,
} from './record-detail.tsx'
export { notice as Notice } from './state.tsx'
export { breadcrumbs as Breadcrumbs, pageContext as PageContext, tabs as Tabs } from './navigation.tsx'
export { modalSheet as ModalSheet } from './modal.tsx'
export { modalForm as ModalForm } from './modal.tsx'
export { datePicker as DatePicker } from './date-picker.tsx'
export { mediaPanel as MediaPanel } from './media.tsx'
export { attachmentPanel as AttachmentPanel } from './attachments.tsx'
export { productVariantManagement as ProductVariantManagement } from './product-variants.tsx'
export { productMediaManagement as ProductMediaManagement } from './product-media.tsx'
export { scheduleBoard as ScheduleBoard } from './schedule.tsx'
export { gantt as Gantt } from './gantt.tsx'
export {
  docTree as DocTree,
  kanbanCard as KanbanCard,
  kanbanGrid as KanbanGrid,
  progressBar as Progress,
  recordList as RecordList,
} from './data.tsx'
export { navGroup as NavGroup } from './nav.tsx'
export { barChart as BarChart, chart as Chart, delta as Delta } from './charts.tsx'
export { definitionList as DefinitionList } from './layout.tsx'
