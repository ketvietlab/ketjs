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

/** Column-template presets offered while creating a project. */
export const TEMPLATE_OPTIONS = (_: Translator) => [
  { value: 'simple', label: _('flow_backend.template.simple') },
  { value: 'kanban', label: _('flow_backend.template.kanban') },
  { value: 'scrum', label: _('flow_backend.template.scrum') },
  { value: 'custom', label: _('flow_backend.template.custom') },
]

export type ProjectCreateScreenOptions = {
  fields: FormField[]
  action: string
  cancelHref: string
  returnTo: string
  /**
   * The project's id, decided when the form is rendered rather than when it is
   * posted. `project.save` upserts by id, so a resubmitted form lands on the
   * same project instead of creating a second one — every other create form in
   * this module already carries one.
   */
  recordId: string
  idempotencyKey: string
  errors?: readonly string[]
}

export const projectCreateModal = (_: Translator, options: ProjectCreateScreenOptions): TemplateResult =>
  modalForm({
    id: 'flow-project-create',
    title: _('flow_backend.projects.create'),
    description: _('flow_backend.projects.subtitle'),
    closeHref: options.cancelHref,
    closeLabel: _('flow_backend.action.cancel'),
    presentation: 'sheet',
    size: 'large',
    form: {
      id: 'flow-project-create-form',
      scope: 'flow-project-create',
      action: options.action,
      submit: _('flow_backend.projects.create'),
      submitVariant: 'primary',
      cancelHref: options.cancelHref,
      cancelLabel: _('flow_backend.action.cancel'),
      hidden: {
        returnTo: options.returnTo,
        id: options.recordId,
        idempotencyKey: options.idempotencyKey,
      },
      fields: options.fields,
      errors: options.errors,
    },
  })

export const projectCreateScreen = (
  _: Translator,
  frame: Frame,
  options: ProjectCreateScreenOptions,
): TemplateResult => {
  const formId = 'flow-project-create-form'
  const title = _('flow_backend.projects.create')

  return shell(
    _,
    title,
    <FormPage
      variant="operational"
      frame={frame}
      scope="flow-project-create"
      title={title}
      description={_('flow_backend.projects.subtitle')}
      actions={
        <FormCluster
          label={title}
          forms={[
            button({
              label: title,
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('flow_backend.action.cancel'),
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
              scope="flow-project-create"
              action={options.action}
              submit={title}
              submitVariant="primary"
              submitPlacement="external"
              hidden={{
                returnTo: options.returnTo,
                id: options.recordId,
                idempotencyKey: options.idempotencyKey,
              }}
              fields={options.fields}
              errors={options.errors}
            />
          }
        />
      }
    />,
    { ...frame, topbar: false, titled: false },
  )
}
