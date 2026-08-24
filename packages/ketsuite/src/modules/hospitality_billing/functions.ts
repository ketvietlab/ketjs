/**
 * What a folio owes, said in the ledger's words.
 *
 * A folio is an operational record: it knows a guest stayed four nights, drank
 * from the minibar and cancelled a spa booking. It has no receivable, no tax and
 * no invoice, and closing it at checkout settles nothing — which is why a front
 * desk running KetSuite could not take money, and why an OTA's prepaid amount
 * had nowhere to land.
 *
 * This module is the one seam between the two. It reads charges and writes an
 * accounting document; it never writes a charge and never touches inventory. Tax
 * is the whole reason it needs a configuration of its own: a charge knows what
 * it is, not what it is taxed at, and guessing that is how an invoice ends up
 * claiming a minibar is not subject to VAT.
 */

import { asc, defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { functions as accountFunctions } from '../account/functions.ts'
import { CHARGE_TYPES } from '../hospitality_core/types.ts'

type Issue = { field: string; code: string; messageKey: string; params?: Record<string, unknown> }

const issue = (field: string, code: string, params?: Record<string, unknown>): Issue => ({
  field,
  code,
  messageKey: `hospitality_billing.validation.${code}`,
  ...(params ? { params } : {}),
})

const failure = (...errors: Issue[]) => ({ ok: false, errors })
const n = (value: unknown): number => Number(value ?? 0)
const now = (): string => new Date().toISOString()

const one = async (ctx: Ctx, model: string, id: unknown): Promise<Row | null> =>
  id ? ((await ctx.db.select(model, { id }))[0] ?? null) : null

/** The effects of the account functions this module calls through. */
const INVOICE_EFFECTS = [
  ...(accountFunctions.createInvoice?.effects ?? []),
  ...(accountFunctions.postMove?.effects ?? []),
] as string[]

const PAYMENT_EFFECTS = [...(accountFunctions.registerPayment?.effects ?? [])] as string[]

const FOLIO_EFFECTS = ['read:hospitality_core.Folio', 'read:hospitality_core.Charge'] as const

/** The document a folio's bill is written under, derived so a retry converges. */
const billIdFor = (folioId: unknown): string => `folio-bill:${String(folioId)}`

/**
 * The charges an invoice is made of.
 *
 * Voided ones are gone as far as money is concerned, and a zero charge is a row
 * that says nothing — putting either on an invoice asks a guest to read a line
 * that does not change what they owe.
 */
const billableCharges = async (ctx: Ctx, folioId: unknown): Promise<Row[]> => {
  const C = ctx.table('hospitality_core.Charge')
  const rows = await ctx.db.all(from(C).where(eq(C.folioId, folioId)).orderBy(asc(C.occurredAt), asc(C.id)))
  return rows.filter((row) => String(row.state) === 'active' && n(row.amount) !== 0)
}

/**
 * A charge as an invoice line.
 *
 * Quantity and unit price are carried across so the guest reads "2 nights ×
 * 500" rather than a total with no working. A discount is stored as a positive
 * unit price and a negative amount, so the sign lives on the price here — and
 * when the two disagree, the amount wins, because that is the figure the folio
 * totalled.
 */
const lineFor = (charge: Row, rule: Row): Record<string, unknown> => {
  const amount = n(charge.amount)
  const quantity = n(charge.quantity)
  const unitPrice = n(charge.unitPrice)
  const consistent = quantity !== 0 && Math.abs(quantity * unitPrice - Math.abs(amount)) < 0.005
  return {
    description: String(charge.description),
    productId: charge.productId ?? null,
    productUomId: charge.uomId ?? null,
    quantity: consistent ? String(quantity) : '1',
    priceUnit: consistent ? String(Math.sign(amount) * unitPrice) : String(amount),
    lineAccountId: rule.incomeAccountId ?? null,
    taxId: rule.taxId ?? null,
    taxAccountId: rule.taxAccountId ?? null,
  }
}

export const functions: Record<string, FnSpec> = {
  /**
   * Every charge type, and what it is invoiced as.
   *
   * Types with no rule are listed too, with nothing against them — a settings
   * screen has to be able to show the gap, since the gap is what stops a folio
   * being invoiced.
   */
  listChargeRules: defineFn({
    input: {},
    effects: ['read:hospitality_billing.ChargeRule', 'read:account.Tax', 'read:account.Account'],
    agent: true,
    handler: async (ctx) => {
      const rules = new Map(
        (await ctx.db.select('hospitality_billing.ChargeRule')).map((row) => [String(row.chargeType), row]),
      )
      const named = async (model: string, id: unknown): Promise<string | null> => {
        const row = await one(ctx, model, id)
        return row ? String(row.name) : null
      }
      return Promise.all(
        CHARGE_TYPES.map(async (chargeType) => {
          const rule = rules.get(chargeType) ?? null
          return {
            chargeType,
            configured: Boolean(rule),
            incomeAccountId: rule?.incomeAccountId ?? null,
            incomeAccountName: await named('account.Account', rule?.incomeAccountId),
            taxId: rule?.taxId ?? null,
            taxName: await named('account.Tax', rule?.taxId),
            taxAccountId: rule?.taxAccountId ?? null,
            taxExempt: rule?.taxExempt === true,
          }
        }),
      )
    },
  }),

  saveChargeRule: defineFn({
    input: {
      chargeType: 'text',
      incomeAccountId: 'id?',
      taxId: 'id?',
      taxAccountId: 'id?',
      taxExempt: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:hospitality_billing.ChargeRule',
      'read:account.Account',
      'read:account.Tax',
      'write:hospitality_billing.ChargeRule',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const chargeType = String(args.chargeType ?? '')
      if (!(CHARGE_TYPES as readonly string[]).includes(chargeType))
        return failure(issue('chargeType', 'charge_type'))

      const exempt = args.taxExempt === true
      // Exactly one of the two, so the rule always answers the tax question. A
      // row carrying neither reads as unfinished; one carrying both is two
      // answers, and the invoice would have to pick.
      if (exempt && args.taxId) return failure(issue('taxId', 'tax_exempt_with_tax'))
      if (!exempt && !args.taxId) return failure(issue('taxId', 'tax_required'))

      if (args.taxId) {
        const tax = await one(ctx, 'account.Tax', args.taxId)
        if (!tax) return failure(issue('taxId', 'tax_missing'))
        if (!['sale', 'none'].includes(String(tax.typeTaxUse))) return failure(issue('taxId', 'tax_not_sale'))
      }
      if (args.incomeAccountId) {
        const account = await one(ctx, 'account.Account', args.incomeAccountId)
        if (!account) return failure(issue('incomeAccountId', 'account_missing'))
        if (!String(account.accountType).startsWith('income'))
          return failure(issue('incomeAccountId', 'account_not_income'))
      }
      if (args.taxAccountId && !(await one(ctx, 'account.Account', args.taxAccountId)))
        return failure(issue('taxAccountId', 'account_missing'))

      // One row per company and charge type, so the id is derived rather than
      // generated: saving again corrects the rule instead of racing it.
      const id = `charge-rule:${String(ctx.scope.company ?? '')}:${chargeType}`
      const values = {
        chargeType,
        incomeAccountId: args.incomeAccountId ?? null,
        taxId: args.taxId ?? null,
        taxAccountId: args.taxAccountId ?? null,
        taxExempt: exempt,
        updatedAt: now(),
      }
      const held = (await ctx.db.select('hospitality_billing.ChargeRule', { id }))[0]
      if (held) await ctx.db.update('hospitality_billing.ChargeRule', { id }, values)
      else await ctx.db.insert('hospitality_billing.ChargeRule', { id, ...values })
      return { ok: true, id, errors: [] }
    },
  }),

  /**
   * What a folio owes, whether or not it has been invoiced yet.
   *
   * The same call answers before and after: before, it says what the invoice
   * would be made of and what is stopping it; after, it says what was billed and
   * what is still outstanding.
   */
  getFolioBilling: defineFn({
    input: { folioId: 'id' },
    effects: [
      ...FOLIO_EFFECTS,
      'read:hospitality_billing.ChargeRule',
      'read:hospitality_billing.FolioBill',
      'read:account.Move',
      'read:account.MoveLine',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const folio = await one(ctx, 'hospitality_core.Folio', args.folioId)
      if (!folio) return null
      const charges = await billableCharges(ctx, args.folioId)
      const rules = new Set(
        (await ctx.db.select('hospitality_billing.ChargeRule')).map((row) => String(row.chargeType)),
      )
      const bill =
        (await ctx.db.select('hospitality_billing.FolioBill', { folioId: args.folioId }))[0] ?? null
      const move = bill ? await one(ctx, 'account.Move', bill.moveId) : null

      // What is owed comes from the receivable line, not from the folio total:
      // once an invoice exists the ledger is the record, and a payment is only
      // visible there.
      let due: number | null = null
      if (move) {
        const L = ctx.table('account.MoveLine')
        const counterpart = await ctx.db.one(from(L).where(eq(L.id, `${String(move.id)}:counterpart`)))
        due = counterpart ? n(counterpart.amountResidual) : null
      }

      return {
        folioId: String(folio.id),
        folioState: String(folio.state),
        folioTotal: String(folio.amountTotal ?? '0'),
        chargeCount: charges.length,
        // Named so a screen can say which decision is missing rather than only
        // that something is.
        missingRules: [...new Set(charges.map((row) => String(row.type)))].filter((type) => !rules.has(type)),
        moveId: move ? String(move.id) : null,
        moveName: move ? String(move.name) : null,
        moveState: move ? String(move.state) : null,
        amountTotal: move ? String(move.amountTotal) : null,
        amountDue: due === null ? null : String(due),
        paymentState: move ? String(move.paymentState) : null,
      }
    },
  }),

  /**
   * Turn a closed folio into a posted sales entry.
   *
   * Closed and not open, because an invoice fixes what is owed and an open folio
   * can still take charges: billing one would either be superseded by a night
   * audit an hour later or force a second document for the same stay. Checkout
   * is the moment the stay stops moving, and it is the moment this belongs to.
   *
   * Safe to call twice — by the sweep, by a retried checkout, by an operator who
   * did not see the first one land. The bill row is unique per folio and the
   * entry id is derived from it, so every one of those converges on one invoice.
   */
  invoiceFolio: defineFn({
    input: { folioId: 'id', journalId: 'id?', invoiceDate: 'datetime?' },
    output: { ok: 'bool', id: 'id?', moveId: 'id?', amountTotal: 'decimal?', errors: 'json?' },
    effects: [
      ...FOLIO_EFFECTS,
      'read:hospitality_billing.ChargeRule',
      'read:hospitality_billing.FolioBill',
      'write:hospitality_billing.FolioBill',
      'read:account.Journal',
      ...INVOICE_EFFECTS,
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('hospitality_billing.FolioBill', { folioId: args.folioId }))[0]
      if (existing)
        return {
          ok: true,
          id: String(existing.id),
          moveId: String(existing.moveId),
          amountTotal: String(existing.amountTotal),
          errors: [],
        }

      const folio = await one(ctx, 'hospitality_core.Folio', args.folioId)
      if (!folio) return failure(issue('folioId', 'folio_missing'))
      if (String(folio.state) !== 'closed') return failure(issue('folioId', 'folio_not_closed'))
      if (!folio.partnerId) return failure(issue('folioId', 'folio_without_guest'))

      const charges = await billableCharges(ctx, args.folioId)
      if (!charges.length) return failure(issue('folioId', 'folio_without_charges'))

      const rules = new Map(
        (await ctx.db.select('hospitality_billing.ChargeRule')).map((row) => [String(row.chargeType), row]),
      )
      const lines: Record<string, unknown>[] = []
      for (const charge of charges) {
        const rule = rules.get(String(charge.type))
        // The refusal that matters most in this module. Filing a line with no
        // tax on it tells the authority the sale is not subject to VAT, which is
        // a claim — not a gap — and it would be made silently for every folio.
        if (!rule) return failure(issue('chargeType', 'charge_rule_missing', { type: charge.type }))
        lines.push(lineFor(charge, rule))
      }

      let journalId = args.journalId
      if (journalId) {
        const journal = await one(ctx, 'account.Journal', journalId)
        if (!journal) return failure(issue('journalId', 'journal_missing'))
        if (String(journal.type) !== 'sale') return failure(issue('journalId', 'journal_not_sale'))
      } else {
        const J = ctx.table('account.Journal')
        const journal = await ctx.db.one(from(J).where(eq(J.type, 'sale')).orderBy(asc(J.code)))
        if (!journal) return failure(issue('journalId', 'journal_missing'))
        journalId = journal.id
      }

      const moveId = billIdFor(args.folioId)
      const created = (await accountFunctions.createInvoice!.handler(ctx, {
        id: moveId,
        journalId,
        moveType: 'out_invoice',
        partnerId: folio.partnerId,
        ref: String(folio.code ?? folio.id),
        invoiceDate: args.invoiceDate ?? now(),
        lines,
      })) as Row
      // Accounting's refusals are already field-shaped; passing them through
      // keeps the reason for a rejected folio the reason the ledger gave.
      if (created.ok !== true) return created

      const posted = (await accountFunctions.postMove!.handler(ctx, { id: moveId })) as Row
      if (posted.ok !== true) return posted

      const timestamp = now()
      const bill = await ctx.db.insertIfAbsent('hospitality_billing.FolioBill', {
        id: moveId,
        folioId: args.folioId,
        moveId,
        state: 'invoiced',
        chargeCount: charges.length,
        amountTotal: String(created.amountTotal),
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      // Two callers reached the same folio at once. The entry is the same one —
      // its id came from the folio — so the loser reports what the winner wrote.
      if (!('dryRun' in bill) && !bill.inserted) {
        const held = (await ctx.db.select('hospitality_billing.FolioBill', { folioId: args.folioId }))[0]
        if (held)
          return {
            ok: true,
            id: String(held.id),
            moveId: String(held.moveId),
            amountTotal: String(held.amountTotal),
            errors: [],
          }
      }

      return {
        ok: true,
        id: moveId,
        moveId,
        amountTotal: String(created.amountTotal),
        errors: [],
      }
    },
  }),

  /**
   * Money taken against a folio's invoice.
   *
   * Both what the desk collects at checkout and what a channel collected weeks
   * earlier: a prepayment is the same event seen at a different time, and it
   * settles the same receivable. The caller names the payment, so an OTA can
   * derive an id from its own booking reference and post the prepaid amount
   * exactly once however often it retries.
   */
  recordFolioPayment: defineFn({
    input: {
      id: 'id',
      folioId: 'id',
      amount: 'decimal',
      journalId: 'id',
      date: 'datetime?',
      reference: 'text?',
      memo: 'text?',
    },
    output: { ok: 'bool', id: 'id?', moveId: 'id?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Folio',
      'read:hospitality_billing.FolioBill',
      'read:account.Move',
      'read:account.MoveLine',
      ...PAYMENT_EFFECTS,
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const bill = (await ctx.db.select('hospitality_billing.FolioBill', { folioId: args.folioId }))[0]
      if (!bill) return failure(issue('folioId', 'folio_not_invoiced'))
      const folio = await one(ctx, 'hospitality_core.Folio', args.folioId)

      const counterpartId = `${String(bill.moveId)}:counterpart`
      const counterpart = await one(ctx, 'account.MoveLine', counterpartId)
      if (!counterpart) return failure(issue('folioId', 'folio_not_invoiced'))

      return (await accountFunctions.registerPayment!.handler(ctx, {
        id: args.id,
        name: String(args.reference ?? folio?.code ?? args.id),
        paymentType: 'inbound',
        partnerType: 'customer',
        partnerId: folio?.partnerId ?? null,
        journalId: args.journalId,
        destinationAccountId: counterpart.accountId,
        amount: args.amount,
        date: args.date,
        memo: args.memo ?? null,
        paymentReference: args.reference ?? null,
        reconcileLineId: counterpartId,
      })) as Row
    },
  }),
}
