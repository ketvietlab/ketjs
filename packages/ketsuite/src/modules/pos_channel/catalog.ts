import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row, Route, ServeContext } from '@ketvietlab/ketjs'
import { ledgerOf, quoteTaxLine } from '../account/functions.ts'
import { functions as pricingFunctions } from '../pricing/functions.ts'
import { sellableProduct } from '../product/sellable.ts'
import { channelError, defineChannelRoute, routesOf, stableHash } from '../channel_api/core.ts'

type Req = Parameters<Route>[1]

const object = { type: 'object' }
const envelope = (data: unknown) => ({
  type: 'object',
  properties: { data, error: {}, meta: { type: 'object' } },
})
const query = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cursor: { type: 'string', maxLength: 512 },
    limit: { type: 'integer', minimum: 1, maximum: 200 },
    revision: { type: 'string', maxLength: 128 },
  },
}

type Cursor = { revision: string; offset: number }
const cursorOf = (value: Cursor): string => Buffer.from(JSON.stringify(value)).toString('base64url')
const readCursor = (value: string | null): Cursor | null => {
  if (!value) return null
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<Cursor>
    return typeof parsed.revision === 'string' &&
      Number.isInteger(parsed.offset) &&
      Number(parsed.offset) >= 0
      ? { revision: parsed.revision, offset: Number(parsed.offset) }
      : null
  } catch {
    return null
  }
}

const fail = (ctx: ServeContext, url: URL, req: Req, code: string, status = 409) => ({
  status,
  error: channelError(ctx, url, req, code, {
    messageKey: `pos_channel.error.${code.replace(/^pos\./u, '')}`,
    retryable: code === 'pos.catalogRevisionMismatch',
  }),
})

const active = (value: unknown): boolean => value !== false && value !== 0

const revisionRows = (rows: Row[]): Row[] =>
  rows.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
    ),
  )

