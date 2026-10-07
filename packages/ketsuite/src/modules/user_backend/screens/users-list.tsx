import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { KetTableColumn, KetTableConfig, KetTableRow } from '@ketvietlab/design-system'
import {
  collectionActions,
  collectionControls,
  collectionGridLabels,
  collectionSelection,
  emptyState,
  formatDateTime,
  LinkButton,
  ListPage,
  prepareCollectionGrid,
  shell,
} from '../../../ui/index.ts'
import type { Frame, TableGroup, TableSelection } from '../../../ui/index.ts'
import type { UserRow } from './types.ts'

export type UserListRow = UserRow & { detailHref: string }

export type UsersGridOptions = {
  rows: readonly UserListRow[]
  groups?: readonly TableGroup<UserListRow>[]
  /** A `{id}` href that opens a person on their own page. */
  rowHrefTemplate: string
  /** The bulk form the row checkboxes post to; null when the viewer may not change people in bulk. */
  selection?: TableSelection | null
}

export type UsersListScreenOptions = {
  /** The KetTable island the caller rendered from `usersGrid`. */
  grid: JSXChild
  /** True when nothing matched, so the screen says why instead of drawing an empty grid. */
  empty: boolean
  clearHref?: string | null
  total: number
  /** Null when the viewer may not create a user: the header then offers no create action. */
  createHref: string | null
}

// Date before time, as the record modal writes it: "28/09/2026 08:42".
const signInTime = (locale: string, value: string): string => {
  const at = new Date(value)
  return `${formatDateTime(locale, at, { day: '2-digit', month: '2-digit', year: 'numeric' })} ${formatDateTime(locale, at, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`
}

export const userGridColumns = (_: Translator): KetTableColumn[] => [
  {
    key: 'name',
    label: _('user_backend.field.name'),
    priority: 'primary',
    width: 'wide',
    // Authority that answers to nothing else is said on the row that holds it.
    format: {
      kind: 'custom',
      field: 'name',
      renderer: 'flagged',
      options: { flag: 'superuser', label: _('user_backend.field.superuser'), tone: 'warning' },
    },
  },
  { key: 'login', label: _('user_backend.field.login'), format: { kind: 'identifier', field: 'login' } },
  {
    key: 'email',
    label: _('user_backend.field.email'),
    priority: 'secondary',
    format: { kind: 'text', field: 'email' },
  },
  {
    key: 'lastSignIn',
    label: _('user_backend.login.lastSignIn'),
    kind: 'date',
    priority: 'secondary',
    format: { kind: 'text', field: 'lastSignIn' },
  },
  {
    key: 'access',
    label: _('user_backend.field.accessKind'),
    // Each kind of access reads differently, so each carries its own tone rather
    // than three shades of the same one.
    format: {
      kind: 'status',
      field: 'accessKind',
      tones: {
        internal: { label: _('user_backend.access.internal'), tone: 'info' },
        portal: { label: _('user_backend.access.portal'), tone: 'neutral' },
        public: { label: _('user_backend.access.public'), tone: 'warning' },
      },
    },
  },
  {
    key: 'credential',
    label: _('user_backend.field.credential'),
    // What the reader wants to know is whether this person can sign in, not which
    // mechanism is pending behind it.
    format: {
      kind: 'status',
      field: 'credential',
      tones: {
        ready: { label: _('user_backend.login.ready'), tone: 'positive' },
        pending: { label: _('user_backend.login.preparing'), tone: 'warning' },
      },
    },
  },
  {
    key: 'state',
    label: _('user_backend.field.state'),
    format: {
      kind: 'status',
      field: 'state',
      tones: {
        active: { label: _('user_backend.state.active'), tone: 'positive' },
        archived: { label: _('user_backend.state.archived'), tone: 'neutral' },
      },
    },
  },
]

/** The JSON row the island draws: every value already in the reader's words. */
export const userGridRow =
  (_: Translator) =>
  (row: UserListRow): KetTableRow => ({
    id: row.id,
    name: row.name,
    superuser: row.superuser,
    login: row.login,
    email: row.email || '—',
    lastSignIn: row.lastLoginAt ? signInTime(_.locale, row.lastLoginAt) : _('user_backend.login.never'),
    accessKind: row.accessKind,
    credential: row.passwordReady ? 'ready' : 'pending',
    state: row.active ? 'active' : 'archived',
  })

/** The toolbar state and island config for one page of people. */
export const usersGrid = (
  _: Translator,
  frame: Frame,
  options: UsersGridOptions,
): { frame: Frame; config: KetTableConfig } =>
  prepareCollectionGrid(
    _,
    frame,
    {
      columns: userGridColumns(_),
      rows: options.rows,
      ...(options.groups ? { groups: options.groups } : {}),
      id: (row) => row.id,
      view: userGridRow(_),
      rowHrefTemplate: options.rowHrefTemplate,
      selection: options.selection ?? null,
      labels: collectionGridLabels(_, _('user_backend.users.empty'), _('user_backend.users.emptyHint')),
    },
    { paginate: !options.groups?.length },
  )

export const usersScreen = (_: Translator, frame: Frame, options: UsersListScreenOptions): TemplateResult =>
  shell(
    _,
    _('user_backend.users.title'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('user_backend.users.title')}
      headerActions={
        options.createHref ? (
          <LinkButton
            label={_('user_backend.action.createUser')}
            href={options.createHref}
            variant="primary"
          />
        ) : undefined
      }
      actions={collectionActions(_, frame)}
      controls={collectionControls(_, _('user_backend.users.title'), frame)}
      selection={collectionSelection(_, frame)}
      status={`${_('user_backend.users.title')}: ${String(options.total)}`}
      body={
        !options.empty
          ? options.grid
          : options.clearHref
            ? emptyState(_('user_backend.users.noMatch'), _('user_backend.users.noMatchHint'), {
                actions: (
                  <LinkButton
                    label={_('user_backend.action.clearFilters')}
                    href={options.clearHref}
                    variant="secondary"
                  />
                ),
              })
            : emptyState(_('user_backend.users.empty'), _('user_backend.users.emptyHint'))
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
