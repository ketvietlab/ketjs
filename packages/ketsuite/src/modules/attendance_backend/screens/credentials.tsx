import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  CardGrid,
  ContentCard,
  Framed,
  LinkButton,
  ModalSheet,
  Notice,
  modalForm,
  qrCode,
  Section,
  stack,
} from '../../../ui/index.ts'
import type { FormOption, Frame } from '../../../ui/index.ts'
import { qrMatrix } from '../qr.ts'

export type CredentialIssue = 'kiosk' | 'pin' | 'qr'

export type CredentialValues = {
  employeeId?: string
  name?: string
  requestKey?: string
}

export type CredentialScreenOptions = {
  actions: Partial<Record<CredentialIssue, string>>
  notice?: string
}

export type CredentialModalOptions = {
  action: string
  branchId?: string
  cancelHref: string
  employeeOptions: readonly FormOption[]
  errors?: readonly string[]
  issue: CredentialIssue
  values?: CredentialValues
}

export type CredentialSecretModalOptions = {
  cancelHref: string
  issue: 'kiosk' | 'qr'
  secret: string
}

const issueTitle = (_: Translator, issue: CredentialIssue): string =>
  _(`attendance_backend.credentials.${issue}`)

const withSubmittedEmployee = (options: readonly FormOption[], employeeId?: string): readonly FormOption[] =>
  employeeId && !options.some((option) => option.value === employeeId)
    ? [{ value: employeeId, label: employeeId }, ...options]
    : options

/** A stable action hub; each short credential workflow owns its URL modal. */
export const credentialScreen = (
  _: Translator,
  options: CredentialScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const issues = (['kiosk', 'pin', 'qr'] as const).filter((issue) => options.actions[issue])
  return (
    <Framed
      translator={_}
      title={_('attendance_backend.credentials.title')}
      subtitle={_('attendance_backend.credentials.subtitle')}
      frame={frame}
      body={stack([
        ...(options.notice
          ? [
              <Notice
                title={_('attendance_backend.result.success')}
                message={options.notice}
                tone="positive"
              />,
            ]
          : []),
        <Section
          title={_('attendance_backend.credentials.actions')}
          body={
            <CardGrid
              items={issues}
              id={(issue) => issue}
              card={(issue) => (
                <ContentCard
                  title={issueTitle(_, issue)}
                  summary={_(`attendance_backend.credentials.${issue}Hint`)}
                  actions={
                    <LinkButton
                      href={options.actions[issue]!}
                      label={_(`attendance_backend.action.${issue}`)}
                      variant={issue === 'kiosk' ? 'primary' : 'secondary'}
                    />
                  }
                />
              )}
            />
          }
        />,
      ])}
    />
  )
}

export const credentialModal = (_: Translator, options: CredentialModalOptions): TemplateResult => {
  const values = options.values ?? {}
  const employeeOptions = withSubmittedEmployee(options.employeeOptions, values.employeeId)
  return modalForm({
    id: `attendance-credential-${options.issue}`,
    title: issueTitle(_, options.issue),
    description:
      options.issue === 'kiosk' && options.branchId
        ? `${_('attendance_backend.field.branch')}: ${options.branchId}`
        : _(`attendance_backend.credentials.${options.issue}Hint`),
    closeHref: options.cancelHref,
    closeLabel: _('attendance_backend.action.cancel'),
    presentation: 'dialog',
    form: {
      id: `attendance-credential-${options.issue}-form`,
      scope: `attendance-credential-${options.issue}`,
      action: options.action,
      cancelHref: options.cancelHref,
      cancelLabel: _('attendance_backend.action.cancel'),
      errors: options.errors,
      hidden: {
        action: options.issue,
        ...(values.requestKey ? { requestKey: values.requestKey } : {}),
        ...(options.issue === 'kiosk' && options.branchId ? { branchId: options.branchId } : {}),
      },
      submit: _(`attendance_backend.action.${options.issue}`),
      submitVariant: 'primary',
      fields:
        options.issue === 'kiosk'
          ? [
              {
                name: 'name',
                label: _('attendance_backend.field.name'),
                value: values.name,
                required: true,
              },
            ]
          : [
              {
                name: 'employeeId',
                label: _('attendance_backend.field.employee'),
                type: 'select',
                value: values.employeeId,
                required: true,
                options: employeeOptions,
              },
              ...(options.issue === 'pin'
                ? [
                    {
                      name: 'pin',
                      label: _('attendance_backend.field.pin'),
                      type: 'password' as const,
                      required: true,
                    },
                  ]
                : []),
            ],
    },
  })
}

export const credentialSecretModal = (
  _: Translator,
  options: CredentialSecretModalOptions,
): TemplateResult => (
  <ModalSheet
    id={`attendance-credential-${options.issue}-secret`}
    title={issueTitle(_, options.issue)}
    description={_('attendance_backend.credentials.once')}
    closeHref={options.cancelHref}
    closeLabel={_('attendance_backend.action.dismiss')}
    presentation="dialog"
    body={stack([
      <Notice title={_('attendance_backend.credentials.once')} message={options.secret} tone="warning" />,
      ...(options.issue === 'qr'
        ? [qrCode(qrMatrix(options.secret), _('attendance_backend.credentials.qr'))]
        : []),
    ])}
  />
)
