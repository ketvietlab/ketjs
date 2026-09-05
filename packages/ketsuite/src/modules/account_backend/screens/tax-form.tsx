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

export type TaxFormRow = Record<string, unknown>

export type TaxFormScreenOptions = {
  frame: Frame
  fields: FormField[]
  action: string
  cancelHref: string
  editing?: TaxFormRow | null
  errors?: string[]
}

export const taxFormScreen = (_: Translator, options: TaxFormScreenOptions): TemplateResult => {
  const editing = options.editing ?? null
  const formId = 'tax-create-form'
  const title = editing ? _('account_backend.tax.edit.title') : _('account_backend.tax.create.title')

  return shell(
    _,
    title,
    <FormPage
      variant="operational"
      frame={options.frame}
      scope="account-tax-form-page"
      title={title}
      description={editing ? String(editing.name) : _('account_backend.tax.create.hint')}
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
              scope="account-tax"
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
