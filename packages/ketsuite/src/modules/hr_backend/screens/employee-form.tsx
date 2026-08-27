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
import type { FormField, FormOption, Frame } from '../../../ui/index.ts'

export type EmployeeFormValues = {
  id?: string
  code?: string
  name?: string
  userId?: string
  homeBranchId?: string
  timezone?: string
  startDate?: string
  endDate?: string
  active?: boolean
}

export type EmployeeFormScreenOptions = {
  values?: EmployeeFormValues
  branches: FormOption[]
  editing?: boolean
  /** Locale-aware form endpoint supplied by the route. */
  action: string
  /** Locale-aware employee collection destination. */
  cancelHref: string
  errors?: readonly string[]
}

export const employeeFields = (
  _: Translator,
  options: Pick<EmployeeFormScreenOptions, 'branches' | 'editing' | 'values'>,
): FormField[] => {
  const values = options.values ?? {}
  const timezones = ['Asia/Ho_Chi_Minh', 'UTC']
  if (values.timezone && !timezones.includes(values.timezone)) timezones.unshift(values.timezone)
  const fields: FormField[] = [
    {
      name: 'code',
      label: _('hr_backend.field.code'),
      value: values.code,
      required: true,
    },
    {
      name: 'name',
      label: _('hr_backend.field.name'),
      value: values.name,
      required: options.editing !== true,
      disabled: options.editing === true,
      help: options.editing ? _('hr_backend.employees.nameHelp') : null,
    },
    {
      name: 'userId',
      label: _('hr_backend.field.userId'),
      value: values.userId,
      help: _('hr_backend.employees.userHelp'),
    },
    {
      name: 'homeBranchId',
      label: _('hr_backend.field.branchId'),
      type: options.branches.length > 1 ? 'select' : 'text',
      value: values.homeBranchId,
      options: options.branches.length > 1 ? options.branches : undefined,
      required: true,
    },
    {
      name: 'timezone',
      label: _('hr_backend.field.timezone'),
      type: 'select',
      value: values.timezone || 'Asia/Ho_Chi_Minh',
      options: timezones.map((value) => ({ value, label: value })),
      required: true,
    },
    {
      name: 'startDate',
      label: _('hr_backend.field.startDate'),
      type: 'date',
      value: values.startDate,
      required: true,
    },
  ]
  if (options.editing)
    fields.push(
      {
        name: 'endDate',
        label: _('hr_backend.field.endDate'),
        type: 'date',
        value: values.endDate,
      },
      {
        name: 'active',
        label: _('hr_backend.field.active'),
        type: 'checkbox',
        value: values.active !== false,
        help: _('hr_backend.employees.activeHelp'),
      },
    )
  return fields
}

const titleOf = (_: Translator, editing: boolean): string =>
  editing ? _('hr_backend.employees.edit') : _('hr_backend.employees.create')

export const employeeFormModal = (_: Translator, options: EmployeeFormScreenOptions): TemplateResult => {
  const editing = options.editing === true
  return modalForm({
    id: 'hr-employee-form',
    title: titleOf(_, editing),
    description: _('hr_backend.employees.formHint'),
    closeHref: options.cancelHref,
    closeLabel: _('hr_backend.action.cancel'),
    size: 'large',
    form: {
      id: 'hr-employee-form',
      scope: 'hr-employee',
      action: options.action,
      hidden: options.values?.id ? { id: options.values.id } : undefined,
      fields: employeeFields(_, options),
      errors: options.errors,
      submit: editing ? _('hr_backend.action.save') : _('hr_backend.action.create'),
      submitVariant: 'primary',
      cancelHref: options.cancelHref,
      cancelLabel: _('hr_backend.action.cancel'),
    },
  })
}

export const employeeFormScreen = (
  _: Translator,
  options: EmployeeFormScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const formId = 'hr-employee-form'
  const editing = options.editing === true
  const title = titleOf(_, editing)
  return shell(
    _,
    title,
    <FormPage
      scope="hr-employee-form-page"
      title={title}
      description={_('hr_backend.employees.formHint')}
      actions={
        <FormCluster
          label={title}
          forms={[
            button({
              label: editing ? _('hr_backend.action.save') : _('hr_backend.action.create'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('hr_backend.action.cancel'),
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
              scope="hr-employee"
              action={options.action}
              hidden={options.values?.id ? { id: options.values.id } : undefined}
              fields={employeeFields(_, options)}
              errors={options.errors}
              submit={editing ? _('hr_backend.action.save') : _('hr_backend.action.create')}
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
