import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec, ReportDef } from '@ketvietlab/ketjs'

const template = (title: string) => `<report paper="A4" margin="42">
  <header><row gap="6"><text size="10" weight="bold" tone="accent">{{ company.name }}</text><text size="8" weight="semibold" tone="muted" align="right">KETSUITE · INVENTORY</text></row></header>
  <text size="9" weight="semibold" tone="accent" gap="12">{{ '${title}' | _ }}</text>
  <text size="24" weight="bold" gap="14">{{ name }}</text>
  <row gap="12"><text size="9" weight="semibold">{{ 'stock.report.number' | _ }} · {{ name }}</text><text size="9" tone="muted" align="right">{{ 'stock.report.date' | _ }} · {{ scheduledDate }}</text></row>
  <row gap="18"><text size="10" weight="semibold">{{ 'stock.report.from' | _ }} · {{ source.name }}</text><text size="10" weight="semibold" align="right">{{ 'stock.report.to' | _ }} · {{ destination.name }}</text></row>
  <table><thead><tr><th>{{ 'stock.report.product' | _ }}</th><th>{{ 'stock.report.demand' | _ }}</th><th>{{ 'stock.report.done' | _ }}</th></tr></thead>
  <tbody>{% for move in moves %}<tr><td>{{ move.name }}</td><td>{{ move.productUomQty }}</td><td>{{ move.quantity }}</td></tr>{% endfor %}</tbody></table>
  <footer><row gap="0"><text size="8" weight="semibold" tone="muted">{{ company.name }}</text><text size="8" tone="muted" align="right">{page} / {pages}</text></row></footer>
</report>`

async function data(ctx: Parameters<FnSpec['handler']>[0], id: unknown, code: string) {
  const picking = (await ctx.db.select('stock.Picking', { id }))[0]
  if (!picking) return null
  const type = (await ctx.db.select('stock.PickingType', { id: picking.pickingTypeId }))[0]
  if (!type || type.code !== code) return null
  const company = ctx.scope.company
    ? (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
    : null
  return {
    ...picking,
    company: company
      ? ((await ctx.db.select('partner.Partner', { id: company.partnerId }))[0] ?? { name: '' })
      : { name: '' },
    operationType: type,
    source: (await ctx.db.select('stock.Location', { id: picking.locationId }))[0] ?? { name: '' },
    destination: (await ctx.db.select('stock.Location', { id: picking.locationDestId }))[0] ?? { name: '' },
    moves: await ctx.db.select('stock.Move', { pickingId: id }),
  }
}
const effects = [
  'read:stock.Picking',
  'read:stock.PickingType',
  'read:stock.Location',
  'read:stock.Move',
  'read:company.Company',
  'read:partner.Partner',
]
const output = {
  id: 'id',
  name: 'text',
  scheduledDate: 'datetime',
  company: 'json',
  operationType: 'json',
  source: 'json',
  destination: 'json',
  moves: 'json',
}
export const reportFunctions: Record<string, FnSpec> = {
  getReceiptReport: defineFn({
    input: { id: 'id' },
    output,
    effects,
    handler: (ctx, args) => data(ctx, args.id, 'incoming'),
  }),
  getDeliveryReport: defineFn({
    input: { id: 'id' },
    output,
    effects,
    handler: (ctx, args) => data(ctx, args.id, 'outgoing'),
  }),
  getInternalTransferReport: defineFn({
    input: { id: 'id' },
    output,
    effects,
    handler: (ctx, args) => data(ctx, args.id, 'internal'),
  }),
}
export const reports: Record<string, ReportDef> = {
  receipt: {
    title: 'stock.report.receipt',
    target: 'stock.Picking',
    source: 'stock.getReceiptReport',
    template: template('stock.report.receipt'),
    filename: 'receipt',
  },
  delivery: {
    title: 'stock.report.delivery',
    target: 'stock.Picking',
    source: 'stock.getDeliveryReport',
    template: template('stock.report.delivery'),
    filename: 'delivery-slip',
  },
  internalTransfer: {
    title: 'stock.report.internalTransfer',
    target: 'stock.Picking',
    source: 'stock.getInternalTransferReport',
    template: template('stock.report.internalTransfer'),
    filename: 'internal-transfer',
  },
}