async function snapshot(ctx: Ctx, posConfigId: string) {
  const config = (await ctx.db.select('pos.Config', { id: posConfigId }))[0]
  if (!config || !active(config.active)) return null
  const pricelist = config.pricelistId
    ? (await ctx.db.select('pricing.Pricelist', { id: config.pricelistId }))[0]
    : null
  if (config.pricelistId && (!pricelist || !active(pricelist.active))) return null

  const ledger = await ledgerOf(ctx)
  const rules = pricelist ? await ctx.db.select('pricing.PricelistItem', { pricelistId: pricelist.id }) : []
  const breakpoints = [...new Set([1, ...rules.map((rule) => Number(rule.minQuantity || 1))])]
    .filter((quantity) => Number.isFinite(quantity) && quantity > 0)
    .sort((a, b) => a - b)
  const variants = (await ctx.db.select('product.Product')).sort((a, b) =>
    String(a.id).localeCompare(String(b.id)),
  )
  const methodLinks = await ctx.db.select('pos.ConfigPaymentMethod', { configId: config.id })
  const paymentMethods = (
    await Promise.all(
      methodLinks.map(
        async (link) => (await ctx.db.select('pos.PaymentMethod', { id: link.paymentMethodId }))[0],
      ),
    )
  )
    .filter((method): method is Row => Boolean(method && active(method.active)))
    .map((method) => ({
      id: String(method.id),
      name: String(method.name),
      isCashCount: method.isCash === true,
      type: method.isCash === true ? 'cash' : 'bank',
    }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const currency = String(pricelist?.currency ?? ledger.currency)
  const cashRoundingStep = Number(config.cashRoundingIncrement ?? 0)

  // Hash source rows instead of calculated prices. Pagination can then calculate only the variants
  // on the requested page while a cursor still detects any catalog or price-input change.
  const [
    templates,
    templateUoms,
    productUoms,
    categories,
    costs,
    units,
    pricelists,
    pricelistItems,
    productTaxes,
    taxes,
    companies,
  ] = await Promise.all([
    ctx.db.select('product.Template'),
    ctx.db.select('product.TemplateUom'),
    ctx.db.select('product.ProductUom'),
    ctx.db.select('product.Category'),
    ctx.db.select('product.Cost'),
    ctx.db.select('uom.Unit'),
    ctx.db.select('pricing.Pricelist'),
    ctx.db.select('pricing.PricelistItem'),
    ctx.db.select('account.ProductTax'),
    ctx.db.select('account.Tax'),
    ctx.db.select('company.Company'),
  ])
  const revision = stableHash({
    config: revisionRows([config]),
    variants: revisionRows(variants),
    templates: revisionRows(templates),
    templateUoms: revisionRows(templateUoms),
    productUoms: revisionRows(productUoms),
    categories: revisionRows(categories),
    costs: revisionRows(costs),
    units: revisionRows(units),
    pricelists: revisionRows(pricelists),
    pricelistItems: revisionRows(pricelistItems),
    productTaxes: revisionRows(productTaxes),
    taxes: revisionRows(taxes),
    companies: revisionRows(companies),
    methodLinks: revisionRows(methodLinks),
    paymentMethods,
    currency,
    scale: ledger.scale,
    cashRoundingStep: cashRoundingStep > 0 ? cashRoundingStep : null,
  })
  return {
    config,
    currency,
    scale: ledger.scale,
    variants,
    breakpoints,
    pricelist,
    paymentMethods,
    cashRoundingStep,
    revision,
  }
}

async function pageOf(
  ctx: Ctx,
  held: NonNullable<Awaited<ReturnType<typeof snapshot>>>,
  offset: number,
  limit: number,
) {
  const products: Row[] = []
  let nextOffset = offset
  while (nextOffset < held.variants.length && products.length < limit) {
    const variant = held.variants[nextOffset++]!
    const resolved = await sellableProduct(ctx, variant.id)
    if (!resolved.ok) continue
    const { product, template, uoms } = resolved.value
    const prices: Row[] = []
    for (const uom of uoms)
      for (const quantity of held.breakpoints) {
        if (!held.pricelist) {
          const quote = await quoteTaxLine(ctx, {
            productId: product.id,
            quantity: String(quantity),
            priceUnit: String(template.listPrice),
          })
          prices.push({
            uomId: uom.id,
            minQuantity: String(quantity),
            price: String(template.listPrice),
            ruleId: null,
            ...(quote.ok === true
              ? {
                  amountUntaxed: quote.amountUntaxed,
                  amountTax: quote.amountTax,
                  amountTotal: quote.amountTotal,
                  taxIds: quote.taxIds,
                  taxes: quote.taxes.map(({ share: _share, ...tax }) => tax),
                }
              : {}),
          })
          continue
        }
        const priced = (await pricingFunctions.priceFor!.handler(ctx, {
          pricelistId: held.pricelist.id,
          productId: product.id,
          quantity: String(quantity),
          uomId: uom.id,
          date: new Date().toISOString(),
        })) as Row
        if (priced.ok === true) {
          const quote = await quoteTaxLine(ctx, {
            productId: product.id,
            quantity: String(quantity),
            priceUnit: priced.price,
          })
          prices.push({
            uomId: uom.id,
            minQuantity: String(quantity),
            price: String(priced.price),
            ruleId: priced.ruleId == null ? null : String(priced.ruleId),
            ...(quote.ok === true
              ? {
                  amountUntaxed: quote.amountUntaxed,
                  amountTax: quote.amountTax,
                  amountTotal: quote.amountTotal,
                  taxIds: quote.taxIds,
                  taxes: quote.taxes.map(({ share: _share, ...tax }) => tax),
                }
              : {}),
          })
        }
      }
    products.push({
      id: String(product.id),
      templateId: String(template.id),
      name: String(template.name),
      type: String(template.type),
      tracking: String(template.tracking ?? 'none'),
      categoryId: template.categoryId == null ? null : String(template.categoryId),
      defaultCode: product.defaultCode == null ? null : String(product.defaultCode),
      barcode: product.barcode == null ? null : String(product.barcode),
      uomId: String(template.uomId),
      uomName: uoms.find((unit) => unit.id === String(template.uomId))?.name ?? '',
      uoms,
      listPrice: Number(prices[0]?.price ?? template.listPrice),
      prices,
    })
  }
  return { ...held, products, nextOffset, done: nextOffset >= held.variants.length, mismatch: false }
}

export const catalogFunctions: Record<string, FnSpec> = {
  priceBook: defineFn({
    input: { posConfigId: 'id', offset: 'int?', limit: 'int?', revision: 'text?' },
    effects: [
      'read:pos.Config',
      'read:pos.ConfigPaymentMethod',
      'read:pos.PaymentMethod',
      'read:pricing.Pricelist',
      'read:pricing.PricelistItem',
      'read:product.Product',
      'read:product.Template',
      'read:product.TemplateUom',
      'read:product.ProductUom',
      'read:product.Category',
      'read:product.Cost',
      'read:uom.Unit',
      'read:account.ProductTax',
      'read:account.Tax',
      'read:company.Company',
    ],
    exposure: 'internal',
    handler: async (ctx, args) => {
      const held = await snapshot(ctx, String(args.posConfigId))
      if (!held) return null
      const offset = Math.max(0, Number(args.offset ?? 0))
      if (args.revision && args.revision !== held.revision)
        return { ...held, products: [], nextOffset: offset, done: true, mismatch: true }
      return pageOf(ctx, held, offset, Math.max(1, Math.min(200, Number(args.limit ?? 100))))
    },
  }),
}

export const catalogRoutes = routesOf(
  defineChannelRoute({
    profile: 'pos',
    method: 'GET',
    path: 'catalog/price-book',
    operationId: 'pos.catalog.priceBook',
    summary: 'Read one revision-bound page of the live POS product and price-book snapshot.',
    auth: 'required',
    request: { query },
    responses: {
      '200': envelope(object),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
      '422': envelope({ type: 'null' }),
    },
    handler: async (ctx, url, req, _params, request) => {
      const cursor = readCursor(url.searchParams.get('cursor'))
      if (url.searchParams.has('cursor') && !cursor)
        return fail(ctx, url, req, 'pos.catalogCursorInvalid', 422)
      const requestedRevision = url.searchParams.get('revision') ?? cursor?.revision ?? null
      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 100)))
      const offset = cursor?.offset ?? 0
      const held = (await ctx.call(
        'pos_channel.priceBook',
        { posConfigId: request.identity!.posConfigId, offset, limit, revision: requestedRevision },
        url,
        req,
      )) as Awaited<ReturnType<typeof pageOf>> | null
      if (!held) return fail(ctx, url, req, 'pos.catalogUnavailable', 404)
      if (held.mismatch === true) return fail(ctx, url, req, 'pos.catalogRevisionMismatch')
      const now = new Date()
      return {
        data: {
          masterVersion: held.revision,
          validFrom: now.toISOString(),
          validTo: new Date(now.getTime() + 8 * 60 * 60 * 1_000).toISOString(),
          content: {
            configId: String(held.config.id),
            currency: held.currency,
            scale: held.scale,
            products: held.products,
            paymentMethods: held.paymentMethods,
            rounding: held.cashRoundingStep > 0 ? { rounding: held.cashRoundingStep } : null,
          },
        },
        nextCursor: held.done ? null : cursorOf({ revision: held.revision, offset: held.nextOffset }),
      }
    },
  }),
)
