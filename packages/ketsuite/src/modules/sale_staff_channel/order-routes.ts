// Read-only staff sales-order projections.
//
// Sale remains authoritative for totals, lines, deliveries, and invoices. The
// channel joins only the bounded customer label needed by a native list and
// never invents an aggregate version or a write action.

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, routesOf, sha256, stableHash } from '../channel_api/core.ts'
// The domain owns the state machine. Copying its values into the contract by
// hand meant the published enum could fall behind it, and now that the facade
// refuses anything the enum omits, falling behind would turn a legitimate
// filter into a 422.
import { SALE_STATES } from '../sale/functions.ts'

type Req = Parameters<Route>[1]
type Row = Record<string, unknown>

const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }
const money = {
  type: 'object',
  additionalProperties: false,
  properties: { currency: string, amount: string },
  required: ['currency', 'amount'],
}
const party = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, name: string },
  required: ['id', 'name'],
}
const summary = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    reference: string,
    state: { type: 'string', enum: [...SALE_STATES] },
    orderedAt: string,
    customer: party,
    total: money,
  },
  required: ['id', 'reference', 'state', 'orderedAt', 'customer', 'total'],
}
const line = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    productId: string,
    name: string,
    quantity: string,
    uomId: string,
    unitPrice: string,
    discount: string,
    subtotal: string,
  },
  required: ['id', 'productId', 'name', 'quantity', 'uomId', 'unitPrice', 'discount', 'subtotal'],
}
const availabilityLine = {
  type: 'object',
  additionalProperties: false,
  properties: {
    productId: string,
    requestedQuantity: string,
    availableQuantity: string,
    sufficient: { type: 'boolean' },
  },
  required: ['productId', 'requestedQuantity', 'availableQuantity', 'sufficient'],
}
const detail = {
  ...summary,
  properties: {
    ...summary.properties,
    warehouseId: string,
    customerReference: nullableString,
    notes: nullableString,
    lines: { type: 'array', items: line },
    deliveryMoveCount: { type: 'integer', minimum: 0 },
    invoiceCount: { type: 'integer', minimum: 0 },
    version: { type: 'string', pattern: '^sov_[0-9a-f]{64}$' },
    availabilityVersion: { type: 'string', pattern: '^sav_[0-9a-f]{64}$' },
    availability: { type: 'array', items: availabilityLine },
    readOnly: { type: 'boolean', const: true },
  },
  required: [
    ...summary.required,
    'warehouseId',
    'customerReference',
    'notes',
    'lines',
    'deliveryMoveCount',
    'invoiceCount',
    'version',
    'availabilityVersion',
    'availability',
    'readOnly',
  ],
}
const lifecycleReference = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, reference: string, state: string },
  required: ['id', 'reference', 'state'],
}
const lifecycleInvoice = {
  ...lifecycleReference,
  properties: { ...lifecycleReference.properties, paymentStatus: string },
  required: [...lifecycleReference.required, 'paymentStatus'],
}
const lifecycle = {
  type: 'object',
  additionalProperties: false,
  properties: {
    order: lifecycleReference,
    deliveries: { type: 'array', items: lifecycleReference },
    invoices: { type: 'array', items: lifecycleInvoice },
    version: string,
    readOnly: { type: 'boolean', const: true },
  },
  required: ['order', 'deliveries', 'invoices', 'version', 'readOnly'],
}
const page = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: { type: 'array', items: summary },
    nextCursor: nullableString,
  },
  required: ['items', 'nextCursor'],
}
const envelope = (data: unknown) => ({
  type: 'object',
  properties: { data, error: {}, meta: { type: 'object' } },
})

