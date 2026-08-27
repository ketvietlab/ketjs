import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  DefinitionList,
  emptyState,
  Framed,
  inline,
  LinkButton,
  modalForm,
  Notice,
  RecordForm,
  Section,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { Frame, NoticeTone } from '../../../ui/index.ts'

type R = Record<string, unknown>

export type LeaveRequestValues = {
  leaveTypeId?: string
  dateFrom?: string
  dateTo?: string
  portion?: string
  reason?: string
}

export type MyWorkScreenOptions = {
  action: string
  clock: R
  leaveHref: string
  leaves: R[]
  message?: { text: string; tone?: NoticeTone }
  profile: R | null
  sessions: R[]
  shifts: R[]
}

export type LeaveRequestModalOptions = {
  action: string
  cancelHref: string
  errors?: readonly string[]
  values?: LeaveRequestValues
}

const sessionState = (_: Translator, state: unknown) => {
  const value = String(state ?? '')
  return badge(_(`attendance_backend.state.${value}`), value === 'closed' ? 'positive' : 'warning', value)
}

const leaveState = (_: Translator, state: unknown) => {
  const value = String(state ?? '')
  return badge(
    _(`attendance_backend.leaveState.${value}`),
    value === 'approved'
      ? 'positive'
      : value === 'rejected'
        ? 'danger'
        : value === 'requested'
          ? 'warning'
          : 'neutral',
    value,
  )
}

export const leaveRequestModal = (_: Translator, options: LeaveRequestModalOptions): TemplateResult => {
  const values = options.values ?? {}
  return modalForm({
    id: 'attendance-leave-request',
    title: _('attendance_backend.my.leaveRequest'),
    description: _('attendance_backend.my.leaveHint'),
    closeHref: options.cancelHref,
    closeLabel: _('attendance_backend.action.cancel'),
    size: 'large',
    form: {
      id: 'attendance-leave-request-form',
      scope: 'attendance-leave-request',
      action: options.action,
      cancelHref: options.cancelHref,
      cancelLabel: _('attendance_backend.action.cancel'),
      errors: options.errors,
      hidden: { action: 'leave' },
      submit: _('attendance_backend.action.requestLeave'),
      submitVariant: 'primary',
      fields: [
        {
          name: 'leaveTypeId',
          label: _('attendance_backend.field.leaveType'),
          value: values.leaveTypeId,
          required: true,
        },
        {
          name: 'dateFrom',
          label: _('attendance_backend.field.dateFrom'),
          type: 'date',
          value: values.dateFrom,
          required: true,
        },
        {
          name: 'dateTo',
          label: _('attendance_backend.field.dateTo'),
          type: 'date',
          value: values.dateTo,
          required: true,
        },
        {
          name: 'portion',
          label: _('attendance_backend.field.portion'),
          type: 'select',
          value: values.portion || 'full',
          options: [
            { value: 'full', label: _('attendance_backend.portion.full') },
            { value: 'morning', label: _('attendance_backend.portion.morning') },
            { value: 'afternoon', label: _('attendance_backend.portion.afternoon') },
          ],
        },
        {
          name: 'reason',
          label: _('attendance_backend.field.reason'),
          value: values.reason,
        },
      ],
    },
  })
}

