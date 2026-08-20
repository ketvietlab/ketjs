import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import {
  badge,
  dataTable,
  definitionList,
  emptyState,
  framed,
  notice,
  qrCode,
  recordActions,
  recordForm,
  section,
  stack,
  surface,
} from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'
import { qrMatrix } from './qr.ts'
type R = Record<string, unknown>

export const myWorkScreen = (
  _: Translator,
  frame: Frame,
  profile: R | null,
  sessions: R[],
  shifts: R[],
  leaves: R[],
  message?: string,
): TemplateResult =>
  framed(
    _,
    _('attendance_backend.my.title'),
    frame,
    stack([
      ...(message ? [notice({ title: _('attendance_backend.result.title'), message, tone: 'info' })] : []),
      surface({
        body: recordActions({
          action: '/my/work',
          actions: [{ value: 'punch', label: _('attendance_backend.action.punch'), variant: 'primary' }],
        }),
      }),
      section({
        title: _('attendance_backend.my.profile'),
        body: profile
          ? definitionList({
              title: _('attendance_backend.my.profile'),
              items: [
                {
                  key: 'code',
                  term: _('attendance_backend.field.employee'),
                  value: `${profile.code} · ${profile.name}`,
                },
                {
                  key: 'branch',
                  term: _('attendance_backend.field.branch'),
                  value: String(profile.homeBranchId),
                },
              ],
            })
          : emptyState(_('attendance_backend.empty.profile'), _('attendance_backend.empty.profileHint')),
      }),
      section({
        title: _('attendance_backend.my.schedule'),
        body: shifts.length
          ? dataTable(_, {
              rows: shifts,
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
                { key: 'stop', label: _('attendance_backend.field.stop'), cell: (row) => String(row.stopAt) },
              ],
            })
          : emptyState(_('attendance_backend.empty.schedule'), _('attendance_backend.empty.scheduleHint')),
      }),
      section({
        title: _('attendance_backend.my.sessions'),
        body: sessions.length
          ? dataTable(_, {
              rows: sessions,
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
                  cell: (row) =>
                    badge(
                      _(`attendance_backend.state.${row.state}`),
                      row.state === 'closed' ? 'positive' : 'warning',
                    ),
                },
              ],
            })
          : emptyState(_('attendance_backend.empty.sessions'), _('attendance_backend.empty.sessionsHint')),
      }),
      section({
        title: _('attendance_backend.my.leave'),
        body: stack([
          surface({
            body: recordForm({
              action: '/my/work',
              hidden: { action: 'leave' },
              submit: _('attendance_backend.action.requestLeave'),
              submitVariant: 'secondary',
              fields: [
                { name: 'leaveTypeId', label: _('attendance_backend.field.leaveType'), required: true },
                {
                  name: 'dateFrom',
                  label: _('attendance_backend.field.dateFrom'),
                  type: 'date',
                  required: true,
                },
                { name: 'dateTo', label: _('attendance_backend.field.dateTo'), type: 'date', required: true },
                {
                  name: 'portion',
                  label: _('attendance_backend.field.portion'),
                  type: 'select',
                  options: [
                    { value: 'full', label: _('attendance_backend.portion.full') },
                    { value: 'morning', label: _('attendance_backend.portion.morning') },
                    { value: 'afternoon', label: _('attendance_backend.portion.afternoon') },
                  ],
                },
                { name: 'reason', label: _('attendance_backend.field.reason') },
              ],
            }),
          }),
          ...(leaves.length
            ? [
                dataTable(_, {
                  rows: leaves,
                  id: (row) => String(row.id),
                  columns: [
                    {
                      key: 'range',
                      label: _('attendance_backend.field.date'),
                      cell: (row) => `${row.dateFrom} – ${row.dateTo}`,
                    },
                    {
                      key: 'state',
                      label: _('attendance_backend.field.state'),
                      cell: (row) => String(row.state),
                    },
                  ],
                }),
              ]
            : []),
        ]),
      }),
    ]),
  )

