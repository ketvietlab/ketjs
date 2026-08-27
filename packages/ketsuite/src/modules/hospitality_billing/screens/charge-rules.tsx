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
  Notice,
  RecordForm,
  ruleColumns,
  Section,
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
): TemplateResult => (
  <ListScreenFrame
    translator={_}
    title={_('hospitality_billing.chargeRules.title')}
    frame={frame}
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
      <Section
        title={_('hospitality_billing.chargeRules.save')}
        description={_('hospitality_billing.chargeRules.intro')}
        body={
          <RecordForm
            action="/admin/hospitality/billing/rules"
            method="post"
            submit={_('hospitality_billing.chargeRules.save')}
            submitVariant="primary"
            hidden={{ operation: 'save-rule' }}
            fields={[
              {
                name: 'chargeType',
                label: _('hospitality_billing.chargeRules.chargeType'),
                type: 'select',
                required: true,
                options: CHARGE_TYPES.map((value) => ({ value, label: chargeName(_, value) })),
              },
              {
                name: 'taxId',
                label: _('hospitality_billing.chargeRules.tax'),
                type: 'select',
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
                options: [
                  { value: '', label: _('hospitality_billing.chargeRules.inherit') },
                  ...taxAccounts.map((account) => ({ value: account.id, label: account.name })),
                ],
              },
            ]}
          />
        }
      />,
      dataTable(_, { columns: ruleColumns(_), rows, id: (row) => row.chargeType }),
    ])}
  />
)
