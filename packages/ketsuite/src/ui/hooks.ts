// Every data-ui name the kit can emit, gathered from the files that emit them.
//
// This replaced a hand-maintained array in the contract test, which drifted four
// times in one afternoon: a hook is registered beside the markup that produces it,
// so forgetting to register one turns the test red in the file you just edited
// rather than in a list somebody else maintains.

import { HOOKS as icons } from './icons.ts'
import { HOOKS as primitives } from './primitives.tsx'
import { HOOKS as state } from './state.tsx'
import { HOOKS as table } from './table.tsx'
import { HOOKS as nav } from './nav.tsx'
import { HOOKS as chrome } from './chrome.tsx'
import { HOOKS as layout } from './layout.tsx'
import { HOOKS as actions } from './actions.tsx'
import { HOOKS as surfaces } from './surfaces.tsx'
import { HOOKS as navigation } from './navigation.tsx'
import { HOOKS as data } from './data.tsx'
import { HOOKS as gantt } from './gantt.tsx'
import { HOOKS as media } from './media.tsx'
import { HOOKS as attachments } from './attachments.tsx'
import { HOOKS as form } from './form.tsx'
import { HOOKS as datePicker } from './date-picker.tsx'
import { HOOKS as schedule } from './schedule.tsx'
import { HOOKS as mail } from './mail.ts'
import { HOOKS as activity } from './activity.ts'
import { HOOKS as calendar } from './calendar.ts'
import { HOOKS as record } from './record.tsx'
import { HOOKS as recordDetail } from './record-detail.tsx'
import { HOOKS as modal } from './modal.tsx'
import { HOOKS as auth } from './auth.tsx'

const ALL = [
  ...icons,
  ...actions,
  ...primitives,
  ...state,
  ...surfaces,
  ...table,
  ...data,
  ...gantt,
  ...media,
  ...attachments,
  ...form,
  ...datePicker,
  ...schedule,
  ...navigation,
  ...nav,
  ...chrome,
  ...layout,
  ...mail,
  ...activity,
  ...calendar,
  ...record,
  ...recordDetail,
  ...modal,
  ...auth,
]

/** Sorted and de-duplicated: two files may legitimately share `title`. */
export const HOOKS: readonly string[] = [...new Set(ALL)].sort()

/** A name claimed by two files is usually a copy-paste, so say which. */
export const OWNERS: Readonly<Record<string, string[]>> = Object.freeze(
  Object.fromEntries(
    HOOKS.map((h) => [
      h,
      (
        [
          ['icons', icons],
          ['primitives', primitives],
          ['state', state],
          ['table', table],
          ['nav', nav],
          ['chrome', chrome],
          ['layout', layout],
          ['actions', actions],
          ['surfaces', surfaces],
          ['navigation', navigation],
          ['data', data],
          ['gantt', gantt],
          ['media', media],
          ['attachments', attachments],
          ['form', form],
          ['date-picker', datePicker],
          ['schedule', schedule],
          ['mail', mail],
          ['activity', activity],
          ['calendar', calendar],
          ['record', record],
          ['record-detail', recordDetail],
          ['modal', modal],
          ['auth', auth],
        ] as Array<[string, readonly string[]]>
      )
        .filter(([, list]) => (list as readonly string[]).includes(h))
        .map(([name]) => name),
    ]),
  ),
)
