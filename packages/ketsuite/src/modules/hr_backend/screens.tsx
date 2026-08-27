import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  Framed,
  RecordActions,
  RecordForm,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'

type R = Record<string, unknown>

const stateBadge = (_: Translator, value: unknown) => {
  const state = String(value ?? '')
  return badge(
    _(`hr_backend.state.${state}`),
    state === 'published' || state === 'approved' ? 'positive' : state === 'rejected' ? 'danger' : 'neutral',
  )
}

export const rosterScreen = (
  _: Translator,
  frame: Frame,
  rows: R[],
  branchId: string,
  weekStart: string,
  errors: string[] = [],
): TemplateResult => {
  const roster = rows[0]
  const shifts = (roster?.shifts as R[] | undefined) ?? []
  return (
    <Framed
      translator={_}
      title={_('hr_backend.roster.title')}
      frame={frame}
      body={stack([
        <Section
          title={_('hr_backend.roster.generate')}
          body={
            <Surface
              body={
                <RecordForm
                  action="/admin/hr/roster"
                  errors={errors}
                  submit={_('hr_backend.action.generate')}
                  submitVariant="primary"
                  fields={[
                    {
                      name: 'branchId',
                      label: _('hr_backend.field.branchId'),
                      value: branchId,
                      required: true,
                    },
                    {
                      name: 'weekStart',
                      label: _('hr_backend.field.weekStart'),
                      type: 'date',
                      value: weekStart,
                      required: true,
                    },
                  ]}
                />
              }
            />
          }
        />,
        ...(roster
          ? [
              <Section
                title={`${_('hr_backend.roster.week')} ${String(roster.weekStart)}`}
                description={_('hr_backend.roster.hint')}
                body={stack([
                  stateBadge(_, roster.state),
                  <Surface
                    body={
                      <RecordActions
                        action={`/admin/hr/roster?id=${encodeURIComponent(String(roster.id))}&version=${encodeURIComponent(String(roster.version))}&branch=${encodeURIComponent(branchId)}&week=${encodeURIComponent(weekStart)}`}
                        actions={
                          roster.state === 'published'
                            ? [
                                {
                                  value: 'reopen',
                                  label: _('hr_backend.action.reopen'),
                                  variant: 'secondary',
                                },
                              ]
                            : [
                                {
                                  value: 'publish',
                                  label: _('hr_backend.action.publish'),
                                  variant: 'primary',
                                },
                              ]
                        }
                      />
                    }
                  />,
                ])}
              />,
              shifts.length
                ? dataTable(_, {
                    rows: shifts,
                    id: (row) => String(row.id),
                    columns: [
                      {
                        key: 'employee',
                        label: _('hr_backend.field.employee'),
                        cell: (row) => String(row.employeeName),
                        priority: 'primary',
                      },
                      {
                        key: 'date',
                        label: _('hr_backend.field.date'),
                        cell: (row) => String(row.localDate),
                      },
                      {
                        key: 'start',
                        label: _('hr_backend.field.startAt'),
                        cell: (row) => String(row.startAt),
                      },
                      { key: 'stop', label: _('hr_backend.field.stopAt'), cell: (row) => String(row.stopAt) },
                    ],
                  })
                : emptyState(_('hr_backend.empty.shifts'), _('hr_backend.empty.shiftsHint')),
            ]
          : []),
      ])}
    />
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
