import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  inline,
  code,
  collectionActions,
  collectionControls,
  collectionTable,
  emptyState,
  LinkButton,
  ListPage,
  prepareCollectionTable,
  shell,
} from '../../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../../ui/index.ts'
import type { UserRow } from './types.ts'

export type UserListRow = UserRow & { detailHref: string }

export type UsersListScreenOptions = {
  rows: readonly UserListRow[]
  clearHref?: string | null
  total: number
  createHref: string
  /** What the search-filter bar decided about the table, such as its groups. */
  table?: Partial<DataTable<UserListRow>>
}

export const userListColumns = (_: Translator): Array<Column<UserListRow>> => [
  {
    key: 'name',
    label: _('user_backend.field.name'),
    priority: 'primary',
    width: 'wide',
    // Authority that answers to nothing else is said on the row that holds it.
    cell: (row) =>
      row.superuser
        ? inline([row.name, badge(_('user_backend.field.superuser'), 'warning', 'superuser')])
        : row.name,
  },
  {
    key: 'login',
    label: _('user_backend.field.login'),
    kind: 'identifier',
    cell: (row) => code(row.login, 'identifier'),
  },
  {
    key: 'access',
    label: _('user_backend.field.accessKind'),
    kind: 'status',
    // Each kind of access reads differently, so each carries its own tone rather
    // than three shades of the same one.
    cell: (row) =>
      badge(
        _(`user_backend.access.${row.accessKind}`),
        row.accessKind === 'internal' ? 'info' : row.accessKind === 'portal' ? 'neutral' : 'warning',
        row.accessKind,
      ),
  },
  {
    key: 'credential',
    label: _('user_backend.field.credential'),
    kind: 'status',
    // What the reader wants to know is whether this person can sign in, not which
    // mechanism is pending behind it.
    cell: (row) =>
      row.passwordReady
        ? badge(_('user_backend.login.ready'), 'positive', 'ready')
        : badge(_('user_backend.login.preparing'), 'warning', 'pending'),
  },
  {
    key: 'state',
    label: _('user_backend.field.state'),
    kind: 'status',
    cell: (row) =>
      row.active
        ? badge(_('user_backend.state.active'), 'positive', 'active')
        : badge(_('user_backend.state.archived'), 'neutral', 'archived'),
  },
]

export const usersScreen = (_: Translator, frame: Frame, options: UsersListScreenOptions): TemplateResult => {
  const prepared = prepareCollectionTable(
    _,
    frame,
    {
      rows: options.rows,
      id: (row) => row.id,
      rowHref: (row) => row.detailHref,
      columns: userListColumns(_),
      ...options.table,
    },
    { paginate: !options.table?.groups },
  )
  frame = prepared.frame
  return shell(
    _,
    _('user_backend.users.title'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('user_backend.users.title')}
      description={_('user_backend.users.subtitle')}
      headerActions={
        <LinkButton label={_('user_backend.action.createUser')} href={options.createHref} variant="primary" />
      }
      actions={collectionActions(_, frame)}
      controls={collectionControls(_, _('user_backend.users.title'), frame)}
      status={`${_('user_backend.users.title')}: ${String(options.total)}`}
      body={
        options.rows.length || options.table?.groups?.length
          ? collectionTable(_, prepared.table)
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
}
