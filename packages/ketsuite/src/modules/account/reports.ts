import { defineFn } from 'ketjs'
import type { FnSpec, ReportDef } from 'ketjs'

const template = (title: string) => `<report paper="A4" margin="40">
  <header><text size="9" align="right">{{ company.name }}</text></header>
  <text size="22" weight="bold">{{ '${title}' | _ }}</text>
  <row><text>{{ 'account.report.number' | _ }}: {{ name }}</text><text>{{ 'account.report.date' | _ }}: {{ invoiceDate }}</text></row>
  <text>{{ 'account.report.partner' | _ }}: {{ partner.name }}</text>
  <table><thead><tr><th>{{ 'account.report.description' | _ }}</th><th>{{ 'account.report.quantity' | _ }}</th><th>{{ 'account.report.unitPrice' | _ }}</th><th>{{ 'account.report.balance' | _ }}</th></tr></thead>
  <tbody>{% for line in lines %}<tr><td>{{ line.name }}</td><td>{{ line.quantity }}</td><td>{{ line.priceUnit }}</td><td>{{ line.balance }}</td></tr>{% endfor %}</tbody></table>
  <text align="right">{{ 'account.report.untaxed' | _ }}: {{ amountUntaxed }} {{ currency }}</text>
  <text align="right">{{ 'account.report.tax' | _ }}: {{ amountTax }} {{ currency }}</text>
  <text size="14" weight="bold" align="right">{{ 'account.report.total' | _ }}: {{ amountTotal }} {{ currency }}</text>
  <footer><text size="8" align="center">{page}/{pages}</text></footer>
</report>`

async function data(ctx: Parameters<FnSpec['handler']>[0], id: unknown, moveType: string) {
  const move = (await ctx.db.select('account.Move', { id }))[0]
  if (!move || move.moveType !== moveType) return null
  const company = ctx.scope.company
    ? (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
    : null
  return {
    ...move,
    company: company
      ? ((await ctx.db.select('partner.Partner', { id: company.partnerId }))[0] ?? { name: '' })
      : { name: '' },
    partner: move.partnerId
      ? ((await ctx.db.select('partner.Partner', { id: move.partnerId }))[0] ?? { name: '' })
      : { name: '' },
    lines: (await ctx.db.select('account.MoveLine', { moveId: id })).filter((line) => !line.displayType),
  }
}
const effects = ['read:account.Move', 'read:account.MoveLine', 'read:company.Company', 'read:partner.Partner']
const output = {
  id: 'id',
  name: 'text',
  invoiceDate: 'datetime?',
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
