import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { badge, dataTable, emptyState, Framed, RecordActions } from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'

type R = Record<string, unknown>

const stateBadge = (_: Translator, value: unknown) => {
  const state = String(value ?? '')
  return badge(
    _(`hr_backend.state.${state}`),
    state === 'published' || state === 'approved' ? 'positive' : state === 'rejected' ? 'danger' : 'neutral',
  )
}

export const leavesScreen = (_: Translator, frame: Frame, rows: R[]): TemplateResult => (
  <Framed
    translator={_}
    title={_('hr_backend.leaves.title')}
    frame={frame}
    body={
      rows.length
        ? dataTable(_, {
            rows,
            id: (row) => String(row.id),
            columns: [
              {
                key: 'employee',
                label: _('hr_backend.field.employee'),
                cell: (row) => String(row.employeeId),
                priority: 'primary',
              },
              {
                key: 'range',
                label: _('hr_backend.field.date'),
                cell: (row) => `${row.dateFrom} – ${row.dateTo}`,
              },
              { key: 'days', label: _('hr_backend.field.days'), cell: (row) => String(row.requestedDays) },
              { key: 'state', label: _('hr_backend.field.state'), cell: (row) => stateBadge(_, row.state) },
              {
                key: 'actions',
                label: _('hr_backend.field.actions'),
                cell: (row) =>
                  row.state === 'requested' ? (
                    <RecordActions
                      action={`/admin/hr/leaves?id=${encodeURIComponent(String(row.id))}`}
                      actions={[
                        { value: 'approved', label: _('hr_backend.action.approve'), variant: 'primary' },
                        { value: 'rejected', label: _('hr_backend.action.reject'), variant: 'destructive' },
                      ]}
                    />
                  ) : (
                    ''
                  ),
              },
            ],
          })
        : emptyState(_('hr_backend.empty.leaves'), _('hr_backend.empty.leavesHint'))
    }
  />
)
