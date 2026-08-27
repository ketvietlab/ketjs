import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  button,
  FormCluster,
  FormPage,
  linkButton,
  modalForm,
  RecordForm,
  shell,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

export type InvoicingPolicyCreateScreenOptions = {
  fields: FormField[]
  /** Locale-aware form endpoint, including the validated return destination. */
  action: string
  /** Validated, locale-aware invoicing-policy list destination. */
  cancelHref: string
  errors?: readonly string[]
}

export const invoicingPolicyCreateModal = (
  _: Translator,
  options: InvoicingPolicyCreateScreenOptions,
): TemplateResult =>
  modalForm({
    id: 'sales-invoicing-policy',
    title: _('sale_backend.policy.edit.title'),
    description: _('sale_backend.policy.edit.hint'),
    closeHref: options.cancelHref,
    closeLabel: _('sale_backend.action.cancel'),
    presentation: 'dialog',
    form: {
      id: 'invoicing-policy-form',
      scope: 'sales-invoicing-policy',
      action: options.action,
      submit: _('sale_backend.action.savePolicy'),
      submitVariant: 'primary',
      cancelHref: options.cancelHref,
      cancelLabel: _('sale_backend.action.cancel'),
      errors: options.errors,
      fields: options.fields,
    },
  })

export const invoicingPolicyCreateScreen = (
  _: Translator,
  options: InvoicingPolicyCreateScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const formId = 'invoicing-policy-form'

  return shell(
    _,
    _('sale_backend.policy.edit.title'),
    <FormPage
      scope="sales-invoicing-policy-form-page"
      title={_('sale_backend.policy.edit.title')}
      description={_('sale_backend.policy.edit.hint')}
      actions={
        <FormCluster
          label={_('sale_backend.policy.edit.title')}
          forms={[
            button({
              label: _('sale_backend.action.savePolicy'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('sale_backend.action.cancel'),
              href: options.cancelHref,
              variant: 'secondary',
            }),
          ]}
        />
      }
      body={
        <Surface
          body={
            <RecordForm
              id={formId}
              scope="sales-invoicing-policy"
              action={options.action}
              submit={_('sale_backend.action.savePolicy')}
              submitVariant="primary"
              submitPlacement="external"
              errors={options.errors}
              fields={options.fields}
            />
          }
        />
      }
    />,
    { ...frame, topbar: false, titled: false },
  )
}
