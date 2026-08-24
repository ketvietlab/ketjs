// Read-only purchasable-product directory for staff clients.

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, routesOf } from '../channel_api/core.ts'

type Req = Parameters<Route>[1]
type Row = Record<string, unknown>

const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }
const kind = { type: 'string', enum: ['stockable', 'consumable', 'service'] }
const summary = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    name: string,
    kind,
    reference: nullableString,
    uom: string,
  },
  required: ['id', 'name', 'kind', 'reference', 'uom'],
}
const detail = {
  ...summary,
  properties: { ...summary.properties, readOnly: { type: 'boolean', const: true } },
  required: [...summary.required, 'readOnly'],
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
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: unknown }
    return Number.isInteger(parsed.offset) && Number(parsed.offset) >= 0 ? Number(parsed.offset) : 0
  } catch {
    return 0
  }
}
const cursorOf = (offset: number): string => Buffer.from(JSON.stringify({ offset })).toString('base64url')

type DirectoryContext = { configs: Map<string, Row>; units: Map<string, Row> }

const contextOf = async (ctx: ServeContext, rows: Row[], url: URL, req: Req): Promise<DirectoryContext> => {
  const templateIds = [...new Set(rows.map((row) => String((row.template as Row).id)))]
  const configs = (await ctx.call('stock.listProductConfigs', { templateIds }, url, req)) as Row[]
  const units = (await ctx.call('uom.listUnits', {}, url, req)) as Row[]
  return {
    configs: new Map(configs.map((row) => [String(row.templateId), row])),
    units: new Map(units.map((row) => [String(row.id), row])),
  }
}
const productName = (row: Row): string => {
  const template = row.template as Row
  const variant = row.name == null ? '' : String(row.name).trim()
  return variant ? `${String(template.name)} · ${variant}` : String(template.name)
}
const productKind = (row: Row, context: DirectoryContext): string => {
  const template = row.template as Row
  if (template.type === 'service') return 'service'
  return context.configs.get(String(template.id))?.isStorable === true ? 'stockable' : 'consumable'
}
const project = (row: Row, context: DirectoryContext) => {
  const template = row.template as Row
  const unit = context.units.get(String(template.uomId))
  if (!unit) return null
  return {
    id: String(row.id),
    name: productName(row),
    kind: productKind(row, context),
    reference: row.defaultCode == null ? null : String(row.defaultCode),
    uom: String(unit.name),
  }
}
const isPurchasable = (row: Row): boolean => {
  const template = row.template as Row | undefined
  return Boolean(
    row.active !== false &&
      template &&
      template.active !== false &&
      template.purchaseOk === true &&
      template.uomId != null,
  )
}

const notFound = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'purchase_staff_channel.productNotFound', {
    messageKey: 'purchase_staff_channel.error.productNotFound',
  }),
})

export const productRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'purchasing/products',
    operationId: 'staff.purchasing.products.list',
    summary: 'List or search active purchasable products without supplier pricing or barcode data.',
    auth: 'required',
    capability: { key: 'purchasing.products', action: 'read' },
    request: {
      query: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', minLength: 2 },
          cursor: string,
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
    },
    responses: { '200': envelope(page) },
    handler: async (ctx, url, req) => {
      const limit = positive(url.searchParams.get('limit'), 20, 50)
      const offset = offsetOf(url.searchParams.get('cursor'))
      const rows = (await ctx.call(
        'product.listVariants',
        {
          search: url.searchParams.get('query') || undefined,
          purchaseOk: true,
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
    path: 'purchasing/products/{id}',
    operationId: 'staff.purchasing.products.get',
    summary: 'Read one active purchasable product without supplier pricing or barcode data.',
    auth: 'required',
    capability: { key: 'purchasing.products', action: 'read' },
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
      if (!row || !isPurchasable(row)) return notFound(ctx, url, req)
      const context = await contextOf(ctx, [row], url, req)
      const value = project(row, context)
      return value ? { data: { ...value, readOnly: true } } : notFound(ctx, url, req)
    },
  }),
)
