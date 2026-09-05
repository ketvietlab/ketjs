import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  button,
  FormCluster,
  FormPage,
  linkButton,
  modalForm,
  RecordForm,
  Section,
  shell,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

export type StockRouteCreateScreenOptions = {
  /** Locale-aware endpoint supplied by the route. */
  action: string
  /** Locale-aware supply-route list destination supplied by the route. */
  cancelHref: string
  errors?: readonly string[]
}

const stockRouteFields = (_: Translator): FormField[] => [
  {
    name: 'name',
    label: _('stock_backend.stockRoute.field.name'),
    placeholder: _('stock_backend.stockRoute.field.name.placeholder'),
    required: true,
  },
  {
    name: 'sequence',
    label: _('stock_backend.field.sequence'),
    type: 'number',
    value: 10,
    help: _('stock_backend.stockRoute.field.sequence.help'),
  },
]

export const stockRouteCreateModal = (
  _: Translator,
  options: StockRouteCreateScreenOptions,
): TemplateResult =>
  modalForm({
    id: 'stock-route-create',
    title: _('stock_backend.stockRoute.create.title'),
    closeHref: options.cancelHref,
    closeLabel: _('stock_backend.action.cancel'),
    presentation: 'dialog',
    form: {
      id: 'stock-route-create-form',
      scope: 'stock-route-create',
      action: options.action,
      submit: _('stock_backend.action.create'),
      submitVariant: 'primary',
      errors: options.errors,
      fields: stockRouteFields(_),
      cancelHref: options.cancelHref,
      cancelLabel: _('stock_backend.action.cancel'),
    },
  })

export const stockRouteCreateScreen = (
  _: Translator,
  options: StockRouteCreateScreenOptions,
  frame: Frame,
): TemplateResult => {
  const formId = 'stock-route-create-form'

  return shell(
    _,
    _('stock_backend.stockRoute.create.title'),
    <FormPage
      variant="operational"
      frame={frame}
      scope="stock-route-create"
      title={_('stock_backend.stockRoute.create.title')}
      description={_('stock_backend.stockRoute.create.hint')}
      actions={
        <FormCluster
          label={_('stock_backend.stockRoute.create.title')}
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
          title={_('stock_backend.stockRoute.detail.information.title')}
          description={_('stock_backend.stockRoute.detail.information.hint')}
          body={
            <Surface
              body={
                <RecordForm
                  id={formId}
                  scope="stock-route-create"
                  action={options.action}
                  submit={_('stock_backend.action.create')}
                  submitVariant="primary"
                  submitPlacement="external"
                  errors={options.errors}
                  fields={stockRouteFields(_)}
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
