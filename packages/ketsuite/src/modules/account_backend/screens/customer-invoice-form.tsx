import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { button, FormCluster, FormPage, linkButton, RecordForm, shell, Surface } from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

export type CustomerInvoiceFormScreenOptions = {
  frame: Frame
  fields: FormField[]
  action: string
  cancelHref: string
  idempotencyKey: string
  errors?: string[]
}

export const customerInvoiceFormScreen = (
  _: Translator,
  options: CustomerInvoiceFormScreenOptions,
): TemplateResult => {
  const formId = 'customer-invoice-create-form'
  const title = _('account_backend.customerInvoice.create.title')

  return shell(
    _,
    title,
    <FormPage
      variant="operational"
      frame={options.frame}
      scope="account-customer-invoice-form-page"
      title={title}
      description={_('account_backend.customerInvoice.create.hint')}
      actions={
        <FormCluster
          label={title}
          forms={[
            button({
              label: _('account_backend.action.create'),
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
      body={
        <Surface
          body={
            <RecordForm
              id={formId}
              scope="account-customer-invoice"
              action={options.action}
              submit={_('account_backend.action.create')}
              submitVariant="primary"
              submitPlacement="external"
              fields={options.fields}
              errors={options.errors}
              hidden={{ id: options.idempotencyKey }}
            />
          }
        />
      }
    />,
    { ...options.frame, topbar: false, titled: false },
  )
}