const decimal = { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d+)?$' }
const draftLine = {
  type: 'object',
  additionalProperties: false,
  properties: { productId: string, quantity: decimal, uomId: string },
  required: ['productId', 'quantity', 'uomId'],
}
const draftBody = (withVersion: boolean) => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    partnerId: string,
    warehouseId: string,
    customerReference: { type: 'string', maxLength: 200 },
    notes: { type: 'string', maxLength: 2000 },
    lines: { type: 'array', minItems: 1, maxItems: 100, items: draftLine },
    ...(withVersion ? { expectedVersion: { type: 'string', pattern: '^sov_[0-9a-f]{64}$' } } : {}),
  },
  required: ['partnerId', 'lines', ...(withVersion ? ['expectedVersion'] : [])],
})
const replayHeaders = {
  type: 'object',
  additionalProperties: true,
  properties: { 'Idempotency-Key': { type: 'string', minLength: 8, maxLength: 200 } },
  required: ['Idempotency-Key'],
}
const versionHeaders = {
  type: 'object',
  additionalProperties: true,
  properties: {
    ...replayHeaders.properties,
    'If-Match': { type: 'string', minLength: 1, maxLength: 200 },
  },
  required: ['Idempotency-Key', 'If-Match'],
}
const expectedVersionBody = (availability = false) => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    expectedVersion: { type: 'string', pattern: '^sov_[0-9a-f]{64}$' },
    ...(availability ? { availabilityVersion: { type: 'string', pattern: '^sav_[0-9a-f]{64}$' } } : {}),
  },
  required: ['expectedVersion', ...(availability ? ['availabilityVersion'] : [])],
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

// A page of orders points at a handful of partners, and asking for each name on
// its own turns fifty rows into two hundred queries: getPartner also loads the
// addresses and roles this projection never reads. listPartners takes the ids
// together. Archived partners stay in, or an order whose customer was later
// retired would lose its label.
const namesOf = async (ctx: ServeContext, rows: Row[], url: URL, req: Req) => {
  const ids = [...new Set(rows.map((row) => String(row.partnerId)))]
  if (!ids.length) return new Map<string, string>()
  const partners = (await ctx.call('partner.listPartners', { ids, includeArchived: true }, url, req)) as Row[]
  return new Map(partners.map((partner) => [String(partner.id), String(partner.name)]))
}
const customerOf = (row: Row, names: Map<string, string>) => {
  const id = String(row.partnerId)
  return { id, name: names.get(id) ?? id }
}
const projectSummary = (row: Row, names: Map<string, string>) => ({
  id: String(row.id),
  reference: String(row.name),
  state: String(row.state),
  orderedAt: String(row.dateOrder),
  customer: customerOf(row, names),
  total: { currency: String(row.currency), amount: String(row.amountTotal) },
})

const projectedLines = (row: Row) =>
  (Array.isArray(row.lines) ? (row.lines as Row[]) : [])
    .sort(
      (left, right) =>
        Number(left.sequence ?? 0) - Number(right.sequence ?? 0) ||
        String(left.id).localeCompare(String(right.id)),
    )
    .map((item) => ({
      id: String(item.id),
      productId: String(item.productId),
      name: String(item.name),
      quantity: String(item.productUomQty),
      uomId: String(item.productUomId),
      unitPrice: String(item.priceUnit),
      discount: String(item.discount),
      subtotal: String(item.priceSubtotal),
    }))

const availabilityOf = async (ctx: ServeContext, row: Row, url: URL, req: Req) => {
  const requested = new Map<string, number>()
  for (const item of projectedLines(row))
    requested.set(item.productId, (requested.get(item.productId) ?? 0) + Number(item.quantity))
  const productIds = [...requested.keys()].sort()
  const rows = productIds.length
    ? ((await ctx.call(
        'stock.listProductAvailability',
        { productIds, warehouseId: row.warehouseId },
        url,
        req,
      )) as Row[])
    : []
  const available = new Map(rows.map((item) => [String(item.productId), String(item.available)]))
  const availability = productIds.map((productId) => {
    const requestedQuantity = String(requested.get(productId) ?? 0)
    const availableQuantity = available.get(productId) ?? '0'
    return {
      productId,
      requestedQuantity,
      availableQuantity,
      sufficient: Number(availableQuantity) >= Number(requestedQuantity),
    }
  })
  return {
    availability,
    availabilityVersion: `sav_${stableHash({ warehouseId: row.warehouseId, availability })}`,
  }
}

