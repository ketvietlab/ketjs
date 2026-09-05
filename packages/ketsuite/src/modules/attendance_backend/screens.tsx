import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { Notice, RecordForm, Section, stack, Surface } from '../../ui/index.ts'

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
