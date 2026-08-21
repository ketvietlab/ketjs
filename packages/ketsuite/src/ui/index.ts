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
// The stylesheet lives with the `backend` module, not here. A deployment that uses
// the kit without installing the admin gets correct markup and no styles — a
// deliberate trade, noted in design/HANDOFF.md.

export { icon, hasIcon } from './icons.ts'
export { formatMoney } from './format.ts'
export { button, linkButton, iconButton, actionGroup } from './actions.tsx'
export type { ActionVariant, ActionSize, ButtonSpec, LinkButtonSpec } from './actions.tsx'
export {
  inline,
  badge,
  tag,
  countBadge,
  avatar,
  person,
  initials,
  actionButton,
  code,
  qrCode,
} from './primitives.tsx'
export type { Tone } from './primitives.tsx'
export { notice, emptyState, errorState, loadingState } from './state.tsx'
export type { NoticeTone } from './state.tsx'
export { stack, section, surface, cardGrid, contentCard, metric } from './surfaces.tsx'
export { dataTable, visibleColumns } from './table.tsx'
export type { Cell, Column, DataTable, TableGroup } from './table.tsx'
export { scheduleBoard } from './schedule.tsx'
export type { ScheduleDay, ScheduleEvent, ScheduleRow, ScheduleTone } from './schedule.tsx'
export { kanbanCard, kanbanGrid, recordList } from './data.tsx'
export { mediaPanel } from './media.tsx'
export type { MediaItem, MediaLabels, MediaPanelProps } from './media.tsx'
export { attachmentPanel } from './attachments.tsx'
export type { AttachmentItem } from './attachments.tsx'
export { recordForm, recordActions, formCluster } from './form.tsx'
export { authTokenScreen } from './auth.tsx'
export type { FormField, FormOption, RecordFormOptions } from './form.tsx'
export { datePicker } from './date-picker.tsx'
export type { DatePickerField, DatePickerOptions } from './date-picker.tsx'
export { breadcrumbs, tabs } from './navigation.tsx'
export type { Breadcrumb, Tab } from './navigation.tsx'
export { recordWorkspace, recordToggle } from './record.tsx'
export { modalSheet } from './modal.tsx'
export type { RecordSummaryItem, RecordWorkspaceSlots } from './record.tsx'
export { sidebar, sidebarMain, sidebarFoot } from './nav.tsx'
export type { Indicator, SidebarOptions, Viewer } from './nav.tsx'
export { listChrome, topbarSearch } from './chrome.tsx'
export type { Facet, ListChrome, Pager, ViewKind, SearchMenu, SearchMenuItem } from './chrome.tsx'
export { backendPage, shell, framedPage, appCard, cardGroups, definitionList } from './layout.tsx'
export type { CardMeta, Extras, Frame } from './layout.tsx'
export { HOOKS, OWNERS } from './hooks.ts'
export { mailContractCases } from './mail.ts'
export { activityContractCases } from './activity.ts'
export { calendarContractCases } from './calendar.ts'

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
export { framedPage as Framed, appCard as AppCard, cardGroups as CardGroups } from './layout.tsx'
export { section as Section, surface as Surface, contentCard as ContentCard } from './surfaces.tsx'
export { cardGrid as CardGrid, metric as Metric } from './surfaces.tsx'
export { recordForm as RecordForm, formCluster as FormCluster } from './form.tsx'
export { recordActions as RecordActions } from './form.tsx'
export { recordWorkspace as RecordWorkspace, recordToggle as RecordToggle } from './record.tsx'
export { notice as Notice } from './state.tsx'
export { breadcrumbs as Breadcrumbs, tabs as Tabs } from './navigation.tsx'
export { modalSheet as ModalSheet } from './modal.tsx'
export { datePicker as DatePicker } from './date-picker.tsx'
export { mediaPanel as MediaPanel } from './media.tsx'
export { attachmentPanel as AttachmentPanel } from './attachments.tsx'
export { scheduleBoard as ScheduleBoard } from './schedule.tsx'
export { kanbanCard as KanbanCard, kanbanGrid as KanbanGrid, recordList as RecordList } from './data.tsx'
export { definitionList as DefinitionList } from './layout.tsx'
