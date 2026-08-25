// Staff-facing inventory catalogue reads.
//
// Product owns catalogue identity, Stock owns availability and positions, and
// Product Media owns image presence. This facade composes only those proven
// reads; prices, BOMs, management options, and lifecycle writes stay absent.

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, routesOf, sha256 } from '../channel_api/core.ts'
import { TRACKING } from '../stock/functions.ts'

type Req = Parameters<Route>[1]
type Row = Record<string, unknown>

const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }
const uom = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, name: string },
  required: ['id', 'name'],
}
const channels = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sales: { type: 'boolean' },
    purchase: { type: 'boolean' },
    pointOfSale: { type: 'boolean' },
  },
  required: ['sales', 'purchase', 'pointOfSale'],
}
const summary = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    name: string,
    active: { type: 'boolean' },
    kind: { type: 'string', enum: ['storable', 'consumable'] },
    sku: nullableString,
    barcode: nullableString,
    uom,
    availableQuantity: string,
    channels,
    hasImage: { type: 'boolean' },
  },
  required: [
    'id',
    'name',
    'active',
    'kind',
    'sku',
    'barcode',
    'uom',
    'availableQuantity',
    'channels',
    'hasImage',
  ],
}
const stockPosition = {
  type: 'object',
  additionalProperties: false,
  properties: {
    locationId: string,
    locationName: string,
    lotId: nullableString,
    lotName: nullableString,
    quantity: string,
    version: string,
    requiresLotName: { type: 'boolean' },
  },
  required: ['locationId', 'locationName', 'lotId', 'lotName', 'quantity', 'version', 'requiresLotName'],
}
const detail = {
  ...summary,
  properties: {
    ...summary.properties,
    tracking: { type: 'string', enum: [...TRACKING] },
    stockPositions: { type: 'array', items: stockPosition },
    version: string,
    availableActions: { type: 'array', items: string, maxItems: 0 },
    readOnly: { type: 'boolean', const: true },
  },
  required: [...summary.required, 'tracking', 'stockPositions', 'version', 'availableActions', 'readOnly'],
}
const page = {
  type: 'object',
  additionalProperties: false,
  properties: { items: { type: 'array', items: summary }, nextCursor: nullableString },
  required: ['items', 'nextCursor'],
}
const envelope = (data: unknown) => ({
  type: 'object',
  properties: { data, error: {}, meta: { type: 'object' } },
})

const positive = (value: string | null, fallback: number, maximum: number): number => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? Math.min(number, maximum) : fallback
}
const offsetOf = (cursor: string | null): number => {
  if (!cursor) return 0
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      offset?: unknown
    }
    return Number.isInteger(parsed.offset) && Number(parsed.offset) >= 0 ? Number(parsed.offset) : 0
  } catch {
    return 0
  }
}
const cursorOf = (offset: number): string => Buffer.from(JSON.stringify({ offset })).toString('base64url')

type Context = {
  configs: Map<string, Row>
  units: Map<string, Row>
  availability: Map<string, string>
  mediaTargets: Set<string>
}

const contextOf = async (ctx: ServeContext, rows: Row[], url: URL, req: Req): Promise<Context> => {
  const templates = rows.map((row) => row.template as Row)
  const templateIds = [...new Set(templates.map((row) => String(row.id)))]
  const productIds = [...new Set(rows.map((row) => String(row.id)))]
  const unitIds = [...new Set(templates.flatMap((row) => (row.uomId == null ? [] : [String(row.uomId)])))]
  const [configs, units, availability, media] = (await Promise.all([
    ctx.call('stock.listProductConfigs', { templateIds }, url, req),
    ctx.call('uom.listUnits', { ids: unitIds }, url, req),
    ctx.call('stock.listProductAvailability', { productIds }, url, req),
    ctx.call('product_media.listPrimaryMedia', { templateIds, productIds }, url, req),
  ])) as [Row[], Row[], Row[], Row[]]
  return {
    configs: new Map(configs.map((row) => [String(row.templateId), row])),
    units: new Map(units.map((row) => [String(row.id), row])),
    availability: new Map(availability.map((row) => [String(row.productId), String(row.available)])),
    mediaTargets: new Set(
      media.flatMap((row) => [
        ...(row.productId == null ? [] : [`product:${String(row.productId)}`]),
        ...(row.templateId == null ? [] : [`template:${String(row.templateId)}`]),
      ]),
    ),
  }
}

