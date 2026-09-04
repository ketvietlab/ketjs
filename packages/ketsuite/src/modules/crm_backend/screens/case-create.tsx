import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { button, FormCluster, FormPage, linkButton, RecordForm, shell, Surface } from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

export type CaseCreateScreenOptions = {
  fields: FormField[]
  /** Locale-aware endpoint supplied by the route. */
  action: string
  /** Safe, locale-aware list or pipeline destination supplied by the route. */
  cancelHref: string
  /** Carried through POST so validation does not lose the originating query state. */
  returnTo: string
  errors?: readonly string[]
}

export const caseCreateScreen = (
  _: Translator,
  frame: Frame,
  options: CaseCreateScreenOptions,
): TemplateResult => {
  const formId = 'crm-case-create-form'

  return shell(
    _,
    _('crm_backend.action.create'),
    <FormPage
      variant="operational"
      frame={frame}
      scope="crm-case-create"
      title={_('crm_backend.action.create')}
      description={_('crm_backend.cases.title')}
      actions={
        <FormCluster
          label={_('crm_backend.action.create')}
          forms={[
            button({
              label: _('crm_backend.action.create'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('crm_backend.action.cancel'),
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
              scope="crm-case-create"
              action={options.action}
              submit={_('crm_backend.action.create')}
              submitVariant="primary"
              submitPlacement="external"
              errors={options.errors}
              hidden={{ returnTo: options.returnTo }}
              fields={options.fields}
            />
          }
        />
      }
    />,
    { ...frame, topbar: false, titled: false },
  )
}
