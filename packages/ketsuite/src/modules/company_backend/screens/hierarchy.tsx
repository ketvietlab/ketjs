import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { badge, code, dataTable, emptyState, Framed, inline, LinkButton } from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
import type { CompanyRow } from './types.ts'

export type CompanyHierarchyRow = CompanyRow & {
  depth: number
  parentName?: string | null
  detailHref: string
}

export type HierarchyScreenOptions = {
  rows: readonly CompanyHierarchyRow[]
  companiesHref: string
  createHref: string
}

export const hierarchyScreen = (
  _: Translator,
  frame: Frame,
  options: HierarchyScreenOptions,
): TemplateResult => (
  <Framed
    translator={_}
    title={_('company_backend.hierarchy.title')}
    subtitle={`${_('company_backend.screen.title')}: ${String(options.rows.length)}`}
    frame={frame}
    actions={inline([
      <LinkButton
        label={_('company_backend.action.backCompanies')}
        href={options.companiesHref}
        variant="secondary"
      />,
      <LinkButton label={_('company_backend.action.create')} href={options.createHref} variant="primary" />,
    ])}
    body={
      options.rows.length === 0
        ? emptyState(_('company_backend.screen.empty'), _('company_backend.screen.emptyHint'))
        : dataTable(_, {
            rows: options.rows,
            id: (row) => row.id,
            rowHref: (row) => row.detailHref,
            columns: [
              {
                key: 'name',
                label: _('company_backend.field.name'),
                priority: 'primary',
                width: 'wide',
                cell: (row) => `${'— '.repeat(row.depth)}${row.name}`,
              },
              {
                key: 'code',
                label: _('company_backend.field.code'),
                kind: 'identifier',
                cell: (row) => code(row.code, 'identifier'),
              },
              {
                key: 'parent',
                label: _('company_backend.field.parent'),
                cell: (row) => row.parentName ?? '—',
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
            ],
          })
    }
  />
)