export const kioskScreen = (_: Translator, kioskSecret: string, result?: R): TemplateResult =>
  stack([
    section({
      title: _('attendance_backend.kiosk.title'),
      description: _('attendance_backend.kiosk.hint'),
      body: stack([
        ...(result
          ? [
              notice({
                title: result.ok
                  ? _('attendance_backend.result.success')
                  : _('attendance_backend.result.failed'),
                message: result.ok
                  ? _(`attendance_backend.punch.${result.kind}`)
                  : _('attendance_backend.error.credential'),
                tone: result.ok ? 'positive' : 'danger',
              }),
            ]
          : []),
        surface({
          body: recordForm({
            action: `/attendance/kiosk/${encodeURIComponent(kioskSecret)}`,
            submit: _('attendance_backend.action.punch'),
            submitVariant: 'primary',
            fields: [
              { name: 'employeeCode', label: _('attendance_backend.field.employeeCode') },
              { name: 'pin', label: _('attendance_backend.field.pin'), type: 'password' },
              { name: 'qr', label: _('attendance_backend.field.qr') },
            ],
          }),
        }),
      ]),
    }),
  ])

export const periodScreen = (
  _: Translator,
  frame: Frame,
  month: string,
  period: R | null,
): TemplateResult => {
  const entries = (period?.entries as R[] | undefined) ?? []
  return framed(
    _,
    _('attendance_backend.admin.title'),
    frame,
    stack([
      surface({
        body: recordForm({
          action: '/admin/attendance',
          submit: _('attendance_backend.action.openPeriod'),
          submitVariant: 'secondary',
          fields: [
            { name: 'month', label: _('attendance_backend.field.month'), value: month, required: true },
          ],
        }),
      }),
      ...(period
        ? [
            notice({
              title: _('attendance_backend.period.state'),
              message: _(`attendance_backend.state.${period.state}`),
              tone: period.state === 'locked' ? 'positive' : 'info',
            }),
            surface({
              body: recordActions({
                action: `/admin/attendance?month=${encodeURIComponent(month)}`,
                actions:
                  period.state === 'locked'
                    ? [
                        {
                          value: 'reopen',
                          label: _('attendance_backend.action.reopen'),
                          variant: 'secondary',
                        },
                      ]
                    : [{ value: 'close', label: _('attendance_backend.action.close'), variant: 'primary' }],
              }),
            }),
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
              : emptyState(_('attendance_backend.empty.entries'), _('attendance_backend.empty.entriesHint')),
          ]
        : []),
    ]),
  )
}

export const credentialScreen = (_: Translator, frame: Frame, result?: R): TemplateResult =>
  framed(
    _,
    _('attendance_backend.credentials.title'),
    frame,
    stack([
      ...(result?.secret
        ? [
            notice({
              title: _('attendance_backend.credentials.once'),
              message: String(result.secret),
              tone: 'warning',
            }),
          ]
        : []),
      ...(result?.secret && result.credentialKind === 'qr'
        ? [qrCode(qrMatrix(String(result.secret)), _('attendance_backend.credentials.qr'))]
        : []),
      section({
        title: _('attendance_backend.credentials.kiosk'),
        body: surface({
          body: recordForm({
            action: '/admin/attendance/credentials',
            hidden: { action: 'kiosk' },
            submit: _('attendance_backend.action.issue'),
            submitVariant: 'primary',
            fields: [
              { name: 'name', label: _('attendance_backend.field.name'), required: true },
              { name: 'branchId', label: _('attendance_backend.field.branch'), required: true },
            ],
          }),
        }),
      }),
      section({
        title: _('attendance_backend.credentials.pin'),
        body: surface({
          body: recordForm({
            action: '/admin/attendance/credentials',
            hidden: { action: 'pin' },
            submit: _('attendance_backend.action.savePin'),
            submitVariant: 'secondary',
            fields: [
              { name: 'employeeId', label: _('attendance_backend.field.employee'), required: true },
              { name: 'pin', label: _('attendance_backend.field.pin'), type: 'password', required: true },
            ],
          }),
        }),
      }),
      section({
        title: _('attendance_backend.credentials.qr'),
        body: surface({
          body: recordForm({
            action: '/admin/attendance/credentials',
            hidden: { action: 'qr' },
            submit: _('attendance_backend.action.issueQr'),
            submitVariant: 'secondary',
            fields: [{ name: 'employeeId', label: _('attendance_backend.field.employee'), required: true }],
          }),
        }),
      }),
    ]),
  )
