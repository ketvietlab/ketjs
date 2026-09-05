import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec, ReportDef, Row } from '@ketvietlab/ketjs'
import { accountingDateText, DEFAULT_ACCOUNTING_TIMEZONE } from './date.ts'
import { minorText, moneyMinor, scaleOf } from './money.ts'

const template = (title: string) => `<report paper="A4" margin="42">
  <header><row gap="6"><text size="10" weight="bold" tone="accent">{{ company.name }}</text><text size="8" weight="semibold" tone="muted" align="right">KETSUITE · ACCOUNTING</text></row></header>
  <text size="9" weight="semibold" tone="accent" gap="12">{{ '${title}' | _ }}</text>
  <text size="24" weight="bold" gap="14">{{ name }}</text>
  <row gap="12"><text size="9" weight="semibold">{{ 'account.report.number' | _ }} · {{ name }}</text><text size="9" tone="muted" align="right">{{ 'account.report.date' | _ }} · {{ documentDate | date }}</text></row>
  <text size="8" weight="semibold" tone="muted" gap="3">{{ 'account.report.partner' | _ }}</text>
  <text size="12" weight="semibold" gap="18">{{ partner.name }}</text>
  <table><thead><tr><th>{{ 'account.report.description' | _ }}</th><th>{{ 'account.report.quantity' | _ }}</th><th>{{ 'account.report.unitPrice' | _ }}</th><th>{{ 'account.report.balance' | _ }}</th></tr></thead>
  <tbody>{% for line in lines %}<tr><td>{{ line.name }}</td><td>{{ line.quantity }}</td><td>{{ line.priceUnit | amount: currency }}</td><td>{{ line.amount | amount: currency }}</td></tr>{% endfor %}</tbody></table>
  <text size="9" tone="muted" align="right" gap="5">{{ 'account.report.untaxed' | _ }} · {{ amountUntaxed | amount: currency }}</text>
  <text size="9" tone="muted" align="right" gap="7">{{ 'account.report.tax' | _ }} · {{ amountTax | amount: currency }}</text>
  <text size="15" weight="bold" tone="accent" align="right" gap="4">{{ 'account.report.total' | _ }} · {{ amountTotal | amount: currency }}</text>
  <footer><row gap="0"><text size="8" weight="semibold" tone="muted">{{ company.name }}</text><text size="8" tone="muted" align="right">{page} / {pages}</text></row></footer>
</report>`

/**
 * The lines a customer should see, and the amount each one is for.
 *
 * A posted invoice holds three kinds of journal item: what was sold, the tax on
 * it, and the receivable or payable that balances the entry. Only the first kind
 * belongs on the printed document. The other two are the same money seen from
 * the ledger's side, and printing them put the tax on the invoice twice — once as
 * a line, once in the tax total — and the amount owed a third time, as though it
 * were another thing the customer had bought.
 *
 * The account is what separates them, because that is what the distinction
 * actually is: a sold line is revenue or cost, the counterpart is a receivable or
 * a payable, and the tax is a tax liability. Quantity cannot be used —
 * `createInvoice` writes a quantity of one on every posting — and neither can a
 * product id, which is null on most lines.
 *
 * Amounts print unsigned. A credit to revenue is stored negative because that is
 * what it is in double entry, but a customer reading an invoice for a million
 * đồng should not be shown minus one million.
 */
const invoiceLines = (lines: Row[], accounts: Map<string, Row>, scale: number) =>
  lines
    .filter((line) => {
      if (line.displayType) return false
      const type = String(accounts.get(String(line.accountId))?.accountType ?? '')
      return type.startsWith('income') || type.startsWith('expense')
    })
    .map((line) => {
      const balance = moneyMinor(line.balance ?? '0', scale)
      return { ...line, amount: minorText(balance < 0n ? -balance : balance, scale) }
    })

async function data(ctx: Parameters<FnSpec['handler']>[0], id: unknown, moveType: string) {
  // `/reports/{report}/{id}` calls a source with only the record id and enforces
  // nothing itself, so an unnarrowed read here hands a user who holds two
  // companies the other company's document for any id they can guess.
  const companyId = ctx.scope.company
  if (!companyId) return null
  const move = (await ctx.db.select('account.Move', { id, companyId }))[0]
  if (!move || move.moveType !== moveType) return null
  const company = ctx.scope.company
    ? (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
    : null
  const accounts = new Map(
    (await ctx.db.select('account.Account')).map((row) => [String(row.id), row] as const),
  )
  return {
    ...move,
    documentDate: accountingDateText(
      move.documentDate ?? move.invoiceDate ?? move.date,
      company?.accountingTimezone ?? DEFAULT_ACCOUNTING_TIMEZONE,
    ),
    company: company
      ? ((await ctx.db.select('partner.Partner', { id: company.partnerId }))[0] ?? { name: '' })
      : { name: '' },
    partner: move.partnerId
      ? ((await ctx.db.select('partner.Partner', { id: move.partnerId }))[0] ?? { name: '' })
      : { name: '' },
    lines: invoiceLines(
      await ctx.db.select('account.MoveLine', { moveId: id, companyId }),
      accounts,
      scaleOf(move.currency),
    ),
  }
}
const effects = [
  'read:account.Move',
  'read:account.MoveLine',
  'read:account.Account',
  'read:company.Company',
  'read:partner.Partner',
]
const output = {
  id: 'id',
  name: 'text',
  invoiceDate: 'datetime?',
  documentDate: 'date?',
  currency: 'text',
  amountUntaxed: 'decimal',
  amountTax: 'decimal',
  amountTotal: 'decimal',
  company: 'json',
  partner: 'json',
  lines: 'json',
}
export const reportFunctions: Record<string, FnSpec> = {
  getCustomerInvoiceReport: defineFn({
    input: { id: 'id' },
    output,
    effects,
    handler: (ctx, args) => data(ctx, args.id, 'out_invoice'),
  }),
  getVendorBillReport: defineFn({
    input: { id: 'id' },
    output,
    effects,
    handler: (ctx, args) => data(ctx, args.id, 'in_invoice'),
  }),
}
export const reports: Record<string, ReportDef> = {
  customerInvoice: {
    title: 'account.report.customerInvoice',
    target: 'account.Move',
    source: 'account.getCustomerInvoiceReport',
    template: template('account.report.customerInvoice'),
    filename: 'customer-invoice',
  },
  vendorBill: {
    title: 'account.report.vendorBill',
    target: 'account.Move',
    source: 'account.getVendorBillReport',
    template: template('account.report.vendorBill'),
    filename: 'vendor-bill',
  },
}
