import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
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
import type { Column, Frame } from '../../../ui/index.ts'
import type { UserRow } from './types.ts'

export type UserListRow = UserRow & { detailHref: string }

export type UsersListScreenOptions = {
  rows: UserListRow[]
  total: number
  createHref: string
  toggleHref: string
  includeArchived: boolean
}

export const userListColumns = (_: Translator): Array<Column<UserListRow>> => [
  {
    key: 'name',
    label: _('user_backend.field.name'),
    priority: 'primary',
    width: 'wide',
    cell: (row) => row.name,
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
    cell: (row) => badge(_(`user_backend.access.${row.accessKind}`), 'info', row.accessKind),
  },
  {
    key: 'credential',
    label: _('user_backend.field.credential'),
    kind: 'status',
    cell: (row) =>
      row.passwordReady
        ? badge(_('user_backend.state.passwordReady'), 'positive', 'ready')
        : badge(_('user_backend.state.invitationPending'), 'warning', 'pending'),
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
    },
    { paginate: false },
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
      actions={collectionActions(
        _,
        frame,
        <LinkButton
          label={
            options.includeArchived
              ? _('user_backend.filter.activeOnly')
              : _('user_backend.filter.includeArchived')
          }
          href={options.toggleHref}
          variant="tertiary"
        />,
      )}
      controls={collectionControls(_, _('user_backend.users.title'), frame)}
      status={`${_('user_backend.users.title')}: ${String(options.total)}`}
      body={
        options.rows.length
          ? collectionTable(_, prepared.table)
          : emptyState(_('user_backend.users.empty'), _('user_backend.users.emptyHint'))
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
