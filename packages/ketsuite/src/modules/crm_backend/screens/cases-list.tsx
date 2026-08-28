import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  bulkActions,
  dataTable,
  emptyState,
  formatMoney,
  inline,
  LinkButton,
  ListPage,
  listChrome,
  shell,
} from '../../../ui/index.ts'
import type { Column, DataTable, Frame, TableGroup } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'

export type CaseListRow = Record<string, unknown>

export type CasesListScreenOptions = {
  rows: CaseListRow[]
  groups?: TableGroup<CaseListRow>[]
  /** Omitted when the reader may list records but may not create one. */
  createHref?: string
  locale?: string
  total?: number
  table?: Partial<DataTable<CaseListRow>>
}

const local = (_: Translator, group: string, value: unknown): string => {
  const raw = String(value ?? '')
  const key = `crm.${group}.${raw}`
  return _.resolves(key) ? _(key) : raw || '—'
}

const caseState = (_: Translator, value: unknown) => {
  const raw = String(value ?? '')
  return badge(
    local(_, 'terminal', raw),
    raw === 'won' ? 'positive' : raw === 'lost' ? 'danger' : 'neutral',
    raw,
  )
}

export const caseListColumns = (_: Translator): Array<Column<CaseListRow>> => [
  {
    key: 'name',
    label: _('crm_backend.field.name'),
    priority: 'primary',
    width: 'wide',
    cell: (row) => String(row.name),
  },
  {
    key: 'kind',
    label: _('crm_backend.field.kind'),
    cell: (row) => local(_, 'kind', row.kind),
  },
  {
    key: 'partner',
    label: _('crm_backend.field.partner'),
    cell: (row) => String(row.partnerName ?? '—'),
  },
  {
    key: 'stage',
    label: _('crm_backend.field.stage'),
    cell: (row) => String(row.stageName ?? '—'),
  },
  {
    key: 'assignee',
    label: _('crm_backend.field.assignee'),
    cell: (row) => String(row.assigneeName ?? '—'),
  },
  {
    key: 'revenue',
    label: _('crm_backend.field.expectedRevenue'),
    align: 'end',
    kind: 'currency',
    cell: (row) => formatMoney(_, row.expectedRevenue ?? 0, row.currency),
  },
  {
    key: 'state',
    label: _('crm_backend.field.state'),
    kind: 'status',
    cell: (row) => caseState(_, row.terminalState),
  },
]

export const casesListScreen = (
  _: Translator,
  frame: Frame,
  options: CasesListScreenOptions,
): TemplateResult => {
  const groups = options.groups ?? []
  const total = options.total ?? options.rows.length
  const selection = options.table?.selection ?? frame.chrome?.selection
  const hasActions = options.createHref || selection || frame.extras?.['topbar.end'] !== undefined

  return shell(
    _,
    _('crm_backend.cases.title'),
    <ListPage
      title={_('crm_backend.cases.title')}
      description={_('crm_backend.cases.subtitle')}
      actions={
        hasActions
          ? inline([
              options.createHref ? (
                <LinkButton
                  label={_('crm_backend.action.create')}
                  href={options.createHref}
                  variant="primary"
                />
              ) : (
                ''
              ),
              selection ? bulkActions(_, selection) : '',
              frame.extras?.['topbar.end'] ?? '',
            ])
          : undefined
      }
      controls={
        frame.chrome
          ? listChrome(
              _,
              _('crm_backend.cases.title'),
              {
                ...frame.chrome,
                layout: 'command',
                section: undefined,
                create: null,
                selection: null,
              },
              false,
            )
          : undefined
      }
      status={`${_('crm_backend.cases.title')}: ${String(total)}`}
      body={
        options.rows.length || groups.length
          ? dataTable(_, {
              columns: caseListColumns(_),
              rows: options.rows,
              groups,
              id: (row) => String(row.id),
              rowHref: (row) => localized(`/admin/crm/cases/${String(row.id)}`, options.locale ?? ''),
              ...options.table,
            })
          : emptyState(_('crm_backend.empty.title'), _('crm_backend.empty.hint'))
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
