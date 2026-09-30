import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
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
import type { RoleRow } from './types.ts'

export type RoleListRow = RoleRow & { detailHref: string }

export type RolesListScreenOptions = {
  rows: readonly RoleListRow[]
  /**
   * Null while roles come only from role templates: a custom role cannot be
   * assigned, so the header offers no create action.
   */
  createHref: string | null
  presetsHref?: string
  /** What the search-filter bar decided about the table, such as its groups. */
  table?: Partial<DataTable<RoleListRow>>
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
      row.healthIssues?.length ? _('user_backend.roles.stale') : _('user_backend.roles.healthy'),
  },
]

export const rolesScreen = (_: Translator, frame: Frame, options: RolesListScreenOptions): TemplateResult => {
  const prepared = prepareCollectionTable(
    _,
    frame,
    {
      rows: options.rows,
      id: (row) => row.id,
      rowHref: (row) => row.detailHref,
      columns: roleListColumns(_),
      ...options.table,
    },
    { paginate: !options.table?.groups },
  )
  frame = prepared.frame
  return shell(
    _,
    _('user_backend.roles.title'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('user_backend.roles.title')}
      controls={collectionControls(_, _('user_backend.roles.title'), frame)}
      headerActions={
        options.createHref ? (
          <LinkButton
            label={_('user_backend.action.createRole')}
            href={options.createHref}
            variant="primary"
          />
        ) : undefined
      }
      actions={collectionActions(_, frame)}
      status={`${_('user_backend.roles.title')}: ${String(options.rows.length)}`}
      body={
        options.rows.length || options.table?.groups?.length
          ? collectionTable(_, prepared.table)
          : emptyState(_('user_backend.roles.empty'), _('user_backend.roles.emptyHint'))
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
