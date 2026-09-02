import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { dataTable, emptyState, inline, LinkButton, ListPage, shell } from '../../../ui/index.ts'
import type { Column, Frame } from '../../../ui/index.ts'
import type { RoleRow } from './types.ts'

export type RoleListRow = RoleRow & { detailHref: string }

export type RolesListScreenOptions = {
  rows: readonly RoleListRow[]
  createHref: string
  presetsHref: string
}

export const roleListColumns = (_: Translator): Array<Column<RoleListRow>> => [
  {
    key: 'name',
    label: _('user_backend.field.name'),
    priority: 'primary',
    width: 'wide',
    cell: (row) => row.name,
  },
  {
    key: 'mode',
    label: _('user_backend.field.roleMode'),
    cell: (row) =>
      row.mode === 'managed'
        ? `${_('user_backend.role.managed')} · v${String(row.templateVersion ?? '—')}`
        : _('user_backend.role.custom'),
  },
  {
    key: 'description',
    label: _('user_backend.field.description'),
    cell: (row) => row.description || '—',
  },
  {
    key: 'assignments',
    label: _('user_backend.access.assignments'),
    cell: (row) => String(row.assignmentCount ?? 0),
  },
  {
    key: 'health',
    label: _('user_backend.access.health'),
    cell: (row) =>
      row.healthIssues?.length
        ? row.healthIssues.map((issue) => _(`user_backend.health.${issue}`)).join(', ')
        : _('user_backend.health.healthy'),
  },
]

export const rolesScreen = (_: Translator, frame: Frame, options: RolesListScreenOptions): TemplateResult =>
  shell(
    _,
    _('user_backend.roles.title'),
    <ListPage
      title={_('user_backend.roles.title')}
      description={_('user_backend.roles.subtitle')}
      actions={inline([
        <LinkButton
          label={_('user_backend.action.createRole')}
          href={options.createHref}
          variant="primary"
        />,
        <LinkButton
          label={_('user_backend.action.presets')}
          href={options.presetsHref}
          variant="secondary"
        />,
        frame.extras?.['topbar.end'] ?? '',
      ])}
      status={`${_('user_backend.roles.title')}: ${String(options.rows.length)}`}
      body={
        options.rows.length
          ? dataTable(_, {
              rows: options.rows,
              id: (row) => row.id,
              rowHref: (row) => row.detailHref,
              columns: roleListColumns(_),
            })
          : emptyState(_('user_backend.roles.empty'), _('user_backend.roles.emptyHint'))
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
