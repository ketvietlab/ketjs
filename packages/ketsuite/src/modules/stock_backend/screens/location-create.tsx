import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { button, FormCluster, FormPage, linkButton, RecordForm, shell, Surface } from '../../../ui/index.ts'
import type { FormOption, Frame } from '../../../ui/index.ts'

export type LocationCreateScreenOptions = {
  warehouses: FormOption[]
  parents: FormOption[]
  /** Locale-aware endpoint supplied by the route. */
  action: string
  /** Locale-aware location-list destination supplied by the route. */
  cancelHref: string
  errors?: readonly string[]
}

const selectionLabel = (_: Translator, group: string, value: string): string => {
  const key = `stock_backend.${group}.${value}`
  return _.resolves(key) ? _(key) : value
}

const usageOptions = (_: Translator): FormOption[] =>
  ['internal', 'view', 'supplier', 'customer', 'inventory', 'production', 'transit'].map((value) => ({
    value,
    label: selectionLabel(_, 'usage', value),
  }))

export const locationCreateScreen = (
  _: Translator,
  options: LocationCreateScreenOptions,
  frame: Frame,
): TemplateResult => {
  const formId = 'location-create-form'

  return shell(
    _,
    _('stock_backend.location.create.title'),
    <FormPage
      scope="location-create"
      title={_('stock_backend.location.create.title')}
      description={_('stock_backend.location.create.hint')}
      actions={
        <FormCluster
          label={_('stock_backend.location.create.title')}
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
              scope="location-create"
              action={options.action}
              submit={_('stock_backend.action.create')}
              submitVariant="primary"
              submitPlacement="external"
              errors={options.errors}
              fields={[
                {
                  name: 'name',
                  label: _('stock_backend.location.field.name'),
                  placeholder: _('stock_backend.location.field.name.placeholder'),
                  required: true,
                },
                {
                  name: 'parentId',
                  label: _('stock_backend.field.parentLocation'),
                  type: 'select',
                  options: [{ value: '', label: '—' }, ...options.parents],
                },
                {
                  name: 'usage',
                  label: _('stock_backend.field.usage'),
                  type: 'select',
                  value: 'internal',
                  options: usageOptions(_),
                  required: true,
                  help: _('stock_backend.location.field.usage.help'),
                },
                {
                  name: 'warehouseId',
                  label: _('stock_backend.field.warehouse'),
                  type: 'select',
                  options: [{ value: '', label: '—' }, ...options.warehouses],
                  help: _('stock_backend.location.field.warehouse.help'),
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
