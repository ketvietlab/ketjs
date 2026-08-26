import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  button,
  FormCluster,
  FormPage,
  linkButton,
  RecordForm,
  Section,
  shell,
  Surface,
} from '../../../ui/index.ts'
import type { FormOption, Frame } from '../../../ui/index.ts'

export type LotCreateScreenOptions = {
  products: FormOption[]
  /** Locale-aware endpoint supplied by the route. */
  action: string
  /** Locale-aware list destination supplied by the route. */
  cancelHref: string
  errors?: readonly string[]
}

export const lotCreateScreen = (
  _: Translator,
  options: LotCreateScreenOptions,
  frame: Frame,
): TemplateResult => {
  const formId = 'lot-create-form'

  return shell(
    _,
    _('stock_backend.lot.create.title'),
    <FormPage
      scope="lot-create"
      title={_('stock_backend.lot.create.title')}
      description={_('stock_backend.lot.create.hint')}
      actions={
        <FormCluster
          label={_('stock_backend.lot.create.title')}
          forms={[
            button({
              label: _('stock_backend.action.create'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('stock_backend.action.cancel'),
              href: options.cancelHref,
              variant: 'secondary',
            }),
          ]}
        />
      }
      body={
        <Section
          title={_('stock_backend.lot.information.title')}
          description={_('stock_backend.lot.information.hint')}
          body={
            <Surface
              body={
                <RecordForm
                  id={formId}
                  scope="lot-create"
                  action={options.action}
                  submit={_('stock_backend.action.create')}
                  submitVariant="primary"
                  submitPlacement="external"
                  errors={options.errors}
                  fields={[
                    {
                      name: 'productId',
                      label: _('stock_backend.lot.field.product'),
                      type: 'select',
                      options: options.products,
                      required: true,
                      help: _('stock_backend.lot.create.product.help'),
                    },
                    {
                      name: 'name',
                      label: _('stock_backend.field.lotSerial'),
                      placeholder: _('stock_backend.lot.create.name.placeholder'),
                      required: true,
                    },
                    {
                      name: 'ref',
                      label: _('stock_backend.lot.field.reference'),
                    },
                    {
                      name: 'note',
                      label: _('stock_backend.lot.field.description'),
                      type: 'textarea',
                      span: 'full',
                    },
                  ]}
                />
              }
            />
          }
        />
      }
    />,
    { ...frame, topbar: false, titled: false },
  )
}
