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

export type BomCreateScreenOptions = {
  fields: FormField[]
  /** Locale-aware create endpoint supplied by the route. */
  action: string
  /** Locale-aware BOM collection destination supplied by the route. */
  cancelHref: string
  errors?: readonly string[]
}

export const bomCreateModal = (_: Translator, options: BomCreateScreenOptions): TemplateResult =>
  modalForm({
    id: 'manufacturing-bom-create',
    title: _('manufacturing_backend.boms.create'),
    closeHref: options.cancelHref,
    closeLabel: _('manufacturing_backend.action.cancel'),
    size: 'large',
    form: {
      id: 'manufacturing-bom-create-form',
      scope: 'manufacturing-bom-create',
      action: options.action,
      submit: _('manufacturing_backend.action.create'),
      submitVariant: 'primary',
      cancelHref: options.cancelHref,
      cancelLabel: _('manufacturing_backend.action.cancel'),
      errors: options.errors,
      fields: options.fields,
    },
  })

/** Standalone compatibility surface for hosts that choose not to layer the create form. */
export const bomCreateScreen = (
  _: Translator,
  options: BomCreateScreenOptions,
  frame: Frame = {},
): TemplateResult => {
  const formId = 'manufacturing-bom-create-form'
  const title = _('manufacturing_backend.boms.create')

  return shell(
    _,
    title,
    <FormPage
      variant="operational"
      frame={frame}
      scope="manufacturing-bom-create-form-page"
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
              scope="manufacturing-bom-create"
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
