// Staff-facing inventory product management.
//
// Product owns catalogue identity, Stock owns availability and positions, and
// Product Media owns image presence. This facade composes their checked domain
// functions into the bounded catalogue, lifecycle, and stock-adjustment API.

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import {
  channelError,
  defineChannelRoute,
  idempotencyKey,
  routesOf,
  stableHash,
} from '../channel_api/core.ts'
import { TRACKING } from '../stock/functions.ts'

type Req = Parameters<Route>[1]
type Row = Record<string, unknown>

const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }
const decimal = { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d+)?$' }
const money = {
  type: 'object',
  additionalProperties: false,
  properties: { currency: string, amount: decimal },
  required: ['currency', 'amount'],
}
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
    salePrice: money,
    cost: money,
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
    'salePrice',
    'cost',
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
    categoryId: nullableString,
    stockPositions: { type: 'array', items: stockPosition },
    version: string,
    availableActions: { type: 'array', items: string },
    readOnly: { type: 'boolean' },
  },
  required: [
    ...summary.required,
    'tracking',
    'categoryId',
    'stockPositions',
    'version',
    'availableActions',
    'readOnly',
  ],
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

const option = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, name: string, code: nullableString, parentId: nullableString },
  required: ['id', 'name', 'code', 'parentId'],
}
const managementOptions = {
  type: 'object',
  additionalProperties: false,
  properties: {
    uoms: { type: 'array', items: option },
    categories: { type: 'array', items: option },
    routes: { type: 'array', items: option },
    locations: { type: 'array', items: option },
  },
  required: ['uoms', 'categories', 'routes', 'locations'],
}
const writeBody = (withVersion: boolean) => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 1, maxLength: 200 },
    kind: { type: 'string', enum: ['storable', 'consumable'] },
    uomId: string,
    categoryId: nullableString,
    salePrice: decimal,
    cost: decimal,
    channels,
    tracking: { type: 'string', enum: [...TRACKING] },
    sku: nullableString,
    barcode: nullableString,
    ...(withVersion ? { expectedVersion: { type: 'string', pattern: '^ipv_[0-9a-f]{64}$' } } : {}),
  },
  required: [
    'name',
    'kind',
    'uomId',
    'categoryId',
    'salePrice',
    'cost',
    'channels',
    'tracking',
    'sku',
    'barcode',
    ...(withVersion ? ['expectedVersion'] : []),
  ],
})
const versionBody = {
  type: 'object',
  additionalProperties: false,
  properties: { expectedVersion: { type: 'string', pattern: '^ipv_[0-9a-f]{64}$' } },
  required: ['expectedVersion'],
}
const adjustmentBody = {
  type: 'object',
  additionalProperties: false,
  properties: {
    locationId: string,
    lotId: nullableString,
    countedQuantity: decimal,
    expectedVersion: { type: 'string', pattern: '^sav_[0-9a-f]{64}$' },
    reason: { type: 'string', minLength: 3, maxLength: 200 },
  },
  required: ['locationId', 'lotId', 'countedQuantity', 'expectedVersion', 'reason'],
}
const adjustmentResult = {
  type: 'object',
  additionalProperties: false,
  properties: {
    outcome: { type: 'string', const: 'adjusted' },
    previousQuantity: decimal,
    currentQuantity: decimal,
    version: { type: 'string', pattern: '^sav_[0-9a-f]{64}$' },
  },
  required: ['outcome', 'previousQuantity', 'currentQuantity', 'version'],
}

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
  costs: Map<string, string>
  currency: string
  mediaTargets: Set<string>
}

