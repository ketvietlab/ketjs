import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { button, FormCluster, FormPage, linkButton, RecordForm, shell, Surface } from '../../../ui/index.ts'
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
  errors?: readonly string[]
}

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
              hidden={{ returnTo: options.returnTo }}
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
