import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { button, FormCluster, FormPage, linkButton, RecordForm, shell, Surface } from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

export type PaymentFormScreenOptions = {
  frame: Frame
  fields: FormField[]
  action: string
  cancelHref: string
  paymentId: string
  errors?: string[]
}

/** A payment has enough accounting and reconciliation state to deserve a full route. */
export const paymentFormScreen = (_: Translator, options: PaymentFormScreenOptions): TemplateResult => {
  const formId = 'payment-register-form'
  const title = _('account_backend.payment.create.title')
  return shell(
    _,
    title,
    <FormPage
      variant="operational"
      frame={options.frame}
      scope="account-payment-form-page"
      title={title}
      description={_('account_backend.payment.create.hint')}
      actions={
        <FormCluster
          label={title}
          forms={[
            button({
              label: _('account_backend.action.registerPayment'),
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
              scope="account-payment"
              action={options.action}
              submit={_('account_backend.action.registerPayment')}
              submitVariant="primary"
              submitPlacement="external"
              fields={options.fields}
              errors={options.errors}
              hidden={{ action: 'register', id: options.paymentId }}
            />
          }
        />
      }
    />,
    { ...options.frame, topbar: false, titled: false },
  )
}
