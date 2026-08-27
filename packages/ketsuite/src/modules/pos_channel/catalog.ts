import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row, Route, ServeContext } from '@ketvietlab/ketjs'
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

async function snapshot(ctx: Ctx, posConfigId: string) {
  const config = (await ctx.db.select('pos.Config', { id: posConfigId }))[0]
  if (!config || !active(config.active)) return null
  const pricelist = config.pricelistId
    ? (await ctx.db.select('pricing.Pricelist', { id: config.pricelistId }))[0]
    : null
  if (config.pricelistId && (!pricelist || !active(pricelist.active))) return null

  const rules = pricelist ? await ctx.db.select('pricing.PricelistItem', { pricelistId: pricelist.id }) : []
  const breakpoints = [...new Set([1, ...rules.map((rule) => Number(rule.minQuantity || 1))])]
    .filter((quantity) => Number.isFinite(quantity) && quantity > 0)
    .sort((a, b) => a - b)
  const variants = (await ctx.db.select('product.Product')).sort((a, b) =>
    String(a.id).localeCompare(String(b.id)),
  )
  const products: Row[] = []
  for (const variant of variants) {
    const resolved = await sellableProduct(ctx, variant.id)
    if (!resolved.ok) continue
    const { product, template, uoms } = resolved.value
    const prices: Row[] = []
    for (const uom of uoms)
      for (const quantity of breakpoints) {
        if (!pricelist) {
          prices.push({
            uomId: uom.id,
            minQuantity: String(quantity),
            price: String(template.listPrice),
            ruleId: null,
          })
          continue
        }
        const priced = (await pricingFunctions.priceFor!.handler(ctx, {
          pricelistId: pricelist.id,
          productId: product.id,
          quantity: String(quantity),
          uomId: uom.id,
          date: new Date().toISOString(),
        })) as Row
        if (priced.ok === true)
          prices.push({
            uomId: uom.id,
            minQuantity: String(quantity),
            price: String(priced.price),
            ruleId: priced.ruleId == null ? null : String(priced.ruleId),
          })
      }
    products.push({
      id: String(product.id),
      templateId: String(template.id),
      name: String(template.name),
      type: String(template.type),
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
  const currency = String(pricelist?.currency ?? '')
  const revision = stableHash({
    configId: String(config.id),
    pricelistId: pricelist?.id == null ? null : String(pricelist.id),
    currency,
    products,
    paymentMethods,
    cashRoundingStep: null,
  })
  return { config, currency, products, paymentMethods, revision }
}

export const catalogFunctions: Record<string, FnSpec> = {
  priceBook: defineFn({
    input: { posConfigId: 'id' },
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
    ],
    agent: true,
    handler: (ctx, args) => snapshot(ctx, String(args.posConfigId)),
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
      const held = (await ctx.call(
        'pos_channel.priceBook',
        { posConfigId: request.identity!.posConfigId },
        url,
        req,
      )) as Awaited<ReturnType<typeof snapshot>>
      if (!held) return fail(ctx, url, req, 'pos.catalogUnavailable', 404)
      const cursor = readCursor(url.searchParams.get('cursor'))
      if (url.searchParams.has('cursor') && !cursor)
        return fail(ctx, url, req, 'pos.catalogCursorInvalid', 422)
      const requestedRevision = url.searchParams.get('revision') ?? cursor?.revision ?? null
      if (requestedRevision && requestedRevision !== held.revision)
        return fail(ctx, url, req, 'pos.catalogRevisionMismatch')

      const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') ?? 100)))
      const offset = cursor?.offset ?? 0
      const page = held.products.slice(offset, offset + limit)
      const nextOffset = offset + page.length
      const now = new Date()
      return {
        data: {
          masterVersion: held.revision,
          validFrom: now.toISOString(),
          validTo: new Date(now.getTime() + 8 * 60 * 60 * 1_000).toISOString(),
          content: {
            configId: String(held.config.id),
            currency: held.currency,
            products: page,
            paymentMethods: held.paymentMethods,
            rounding: null,
          },
        },
        nextCursor:
          nextOffset < held.products.length
            ? cursorOf({ revision: held.revision, offset: nextOffset })
            : null,
      }
    },
  }),
)
