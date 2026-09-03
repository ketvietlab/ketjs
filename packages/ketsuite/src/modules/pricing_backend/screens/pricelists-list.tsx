import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { badge, code, dataTable, emptyState, inline, LinkButton, ListPage, shell } from '../../../ui/index.ts'
import type { Column, Frame } from '../../../ui/index.ts'
import { pricingSelectionLabel } from './shared.ts'
import type { PricelistRow } from './shared.ts'

export type PricelistsScreenOptions = {
  rows: readonly PricelistRow[]
  createHref: string
}

export const pricelistColumns = (_: Translator): Array<Column<PricelistRow>> => [
  { key: 'name', label: _('pricing_backend.col.name'), cell: (row) => row.name, priority: 'primary' },
  { key: 'currency', label: _('pricing_backend.col.currency'), cell: (row) => row.currency },
  {
    key: 'state',
    label: _('pricing_backend.col.state'),
    kind: 'status',
    cell: (row) => badge(pricingSelectionLabel(_, 'state', row.state), 'neutral', row.state),
  },
  { key: 'sequence', label: _('pricing_backend.col.sequence'), cell: (row) => row.sequence },
  { key: 'id', label: _('backend.table.id'), cell: (row) => code(row.id), optional: true },
]

export const pricelistsScreen = (
  _: Translator,
  frame: Frame,
  options: PricelistsScreenOptions,
): TemplateResult =>
  shell(
    _,
    _('pricing_backend.title'),
    <ListPage
      variant="operational"
      frame={frame}
      title={_('pricing_backend.title')}
      description={_('pricing_backend.subtitle')}
      actions={inline([
        <LinkButton label={_('pricing_backend.action.create')} href={options.createHref} variant="primary" />,
        frame.extras?.['topbar.end'] ?? '',
      ])}
      status={`${_('pricing_backend.title')}: ${String(options.rows.length)}`}
      body={
        options.rows.length
          ? dataTable(_, {
              columns: pricelistColumns(_),
              rows: options.rows,
              id: (row) => row.id,
              rowHref: (row) => row.detailHref,
            })
          : emptyState(_('pricing_backend.empty'), _('pricing_backend.emptyHint'))
      }
    />,
    { ...frame, chrome: null, topbar: false },
  )
