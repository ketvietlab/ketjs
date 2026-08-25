import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import { badge, code, dataTable, emptyState, PartnerListLayout, shell } from '../../../ui/index.ts'
import type { DataTable, Frame } from '../../../ui/index.ts'
import { localized } from '../../backend/screen.ts'
import type { PartnerListRow, PartnerListSummary } from './types.ts'

const tableFor = (
  _: Translator,
  rows: PartnerListRow[],
  table: Partial<DataTable<PartnerListRow>>,
  locale: string,
) =>
  dataTable(_, {
    rows,
    id: (row) => row.id,
    gutter: 'compact',
    rowHref: (row) => localized(`/admin/partner/partners/${row.id}`, locale),
    rowLink: false,
    columns: [
      { key: 'name', label: _('partner_backend.field.name'), priority: 'primary', cell: (row) => row.name },
      {
        key: 'kind',
        label: _('partner_backend.field.kind'),
        kind: 'status',
        cell: (row) => badge(_(`partner.kind.${row.kind}`), row.kind === 'company' ? 'info' : 'neutral'),
      },
      { key: 'email', label: _('partner_backend.field.email'), cell: (row) => row.email || '—' },
      { key: 'phone', label: _('partner_backend.field.phone'), cell: (row) => row.phone || '—' },
      {
        key: 'ref',
        label: _('partner_backend.field.ref'),
        kind: 'identifier',
        optional: true,
        cell: (row) => (row.ref ? code(row.ref, 'identifier') : '—'),
      },
      {
        key: 'state',
        label: _('partner_backend.field.state'),
        kind: 'status',
        cell: (row) =>
          badge(
            row.active ? _('partner_backend.state.active') : _('partner_backend.state.archived'),
            row.active ? 'positive' : 'neutral',
          ),
      },
    ],
    ...table,
  })

export const partnersScreen = (
  _: Translator,
  rows: PartnerListRow[],
  frame: Frame,
  table: Partial<DataTable<PartnerListRow>> = {},
  locale = '',
  summary?: PartnerListSummary,
): TemplateResult =>
  shell(
    _,
    _('partner_backend.screen.title'),
    rows.length === 0 ? (
      emptyState(_('partner_backend.screen.empty'), _('partner_backend.screen.emptyHint'))
    ) : summary ? (
      <PartnerListLayout
        title={_('partner_backend.list.summary')}
        tabs={[
          {
            id: 'all',
            label: _('partner_backend.list.all'),
            count: summary.total,
            href: summary.allHref,
            active: summary.active === 'all',
          },
          {
            id: 'customers',
            label: _('partner_backend.filter.customers'),
            count: summary.customers,
            href: summary.customersHref,
            active: summary.active === 'customers',
          },
          {
            id: 'suppliers',
            label: _('partner_backend.filter.suppliers'),
            count: summary.suppliers,
            href: summary.suppliersHref,
            active: summary.active === 'suppliers',
          },
          {
            id: 'archived',
            label: _('partner_backend.filter.includeArchived'),
            count: summary.archived,
            href: summary.archivedHref,
            active: summary.active === 'archived',
          },
        ]}
        stats={[
          { label: _('partner_backend.list.total'), value: summary.total },
          { label: _('partner_backend.filter.customers'), value: summary.customers },
          { label: _('partner_backend.filter.suppliers'), value: summary.suppliers },
          { label: _('partner_backend.filter.includeArchived'), value: summary.archived },
        ]}
        table={tableFor(_, rows, table, locale)}
      />
    ) : (
      tableFor(_, rows, table, locale)
    ),
    frame,
  )
