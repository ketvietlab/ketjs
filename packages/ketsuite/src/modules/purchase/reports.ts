import { defineFn } from 'ketjs'
import type { FnSpec, ReportDef } from 'ketjs'

const template = (title: string) => `<report paper="A4" margin="40">
  <header><text size="9" align="right">{{ company.name }}</text></header>
  <text size="22" weight="bold">{{ '${title}' | _ }}</text>
  <row><text>{{ 'purchase.report.number' | _ }}: {{ name }}</text><text>{{ 'purchase.report.date' | _ }}: {{ dateOrder }}</text></row>
  <text>{{ 'purchase.report.vendor' | _ }}: {{ partner.name }}</text>
  <table><thead><tr><th>{{ 'purchase.report.description' | _ }}</th><th>{{ 'purchase.report.quantity' | _ }}</th><th>{{ 'purchase.report.unitPrice' | _ }}</th><th>{{ 'purchase.report.subtotal' | _ }}</th></tr></thead>
  <tbody>{% for line in lines %}<tr><td>{{ line.name }}</td><td>{{ line.productQty }}</td><td>{{ line.priceUnit }}</td><td>{{ line.priceSubtotal }}</td></tr>{% endfor %}</tbody></table>
  <text align="right">{{ 'purchase.report.untaxed' | _ }}: {{ amountUntaxed }} {{ currency }}</text>
  <text align="right">{{ 'purchase.report.tax' | _ }}: {{ amountTax }} {{ currency }}</text>
  <text size="14" weight="bold" align="right">{{ 'purchase.report.total' | _ }}: {{ amountTotal }} {{ currency }}</text>
  <footer><text size="8" align="center">{page}/{pages}</text></footer>
</report>`

async function data(ctx: Parameters<FnSpec['handler']>[0], id: unknown, states: string[]) {
  const order = (await ctx.db.select('purchase.Order', { id }))[0]
  if (!order || !states.includes(String(order.state))) return null
  const company = ctx.scope.company
    ? (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
    : null
  return {
    ...order,
    company: company
      ? ((await ctx.db.select('partner.Partner', { id: company.partnerId }))[0] ?? { name: '' })
      : { name: '' },
    partner: (await ctx.db.select('partner.Partner', { id: order.partnerId }))[0] ?? { name: '' },
    lines: await ctx.db.select('purchase.OrderLine', { orderId: id }),
  }
}
const effects = [
  'read:purchase.Order',
  'read:purchase.OrderLine',
  'read:company.Company',
  'read:partner.Partner',
]
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
  getRfqReport: defineFn({
    input: { id: 'id' },
    output,
    effects,
    handler: (ctx, args) => data(ctx, args.id, ['draft', 'sent', 'to approve']),
  }),
  getPurchaseOrderReport: defineFn({
    input: { id: 'id' },
    output,
    effects,
    handler: (ctx, args) => data(ctx, args.id, ['purchase', 'done']),
  }),
}
export const reports: Record<string, ReportDef> = {
  rfq: {
    title: 'purchase.report.rfq',
    target: 'purchase.Order',
    source: 'purchase.getRfqReport',
    template: template('purchase.report.rfq'),
    filename: 'request-for-quotation',
  },
  purchaseOrder: {
    title: 'purchase.report.purchaseOrder',
    target: 'purchase.Order',
    source: 'purchase.getPurchaseOrderReport',
    template: template('purchase.report.purchaseOrder'),
    filename: 'purchase-order',
  },
}