const contextOf = async (
  ctx: ServeContext,
  rows: Row[],
  companyId: string,
  url: URL,
  req: Req,
): Promise<Context> => {
  const templates = rows.map((row) => row.template as Row)
  const templateIds = [...new Set(templates.map((row) => String(row.id)))]
  const productIds = [...new Set(rows.map((row) => String(row.id)))]
  const unitIds = [...new Set(templates.flatMap((row) => (row.uomId == null ? [] : [String(row.uomId)])))]
  const [configs, units, availability, costs, company, media] = (await Promise.all([
    ctx.call('stock.listProductConfigs', { templateIds }, url, req),
    ctx.call('uom.listUnits', { ids: unitIds }, url, req),
    ctx.call('stock.listProductAvailability', { productIds }, url, req),
    ctx.call('product.listVariantCosts', { productIds }, url, req),
    ctx.call('company.getCompany', { id: companyId }, url, req),
    ctx.call('product_media.listPrimaryMedia', { templateIds, productIds }, url, req),
  ])) as [Row[], Row[], Row[], Row[], Row, Row[]]
  return {
    configs: new Map(configs.map((row) => [String(row.templateId), row])),
    units: new Map(units.map((row) => [String(row.id), row])),
    availability: new Map(availability.map((row) => [String(row.productId), String(row.available)])),
    costs: new Map(costs.map((row) => [String(row.productId), String(row.standardPrice)])),
    currency: String(company.currency),
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
    salePrice: { currency: context.currency, amount: String(template.listPrice) },
    cost: { currency: context.currency, amount: context.costs.get(String(row.id)) ?? '0' },
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

const versionFailure = (ctx: ServeContext, url: URL, req: Req, stock = false) => ({
  status: 409,
  error: channelError(
    ctx,
    url,
    req,
    stock ? 'inventory_staff_channel.stockVersionConflict' : 'inventory_staff_channel.versionConflict',
    {
      messageKey: stock
        ? 'inventory_staff_channel.error.stockVersionConflict'
        : 'inventory_staff_channel.error.versionConflict',
      retryable: true,
    },
  ),
})

const domainFailure = (ctx: ServeContext, url: URL, req: Req, result: unknown) => {
  const issues = Array.isArray((result as { errors?: unknown })?.errors)
    ? ((result as { errors: Row[] }).errors ?? [])
    : []
  const conflict = issues.some((issue) =>
    ['expectedRevision', 'expectedQuantRevision', 'active', 'id'].includes(String(issue.field)),
  )
  return {
    status: conflict ? 409 : 422,
    error: channelError(
      ctx,
      url,
      req,
      conflict ? 'inventory_staff_channel.conflict' : 'inventory_staff_channel.invalidRequest',
      {
        messageKey: conflict
          ? 'inventory_staff_channel.error.conflict'
          : 'inventory_staff_channel.error.invalidRequest',
        fieldErrors: Object.fromEntries(
          issues
            .filter((issue) => issue.field)
            .map((issue) => [
              String(issue.field),
              {
                code: 'inventory_staff_channel.invalidField',
                messageKey: 'inventory_staff_channel.error.invalidField',
                params: {},
              },
            ]),
        ),
      },
    ),
  }
}
const invalidResult = (field: string, message: string) => ({
  ok: false,
  errors: [{ field, message }],
})
const requestVersion = (req: Req, body: Row): string | null => {
  const expected = String(body.expectedVersion ?? '')
  const header = String(req.headers['if-match'] ?? '').trim()
  if (!header) return expected || null
  return header === expected || header === `"${expected}"` ? expected : null
}
const commandId = (prefix: string, namespace: string, key: string): string =>
  `${prefix}_${stableHash(`${namespace}\n${key}`).slice(0, 32)}`
const idParams = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string },
  required: ['id'],
}

type PositionEvidence = {
  locationId: string
  lotId: string | null
  quantity: string
  revision: number
  version: string
}

const currentProduct = async (ctx: ServeContext, id: string, url: URL, req: Req) => {
  const row = (await ctx.call('product.getVariantSummary', { id }, url, req)) as Row | null
  const template = row?.template as Row | undefined
  return row && template && template.type === 'goods' && template.uomId != null ? { row, template } : null
}

