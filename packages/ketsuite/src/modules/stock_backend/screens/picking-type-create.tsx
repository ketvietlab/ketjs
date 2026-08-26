import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { button, FormCluster, FormPage, linkButton, RecordForm, shell, Surface } from '../../../ui/index.ts'
import type { FormOption, Frame } from '../../../ui/index.ts'

export type PickingTypeCreateScreenOptions = {
  warehouses: FormOption[]
  locations: FormOption[]
  /** Locale-aware create endpoint supplied by the route. */
  action: string
  /** Locale-aware `/admin/stock/picking-types` destination supplied by the route. */
  cancelHref: string
  errors?: readonly string[]
}

const selectionLabel = (_: Translator, group: string, value: string): string => {
  const key = `stock_backend.${group}.${value}`
  return _.resolves(key) ? _(key) : value
}

const selectionOptions = (_: Translator, group: string, values: readonly string[]): FormOption[] =>
  values.map((value) => ({ value, label: selectionLabel(_, group, value) }))

export const pickingTypeCreateScreen = (
  _: Translator,
  options: PickingTypeCreateScreenOptions,
  frame: Frame,
): TemplateResult => {
  const formId = 'picking-type-create-form'

  return shell(
    _,
    _('stock_backend.pickingType.create.title'),
    <FormPage
      scope="picking-type-create"
      title={_('stock_backend.pickingType.create.title')}
      description={_('stock_backend.pickingType.create.hint')}
      actions={
        <FormCluster
          label={_('stock_backend.pickingType.create.title')}
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
              scope="picking-type-create"
              action={options.action}
              submit={_('stock_backend.action.create')}
              submitVariant="primary"
              submitPlacement="external"
              errors={options.errors}
              fields={[
                {
                  name: 'name',
                  label: _('stock_backend.pickingType.field.name'),
                  placeholder: _('stock_backend.pickingType.field.name.placeholder'),
                  required: true,
                },
                {
                  name: 'code',
                  label: _('stock_backend.pickingType.field.code'),
                  type: 'radio',
                  value: 'internal',
                  options: selectionOptions(_, 'pickingType', ['incoming', 'outgoing', 'internal']),
                  required: true,
                  span: 'full',
                },
                {
                  name: 'warehouseId',
                  label: _('stock_backend.field.warehouse'),
                  type: 'select',
                  options: options.warehouses,
                  required: true,
                },
                {
                  name: 'createBackorder',
                  label: _('stock_backend.field.backorder'),
                  type: 'select',
                  value: 'ask',
                  options: selectionOptions(_, 'backorder', ['ask', 'always', 'never']),
                  required: true,
                  help: _('stock_backend.pickingType.field.backorder.help'),
                },
                {
                  name: 'defaultLocationSrcId',
                  label: _('stock_backend.field.sourceLocation'),
                  type: 'select',
                  options: options.locations,
                  required: true,
                },
                {
                  name: 'defaultLocationDestId',
                  label: _('stock_backend.field.destinationLocation'),
                  type: 'select',
                  options: options.locations,
                  required: true,
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
