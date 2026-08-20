import { defineFn } from 'ketjs'
import type { FnSpec, ReportDef } from 'ketjs'

const template = (title: string) => `<report paper="A4" margin="40">
  <header><text size="9" align="right">{{ company.name }}</text></header>
  <text size="22" weight="bold">{{ '${title}' | _ }}</text>
  <row><text>{{ 'sale.report.number' | _ }}: {{ name }}</text><text>{{ 'sale.report.date' | _ }}: {{ dateOrder }}</text></row>
  <text>{{ 'sale.report.customer' | _ }}: {{ partner.name }}</text>
  <table><thead><tr><th>{{ 'sale.report.description' | _ }}</th><th>{{ 'sale.report.quantity' | _ }}</th><th>{{ 'sale.report.unitPrice' | _ }}</th><th>{{ 'sale.report.subtotal' | _ }}</th></tr></thead>
  <tbody>{% for line in lines %}<tr><td>{{ line.name }}</td><td>{{ line.productUomQty }}</td><td>{{ line.priceUnit }}</td><td>{{ line.priceSubtotal }}</td></tr>{% endfor %}</tbody></table>
  <text align="right">{{ 'sale.report.untaxed' | _ }}: {{ amountUntaxed }} {{ currency }}</text>
  <text align="right">{{ 'sale.report.tax' | _ }}: {{ amountTax }} {{ currency }}</text>
  <text size="14" weight="bold" align="right">{{ 'sale.report.total' | _ }}: {{ amountTotal }} {{ currency }}</text>
  <footer><text size="8" align="center">{page}/{pages}</text></footer>
</report>`

async function data(ctx: Parameters<FnSpec['handler']>[0], id: unknown, states: string[]) {
  const order = (await ctx.db.select('sale.Order', { id }))[0]
  if (!order || !states.includes(String(order.state))) return null
  const company = ctx.scope.company
    ? (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
    : null
  const companyParty = company ? (await ctx.db.select('partner.Partner', { id: company.partnerId }))[0] : null
  const partner = (await ctx.db.select('partner.Partner', { id: order.partnerId }))[0]
  return {
    ...order,
    company: companyParty ?? { name: '' },
    partner: partner ?? { name: '' },
    lines: await ctx.db.select('sale.OrderLine', { orderId: id }),
  }
}

const effects = ['read:sale.Order', 'read:sale.OrderLine', 'read:company.Company', 'read:partner.Partner']
const output = {
  id: 'id',
  name: 'text',
  dateOrder: 'datetime',
  currency: 'text',
  amountUntaxed: 'decimal',
  amountTax: 'decimal',
  amountTotal: 'decimal',
  company: 'json',
  partner: 'json',
  lines: 'json',
}
export const reportFunctions: Record<string, FnSpec> = {
  getQuotationReport: defineFn({
    input: { id: 'id' },
    output,
    effects,
    handler: (ctx, args) => data(ctx, args.id, ['draft', 'sent']),
  }),
  getSalesOrderReport: defineFn({
    input: { id: 'id' },
    output,
    effects,
    handler: (ctx, args) => data(ctx, args.id, ['sale']),
  }),
}

export const reports: Record<string, ReportDef> = {
  quotation: {
    title: 'sale.report.quotation',
    target: 'sale.Order',
    source: 'sale.getQuotationReport',
    template: template('sale.report.quotation'),
    filename: 'quotation',
  },
  salesOrder: {
    title: 'sale.report.salesOrder',
    target: 'sale.Order',
    source: 'sale.getSalesOrderReport',
    template: template('sale.report.salesOrder'),
    filename: 'sales-order',
  },
}
