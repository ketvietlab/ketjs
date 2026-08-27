import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  dataTable,
  emptyState,
  Framed,
  Notice,
  qrCode,
  RecordActions,
  RecordForm,
  Section,
  stack,
  Surface,
} from '../../ui/index.ts'
import type { Frame } from '../../ui/index.ts'
import { qrMatrix } from './qr.ts'

type R = Record<string, unknown>

export const kioskScreen = (_: Translator, kioskSecret: string, result?: R): TemplateResult =>
  stack([
    <Section
      title={_('attendance_backend.kiosk.title')}
      description={_('attendance_backend.kiosk.hint')}
      body={stack([
        ...(result
          ? [
              <Notice
                title={
                  result.ok ? _('attendance_backend.result.success') : _('attendance_backend.result.failed')
                }
                message={
                  result.ok
                    ? _(`attendance_backend.punch.${result.kind}`)
                    : _('attendance_backend.error.credential')
                }
                tone={result.ok ? 'positive' : 'danger'}
              />,
            ]
          : []),
        <Surface
          body={
            <RecordForm
              action={`/attendance/kiosk/${encodeURIComponent(kioskSecret)}`}
              submit={_('attendance_backend.action.punch')}
              submitVariant="primary"
              fields={[
                { name: 'employeeCode', label: _('attendance_backend.field.employeeCode') },
                { name: 'pin', label: _('attendance_backend.field.pin'), type: 'password' },
                { name: 'qr', label: _('attendance_backend.field.qr') },
              ]}
            />
          }
        />,
      ])}
    />,
  ])

export const periodScreen = (
  _: Translator,
  frame: Frame,
  month: string,
  period: R | null,
): TemplateResult => {
  const entries = (period?.entries as R[] | undefined) ?? []
  return (
    <Framed
      translator={_}
      title={_('attendance_backend.admin.title')}
      frame={frame}
      body={stack([
        <Surface
          body={
            <RecordForm
              action="/admin/attendance"
              submit={_('attendance_backend.action.openPeriod')}
              submitVariant="secondary"
              fields={[
                {
                  name: 'month',
                  label: _('attendance_backend.field.month'),
                  type: 'month',
                  value: month,
                  required: true,
                },
              ]}
            />
          }
        />,
        ...(period
          ? [
              <Notice
                title={_('attendance_backend.period.state')}
                message={_(`attendance_backend.state.${period.state}`)}
                tone={period.state === 'locked' ? 'positive' : 'info'}
              />,
              <Surface
                body={
                  <RecordActions
                    action={`/admin/attendance?month=${encodeURIComponent(month)}`}
                    actions={
                      period.state === 'locked'
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
              />,
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
                  ),
            ]
          : []),
      ])}
    />
  )
}

export const credentialScreen = (_: Translator, frame: Frame, result?: R): TemplateResult => (
  <Framed
    translator={_}
    title={_('attendance_backend.credentials.title')}
    frame={frame}
    body={stack([
      ...(result?.secret
        ? [
            <Notice
              title={_('attendance_backend.credentials.once')}
              message={String(result.secret)}
              tone="warning"
            />,
          ]
        : []),
      ...(result?.secret && result.credentialKind === 'qr'
        ? [qrCode(qrMatrix(String(result.secret)), _('attendance_backend.credentials.qr'))]
        : []),
      <Section
        title={_('attendance_backend.credentials.kiosk')}
        body={
          <Surface
            body={
              <RecordForm
                action="/admin/attendance/credentials"
                hidden={{ action: 'kiosk' }}
                submit={_('attendance_backend.action.issue')}
                submitVariant="primary"
                fields={[
                  { name: 'name', label: _('attendance_backend.field.name'), required: true },
                  { name: 'branchId', label: _('attendance_backend.field.branch'), required: true },
                ]}
              />
            }
          />
        }
      />,
      <Section
        title={_('attendance_backend.credentials.pin')}
        body={
          <Surface
            body={
              <RecordForm
                action="/admin/attendance/credentials"
                hidden={{ action: 'pin' }}
                submit={_('attendance_backend.action.savePin')}
                submitVariant="secondary"
                fields={[
                  { name: 'employeeId', label: _('attendance_backend.field.employee'), required: true },
                  {
                    name: 'pin',
                    label: _('attendance_backend.field.pin'),
                    type: 'password',
                    required: true,
                  },
                ]}
              />
            }
          />
        }
      />,
      <Section
        title={_('attendance_backend.credentials.qr')}
        body={
          <Surface
            body={
              <RecordForm
                action="/admin/attendance/credentials"
                hidden={{ action: 'qr' }}
                submit={_('attendance_backend.action.issueQr')}
                submitVariant="secondary"
                fields={[
                  { name: 'employeeId', label: _('attendance_backend.field.employee'), required: true },
                ]}
              />
            }
          />
        }
      />,
    ])}
  />
)
