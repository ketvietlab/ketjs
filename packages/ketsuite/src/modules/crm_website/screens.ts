import type { Translator } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import { notice, recordForm, section, stack, surface } from '../../ui/index.ts'
import type { FormField } from '../../ui/index.ts'

export const websiteLeadScreen = (
  _: Translator,
  fields: FormField[],
  errors: string[] = [],
  success = false,
): TemplateResult =>
  stack([
    ...(success
      ? [
          notice({
            title: _('crm_website.website.successTitle'),
            message: _('crm_website.website.success'),
            tone: 'positive',
          }),
        ]
      : []),
    section({
      title: _('crm_website.website.title'),
      description: _('crm_website.website.hint'),
      body: surface({
        body: recordForm({
          action: '/contact/sales',
          fields,
          errors,
          submit: _('crm_website.website.submit'),
          submitVariant: 'primary',
        }),
      }),
    }),
  ])
