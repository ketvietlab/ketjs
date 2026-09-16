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
  /** Where the list stands with nothing narrowing it, when something does. */
  clearHref?: string | null
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
          : options.clearHref
            ? // Nothing matched what was asked for, so the way out is dropping the
              // question rather than the hint for an empty deployment.
              emptyState(_('user_backend.users.noMatch'), _('user_backend.users.noMatchHint'), {
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
