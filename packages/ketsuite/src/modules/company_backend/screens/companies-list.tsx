import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  code,
  collectionActions,
  collectionControls,
  collectionTable,
  emptyState,
  inline,
  LinkButton,
  ListPage,
  prepareCollectionTable,
  shell,
} from '../../../ui/index.ts'
import type { Column, DataTable, Frame } from '../../../ui/index.ts'
import type { CompanyRow } from './types.ts'

export type CompanyListRow = CompanyRow & { detailHref: string }

export type CompaniesListScreenOptions = {
  rows: CompanyListRow[]
  total: number
  createHref: string
  hierarchyHref: string
  /** What the search-filter bar decided about the table, such as its groups. */
  table?: Partial<DataTable<CompanyListRow>>
}

export const companyListColumns = (_: Translator): Array<Column<CompanyListRow>> => [
  {
    key: 'code',
    label: _('company_backend.field.code'),
    cell: (row) => code(row.code, 'identifier'),
    kind: 'identifier',
    priority: 'primary',
  },
  {
    key: 'name',
    label: _('company_backend.field.name'),
    cell: (row) => row.name,
    priority: 'secondary',
    width: 'wide',
  },
  {
    key: 'currency',
    label: _('company_backend.field.currency'),
    cell: (row) => row.currency,
  },
  {
    key: 'state',
    label: _('company_backend.field.state'),
    kind: 'status',
    cell: (row) =>
      row.active
        ? badge(_('company_backend.state.active'), 'positive', 'active')
        : badge(_('company_backend.state.archived'), 'neutral', 'archived'),
  },
]

export const companiesListScreen = (
  _: Translator,
  frame: Frame,
  options: CompaniesListScreenOptions,
): TemplateResult => {
  const prepared = prepareCollectionTable(
    _,
    frame,
    {
      rows: options.rows,
      id: (row) => row.id,
      rowHref: (row) => row.detailHref,
      columns: companyListColumns(_),
      ...options.table,
    },
    { paginate: !options.table?.groups },
  )
  frame = prepared.frame
  return shell(
    _,
    _('company_backend.screen.title'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('company_backend.screen.title')}
      description={_('company_backend.screen.subtitle')}
      headerActions={
        <LinkButton label={_('company_backend.action.create')} href={options.createHref} variant="primary" />
      }
      actions={collectionActions(
        _,
        frame,
        // The bar owns the archived toggle now, so only the tree link is left.
        inline([
          <LinkButton
            label={_('company_backend.action.hierarchy')}
            href={options.hierarchyHref}
            variant="secondary"
          />,
        ]),
      )}
      controls={collectionControls(_, _('company_backend.screen.title'), frame)}
      status={`${_('company_backend.screen.title')}: ${String(options.total)}`}
      body={
        options.rows.length || options.table?.groups?.length
          ? collectionTable(_, prepared.table)
          : emptyState(_('company_backend.screen.empty'), _('company_backend.screen.emptyHint'))
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
}
