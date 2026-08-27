import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { button, FormCluster, FormPage, linkButton, RecordForm, shell, Surface } from '../../../ui/index.ts'
import type { FormOption, Frame } from '../../../ui/index.ts'

export type ReplenishmentCreateScreenOptions = {
  products: FormOption[]
  warehouses: FormOption[]
  locations: FormOption[]
  units: FormOption[]
  routes: FormOption[]
  /** Locale-aware endpoint supplied by the route. */
  action: string
  /** Locale-aware replenishment-list destination supplied by the route. */
  cancelHref: string
  errors?: readonly string[]
}

export const replenishmentCreateScreen = (
  _: Translator,
  options: ReplenishmentCreateScreenOptions,
  frame: Frame,
): TemplateResult => {
  const formId = 'replenishment-create-form'

  return shell(
    _,
    _('stock_backend.replenishment.create.title'),
    <FormPage
      scope="stock-replenishment-create"
      title={_('stock_backend.replenishment.create.title')}
      description={_('stock_backend.replenishment.create.hint')}
      actions={
        <FormCluster
          label={_('stock_backend.replenishment.create.title')}
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
        <Surface
          body={
            <RecordForm
              id={formId}
              scope="stock-replenishment-create"
              action={options.action}
              submit={_('stock_backend.action.create')}
              submitVariant="primary"
              submitPlacement="external"
              errors={options.errors}
              fields={[
                {
                  name: 'productId',
                  label: _('stock_backend.field.product'),
                  type: 'select',
                  options: [{ value: '', label: '—' }, ...options.products],
                  required: true,
                },
                {
                  name: 'warehouseId',
                  label: _('stock_backend.field.warehouse'),
                  type: 'select',
                  options: [{ value: '', label: '—' }, ...options.warehouses],
                  required: true,
                },
                {
                  name: 'locationId',
                  label: _('stock_backend.field.location'),
                  type: 'select',
                  options: [{ value: '', label: '—' }, ...options.locations],
                  required: true,
                },
                {
                  name: 'trigger',
                  label: _('stock_backend.field.trigger'),
                  type: 'select',
                  options: [
                    { value: 'auto', label: _('stock_backend.trigger.auto') },
                    { value: 'manual', label: _('stock_backend.trigger.manual') },
                  ],
                },
                {
                  name: 'minQuantity',
                  label: _('stock_backend.field.minQuantity'),
                  type: 'decimal',
                  value: 0,
                },
                {
                  name: 'maxQuantity',
                  label: _('stock_backend.field.maxQuantity'),
                  type: 'decimal',
                  value: 0,
                },
                {
                  name: 'replenishmentUomId',
                  label: _('stock_backend.field.replenishmentUom'),
                  type: 'select',
                  options: [{ value: '', label: '—' }, ...options.units],
                },
                {
                  name: 'routeId',
                  label: _('stock_backend.field.route'),
                  type: 'select',
                  options: [{ value: '', label: '—' }, ...options.routes],
                },
              ]}
            />
          }
        />
      }
    />,
    { ...frame, topbar: false, titled: false },
  )
}
