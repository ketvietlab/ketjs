import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  Framed,
  linkButton,
  Notice,
  RecordForm,
  Section,
  stack,
} from '../../ui/index.ts'
import type { Column, Frame } from '../../ui/index.ts'
import { CHARGE_TYPES } from '../hospitality_core/types.ts'

export type ChargeRuleRow = {
  chargeType: string
  configured: boolean
  incomeAccountId: string | null
  incomeAccountName: string | null
  taxId: string | null
  taxName: string | null
  taxAccountId: string | null
  taxExempt: boolean
}

export type ChoiceRow = { id: string; name: string }

export type FolioBillingRow = {
  folioId: string
  folioCode: string
  guest: string | null
  closedAt: string | null
  folioTotal: string
  chargeCount: number
  missingRules: string[]
  moveId: string | null
  moveName: string | null
  amountTotal: string | null
  amountDue: string | null
  paymentState: string | null
}

const chargeName = (_: Translator, type: string): string =>
  (CHARGE_TYPES as readonly string[]).includes(type) ? _(`hospitality_billing.chargeType.${type}`) : type

const feedback = (_: Translator, state?: string | null): TemplateResult | null => {
  if (state === 'saved')
    return (
      <Notice
        title={_('hospitality_billing.feedback.saved')}
        message={_('hospitality_billing.feedback.savedHint')}
        tone="positive"
      />
    )
  if (state === 'invoiced')
    return (
      <Notice
        title={_('hospitality_billing.feedback.invoiced')}
        message={_('hospitality_billing.feedback.invoicedHint')}
        tone="positive"
      />
    )
  if (state === 'paid')
    return (
      <Notice
        title={_('hospitality_billing.feedback.paid')}
        message={_('hospitality_billing.feedback.paidHint')}
        tone="positive"
      />
    )
  if (state === 'queued')
    return (
      <Notice
        title={_('hospitality_billing.feedback.queued')}
        message={_('hospitality_billing.feedback.queuedHint')}
        tone="info"
      />
    )
  if (state === 'invalid')
    return (
      <Notice
        title={_('hospitality_billing.feedback.invalid')}
        message={_('hospitality_billing.feedback.invalidHint')}
        tone="danger"
      />
    )
  return null
}

const ruleColumns = (_: Translator): Column<ChargeRuleRow>[] => [
  {
    key: 'chargeType',
    label: _('hospitality_billing.chargeRules.chargeType'),
    cell: (row) => chargeName(_, row.chargeType),
  },
  {
    key: 'state',
    label: _('hospitality_billing.col.state'),
    cell: (row) =>
      row.configured
        ? badge(_('hospitality_billing.chargeRules.configured'), 'positive')
        : badge(_('hospitality_billing.chargeRules.missing'), 'danger'),
  },
  {
    key: 'incomeAccountName',
    label: _('hospitality_billing.chargeRules.incomeAccount'),
    cell: (row) => row.incomeAccountName ?? '—',
  },
  {
    key: 'taxName',
    label: _('hospitality_billing.chargeRules.tax'),
    cell: (row) => (row.taxExempt ? _('hospitality_billing.chargeRules.taxExempt') : (row.taxName ?? '—')),
  },
]

/**
 * The screen a folio cannot be invoiced without.
 *
 * It leads with the rules that are missing rather than the ones that are set,
 * because an undeclared charge type is what stops a checkout billing, and the
 * operator reading this arrived here from that refusal.
 */
export const chargeRulesScreen = (
  _: Translator,
  rows: ChargeRuleRow[],
  taxes: ChoiceRow[],
  incomeAccounts: ChoiceRow[],
  taxAccounts: ChoiceRow[],
  frame: Frame,
  state?: string | null,
): TemplateResult => (
  <Framed
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

const folioColumns = (_: Translator): Column<FolioBillingRow>[] => [
  {
    key: 'folioCode',
    label: _('hospitality_billing.col.folio'),
    cell: (row) => row.folioCode,
  },
  { key: 'guest', label: _('hospitality_billing.col.guest'), cell: (row) => row.guest ?? '—' },
  {
    key: 'folioTotal',
    label: _('hospitality_billing.col.charges'),
    align: 'end',
    cell: (row) => row.folioTotal,
  },
  {
    key: 'state',
    label: _('hospitality_billing.col.state'),
    cell: (row) => {
      if (row.missingRules.length)
        return badge(
          _('hospitality_billing.state.blocked', {
            types: row.missingRules.map((type) => chargeName(_, type)).join(', '),
          }),
          'danger',
        )
      if (!row.moveId) return badge(_('hospitality_billing.state.unbilled'), 'neutral')
      if (row.paymentState === 'paid') return badge(_('hospitality_billing.state.paid'), 'positive')
      return badge(_('hospitality_billing.state.owing'), 'warning')
    },
  },
  {
    key: 'moveName',
    label: _('hospitality_billing.col.invoice'),
    cell: (row) => row.moveName ?? '—',
  },
  {
    key: 'amountDue',
    label: _('hospitality_billing.col.due'),
    align: 'end',
    cell: (row) => row.amountDue ?? '—',
  },
  {
    key: 'action',
    label: '',
    cell: (row) =>
      row.moveId ? (
        <RecordForm
          action="/admin/hospitality/billing"
          method="post"
          submit={_('hospitality_billing.action.recordPayment')}
          submitVariant="secondary"
          hidden={{ operation: 'record-payment', folioId: row.folioId }}
          fields={[
            {
              name: 'amount',
              label: _('hospitality_billing.field.amount'),
              type: 'decimal',
              value: row.amountDue ?? '0',
              required: true,
            },
          ]}
        />
      ) : (
        <RecordForm
          action="/admin/hospitality/billing"
          method="post"
          submit={_('hospitality_billing.action.invoice')}
          submitVariant="primary"
          hidden={{ operation: 'invoice-folio', folioId: row.folioId }}
          fields={[]}
        />
      ),
  },
]

/**
 * Closed folios and what became of them.
 *
 * Only closed ones: an open folio can still take charges, and billing one would
 * be superseded by the next night audit. The blocked badge names the charge type
 * whose rule is missing, so the fix is one link away rather than a hunt.
 */
export const billingScreen = (
  _: Translator,
  rows: FolioBillingRow[],
  frame: Frame,
  state?: string | null,
): TemplateResult => (
  <Framed
    translator={_}
    title={_('hospitality_billing.screen.title')}
    subtitle={_('hospitality_billing.screen.subtitle')}
    frame={frame}
    body={stack([
      feedback(_, state),
      rows.length
        ? dataTable(_, { columns: folioColumns(_), rows, id: (row) => row.folioId })
        : // A dead end that names the next step and does not link to it is the
          // defect the hospitality review filed seven times; the rules screen is
          // where an operator has to go from here.
          emptyState(_('hospitality_billing.screen.empty'), _('hospitality_billing.screen.emptyHint'), {
            actions: linkButton({
              label: _('hospitality_billing.menu.chargeRules'),
              href: '/admin/hospitality/billing/rules',
            }),
          }),
      // A hotel closes folios all night with nobody at the desk. One press bills
      // everything that is only waiting for one.
      rows.some((row) => !row.moveId && !row.missingRules.length) ? (
        <RecordForm
          action="/admin/hospitality/billing"
          method="post"
          submit={_('hospitality_billing.action.invoiceAll')}
          submitVariant="secondary"
          hidden={{ operation: 'queue-closed' }}
          fields={[]}
        />
      ) : null,
    ])}
  />
)
