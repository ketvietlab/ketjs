import type { TemplateResult } from '@ketvietlab/ketjs-view'
import type { Translator } from '@ketvietlab/ketjs'
import { Framed, RecordForm, Section, Surface } from '../../ui/index.ts'
import type { FormOption, Frame } from '../../ui/index.ts'

export const accountingTermsScreen = (
  _: Translator,
  partner: { id: string; name: string },
  terms: {
    paymentTermId?: string | null
    receivableAccountId?: string | null
    payableAccountId?: string | null
  } | null,
  options: { paymentTerms: FormOption[]; receivable: FormOption[]; payable: FormOption[] },
  frame: Frame,
  action: string,
  backHref: string,
  errors?: string[],
): TemplateResult => (
  <Framed
    translator={_}
    title={_('account_partner_backend.screen.title', { name: partner.name })}
    frame={frame}
    body={
      <Section
        title={_('account_partner_backend.section.title')}
        description={_('account_partner_backend.section.hint')}
        body={
          <Surface
            body={
              <RecordForm
                action={action}
                submit={_('account_partner_backend.action.save')}
                submitVariant="primary"
                cancelHref={backHref}
                cancelLabel={_('account_partner_backend.action.back')}
                errors={errors}
                fields={[
                  {
                    name: 'paymentTermId',
                    label: _('account_partner_backend.field.paymentTerm'),
                    type: 'select',
                    value: terms?.paymentTermId,
                    options: [{ value: '', label: '—' }, ...options.paymentTerms],
                  },
                  {
                    name: 'receivableAccountId',
                    label: _('account_partner_backend.field.receivable'),
                    type: 'select',
                    value: terms?.receivableAccountId,
                    options: [{ value: '', label: '—' }, ...options.receivable],
                  },
                  {
                    name: 'payableAccountId',
                    label: _('account_partner_backend.field.payable'),
                    type: 'select',
                    value: terms?.payableAccountId,
                    options: [{ value: '', label: '—' }, ...options.payable],
                  },
                ]}
              />
            }
          />
        }
      />
    }
  />
)