const productName = (row: Row): string => {
  const template = row.template as Row
  const variant = row.name == null ? '' : String(row.name).trim()
  return variant ? `${String(template.name)} · ${variant}` : String(template.name)
}
const activeOf = (row: Row): boolean => {
  const template = row.template as Row
  return row.active !== false && template.active !== false
}
const project = (row: Row, context: Context) => {
  const template = row.template as Row
  const config = context.configs.get(String(template.id)) ?? {}
  const unit = context.units.get(String(template.uomId))
  if (!unit) return null
  return {
    id: String(row.id),
    name: productName(row),
    active: activeOf(row),
    kind: config.isStorable === true ? 'storable' : 'consumable',
    sku: row.defaultCode == null ? null : String(row.defaultCode),
    barcode: row.barcode == null ? null : String(row.barcode),
    uom: { id: String(unit.id), name: String(unit.name) },
    availableQuantity: context.availability.get(String(row.id)) ?? '0',
    channels: {
      sales: template.saleOk === true,
      purchase: template.purchaseOk === true,
      // POS currently applies Product's saleOk gate and has no independent
      // catalogue flag, so this is the domain's actual eligibility rule.
      pointOfSale: template.saleOk === true,
    },
    hasImage:
      context.mediaTargets.has(`product:${String(row.id)}`) ||
      context.mediaTargets.has(`template:${String(template.id)}`),
  }
}

const notFound = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'inventory_staff_channel.productNotFound', {
    messageKey: 'inventory_staff_channel.error.productNotFound',
  }),
})

export const channelRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'inventory/products',
    operationId: 'staff.inventory.products.list',
    summary: 'List goods with company availability and channel eligibility.',
    auth: 'required',
    capability: { key: 'inventory.products', action: 'read' },
    request: {
      query: {
        type: 'object',
        properties: {
          query: { type: 'string', minLength: 2 },
          status: { type: 'string', enum: ['active', 'archived', 'all'] },
          cursor: string,
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
    },
    responses: { '200': envelope(page) },
    handler: async (ctx, url, req) => {
      const limit = positive(url.searchParams.get('limit'), 20, 50)
      const offset = offsetOf(url.searchParams.get('cursor'))
      const status = url.searchParams.get('status') ?? 'active'
      const rows = (await ctx.call(
        'product.listVariants',
        {
          search: url.searchParams.get('query') || undefined,
          type: 'goods',
          includeArchived: status !== 'active',
          active: status === 'all' ? undefined : status === 'active',
          requireUom: true,
          limit: limit + 1,
          offset,
        },
        url,
        req,
      )) as Row[]
      const hasMore = rows.length > limit
      const pageRows = rows.slice(0, limit)
      const context = await contextOf(ctx, pageRows, url, req)
      return {
        data: {
          items: pageRows.flatMap((row) => {
            const value = project(row, context)
            return value ? [value] : []
          }),
          nextCursor: hasMore ? cursorOf(offset + limit) : null,
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'inventory/products/{id}',
    operationId: 'staff.inventory.products.get',
    summary: 'Read one goods variant with its company stock positions.',
    auth: 'required',
    capability: { key: 'inventory.products', action: 'read' },
    request: {
      params: {
        type: 'object',
        additionalProperties: false,
        properties: { id: string },
        required: ['id'],
      },
    },
    responses: { '200': envelope(detail), '404': envelope({ type: 'null' }) },
    handler: async (ctx, url, req, params) => {
      const row = (await ctx.call('product.getVariantSummary', { id: params.id }, url, req)) as Row | null
      const template = row?.template as Row | undefined
      if (!row || !template || template.type !== 'goods' || template.uomId == null)
        return notFound(ctx, url, req)
      const context = await contextOf(ctx, [row], url, req)
      const base = project(row, context)
      if (!base) return notFound(ctx, url, req)
      const stock = (await ctx.call('stock.getProductStockView', { productId: params.id }, url, req)) as Row
      const config = context.configs.get(String(template.id)) ?? {}
      const tracking = TRACKING.includes(config.tracking as never) ? String(config.tracking) : 'none'
      const positions = (Array.isArray(stock.positions) ? (stock.positions as Row[]) : []).map((entry) => {
        const quant = entry.quant as Row
        const location = entry.location as Row
        const lot = entry.lot as Row | null
        return {
          locationId: String(location.id),
          locationName: String(location.name),
          lotId: lot ? String(lot.id) : null,
          lotName: lot ? String(lot.name) : null,
          quantity: String(quant.quantity),
          version: `sav_${sha256(JSON.stringify(entry))}`,
          requiresLotName: tracking !== 'none' && !lot,
        }
      })
      // `base` carries labels resolved from uom and product — a unit renamed
      // there changed the answer while a hash of the raw row did not. Hash the
      // representation that was actually built.
      const content = {
        ...base,
        availableQuantity: String(stock.available ?? base.availableQuantity),
        tracking,
        stockPositions: positions,
      }
      const version = `ipv_${sha256(JSON.stringify(content))}`
      return {
        data: {
          ...content,
          version,
          availableActions: [],
          readOnly: true,
        },
        headers: { etag: `"${version}"` },
      }
    },
  }),
)
