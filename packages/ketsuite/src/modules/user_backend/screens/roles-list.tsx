import type { Translator } from '@ketvietlab/ketjs'
import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import type { KetTableColumn, KetTableConfig, KetTableRow } from '@ketvietlab/design-system'
import {
  collectionActions,
  collectionControls,
  collectionGridLabels,
  emptyState,
  LinkButton,
  ListPage,
  prepareCollectionGrid,
  shell,
} from '../../../ui/index.ts'
import type { Frame, TableGroup } from '../../../ui/index.ts'
import type { RoleRow } from './types.ts'

export type RoleListRow = RoleRow & { detailHref: string }

export type RolesGridOptions = {
  rows: readonly RoleListRow[]
  groups?: readonly TableGroup<RoleListRow>[]
  /** A `{id}` href that opens a role in the record modal. */
  rowHrefTemplate: string
}

export type RolesListScreenOptions = {
  /** The KetTable island the caller rendered from `rolesGrid`. */
  grid: JSXChild
  /** True when there is no role to show, so the screen says why instead of drawing an empty grid. */
  empty: boolean
  total: number
  /**
   * Null while roles come only from role templates: a custom role cannot be
   * assigned, so the header offers no create action.
   */
  createHref: string | null
  presetsHref?: string
}

export const roleGridColumns = (_: Translator): KetTableColumn[] => [
  {
    key: 'name',
    label: _('user_backend.field.name'),
    priority: 'primary',
    width: 'wide',
    format: { kind: 'text', field: 'name' },
  },
  {
    key: 'description',
    label: _('user_backend.field.description'),
    wrap: true,
    format: { kind: 'text', field: 'description' },
  },
  {
    key: 'assignments',
    label: _('user_backend.access.assignments'),
    align: 'end',
    format: { kind: 'number', field: 'assignmentCount' },
  },
  {
    key: 'areas',
    label: _('user_backend.roles.permissionsTitle'),
    align: 'end',
    format: { kind: 'number', field: 'bundleCount' },
  },
  {
    key: 'health',
    label: _('user_backend.access.health'),
    format: {
      kind: 'status',
      field: 'health',
      tones: {
        healthy: { label: _('user_backend.roles.healthy'), tone: 'positive' },
        stale: { label: _('user_backend.roles.stale'), tone: 'warning' },
      },
    },
  },
]

/** The JSON row the island draws. A role no template owns has no area count. */
export const roleGridRow = (row: RoleListRow): KetTableRow => ({
  id: row.id,
  name: row.name,
  description: row.description || '—',
  assignmentCount: row.assignmentCount ?? 0,
  bundleCount: row.bundleCount ?? null,
  health: row.healthIssues?.length ? 'stale' : 'healthy',
})

/** The toolbar state and island config for the roles collection. */
export const rolesGrid = (
  _: Translator,
  frame: Frame,
  options: RolesGridOptions,
): { frame: Frame; config: KetTableConfig } =>
  prepareCollectionGrid(
    _,
    frame,
    {
      columns: roleGridColumns(_),
      rows: options.rows,
      ...(options.groups ? { groups: options.groups } : {}),
      id: (row) => row.id,
      view: roleGridRow,
      rowHrefTemplate: options.rowHrefTemplate,
      labels: collectionGridLabels(_, _('user_backend.roles.empty'), _('user_backend.roles.emptyHint')),
    },
    { paginate: !options.groups?.length },
  )

export const rolesScreen = (_: Translator, frame: Frame, options: RolesListScreenOptions): TemplateResult =>
  shell(
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
      status={`${_('user_backend.roles.title')}: ${String(options.total)}`}
      body={
        options.empty
          ? emptyState(_('user_backend.roles.empty'), _('user_backend.roles.emptyHint'))
          : options.grid
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
