import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { Notice, RecordForm, Section, stack, Surface } from '../../ui/index.ts'
import type { FormField } from '../../ui/index.ts'

export const websiteLeadScreen = (
  _: Translator,
  fields: FormField[],
  errors: string[] = [],
  success = false,
  idempotencyKey = '',
  /**
   * The form posts back to the page it was rendered on, locale and all: without
   * the query the redirect after a submission came back in the default language
   * and the visitor watched the page change languages under them.
   */
  action = '/contact/sales',
): TemplateResult =>
  stack([
    ...(success
      ? [
          <Notice
            title={_('crm_website.website.successTitle')}
            message={_('crm_website.website.success')}
            tone="positive"
          />,
        ]
      : []),
    <Section
      title={_('crm_website.website.title')}
      description={_('crm_website.website.hint')}
      body={
        <Surface
          body={
            <RecordForm
              action={action}
              // `website` is the honeypot and stays empty; `idempotencyKey`
              // makes a refreshed submission a replay rather than a second lead.
              hidden={{ website: '', idempotencyKey }}
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
