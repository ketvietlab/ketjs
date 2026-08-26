import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  button,
  FormCluster,
  FormPage,
  linkButton,
  RecordForm,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

export type AccountFormRow = Record<string, unknown>

export type AccountFormScreenOptions = {
  frame: Frame
  fields: FormField[]
  action: string
  cancelHref: string
  editing?: AccountFormRow | null
  displayName?: (row: AccountFormRow) => string
  errors?: string[]
}

export const accountFormScreen = (_: Translator, options: AccountFormScreenOptions): TemplateResult => {
  const editing = options.editing ?? null
  const name = options.displayName ?? ((row: AccountFormRow) => String(row.name))
  const formId = 'account-create-form'
  const title = editing ? _('account_backend.account.edit.title') : _('account_backend.account.create.title')

  return shell(
    _,
    title,
    <FormPage
      scope="account-chart-form-page"
      title={title}
      description={
        editing ? `${String(editing.code)} · ${name(editing)}` : _('account_backend.account.create.hint')
      }
      status={
        editing
          ? badge(
              editing.active ? _('account_backend.active') : _('account_backend.archived'),
              editing.active ? 'positive' : 'neutral',
              editing.active ? 'active' : 'archived',
            )
          : undefined
      }
      actions={
        <FormCluster
          label={title}
          forms={[
            button({
              label: editing ? _('account_backend.action.save') : _('account_backend.action.create'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('account_backend.action.cancelEdit'),
              href: options.cancelHref,
              variant: 'secondary',
            }),
          ]}
        />
      }
      body={stack([
        <Surface
          body={
            <RecordForm
              id={formId}
              scope="account-chart"
              action={options.action}
              submit={editing ? _('account_backend.action.save') : _('account_backend.action.create')}
              submitVariant="primary"
              submitPlacement="external"
              fields={options.fields}
              errors={options.errors}
            />
          }
        />,
      ])}
    />,
    { ...options.frame, topbar: false, titled: false },
  )
}
