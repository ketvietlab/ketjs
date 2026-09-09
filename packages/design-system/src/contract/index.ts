import { HOOKS as actionHooks } from '../primitives/actions/index.tsx'
import { HOOKS as feedbackHooks } from '../primitives/feedback/index.tsx'
import { HOOKS as fieldHooks } from '../primitives/field/index.tsx'
import { HOOKS as statusHooks } from '../primitives/status/index.tsx'
import { HOOKS as navigationHooks } from '../primitives/navigation/index.tsx'
import { HOOKS as progressHooks } from '../primitives/progress/index.tsx'
import { HOOKS as menuHooks } from '../interactions/menu/index.tsx'
import { HOOKS as popoverHooks } from '../interactions/popover/index.tsx'
import { HOOKS as tooltipHooks } from '../interactions/tooltip/index.tsx'
import { HOOKS as dialogHooks } from '../interactions/dialog/index.tsx'
import { HOOKS as toastHooks } from '../interactions/toast/index.tsx'
import { HOOKS as spinnerHooks } from '../interactions/spinner/index.tsx'
import { HOOKS as skeletonHooks } from '../interactions/skeleton/index.tsx'
import { HOOKS as scalarFieldHooks } from '../forms/scalar-fields/index.tsx'
import { HOOKS as comboboxHooks } from '../forms/combobox/index.tsx'
import { HOOKS as dateTimeHooks } from '../forms/date-time/index.tsx'
import { HOOKS as uploadHooks } from '../forms/upload/index.tsx'
import { HOOKS as relationPickerHooks } from '../forms/relation-picker/index.tsx'
import { HOOKS as layoutHooks } from '../layouts/layout/index.tsx'
import { HOOKS as shellHooks } from '../layouts/shell/index.tsx'
import { HOOKS as tableHooks } from '../patterns/data-table/index.tsx'
import { HOOKS as listChromeHooks } from '../patterns/list-chrome/index.tsx'
import { HOOKS as listPageHooks } from '../patterns/list-page/index.tsx'
import { HOOKS as formPageHooks } from '../patterns/form-page/index.tsx'
import { HOOKS as recordPageHooks } from '../patterns/record-page/index.tsx'
import { HOOKS as dashboardPageHooks } from '../patterns/dashboard-page/index.tsx'
import { HOOKS as boardPageHooks } from '../patterns/board-page/index.tsx'
import { HOOKS as modalHooks } from '../patterns/modal-sheet/index.tsx'
import { HOOKS as pipelineHooks } from '../patterns/pipeline/index.tsx'
import { HOOKS as formHooks } from '../patterns/record-form/index.tsx'

const GROUPS = {
  actions: actionHooks,
  feedback: feedbackHooks,
  fields: fieldHooks,
  status: statusHooks,
  navigation: navigationHooks,
  progress: progressHooks,
  menu: menuHooks,
  popover: popoverHooks,
  tooltip: tooltipHooks,
  dialog: dialogHooks,
  toast: toastHooks,
  spinner: spinnerHooks,
  skeleton: skeletonHooks,
  scalarFields: scalarFieldHooks,
  combobox: comboboxHooks,
  dateTime: dateTimeHooks,
  upload: uploadHooks,
  relationPicker: relationPickerHooks,
  layouts: layoutHooks,
  shell: shellHooks,
  table: tableHooks,
  listChrome: listChromeHooks,
  listPage: listPageHooks,
  formPage: formPageHooks,
  recordPage: recordPageHooks,
  dashboardPage: dashboardPageHooks,
  boardPage: boardPageHooks,
  modal: modalHooks,
  pipeline: pipelineHooks,
  form: formHooks,
} as const

export const HOOKS: readonly string[] = [...new Set(Object.values(GROUPS).flat())].sort()

export const OWNERS: Readonly<Record<string, string[]>> = Object.freeze(
  Object.fromEntries(Object.entries(GROUPS).map(([owner, hooks]) => [owner, [...hooks]])),
)
