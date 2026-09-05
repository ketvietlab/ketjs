import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  button,
  FormCluster,
  FormPage,
  linkButton,
  modalForm,
  RecordForm,
  Section,
  shell,
  Surface,
} from '../../../ui/index.ts'
import type { FormOption, Frame } from '../../../ui/index.ts'

export type AccountingTermsPartner = { id: string; name: string }

export type AccountingTerms = {
  paymentTermId?: string | null
  receivableAccountId?: string | null
  payableAccountId?: string | null
}

export type AccountingTermsOptions = {
  paymentTerms: FormOption[]
  receivable: FormOption[]
  payable: FormOption[]
}

const accountingTermsFields = (
  _: Translator,
  terms: AccountingTerms | null,
  options: AccountingTermsOptions,
) => [
  {
    name: 'paymentTermId',
    label: _('account_partner_backend.field.paymentTerm'),
    type: 'select' as const,
    value: terms?.paymentTermId,
    options: [{ value: '', label: '—' }, ...options.paymentTerms],
  },
  {
    name: 'receivableAccountId',
    label: _('account_partner_backend.field.receivable'),
    type: 'select' as const,
    value: terms?.receivableAccountId,
    options: [{ value: '', label: '—' }, ...options.receivable],
  },
  {
    name: 'payableAccountId',
    label: _('account_partner_backend.field.payable'),
    type: 'select' as const,
    value: terms?.payableAccountId,
    options: [{ value: '', label: '—' }, ...options.payable],
  },
]

export const accountingTermsModal = (
  _: Translator,
  partner: AccountingTermsPartner,
  terms: AccountingTerms | null,
  options: AccountingTermsOptions,
  action: string,
  backHref: string,
  errors?: string[],
): TemplateResult =>
  modalForm({
    id: 'partner-accounting-terms',
    title: _('account_partner_backend.screen.title', { name: partner.name }),
    description: _('account_partner_backend.section.hint'),
    closeHref: backHref,
    closeLabel: _('account_partner_backend.action.back'),
    presentation: 'dialog',
    size: 'large',
    form: {
      id: 'partner-accounting-terms-form',
      scope: 'partner-accounting-terms',
      action,
      submit: _('account_partner_backend.action.save'),
      submitVariant: 'primary',
      cancelHref: backHref,
      cancelLabel: _('account_partner_backend.action.back'),
      errors,
      fields: accountingTermsFields(_, terms, options),
    },
  })

export const accountingTermsScreen = (
  _: Translator,
  partner: AccountingTermsPartner,
  terms: AccountingTerms | null,
  options: AccountingTermsOptions,
  frame: Frame,
  action: string,
  backHref: string,
  errors?: string[],
): TemplateResult => {
  const formId = 'partner-accounting-terms-form'
  const title = _('account_partner_backend.screen.title', { name: partner.name })

  return shell(
    _,
    title,
    <FormPage
      variant="operational"
      frame={frame}
      scope="partner-accounting-terms-form-page"
      title={title}
      description={_('account_partner_backend.section.hint')}
      actions={
        <FormCluster
          label={_('account_partner_backend.section.title')}
          forms={[
            button({
              label: _('account_partner_backend.action.save'),
              type: 'submit',
              form: formId,
              variant: 'primary',
            }),
            linkButton({
              label: _('account_partner_backend.action.back'),
              href: backHref,
              variant: 'secondary',
            }),
          ]}
        />
      }
      body={
        <Section
          title={_('account_partner_backend.section.title')}
          body={
            <Surface
              body={
                <RecordForm
                  id={formId}
                  scope="partner-accounting-terms"
                  action={action}
                  submit={_('account_partner_backend.action.save')}
                  submitVariant="primary"
                  submitPlacement="external"
                  errors={errors}
                  fields={accountingTermsFields(_, terms, options)}
                />
              }
            />
          }
        />
      }
    />,
    { ...frame, topbar: false, titled: false },
  )
}
