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

export type WarehouseCreateScreenOptions = {
  /** Locale-aware endpoint supplied by the route. */
  action: string
  /** Locale-aware warehouse-list destination supplied by the route. */
  cancelHref: string
  errors?: readonly string[]
}

const selectionLabel = (_: Translator, group: string, value: string): string => {
  const key = `stock_backend.${group}.${value}`
  return _.resolves(key) ? _(key) : value
}

const warehouseFields = (_: Translator): FormField[] => [
  {
    name: 'name',
    label: _('stock_backend.warehouse.field.name'),
    placeholder: _('stock_backend.warehouse.field.name.placeholder'),
    required: true,
  },
  {
    name: 'code',
    label: _('stock_backend.warehouse.field.code'),
    placeholder: _('stock_backend.warehouse.field.code.placeholder'),
    help: _('stock_backend.warehouse.field.code.help'),
    required: true,
  },
  {
    name: 'receptionSteps',
    label: _('stock_backend.field.receptionSteps'),
    type: 'radio',
    value: 'one_step',
    options: ['one_step', 'two_steps', 'three_steps'].map((value) => ({
      value,
      label: selectionLabel(_, 'receptionSteps', value),
    })),
    span: 'full',
  },
  {
    name: 'deliverySteps',
    label: _('stock_backend.field.deliverySteps'),
    type: 'radio',
    value: 'ship_only',
    options: ['ship_only', 'pick_ship', 'pick_pack_ship'].map((value) => ({
      value,
      label: selectionLabel(_, 'deliverySteps', value),
    })),
    span: 'full',
  },
]

export const warehouseCreateModal = (_: Translator, options: WarehouseCreateScreenOptions): TemplateResult =>
  modalForm({
    id: 'warehouse-create',
    title: _('stock_backend.warehouse.create.title'),
    closeHref: options.cancelHref,
    closeLabel: _('stock_backend.action.cancel'),
    presentation: 'dialog',
    size: 'large',
    form: {
      id: 'warehouse-create-form',
      scope: 'warehouse-create',
      action: options.action,
      submit: _('stock_backend.action.create'),
      submitVariant: 'primary',
      errors: options.errors,
      fields: warehouseFields(_),
      cancelHref: options.cancelHref,
      cancelLabel: _('stock_backend.action.cancel'),
    },
  })

export const warehouseCreateScreen = (
  _: Translator,
  options: WarehouseCreateScreenOptions,
  frame: Frame,
): TemplateResult => {
  const formId = 'warehouse-create-form'

  return shell(
    _,
    _('stock_backend.warehouse.create.title'),
    <FormPage
      variant="operational"
      frame={frame}
      scope="warehouse-create"
      title={_('stock_backend.warehouse.create.title')}
      description={_('stock_backend.warehouse.create.hint')}
      actions={
        <FormCluster
          label={_('stock_backend.warehouse.create.title')}
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
              scope="warehouse-create"
              action={options.action}
              submit={_('stock_backend.action.create')}
              submitVariant="primary"
              submitPlacement="external"
              errors={options.errors}
              fields={warehouseFields(_)}
            />
          }
        />
      }
    />,
    { ...frame, topbar: false, titled: false },
  )
}
