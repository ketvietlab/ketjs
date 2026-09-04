import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import {
  badge,
  dataTable,
  emptyState,
  ListScreen,
  linkButton,
  modalForm,
  modalWorkspace,
  Notice,
  RecordForm,
  Section,
  stack,
} from '../../../ui/index.ts'
import type { Column, Frame } from '../../../ui/index.ts'
import { CHARGE_TYPES } from '../../hospitality_core/types.ts'

export {
  badge,
  dataTable,
  emptyState,
  ListScreen,
  linkButton,
  modalForm,
  modalWorkspace,
  Notice,
  RecordForm,
  Section,
  stack,
  CHARGE_TYPES,
}
export type { Translator, TemplateResult, Column, Frame }

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

export type BillingBlocker = {
  code:
    | 'folio_open'
    | 'folio_without_charges'
    | 'charge_rule_missing'
    | 'journal_missing'
    | 'folio_without_guest'
  params?: { types?: string[]; state?: string }
  repairHref: string
}

export type FolioBillingRow = {
  folioId: string
  folioCode: string
  guest: string | null
  closedAt: string | null
  folioState: string
  folioTotal: string
  chargeCount: number
  missingRules: string[]
  blockers: BillingBlocker[]
  moveId: string | null
  moveName: string | null
  amountTotal: string | null
  amountDue: string | null
  paymentState: string | null
}

export const chargeName = (_: Translator, type: string): string =>
  (CHARGE_TYPES as readonly string[]).includes(type) ? _(`hospitality_billing.chargeType.${type}`) : type

const blockerLabel = (_: Translator, blocker: BillingBlocker): string => {
  if (blocker.code === 'charge_rule_missing')
    return _(`hospitality_billing.blocker.${blocker.code}`, {
      types: (blocker.params?.types ?? []).map((type) => chargeName(_, type)).join(', '),
    })
  return _(`hospitality_billing.blocker.${blocker.code}`)
}

export const feedback = (_: Translator, state?: string | null): TemplateResult | null => {
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

export const ruleColumns = (_: Translator): Column<ChargeRuleRow>[] => [
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

export const folioColumns = (_: Translator): Column<FolioBillingRow>[] => [
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
      if (row.blockers.length)
        return stack(
          row.blockers.map((blocker) =>
            stack([
              badge(blockerLabel(_, blocker), 'danger'),
              linkButton({
                label: _('hospitality_billing.blocker.repair'),
                href: blocker.repairHref,
                variant: 'secondary',
              }),
            ]),
          ),
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
      ) : row.blockers.length ? (
        '—'
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