const projectDetail = async (ctx: ServeContext, row: Row, url: URL, req: Req) => {
  const base = {
    ...projectSummary(row, await namesOf(ctx, [row], url, req)),
    warehouseId: String(row.warehouseId),
    customerReference: row.clientOrderRef == null ? null : String(row.clientOrderRef),
    notes: row.notes == null ? null : String(row.notes),
    lines: projectedLines(row),
    deliveryMoveCount: Array.isArray(row.moves) ? row.moves.length : 0,
    invoiceCount: Array.isArray(row.invoices) ? row.invoices.length : 0,
  }
  return {
    ...base,
    version: `sov_${stableHash(base)}`,
    ...(await availabilityOf(ctx, row, url, req)),
    readOnly: true,
  }
}

const notFound = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'sale_staff_channel.orderNotFound', {
    messageKey: 'sale_staff_channel.error.orderNotFound',
  }),
})

const domainFailure = (ctx: ServeContext, url: URL, req: Req, result: unknown) => {
  const issues = Array.isArray((result as { errors?: unknown })?.errors)
    ? ((result as { errors: Row[] }).errors ?? [])
    : []
  const conflict = issues.some((issue) => ['expectedRevision', 'state'].includes(String(issue.field)))
  return {
    status: conflict ? 409 : 422,
    error: channelError(
      ctx,
      url,
      req,
      conflict ? 'sale_staff_channel.conflict' : 'sale_staff_channel.invalidRequest',
      {
        messageKey: conflict
          ? 'sale_staff_channel.error.conflict'
          : 'sale_staff_channel.error.invalidRequest',
        fieldErrors: Object.fromEntries(
          issues
            .filter((issue) => issue.field)
            .map((issue) => [
              String(issue.field),
              {
                code: 'sale_staff_channel.invalidField',
                messageKey: 'sale_staff_channel.error.invalidField',
                params: {},
              },
            ]),
        ),
      },
    ),
  }
}

const idempotencyKey = (ctx: ServeContext, url: URL, req: Req) => {
  const key = String(req.headers['idempotency-key'] ?? '').trim()
  if (key.length >= 8 && key.length <= 200) return key
  return {
    status: 400,
    error: channelError(ctx, url, req, 'channel_api.idempotencyRequired', {
      messageKey: 'channel_api.error.idempotencyRequired',
    }),
  }
}

const requestVersion = (req: Req, body: Row): string | null => {
  const expected = String(body.expectedVersion ?? '')
  const header = String(req.headers['if-match'] ?? '').trim()
  if (!header) return null
  return header === expected || header === `"${expected}"` ? expected : null
}

const warehouseForCreate = async (ctx: ServeContext, url: URL, req: Req, requested: unknown) => {
  if (requested != null && String(requested).trim()) return String(requested)
  const warehouses = (await ctx.call('stock.listWarehouses', {}, url, req)) as Row[]
  return warehouses.length === 1 ? String(warehouses[0]!.id) : null
}

const versionFailure = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 409,
  error: channelError(ctx, url, req, 'sale_staff_channel.versionConflict', {
    messageKey: 'sale_staff_channel.error.versionConflict',
  }),
})

const availabilityFailure = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 409,
  error: channelError(ctx, url, req, 'sale_staff_channel.availabilityChanged', {
    messageKey: 'sale_staff_channel.error.availabilityChanged',
    retryable: true,
  }),
})

const currentOrder = async (ctx: ServeContext, url: URL, req: Req, id: string) =>
  (await ctx.call('sale.getOrder', { id }, url, req)) as Row | null

const commandId = (namespace: string, key: string, suffix = '') =>
  `staff_so_${stableHash(`${namespace}\n${key}\n${suffix}`).slice(0, 32)}`

const mutationResult = async (ctx: ServeContext, url: URL, req: Req, id: string) => {
  const row = await currentOrder(ctx, url, req, id)
  if (!row) return notFound(ctx, url, req)
  const data = await projectDetail(ctx, row, url, req)
  return { data, headers: { etag: `"${data.version}"` } }
}

const idParams = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string },
  required: ['id'],
}

const detailHandler = async (ctx: ServeContext, url: URL, req: Req, params: Record<string, string>) =>
  mutationResult(ctx, url, req, params.id)

