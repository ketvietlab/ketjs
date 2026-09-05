import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  code,
  dataTable,
  emptyState,
  inline,
  LinkButton,
  ListPage,
  listChrome,
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

export const usersScreen = (_: Translator, frame: Frame, options: UsersListScreenOptions): TemplateResult =>
  shell(
    _,
    _('user_backend.users.title'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('user_backend.users.title')}
      description={_('user_backend.users.subtitle')}
      actions={inline([
        <LinkButton
          label={_('user_backend.action.createUser')}
          href={options.createHref}
          variant="primary"
        />,
        <LinkButton
          label={
            options.includeArchived
              ? _('user_backend.filter.activeOnly')
              : _('user_backend.filter.includeArchived')
          }
          href={options.toggleHref}
          variant="tertiary"
        />,
        frame.extras?.['topbar.end'] ?? '',
      ])}
      controls={
        frame.chrome
          ? listChrome(
              _,
              _('user_backend.users.title'),
              { ...frame.chrome, layout: 'command', section: undefined, create: null, selection: null },
              false,
            )
          : undefined
      }
      status={`${_('user_backend.users.title')}: ${String(options.total)}`}
      body={
        options.rows.length
          ? dataTable(_, {
              rows: options.rows,
              id: (row) => row.id,
              rowHref: (row) => row.detailHref,
              columns: userListColumns(_),
            })
          : emptyState(_('user_backend.users.empty'), _('user_backend.users.emptyHint'))
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