const projectDetail = async (
  ctx: ServeContext,
  row: Row,
  template: Row,
  companyId: string,
  url: URL,
  req: Req,
) => {
  const context = await contextOf(ctx, [row], companyId, url, req)
  const base = project(row, context)
  if (!base) return null
  const [stock, locations] = (await Promise.all([
    ctx.call('stock.getProductStockView', { productId: row.id }, url, req),
    ctx.call('stock.listLocations', {}, url, req),
  ])) as [Row, Row[]]
  const config = context.configs.get(String(template.id)) ?? {}
  const tracking = TRACKING.includes(config.tracking as never) ? String(config.tracking) : 'none'
  const physical = locations
    .filter((location) => ['internal', 'transit'].includes(String(location.usage)))
    .sort(
      (left, right) =>
        String(left.name).localeCompare(String(right.name)) ||
        String(left.id).localeCompare(String(right.id)),
    )
  const raw = Array.isArray(stock.positions) ? (stock.positions as Row[]) : []
  const positions: Array<Row & PositionEvidence> = []
  for (const location of physical) {
    const entries = raw.filter((entry) => String((entry.location as Row).id) === String(location.id))
    const selected = tracking === 'none' ? entries.filter((entry) => !(entry.lot as Row | null)) : entries
    for (const entry of selected) {
      const quant = entry.quant as Row
      const lot = entry.lot as Row | null
      const evidence = {
        productId: String(row.id),
        locationId: String(location.id),
        lotId: lot ? String(lot.id) : null,
        lotName: lot ? String(lot.name) : null,
        quantity: String(quant.quantity),
        revision: Number(quant.version ?? 0),
      }
      positions.push({
        locationId: evidence.locationId,
        locationName: String(location.name),
        lotId: evidence.lotId,
        lotName: evidence.lotName,
        quantity: evidence.quantity,
        revision: evidence.revision,
        version: `sav_${stableHash(evidence)}`,
        requiresLotName: false,
      })
    }
    if (tracking === 'none' ? selected.length === 0 : true) {
      const evidence = {
        productId: String(row.id),
        locationId: String(location.id),
        lotId: null,
        lotName: null,
        quantity: '0',
        revision: -1,
      }
      positions.push({
        locationId: evidence.locationId,
        locationName: String(location.name),
        lotId: null,
        lotName: null,
        quantity: '0',
        revision: -1,
        version: `sav_${stableHash(evidence)}`,
        requiresLotName: tracking !== 'none',
      })
    }
  }
  const projectedPositions = positions.map(({ revision: _revision, ...position }) => position)
  const content = {
    ...base,
    availableQuantity: String(stock.available ?? base.availableQuantity),
    tracking,
    categoryId: template.categoryId == null ? null : String(template.categoryId),
    stockPositions: projectedPositions,
  }
  const version = `ipv_${stableHash({
    ...content,
    inventoryRevision: Number(config.inventoryRevision ?? 0),
  })}`
  // `delete` is withheld until a product's references can be checked. The guard
  // behind it only sees stock history, so a product still named by a draft
  // quotation could be erased under it, leaving the order line pointing at
  // nothing. Advertising the action would invite exactly that call.
  const availableActions = [
    'update',
    base.active ? 'archive' : 'restore',
    ...(base.kind === 'storable' && base.active ? ['adjust_stock'] : []),
  ]
  return {
    data: { ...content, version, availableActions, readOnly: false },
    revision: Number(config.inventoryRevision ?? 0),
    positions,
  }
}

const readDetail = async (ctx: ServeContext, id: string, companyId: string, url: URL, req: Req) => {
  const current = await currentProduct(ctx, id, url, req)
  if (!current) return null
  const projected = await projectDetail(ctx, current.row, current.template, companyId, url, req)
  return projected ? { ...current, ...projected } : null
}

const mutationResult = async (ctx: ServeContext, id: string, companyId: string, url: URL, req: Req) => {
  const current = await readDetail(ctx, id, companyId, url, req)
  if (!current) return notFound(ctx, url, req)
  return { data: current.data, headers: { etag: `"${String(current.data.version)}"` } }
}

