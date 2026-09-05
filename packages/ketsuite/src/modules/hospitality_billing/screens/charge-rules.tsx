import { ListScreenFrame } from './page-frame.tsx'
import {
  CHARGE_TYPES,
  chargeName,
  type ChargeRuleRow,
  type ChoiceRow,
  dataTable,
  feedback,
  type Frame,
  linkButton,
  modalForm,
  modalWorkspace,
  Notice,
  ruleColumns,
  stack,
  type TemplateResult,
  type Translator,
} from './shared.tsx'

export const chargeRulesScreen = (
  _: Translator,
  rows: ChargeRuleRow[],
  taxes: ChoiceRow[],
  incomeAccounts: ChoiceRow[],
  taxAccounts: ChoiceRow[],
  frame: Frame,
  state?: string | null,
  modal?: {
    open: boolean
    createHref: string
    closeHref: string
    action: string
    selected?: ChargeRuleRow
    rowHref: (row: ChargeRuleRow) => string
    errors?: readonly string[]
    values?: Record<string, string>
  },
): TemplateResult => {
  const list = (
    <ListScreenFrame
      translator={_}
      title={_('hospitality_billing.chargeRules.title')}
      frame={frame}
      actions={linkButton({
        label: _('hospitality_billing.chargeRules.save'),
        href: modal?.createHref ?? '/admin/hospitality/billing/rules?create=1',
        variant: 'primary',
      })}
      body={stack([
        feedback(_, state),
        taxes.length ? null : (
          <Notice
            title={_('hospitality_billing.chargeRules.needsAccounting')}
            message={_('hospitality_billing.chargeRules.needsAccountingHint')}
            tone="warning"
            actions={linkButton({
              label: _('hospitality_billing.chargeRules.openAccounting'),
              href: '/admin/accounting',
            })}
          />
        ),
        dataTable(_, {
          columns: ruleColumns(_),
          rows,
          id: (row) => row.chargeType,
          rowHref: modal?.rowHref,
        }),
      ])}
    />
  )
  if (!modal?.open) return list
  return modalWorkspace(
    list,
    modalForm({
      id: 'hospitality-charge-rule-save',
      title: _('hospitality_billing.chargeRules.save'),
      description: _('hospitality_billing.chargeRules.intro'),
      closeHref: modal.closeHref,
      closeLabel: _('hospitality_core.action.cancel'),
      presentation: 'dialog',
      form: {
        id: 'hospitality-charge-rule-save-form',
        scope: 'hospitality-charge-rule-save',
        action: modal.action,
        submit: _('hospitality_billing.chargeRules.save'),
        submitVariant: 'primary',
        errors: modal.errors,
        cancelHref: modal.closeHref,
        cancelLabel: _('hospitality_core.action.cancel'),
        hidden: { operation: 'save-rule' },
        fields: [
          {
            name: 'chargeType',
            label: _('hospitality_billing.chargeRules.chargeType'),
            type: 'select',
            value: modal.values?.chargeType ?? modal.selected?.chargeType,
            required: true,
            options: CHARGE_TYPES.map((value) => ({ value, label: chargeName(_, value) })),
          },
          {
            name: 'taxId',
            label: _('hospitality_billing.chargeRules.tax'),
            type: 'select',
            value: modal.values?.taxId ?? modal.selected?.taxId ?? '',
            options: [
              { value: '', label: _('hospitality_billing.chargeRules.taxExempt') },
              ...taxes.map((tax) => ({ value: tax.id, label: tax.name })),
            ],
            help: _('hospitality_billing.chargeRules.taxHint'),
          },
          {
            name: 'incomeAccountId',
            label: _('hospitality_billing.chargeRules.incomeAccount'),
            type: 'select',
            value: modal.values?.incomeAccountId ?? modal.selected?.incomeAccountId ?? '',
            options: [
              { value: '', label: _('hospitality_billing.chargeRules.inherit') },
              ...incomeAccounts.map((account) => ({ value: account.id, label: account.name })),
            ],
            help: _('hospitality_billing.chargeRules.incomeAccountHint'),
          },
          {
            name: 'taxAccountId',
            label: _('hospitality_billing.chargeRules.taxAccount'),
            type: 'select',
            value: modal.values?.taxAccountId ?? modal.selected?.taxAccountId ?? '',
            options: [
              { value: '', label: _('hospitality_billing.chargeRules.inherit') },
              ...taxAccounts.map((account) => ({ value: account.id, label: account.name })),
            ],
          },
        ],
      },
    }),
  )
}
