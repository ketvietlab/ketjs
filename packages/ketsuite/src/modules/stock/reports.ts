import { defineFn } from 'ketjs'
import type { FnSpec, ReportDef } from 'ketjs'

const template = (title: string) => `<report paper="A4" margin="40">
  <text size="22" weight="bold">{{ '${title}' | _ }}</text>
  <row><text>{{ 'stock.report.number' | _ }}: {{ name }}</text><text>{{ 'stock.report.date' | _ }}: {{ scheduledDate }}</text></row>
  <text>{{ 'stock.report.from' | _ }}: {{ source.name }}</text><text>{{ 'stock.report.to' | _ }}: {{ destination.name }}</text>
  <table><thead><tr><th>{{ 'stock.report.product' | _ }}</th><th>{{ 'stock.report.demand' | _ }}</th><th>{{ 'stock.report.done' | _ }}</th></tr></thead>
  <tbody>{% for move in moves %}<tr><td>{{ move.name }}</td><td>{{ move.productUomQty }}</td><td>{{ move.quantity }}</td></tr>{% endfor %}</tbody></table>
  <footer><text size="8" align="center">{page}/{pages}</text></footer>
</report>`

async function data(ctx: Parameters<FnSpec['handler']>[0], id: unknown, code: string) {
  const picking = (await ctx.db.select('stock.Picking', { id }))[0]
  if (!picking) return null
  const type = (await ctx.db.select('stock.PickingType', { id: picking.pickingTypeId }))[0]
  if (!type || type.code !== code) return null
  return {
    ...picking,
    operationType: type,
    source: (await ctx.db.select('stock.Location', { id: picking.locationId }))[0] ?? { name: '' },
    destination: (await ctx.db.select('stock.Location', { id: picking.locationDestId }))[0] ?? { name: '' },
    moves: await ctx.db.select('stock.Move', { pickingId: id }),
  }
}
const effects = ['read:stock.Picking', 'read:stock.PickingType', 'read:stock.Location', 'read:stock.Move']
const output = {
  id: 'id',
  name: 'text',
  scheduledDate: 'datetime',
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
