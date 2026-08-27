import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { button, FormCluster, FormPage, linkButton, RecordForm, shell, Surface } from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

export type ManufacturingOrderCreateScreenOptions = {
  fields: FormField[]
  /** Locale-aware create endpoint supplied by the route. */
  action: string
  /** Locale-aware production-order list destination supplied by the route. */
  cancelHref: string
  errors?: readonly string[]
}

export const orderCreateScreen = (
  _: Translator,
  options: ManufacturingOrderCreateScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const formId = 'manufacturing-order-create-form'
  const title = _('manufacturing_backend.orders.create')

  return shell(
    _,
    title,
    <FormPage
      scope="manufacturing-order-create-form-page"
      title={title}
      actions={
        <FormCluster
          label={title}
          forms={[
            button({
              label: _('manufacturing_backend.action.create'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('manufacturing_backend.action.cancel'),
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
              scope="manufacturing-order-create"
              action={options.action}
              fields={options.fields}
              errors={options.errors}
              submit={_('manufacturing_backend.action.create')}
              submitVariant="primary"
              submitPlacement="external"
            />
          }
        />
      }
    />,
    { ...frame, topbar: false, titled: false },
  )
}
