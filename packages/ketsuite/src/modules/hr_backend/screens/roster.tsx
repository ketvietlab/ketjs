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
} from '../../../ui/index.ts'
import type { Frame } from '../../../ui/index.ts'

type R = Record<string, unknown>

export type RosterScreenOptions = {
  action: string
  branchId: string
  errors?: readonly string[]
  rows: readonly R[]
  weekStart: string
  workflowAction: (roster: R) => string
}

const rosterStateBadge = (_: Translator, value: unknown) => {
  const state = String(value ?? '')
  return badge(_(`hr_backend.state.${state}`), state === 'published' ? 'positive' : 'neutral', state)
}

/**
 * Weekly roster is an operational planner, not a CRUD record form. Keep the
 * generation parameters, lifecycle command, and shift grid in one workspace.
 */
export const rosterScreen = (
  _: Translator,
  options: RosterScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const roster = options.rows[0]
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
                  action={options.action}
                  errors={options.errors}
                  submit={_('hr_backend.action.generate')}
                  submitVariant="primary"
                  fields={[
                    {
                      name: 'branchId',
                      label: _('hr_backend.field.branchId'),
                      value: options.branchId,
                      required: true,
                    },
                    {
                      name: 'weekStart',
                      label: _('hr_backend.field.weekStart'),
                      type: 'date',
                      value: options.weekStart,
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
                  rosterStateBadge(_, roster.state),
                  <Surface
                    body={
                      <RecordActions
                        action={options.workflowAction(roster)}
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
                      {
                        key: 'stop',
                        label: _('hr_backend.field.stopAt'),
                        cell: (row) => String(row.stopAt),
                      },
                    ],
                  })
                : emptyState(_('hr_backend.empty.shifts'), _('hr_backend.empty.shiftsHint')),
            ]
          : []),
      ])}
    />
  )
}
