import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  dataTable,
  emptyState,
  RecordScreen,
  LinkButton,
  Notice,
  RecordActions,
  RecordForm,
  Section,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

type R = Record<string, unknown>

export type PeriodScreenOptions = {
  action: string
  errors?: readonly string[]
  exportHref?: string
  lang?: string
  month: string
  period: R | null
  workflowAction: string
}

/**
 * A monthly attendance period is one operational workspace: changing the month,
 * reviewing computed work entries, and locking or reopening that snapshot all
 * need the same context. It is deliberately specialized instead of pretending
 * that each work entry is an independent CRUD row.
 */
export const periodScreen = (
  _: Translator,
  options: PeriodScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const entries = (options.period?.entries as R[] | undefined) ?? []
  const state = String(options.period?.state ?? '')
  return (
    <RecordScreen
      translator={_}
      title={_('attendance_backend.admin.title')}
      subtitle={_('attendance_backend.admin.subtitle')}
      frame={frame}
      actions={
        options.exportHref ? (
          <LinkButton
            href={options.exportHref}
            label={_('attendance_backend.action.export')}
            variant="secondary"
          />
        ) : undefined
      }
      body={stack([
        <Section
          title={_('attendance_backend.field.month')}
          body={
            <Surface
              body={
                <RecordForm
                  action={options.action}
                  method="get"
                  errors={options.errors}
                  hidden={options.lang ? { lang: options.lang } : undefined}
                  submit={_('attendance_backend.action.openPeriod')}
                  submitVariant="secondary"
                  layout="inline"
                  fields={[
                    {
                      name: 'month',
                      label: _('attendance_backend.field.month'),
                      type: 'month',
                      value: options.month,
                      required: true,
                    },
                  ]}
                />
              }
            />
          }
        />,
        ...(options.period
          ? [
              <Section
                title={`${String(options.period.month)} · ${String(options.period.timezone)}`}
                actions={
                  <RecordActions
                    action={options.workflowAction}
                    hidden={{
                      month: String(options.period.month),
                      expectedVersion: String(options.period.version),
                    }}
                    actions={
                      state === 'locked'
                        ? [
                            {
                              value: 'reopen',
                              label: _('attendance_backend.action.reopen'),
                              variant: 'secondary',
                            },
                          ]
                        : [
                            {
                              value: 'close',
                              label: _('attendance_backend.action.close'),
                              variant: 'primary',
                            },
                          ]
                    }
                  />
                }
                body={
                  <Notice
                    title={_('attendance_backend.period.state')}
                    message={_(`attendance_backend.state.${state}`)}
                    tone={state === 'locked' ? 'positive' : 'info'}
                  />
                }
              />,
              <Section
                title={_('attendance_backend.period.entries')}
                description={`${_('attendance_backend.period.entryCount')}: ${String(entries.length)}`}
                body={
                  entries.length
                    ? dataTable(_, {
                        rows: entries,
                        id: (row) => String(row.id),
                        columns: [
                          {
                            key: 'employee',
                            label: _('attendance_backend.field.employee'),
                            cell: (row) => String(row.employeeId),
                            priority: 'primary',
                          },
                          {
                            key: 'date',
                            label: _('attendance_backend.field.date'),
                            cell: (row) => String(row.localDate),
                          },
                          {
                            key: 'planned',
                            label: _('attendance_backend.field.planned'),
                            cell: (row) => String(row.plannedMinutes),
                          },
                          {
                            key: 'worked',
                            label: _('attendance_backend.field.worked'),
                            cell: (row) => String(row.workedMinutes),
                          },
                          {
                            key: 'overtime',
                            label: _('attendance_backend.field.overtime'),
                            cell: (row) => String(row.approvedOvertimeMinutes),
                          },
                          {
                            key: 'exception',
                            label: _('attendance_backend.field.exception'),
                            cell: (row) => String(row.exception ?? '—'),
                          },
                        ],
                      })
                    : emptyState(
                        _('attendance_backend.empty.entries'),
                        _('attendance_backend.empty.entriesHint'),
                      )
                }
              />,
            ]
          : []),
      ])}
    />
  )
}
