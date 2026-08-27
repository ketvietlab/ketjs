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
import type { CompanyRow } from './types.ts'

export type CompanyListRow = CompanyRow & { detailHref: string }

export type CompaniesListScreenOptions = {
  rows: CompanyListRow[]
  total: number
  createHref: string
  hierarchyHref: string
  toggleHref: string
  includeArchived: boolean
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
): TemplateResult =>
  shell(
    _,
    _('company_backend.screen.title'),
    <ListPage
      title={_('company_backend.screen.title')}
      description={_('company_backend.screen.subtitle')}
      actions={inline([
        <LinkButton label={_('company_backend.action.create')} href={options.createHref} variant="primary" />,
        <LinkButton
          label={_('company_backend.action.hierarchy')}
          href={options.hierarchyHref}
          variant="secondary"
        />,
        <LinkButton
          label={
            options.includeArchived
              ? _('company_backend.filter.activeOnly')
              : _('company_backend.filter.includeArchived')
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
              _('company_backend.screen.title'),
              { ...frame.chrome, layout: 'command', section: undefined, create: null, selection: null },
              false,
            )
          : undefined
      }
      status={`${_('company_backend.screen.title')}: ${String(options.total)}`}
      body={
        options.rows.length
          ? dataTable(_, {
              rows: options.rows,
              id: (row) => row.id,
              rowHref: (row) => row.detailHref,
              columns: companyListColumns(_),
            })
          : emptyState(_('company_backend.screen.empty'), _('company_backend.screen.emptyHint'))
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