export const orderRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'sales/orders/{id}',
    operationId: 'staff.sales.orders.get',
    summary: 'Read the canonical versioned sales order used by staff commands.',
    auth: 'required',
    capability: { key: 'sales.orders', action: 'read' },
    request: { params: idParams },
    responses: { '200': envelope(detail), '404': envelope({ type: 'null' }) },
    handler: detailHandler,
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'sales/orders',
    operationId: 'staff.sales.orders.list',
    summary: 'List or search sales orders available to the signed-in salesperson.',
    auth: 'required',
    capability: { key: 'sales.orders', action: 'read' },
    request: {
      query: {
        type: 'object',
        properties: {
          query: string,
          state: { type: 'string', enum: [...SALE_STATES] },
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
        'sale.listOrders',
        {
          search: url.searchParams.get('query') || undefined,
          state: url.searchParams.get('state') || undefined,
          limit: limit + 1,
          offset,
        },
        url,
        req,
      )) as Row[]
      const hasMore = rows.length > limit
      const pageRows = rows.slice(0, limit)
      const names = await namesOf(ctx, pageRows, url, req)
      return {
        data: {
          items: pageRows.map((row) => projectSummary(row, names)),
          nextCursor: hasMore ? cursorOf(offset + limit) : null,
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'sales/orders/{id}/detail',
    operationId: 'staff.sales.orders.detail',
    summary: 'Read one sales order without exposing a mutation contract.',
    auth: 'required',
    capability: { key: 'sales.orders', action: 'read' },
    request: {
      params: {
        type: 'object',
        additionalProperties: false,
        properties: { id: string },
        required: ['id'],
      },
    },
    responses: { '200': envelope(detail), '404': envelope({ type: 'null' }) },
    handler: detailHandler,
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'sales/orders/create',
    operationId: 'staff.sales.orders.create',
    summary: 'Create or replay one canonical draft sales order and all of its lines atomically.',
    auth: 'required',
    capability: { key: 'sales.orders', action: 'create' },
    request: { headers: replayHeaders, body: draftBody(false) },
    responses: {
      '200': envelope(detail),
      '409': envelope({ type: 'null' }),
      '422': envelope({ type: 'null' }),
    },
    idempotent: true,
    rateLimit: { action: 'staff.sales.orders.create', limit: 60, windowMs: 60_000 },
    handler: async (ctx, url, req, _params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const warehouseId = await warehouseForCreate(ctx, url, req, request.body.warehouseId)
      if (!warehouseId)
        return domainFailure(ctx, url, req, {
          errors: [{ field: 'warehouseId', message: 'select one warehouse' }],
        })
      const body = request.body
      const namespace = `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:sale.saveDraft.create`
      const id = commandId(namespace, key)
      const result = (await ctx.call(
        'sale.saveDraft',
        {
          id,
          partnerId: body.partnerId,
          warehouseId,
          clientOrderRef: body.customerReference,
          notes: body.notes,
          create: true,
          lines: (body.lines as Row[]).map((item, index) => ({
            id: `${id}:line:${index + 1}`,
            productId: item.productId,
            productUomQty: item.quantity,
            productUomId: item.uomId,
          })),
        },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: namespace },
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      return mutationResult(ctx, url, req, id)
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'PUT',
    path: 'sales/orders/{id}/update',
    operationId: 'staff.sales.orders.update',
    summary: 'Replace one draft order header and line set under a strong version.',
    auth: 'required',
    capability: { key: 'sales.orders', action: 'update' },
    request: { params: idParams, headers: versionHeaders, body: draftBody(true) },
    responses: {
      '200': envelope(detail),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
      '422': envelope({ type: 'null' }),
    },
    idempotent: true,
    rateLimit: { action: 'staff.sales.orders.update', limit: 120, windowMs: 60_000 },
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const row = await currentOrder(ctx, url, req, params.id)
      if (!row) return notFound(ctx, url, req)
      const current = await projectDetail(ctx, row, url, req)
      const expected = requestVersion(req, request.body)
      if (!expected || expected !== current.version) return versionFailure(ctx, url, req)
      const body = request.body
      const namespace = `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:sale.saveDraft.update`
      const result = (await ctx.call(
        'sale.saveDraft',
        {
          id: params.id,
          partnerId: body.partnerId,
          warehouseId: body.warehouseId ?? row.warehouseId,
          clientOrderRef: body.customerReference,
          notes: body.notes,
          expectedRevision: Number(row.revision ?? 0),
          lines: (body.lines as Row[]).map((item, index) => ({
            id: `${params.id}:staff:${stableHash(`${key}\n${index}`).slice(0, 24)}`,
            productId: item.productId,
            productUomQty: item.quantity,
            productUomId: item.uomId,
          })),
        },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: namespace },
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      return mutationResult(ctx, url, req, params.id)
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'sales/orders/{id}/confirm',
    operationId: 'staff.sales.orders.confirm',
    summary: 'Confirm one reviewed quotation against fresh order and availability evidence.',
    auth: 'required',
    capability: { key: 'sales.orders', action: 'confirm' },
    request: { params: idParams, headers: versionHeaders, body: expectedVersionBody(true) },
    responses: {
      '200': envelope(detail),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    idempotent: true,
    rateLimit: { action: 'staff.sales.orders.confirm', limit: 60, windowMs: 60_000 },
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const row = await currentOrder(ctx, url, req, params.id)
      if (!row) return notFound(ctx, url, req)
      const current = await projectDetail(ctx, row, url, req)
      const expected = requestVersion(req, request.body)
      if (!expected || expected !== current.version) return versionFailure(ctx, url, req)
      if (String(request.body.availabilityVersion) !== current.availabilityVersion)
        return availabilityFailure(ctx, url, req)
      const namespace = `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:sale.confirmOrder`
      const result = (await ctx.call(
        'sale.confirmOrder',
        { id: params.id, expectedRevision: Number(row.revision ?? 0) },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: namespace },
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      return mutationResult(ctx, url, req, params.id)
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'sales/orders/{id}/cancel',
    operationId: 'staff.sales.orders.cancel',
    summary: 'Cancel one undelivered and uninvoiced sales order under a strong version.',
    auth: 'required',
    capability: { key: 'sales.orders', action: 'cancel' },
    request: { params: idParams, headers: versionHeaders, body: expectedVersionBody(false) },
    responses: {
      '200': envelope(detail),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    idempotent: true,
    rateLimit: { action: 'staff.sales.orders.cancel', limit: 60, windowMs: 60_000 },
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const row = await currentOrder(ctx, url, req, params.id)
      if (!row) return notFound(ctx, url, req)
      const current = await projectDetail(ctx, row, url, req)
      const expected = requestVersion(req, request.body)
      if (!expected || expected !== current.version) return versionFailure(ctx, url, req)
      const namespace = `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:sale.cancelOrder`
      const result = (await ctx.call(
        'sale.cancelOrder',
        { id: params.id, expectedRevision: Number(row.revision ?? 0) },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: namespace },
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      return mutationResult(ctx, url, req, params.id)
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'sales/orders/{id}/lifecycle',
    operationId: 'staff.sales.orders.lifecycle',
    summary: 'Read the canonical delivery and invoice lifecycle of one sales order.',
    auth: 'required',
    capability: { key: 'sales.orders', action: 'read' },
    request: {
      params: {
        type: 'object',
        additionalProperties: false,
        properties: { id: string },
        required: ['id'],
      },
    },
    responses: { '200': envelope(lifecycle), '404': envelope({ type: 'null' }) },
    handler: async (ctx, url, req, params) => {
      const row = (await ctx.call('sale.getOrder', { id: params.id }, url, req)) as Row | null
      if (!row) return notFound(ctx, url, req)
      const references = (values: unknown, payment = false) =>
        (Array.isArray(values) ? (values as Row[]) : [])
          .map((item) => ({
            id: String(item.id),
            reference: String(item.name ?? item.id),
            state: String(item.state),
            ...(payment ? { paymentStatus: String(item.paymentState ?? 'not_paid') } : {}),
          }))
          .sort((left, right) => left.id.localeCompare(right.id))
      const content = {
        order: { id: String(row.id), reference: String(row.name), state: String(row.state) },
        deliveries: references(row.pickings),
        invoices: references(row.invoices, true),
      }
      const version = `solv_${sha256(JSON.stringify(content))}`
      return {
        data: { ...content, version, readOnly: true },
        headers: { etag: `"${version}"` },
      }
    },
  }),
)
