import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  notice,
  recordForm as RecordForm,
  section as Section,
  stack,
  surface as Surface,
} from '../../ui/index.ts'
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
    <Section
      title={_('crm_website.website.title')}
      description={_('crm_website.website.hint')}
      body={
        <Surface
          body={
            <RecordForm
              action="/contact/sales"
              fields={fields}
              errors={errors}
              submit={_('crm_website.website.submit')}
              submitVariant="primary"
            />
          }
        />
      }
    />,
  ])
