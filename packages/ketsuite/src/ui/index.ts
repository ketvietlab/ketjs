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
export {
  backendPage,
  shell,
  framed,
  framedPage,
  appCard,
  card,
  cardGroups,
  definitionList,
} from './layout.tsx'
export type { CardMeta, Extras, Frame } from './layout.tsx'
export { HOOKS, OWNERS } from './hooks.ts'
export { mailContractCases } from './mail.ts'
export { activityContractCases } from './activity.ts'
export { calendarContractCases } from './calendar.ts'
