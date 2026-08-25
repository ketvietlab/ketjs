import type { MenuNode } from '@ketvietlab/ketjs'
import type { IslandProps, IslandView } from '@ketvietlab/ketjs-view'
import { NavGroup } from '../../../ui/index.ts'

/**
 * The sidebar's project group, filled into `backend:nav.items`.
 *
 * Flow's screens are scoped to a project, and `MenuDef.path` is a fixed
 * string — "the board of the project I am looking at" is not a path the menu
 * tree can hold. The joint exists for exactly that: the shell hands over the
 * active path, and a module that can read a record out of it contributes the
 * rows the tree could not.
 *
 * An island is handed props and nothing else — no context, no translator — so
 * the wording lives here, keyed by the `lang` the shell passes, the same way
 * mail_backend's inbox indicator handles the one other shell joint anyone
 * fills. The group is labelled with a word rather than the project's name:
 * the name needs a query, the island cannot make one, and the screen it
 * belongs to already carries it as a heading.
 */
const PROJECT_NAV = {
  vi: {
    group: 'Dự án',
    board: 'Bảng',
    issues: 'Danh sách',
    epics: 'Epic',
    sprints: 'Sprint',
    settings: 'Cài đặt',
  },
  en: {
    group: 'Project',
    board: 'Board',
    issues: 'Backlog',
    epics: 'Epics',
    sprints: 'Sprints',
    settings: 'Settings',
  },
} as const

/** `/admin/flow/projects/{id}/{screen}` — the only shape this group answers to. */
const PROJECT_PATH = /^\/admin\/flow\/projects\/([^/?#]+)\/([^/?#]+)/

export const projectNav = (props: IslandProps): IslandView => {
  const active = String(props.active ?? '')
  const english = String(props.lang ?? '')
    .toLowerCase()
    .startsWith('en')
  const words = PROJECT_NAV[english ? 'en' : 'vi']
  const found = PROJECT_PATH.exec(active)
  if (!found) return () => <></>
  const projectId = found[1] as string
  const screen = found[2] as string
  // Each path is written out rather than assembled from the segment, so the
  // repo's route invariant can still read it as a literal and check that a
  // screen actually serves it (test/backend-ui.test.ts).
  const at = (id: string, label: string, path: string): MenuNode => ({
    id: `flow.project.${id}`,
    label,
    path,
    icon: null,
    // The epic map sits under the epics screen, so the group still marks the
    // row the reader came in through rather than nothing at all.
    active: screen === id,
    children: [],
  })
  return () => (
    <NavGroup
      label={words.group}
      items={[
        at('board', words.board, `/admin/flow/projects/${projectId}/board`),
        at('issues', words.issues, `/admin/flow/projects/${projectId}/issues`),
        at('epics', words.epics, `/admin/flow/projects/${projectId}/epics`),
        at('sprints', words.sprints, `/admin/flow/projects/${projectId}/sprints`),
        at('settings', words.settings, `/admin/flow/projects/${projectId}/settings`),
      ]}
    />
  )
}
