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

export type WorkCenterFormValues = {
  id?: string
  code?: string
  name?: string
  capacity?: string
  timeEfficiency?: string
  costPerHour?: string
}

export type WorkCenterFormScreenOptions = {
  values?: WorkCenterFormValues
  editing?: boolean
  /** Locale-aware form endpoint supplied by the route. */
  action: string
  /** Locale-aware work-center collection destination. */
  cancelHref: string
  errors?: readonly string[]
}

export const workCenterFields = (_: Translator, values: WorkCenterFormValues = {}): FormField[] => [
  {
    name: 'code',
    label: _('manufacturing_backend.field.code'),
    value: values.code,
    required: true,
  },
  {
    name: 'name',
    label: _('manufacturing_backend.field.name'),
    value: values.name,
    required: true,
  },
  {
    name: 'capacity',
    label: _('manufacturing_backend.field.capacity'),
    type: 'decimal',
    value: values.capacity || 1,
    required: true,
  },
  {
    name: 'timeEfficiency',
    label: _('manufacturing_backend.field.efficiency'),
    type: 'decimal',
    value: values.timeEfficiency || 100,
    required: true,
  },
  {
    name: 'costPerHour',
    label: _('manufacturing_backend.field.cost'),
    type: 'decimal',
    value: values.costPerHour || 0,
  },
]

const titleOf = (_: Translator, editing: boolean): string =>
  editing ? _('manufacturing_backend.workCenters.edit') : _('manufacturing_backend.workCenters.create')

export const workCenterFormModal = (_: Translator, options: WorkCenterFormScreenOptions): TemplateResult => {
  const editing = options.editing === true
  return modalForm({
    id: 'manufacturing-work-center-form',
    title: titleOf(_, editing),
    closeHref: options.cancelHref,
    closeLabel: _('manufacturing_backend.action.cancel'),
    presentation: 'dialog',
    form: {
      id: 'manufacturing-work-center-form',
      scope: 'manufacturing-work-center',
      action: options.action,
      hidden: options.values?.id ? { id: options.values.id } : undefined,
      fields: workCenterFields(_, options.values),
      errors: options.errors,
      submit: editing ? _('manufacturing_backend.action.save') : _('manufacturing_backend.action.create'),
      submitVariant: 'primary',
      cancelHref: options.cancelHref,
      cancelLabel: _('manufacturing_backend.action.cancel'),
    },
  })
}

export const workCenterFormScreen = (
  _: Translator,
  options: WorkCenterFormScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const formId = 'manufacturing-work-center-form'
  const editing = options.editing === true
  const title = titleOf(_, editing)

  return shell(
    _,
    title,
    <FormPage
      variant="operational"
      frame={frame}
      scope="manufacturing-work-center-form-page"
      title={title}
      actions={
        <FormCluster
          label={title}
          forms={[
            button({
              label: editing
                ? _('manufacturing_backend.action.save')
                : _('manufacturing_backend.action.create'),
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
              scope="manufacturing-work-center"
              action={options.action}
              hidden={options.values?.id ? { id: options.values.id } : undefined}
              fields={workCenterFields(_, options.values)}
              errors={options.errors}
              submit={
                editing ? _('manufacturing_backend.action.save') : _('manufacturing_backend.action.create')
              }
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
