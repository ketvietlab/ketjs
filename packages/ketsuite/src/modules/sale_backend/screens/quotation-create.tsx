import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { button, FormCluster, FormPage, linkButton, RecordForm, shell, Surface } from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

export type QuotationCreateScreenOptions = {
  fields: FormField[]
  /** Locale-aware endpoint, including retained list state, supplied by the route. */
  action: string
  /** Locale-aware quotation-list destination supplied by the route. */
  cancelHref: string
  errors?: readonly string[]
}

export const quotationCreateScreen = (
  _: Translator,
  options: QuotationCreateScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const formId = 'quotation-create-form'

  return shell(
    _,
    _('sale_backend.quotation.create.title'),
    <FormPage
      variant="operational"
      frame={frame}
      scope="sale-quotation-create-form-page"
      title={_('sale_backend.quotation.create.title')}
      description={_('sale_backend.quotation.create.hint')}
      actions={
        <FormCluster
          label={_('sale_backend.quotation.create.title')}
          forms={[
            button({
              label: _('sale_backend.action.create'),
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
              scope="sale-quotation-create"
              action={options.action}
              submit={_('sale_backend.action.create')}
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
