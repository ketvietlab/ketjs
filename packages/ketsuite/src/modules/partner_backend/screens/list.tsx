import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import {
  badge,
  bulkActions,
  code,
  CollectionTabs,
  dataTable,
  emptyState,
  inline,
  LinkButton,
  ListPage,
  listChrome,
  person,
  shell,
  stack,
} from '../../../ui/index.ts'
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
    rowHref: (row) => localized(`/admin/partner/partners/${row.id}`, locale),
    rowLink: false,
    columns: [
      {
        key: 'name',
        label: _('partner_backend.field.name'),
        priority: 'primary',
        width: 'wide',
        cell: (row) => person(row.name),
      },
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
  total = rows.length,
): TemplateResult =>
  shell(
    _,
    _('partner_backend.screen.title'),
    <ListPage
      title={_('partner_backend.screen.title')}
      description={_('partner_backend.screen.description')}
      actions={
        frame.chrome?.create || frame.chrome?.selection || frame.extras?.['topbar.end'] !== undefined
          ? inline([
              frame.chrome?.create ? (
                <LinkButton
                  label={frame.chrome.create.label}
                  href={frame.chrome.create.path}
                  variant="primary"
                />
              ) : (
                ''
              ),
              frame.chrome?.selection ? bulkActions(_, frame.chrome.selection) : '',
              frame.extras?.['topbar.end'] ?? '',
            ])
          : undefined
      }
      controls={
        frame.chrome
          ? listChrome(
              _,
              _('partner_backend.screen.title'),
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
      status={_('partner_backend.screen.results', { count: total })}
      body={
        summary
          ? stack(
              [
                <CollectionTabs
                  label={_('partner_backend.list.summary')}
                  items={[
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
                />,
                rows.length
                  ? tableFor(_, rows, table, locale)
                  : emptyState(_('partner_backend.screen.empty'), _('partner_backend.screen.emptyHint')),
              ],
              'compact',
            )
          : rows.length
            ? tableFor(_, rows, table, locale)
            : emptyState(_('partner_backend.screen.empty'), _('partner_backend.screen.emptyHint'))
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