/** My Work is one employee task surface: clock state, schedule, attendance, and leave stay together. */
export const myWorkScreen = (
  _: Translator,
  options: MyWorkScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const onClock = options.clock.onClock === true
  return (
    <Framed
      translator={_}
      title={_('attendance_backend.my.title')}
      frame={frame}
      body={stack([
        ...(options.message
          ? [
              <Notice
                title={_('attendance_backend.result.title')}
                message={options.message.text}
                tone={options.message.tone ?? 'info'}
              />,
            ]
          : []),
        <Section
          title={_('attendance_backend.my.clock')}
          description={
            onClock && options.clock.startAt
              ? `${_('attendance_backend.my.clockSince')} ${String(options.clock.startAt)}`
              : null
          }
          actions={
            <RecordForm
              action={options.action}
              hidden={{ action: 'punch', expect: onClock ? 'out' : 'in' }}
              fields={[]}
              submit={
                onClock ? _('attendance_backend.action.clockOut') : _('attendance_backend.action.clockIn')
              }
              submitVariant="primary"
              submitSize="compact"
              layout="inline"
            />
          }
          body={
            <Surface
              padding="compact"
              body={inline([
                badge(
                  onClock ? _('attendance_backend.clock.on') : _('attendance_backend.clock.off'),
                  onClock ? 'warning' : 'neutral',
                  onClock ? 'on' : 'off',
                ),
                onClock && options.clock.branchId ? String(options.clock.branchId) : '',
              ])}
            />
          }
        />,
        <Section
          title={_('attendance_backend.my.profile')}
          body={
            options.profile ? (
              <DefinitionList
                title={_('attendance_backend.my.profile')}
                items={[
                  {
                    key: 'code',
                    term: _('attendance_backend.field.employee'),
                    value: `${options.profile.code} · ${options.profile.name}`,
                  },
                  {
                    key: 'branch',
                    term: _('attendance_backend.field.branch'),
                    value: String(options.profile.homeBranchId),
                  },
                  {
                    key: 'timezone',
                    term: _('attendance_backend.field.timezone'),
                    value: String(options.profile.timezone),
                  },
                ]}
              />
            ) : (
              emptyState(_('attendance_backend.empty.profile'), _('attendance_backend.empty.profileHint'))
            )
          }
        />,
        <Section
          title={_('attendance_backend.my.schedule')}
          body={
            options.shifts.length
              ? dataTable(_, {
                  rows: options.shifts,
                  id: (row) => String(row.id),
                  columns: [
                    {
                      key: 'date',
                      label: _('attendance_backend.field.date'),
                      cell: (row) => String(row.localDate),
                      priority: 'primary',
                    },
                    {
                      key: 'start',
                      label: _('attendance_backend.field.start'),
                      cell: (row) => String(row.startAt),
                    },
                    {
                      key: 'stop',
                      label: _('attendance_backend.field.stop'),
                      cell: (row) => String(row.stopAt),
                    },
                  ],
                })
              : emptyState(_('attendance_backend.empty.schedule'), _('attendance_backend.empty.scheduleHint'))
          }
        />,
        <Section
          title={_('attendance_backend.my.sessions')}
          body={
            options.sessions.length
              ? dataTable(_, {
                  rows: options.sessions,
                  id: (row) => String(row.id),
                  columns: [
                    {
                      key: 'start',
                      label: _('attendance_backend.field.start'),
                      cell: (row) => String(row.correctedStartAt ?? row.startAt),
                      priority: 'primary',
                    },
                    {
                      key: 'stop',
                      label: _('attendance_backend.field.stop'),
                      cell: (row) => String(row.correctedStopAt ?? row.stopAt ?? '—'),
                    },
                    {
                      key: 'state',
                      label: _('attendance_backend.field.state'),
                      cell: (row) => sessionState(_, row.state),
                    },
                  ],
                })
              : emptyState(_('attendance_backend.empty.sessions'), _('attendance_backend.empty.sessionsHint'))
          }
        />,
        <Section
          title={_('attendance_backend.my.leave')}
          actions={
            <LinkButton
              label={_('attendance_backend.action.requestLeave')}
              href={options.leaveHref}
              variant="secondary"
              size="compact"
            />
          }
          body={
            options.leaves.length
              ? dataTable(_, {
                  rows: options.leaves,
                  id: (row) => String(row.id),
                  columns: [
                    {
                      key: 'type',
                      label: _('attendance_backend.field.leaveType'),
                      cell: (row) => String(row.leaveTypeId),
                      priority: 'primary',
                    },
                    {
                      key: 'range',
                      label: _('attendance_backend.field.date'),
                      cell: (row) => `${row.dateFrom} – ${row.dateTo}`,
                    },
                    {
                      key: 'days',
                      label: _('attendance_backend.field.days'),
                      cell: (row) => String(row.requestedDays),
                      align: 'end',
                    },
                    {
                      key: 'state',
                      label: _('attendance_backend.field.state'),
                      cell: (row) => leaveState(_, row.state),
                    },
                  ],
                })
              : emptyState(_('attendance_backend.empty.leaves'), _('attendance_backend.empty.leavesHint'))
          }
        />,
      ])}
    />
  )
}