const writeArgs = (body: Row) => {
  const channels = body.channels as Row
  return {
    name: body.name,
    kind: body.kind,
    uomId: body.uomId,
    categoryId: body.categoryId,
    salePrice: body.salePrice,
    cost: body.cost,
    saleOk: channels.sales,
    purchaseOk: channels.purchase,
    pointOfSale: channels.pointOfSale,
    tracking: body.tracking,
    sku: body.sku,
    barcode: body.barcode,
  }
}

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
    handler: async (ctx, url, req, _params, request) => {
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
      const context = await contextOf(ctx, pageRows, String(request.identity!.companyId), url, req)
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
    method: 'POST',
    path: 'inventory/products/create',
    operationId: 'staff.inventory.products.create',
    summary: 'Create or replay one canonical goods product aggregate.',
    auth: 'required',
    capability: { key: 'inventory.products', action: 'create' },
    request: { body: writeBody(false) },
    responses: {
      '200': envelope(detail),
      '409': envelope({ type: 'null' }),
      '422': envelope({ type: 'null' }),
    },
    idempotent: true,
    rateLimit: { action: 'staff.inventory.products.create', limit: 60, windowMs: 60_000 },
    handler: async (ctx, url, req, _params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const namespace = `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:stock.saveInventoryProduct.create`
      const id = commandId('staff_inv_p', namespace, key)
      const templateId = commandId('staff_inv_t', namespace, key)
      const result = (await ctx.call(
        'stock.saveInventoryProduct',
        { id, templateId, create: true, ...writeArgs(request.body) },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: namespace },
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      return mutationResult(ctx, id, String(request.identity!.companyId), url, req)
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'inventory/products/management/options',
    operationId: 'staff.inventory.products.managementOptions',
    summary: 'List bounded canonical choices used by inventory product management.',
    auth: 'required',
    capability: { key: 'inventory.products', action: 'manage' },
    responses: { '200': envelope(managementOptions) },
    handler: async (ctx, url, req) => {
      const [units, categories, routes, locations] = (await Promise.all([
        ctx.call('uom.listUnits', {}, url, req),
        ctx.call('product.listCategories', { limit: 2_000 }, url, req),
        ctx.call('stock.listRoutes', {}, url, req),
        ctx.call('stock.listLocations', {}, url, req),
      ])) as [Row[], Row[], Row[], Row[]]
      const options = (rows: Row[]) =>
        rows
          .map((row) => ({
            id: String(row.id),
            name: String(row.path ?? row.name),
            code: row.code == null ? null : String(row.code),
            parentId: row.parentId == null ? null : String(row.parentId),
          }))
          .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
      return {
        data: {
          uoms: options(units),
          categories: options(categories),
          routes: options(routes),
          locations: options(
            locations.filter((location) => ['internal', 'transit'].includes(String(location.usage))),
          ),
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
    handler: async (ctx, url, req, params, request) => {
      const current = await readDetail(ctx, params.id, String(request.identity!.companyId), url, req)
      if (!current) return notFound(ctx, url, req)
      return { data: current.data, headers: { etag: `"${String(current.data.version)}"` } }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'PUT',
    path: 'inventory/products/{id}/update',
    operationId: 'staff.inventory.products.update',
    summary: 'Update one product aggregate under a strong version.',
    auth: 'required',
    capability: { key: 'inventory.products', action: 'update' },
    request: { params: idParams, body: writeBody(true) },
    responses: {
      '200': envelope(detail),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
      '422': envelope({ type: 'null' }),
    },
    idempotent: true,
    rateLimit: { action: 'staff.inventory.products.update', limit: 120, windowMs: 60_000 },
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const companyId = String(request.identity!.companyId)
      const current = await readDetail(ctx, params.id, companyId, url, req)
      if (!current) return notFound(ctx, url, req)
      const expected = requestVersion(req, request.body)
      if (!expected || expected !== current.data.version) return versionFailure(ctx, url, req)
      const namespace = `staff:${companyId}:${request.identity!.userId}:stock.saveInventoryProduct.update`
      const result = (await ctx.call(
        'stock.saveInventoryProduct',
        {
          id: params.id,
          templateId: current.template.id,
          expectedRevision: current.revision,
          ...writeArgs(request.body),
        },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: namespace },
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      return mutationResult(ctx, params.id, companyId, url, req)
    },
  }),
  ...(['archive', 'restore'] as const).map((action) =>
    defineChannelRoute({
      profile: 'staff',
      method: 'POST',
      path: `inventory/products/{id}/${action}`,
      operationId: `staff.inventory.products.${action}`,
      summary: `${action === 'archive' ? 'Archive' : 'Restore'} one product aggregate under a strong version.`,
      auth: 'required',
      capability: { key: 'inventory.products', action },
      request: { params: idParams, body: versionBody },
      responses: {
        '200': envelope(detail),
        '404': envelope({ type: 'null' }),
        '409': envelope({ type: 'null' }),
      },
      idempotent: true,
      rateLimit: { action: `staff.inventory.products.${action}`, limit: 60, windowMs: 60_000 },
      handler: async (ctx, url, req, params, request) => {
        const key = idempotencyKey(ctx, url, req)
        if (typeof key !== 'string') return key
        const companyId = String(request.identity!.companyId)
        const current = await readDetail(ctx, params.id, companyId, url, req)
        if (!current) return notFound(ctx, url, req)
        const expected = requestVersion(req, request.body)
        if (!expected || expected !== current.data.version) return versionFailure(ctx, url, req)
        const namespace = `staff:${companyId}:${request.identity!.userId}:stock.setInventoryProductActive.${action}`
        const result = (await ctx.call(
          'stock.setInventoryProductActive',
          { id: params.id, active: action === 'restore', expectedRevision: current.revision },
          url,
          req,
          { idempotencyKey: key, idempotencyNamespace: namespace },
        )) as Row
        if (result.ok !== true) return domainFailure(ctx, url, req, result)
        return mutationResult(ctx, params.id, companyId, url, req)
      },
    }),
  ),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'inventory/products/{id}/stock-adjustments',
    operationId: 'staff.inventory.products.adjustStock',
    summary: 'Apply one inventory count against fresh stock-position evidence.',
    auth: 'required',
    capability: { key: 'inventory.products', action: 'adjust_stock' },
    request: { params: idParams, body: adjustmentBody },
    responses: {
      '200': envelope(adjustmentResult),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
      '422': envelope({ type: 'null' }),
    },
    idempotent: true,
    rateLimit: { action: 'staff.inventory.products.adjustStock', limit: 120, windowMs: 60_000 },
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const companyId = String(request.identity!.companyId)
      const current = await readDetail(ctx, params.id, companyId, url, req)
      if (!current) return notFound(ctx, url, req)
      const body = request.body
      const position = current.positions.find(
        (candidate) =>
          candidate.locationId === String(body.locationId) &&
          candidate.lotId === (body.lotId == null ? null : String(body.lotId)),
      )
      if (!position || position.version !== body.expectedVersion) return versionFailure(ctx, url, req, true)
      const locations = (await ctx.call('stock.listLocations', {}, url, req)) as Row[]
      const inventoryLocation = locations
        .filter((location) => location.usage === 'inventory')
        .sort((left, right) => String(left.id).localeCompare(String(right.id)))[0]
      if (!inventoryLocation)
        return domainFailure(
          ctx,
          url,
          req,
          invalidResult('locationId', 'inventory loss location is not configured'),
        )
      const namespace = `staff:${companyId}:${request.identity!.userId}:stock.adjustInventory`
      const adjustmentId = commandId('staff_inv_adj', namespace, key)
      const result = (await ctx.call(
        'stock.adjustInventory',
        {
          id: adjustmentId,
          productId: params.id,
          locationId: body.locationId,
          inventoryLocationId: inventoryLocation.id,
          countedQuantity: body.countedQuantity,
          lotId: body.lotId,
          productUomId: (current.data.uom as Row).id,
          expectedQuantRevision: position.revision,
          reason: body.reason,
        },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: namespace },
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      const refreshed = await readDetail(ctx, params.id, companyId, url, req)
      const changed = refreshed?.positions.find(
        (candidate) => candidate.locationId === position.locationId && candidate.lotId === position.lotId,
      )
      if (!changed) return versionFailure(ctx, url, req, true)
      return {
        data: {
          outcome: 'adjusted',
          previousQuantity: position.quantity,
          currentQuantity: changed.quantity,
          version: changed.version,
        },
      }
    },
  }),
)
