import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'
import { quoteTaxLine } from '../../account/functions.ts'
import { compareDecimals, minorText, scaleOf, sumMoneyMinor } from '../../account/money.ts'
import { ours } from '../scope.ts'

const refused = (field: string, code: string) => ({
  ok: false,
  errors: [{ field, message: `sale.error.${code}` }],
})
class LineEditRefused extends Error {
  readonly result: ReturnType<typeof refused>
  constructor(result: ReturnType<typeof refused>) {
    super('sale line edit refused')
    this.result = result
  }
}

/** Edit one quotation line without repricing or replacing the other lines. */
async function updateLine(ctx: Ctx, args: Row) {
  try {
    return await ctx.tx(async (tx) => {
      const line = (await ours(tx, 'sale.OrderLine', { id: args.id }))[0]
      if (!line) return refused('id', 'lineMissing')
      const order = (await ours(tx, 'sale.Order', { id: line.orderId }))[0]
      if (
        !order ||
        !['draft', 'sent'].includes(String(order.state)) ||
        order.locked ||
        (order.orderAuthority != null && order.orderAuthority !== 'local')
      )
        return refused('id', 'lineNotEditable')
      if (Number(args.expectedRevision) !== Number(order.revision))
        return refused('expectedRevision', 'orderChanged')
      if (compareDecimals(args.productUomQty, '0') <= 0) return refused('productUomQty', 'quantityPositive')
      const priceUnit = args.priceUnit ?? line.priceUnit
      const discount = args.discount ?? line.discount
      if (compareDecimals(priceUnit, '0') < 0) return refused('priceUnit', 'pricePositive')
      if (compareDecimals(discount, '0') < 0 || compareDecimals(discount, '100') > 0)
        return refused('discount', 'discountRange')
      const quote = await quoteTaxLine(tx, {
        productId: line.productId,
        taxIds: args.taxIds ?? line.taxIds ?? (line.taxId ? [line.taxId] : []),
        quantity: args.productUomQty,
        priceUnit,
        discount,
      })
      if (!quote.ok) return quote
      const changed = await tx.db.compareAndSet(
        'sale.Order',
        { id: order.id },
        { revision: order.revision, state: order.state, locked: order.locked },
        { revision: Number(order.revision) + 1 },
      )
      if (!('dryRun' in changed) && !changed.matched) return refused('expectedRevision', 'orderChanged')
      await tx.db.update(
        'sale.OrderLine',
        { id: line.id },
        {
          productUomQty: args.productUomQty,
          priceUnit,
          discount,
          taxId: quote.taxIds[0] ?? null,
          taxIds: quote.taxIds,
          taxEvidence: { currency: quote.currency, scale: quote.scale, taxes: quote.taxes },
          quoteRevision: null,
          priceSubtotal: quote.amountUntaxed,
          priceSubtotalIncl: quote.amountTotal,
        },
      )
      const lines = await ours(tx, 'sale.OrderLine', { orderId: order.id })
      const amounts = await Promise.all(
        lines.map(async (row) => {
          if (row.priceSubtotalIncl != null)
            return { untaxed: row.priceSubtotal, total: row.priceSubtotalIncl }
          const historical = await quoteTaxLine(tx, {
            productId: row.productId,
            taxIds: row.taxIds ?? (row.taxId ? [row.taxId] : []),
            quantity: row.productUomQty,
            priceUnit: row.priceUnit,
            discount: row.discount,
          })
          if (!historical.ok) throw new LineEditRefused(refused('id', 'quoteFailed'))
          return { untaxed: historical.amountUntaxed, total: historical.amountTotal }
        }),
      )
      const scale = scaleOf(order.currency)
      const untaxed = sumMoneyMinor(
        amounts.map((row) => row.untaxed),
        scale,
      )
      const total = sumMoneyMinor(
        amounts.map((row) => row.total),
        scale,
      )
      await tx.db.update(
        'sale.Order',
        { id: order.id },
        {
          amountUntaxed: minorText(untaxed, scale),
          amountTotal: minorText(total, scale),
          amountTax: minorText(total - untaxed, scale),
        },
      )
      return { ok: true, id: line.id, revision: Number(order.revision) + 1 }
    })
  } catch (error) {
    if (error instanceof LineEditRefused) return error.result
    throw error
  }
}

export const lineEditFunctions = {
  updateLine: defineFn({
    input: {
      id: 'id',
      expectedRevision: 'int',
      productUomQty: 'decimal',
      priceUnit: 'decimal?',
      discount: 'decimal?',
      taxIds: 'json?',
    },
    output: { ok: 'bool', id: 'id?', revision: 'int?', errors: 'json?' },
    effects: [
      'read:sale.Order',
      'write:sale.Order',
      'read:sale.OrderLine',
      'write:sale.OrderLine',
      'read:company.Company',
      'read:product.Product',
      'read:product.Template',
      'read:account.Tax',
      'read:account.ProductTax',
    ],
    agent: true,
    handler: updateLine,
  }),
}
