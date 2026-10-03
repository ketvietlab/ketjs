import type { Translator, Row } from '@ketvietlab/ketjs'
import {
  WorkspacePage,
  CardGrid,
  Metric,
  Section,
  LinkButton,
  collectionTable as dataTable,
  emptyState,
  shell,
  stack,
} from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'
export const stockOverviewScreen = (
  _: Translator,
  frame: Frame,
  options: {
    rows: Row[]
    at: (path: string) => string
    rowHref: (row: Row) => string
    createHref: string | null
  },
) => {
  const title = _('stock_backend.overview.title')
  const open = options.rows.filter((row) => !['done', 'cancel'].includes(String(row.state)))
  return shell(
    _,
    title,
    <WorkspacePage
      variant="operational"
      frame={frame}
      title={title}
      actions={
        options.createHref ? (
          <LinkButton label={_('stock_backend.action.create')} href={options.createHref} variant="primary" />
        ) : undefined
      }
      body={stack([
        <CardGrid
          items={[
            { id: 'draft', states: ['draft'] },
            { id: 'waiting', states: ['waiting', 'confirmed', 'partially_available'] },
            { id: 'ready', states: ['assigned', 'reserved'] },
          ].map((item) => ({
            ...item,
            label: _(`stock_backend.state.${item.id === 'ready' ? 'assigned' : item.id}`),
            value: open.filter((row) => item.states.includes(String(row.state))).length,
          }))}
          id={(item) => item.id}
          card={(item) => (
            <Metric
              label={item.label}
              value={String(item.value)}
              href={options.at(`/admin/stock/transfers?preset=${item.id}`)}
            />
          )}
        />,
        <Section
          title={_('stock_backend.overview.queue')}
          actions={
            <LinkButton label={_('stock_backend.transfers')} href={options.at('/admin/stock/transfers')} />
          }
          body={
            open.length
              ? dataTable(_, {
                  rows: open.slice(0, 10),
                  id: (r) => String(r.id),
                  rowHref: options.rowHref,
                  columns: [
                    {
                      key: 'name',
                      label: _('stock_backend.transfer.list.col.reference'),
                      cell: (r) => String(r.name),
                      priority: 'primary',
                    },
                    {
                      key: 'operationType',
                      label: _('stock_backend.transfer.list.col.operationType'),
                      cell: (r) => String(r.operationType ?? '—'),
                      wrap: true,
                    },
                    {
                      key: 'source',
                      label: _('stock_backend.transfer.list.col.source'),
                      cell: (r) => `${r.source ?? '—'} → ${r.destination ?? '—'}`,
                      wrap: true,
                    },
                    {
                      key: 'scheduledDate',
                      label: _('stock_backend.transfer.list.col.scheduledDate'),
                      cell: (r) => String(r.scheduledDate || '—'),
                      kind: 'date',
                    },
                    {
                      key: 'state',
                      label: _('stock_backend.transfer.list.col.state'),
                      cell: (r) => _(`stock_backend.state.${r.state}`),
                    },
                  ],
                })
              : emptyState(_('stock_backend.overview.empty'), '')
          }
        />,
      ])}
    />,
    { ...frame, topbar: false },
  )
}
