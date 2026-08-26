import { HOOKS as actionHooks } from '../primitives/actions.tsx'
import { HOOKS as feedbackHooks } from '../primitives/feedback.tsx'
import { HOOKS as fieldHooks } from '../primitives/field.tsx'
import { HOOKS as statusHooks } from '../primitives/status.tsx'
import { HOOKS as navigationHooks } from '../primitives/navigation.tsx'
import { HOOKS as progressHooks } from '../primitives/progress.tsx'
import { HOOKS as layoutHooks } from '../layouts/index.tsx'
import { HOOKS as shellHooks } from '../layouts/shell.tsx'
import { HOOKS as tableHooks } from '../patterns/data-table.tsx'
import { HOOKS as listPageHooks } from '../patterns/list-page.tsx'
import { HOOKS as formPageHooks } from '../patterns/form-page.tsx'
import { HOOKS as modalHooks } from '../patterns/modal-sheet.tsx'
import { HOOKS as formHooks } from '../patterns/record-form.tsx'

const GROUPS = {
  actions: actionHooks,
  feedback: feedbackHooks,
  fields: fieldHooks,
  status: statusHooks,
  navigation: navigationHooks,
  progress: progressHooks,
  layouts: layoutHooks,
  shell: shellHooks,
  table: tableHooks,
  listPage: listPageHooks,
  formPage: formPageHooks,
  modal: modalHooks,
  form: formHooks,
} as const

export const HOOKS: readonly string[] = [...new Set(Object.values(GROUPS).flat())].sort()

export const OWNERS: Readonly<Record<string, string[]>> = Object.freeze(
  Object.fromEntries(Object.entries(GROUPS).map(([owner, hooks]) => [owner, [...hooks]])),
)
