import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  button,
  FormCluster,
  FormPage,
  linkButton,
  notice,
  RecordForm,
  shell,
  stack,
  Surface,
} from '../../../ui/index.ts'
import type { FormField, Frame } from '../../../ui/index.ts'

export type CaseCreateScreenOptions = {
  /** Context-specific heading such as "Create lead" when starting from a partner. */
  title?: string
  fields: FormField[]
  /** Locale-aware endpoint supplied by the route. */
  action: string
  /** Safe, locale-aware list or pipeline destination supplied by the route. */
  cancelHref: string
  /** Carried through POST so validation does not lose the originating query state. */
  returnTo: string
  errors?: readonly string[]
  guidance?: { title: string; description: string }
  partnerIntent?: boolean
}

export const caseCreateScreen = (
  _: Translator,
  frame: Frame,
  options: CaseCreateScreenOptions,
): TemplateResult => {
  const formId = 'crm-case-create-form'
  const title = options.title ?? _('crm_backend.action.create')

  return shell(
    _,
    title,
    <FormPage
      variant="operational"
      frame={frame}
      scope="crm-case-create"
      title={title}
      description={_('crm_backend.case.create.subtitle')}
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
              label: _('crm_backend.action.cancel'),
              href: options.cancelHref,
              variant: 'secondary',
            }),
          ]}
        />
      }
      body={stack([
        ...(options.guidance
          ? [
              notice({
                title: options.guidance.title,
                message: options.guidance.description,
                tone: 'info',
              }),
            ]
          : []),
        <Surface
          body={
            <RecordForm
              id={formId}
              scope="crm-case-create"
              action={options.action}
              submit={title}
              submitVariant="primary"
              submitPlacement="external"
              errors={options.errors}
              hidden={{
                returnTo: options.returnTo,
                ...(options.partnerIntent ? { partnerIntent: '1' } : {}),
              }}
              fields={options.fields}
            />
          }
        />,
      ])}
    />,
    { ...frame, topbar: false, titled: false },
  )
}
