// Staff-facing warehouse transfer reads.
//
// Stock owns the transfer aggregate and batches its joins. This facade adds only
// the company/product/unit labels required by the native projection; claim and
// execution commands remain absent until their ownership and version models exist.

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, routesOf, sha256 } from '../channel_api/core.ts'
import { PICKING_TYPE_CODES, TRACKING } from '../stock/functions.ts'

type Req = Parameters<Route>[1]
type Row = Record<string, unknown>

const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }
const named = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, name: string },
  required: ['id', 'name'],
}
const operation = {
  type: 'object',
  additionalProperties: false,
  properties: {
    code: { type: 'string', enum: [...PICKING_TYPE_CODES] },
    name: string,
  },
  required: ['code', 'name'],
}
const sourceDocument = {
  type: 'object',
  additionalProperties: false,
  properties: { type: { type: 'string', enum: ['other', 'none'] }, reference: string },
  required: ['type'],
}
const context = {
  type: 'object',
  additionalProperties: false,
  properties: {
    company: named,
    warehouse: named,
    sourceLocation: named,
    destinationLocation: named,
    operation,
    sourceDocument,
  },
  required: ['company', 'sourceLocation', 'destinationLocation', 'operation', 'sourceDocument'],
}
const progress = {
  type: 'object',
  additionalProperties: false,
  properties: {
    lineCount: { type: 'integer', minimum: 0 },
    completedLineCount: { type: 'integer', minimum: 0 },
  },
  required: ['lineCount', 'completedLineCount'],
}
const trackingSummary = {
  type: 'object',
  additionalProperties: false,
  properties: { lotOrSerialRequired: { type: 'boolean' }, allRequirementsSatisfied: { type: 'boolean' } },
  required: ['lotOrSerialRequired', 'allRequirementsSatisfied'],
}
const quality = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: {
      type: 'string',
      enum: ['not_required', 'pending', 'passed', 'failed', 'unavailable'],
    },
    requirements: { type: 'array', items: string },
  },
  required: ['status', 'requirements'],
}
const nextAction = {
  type: 'object',
  additionalProperties: false,
  properties: { code: string, label: string, supported: { type: 'boolean' }, reason: string },
  required: ['code', 'label', 'supported'],
}
const sourceReference = {
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { type: 'string', const: 'stock_picking' },
    id: string,
    displayName: string,
    version: string,
  },
  required: ['type', 'id', 'displayName', 'version'],
}
const summary = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    title: string,
    state: {
      type: 'string',
      enum: ['waiting', 'ready', 'in_progress', 'blocked', 'done', 'cancelled'],
    },
    context,
    progress,
    tracking: trackingSummary,
    quality,
    nextAction,
    sourceReference,
    version: string,
    scheduledAt: string,
  },
  required: [
    'id',
    'title',
    'state',
    'context',
    'progress',
    'tracking',
    'quality',
    'nextAction',
    'sourceReference',
    'version',
  ],
}
const product = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, name: string, sku: string },
  required: ['id', 'name'],
}
const lot = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, name: string, quantity: string },
  required: ['name', 'quantity'],
}
const line = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    product,
    uom: named,
    expectedQuantity: string,
    doneQuantity: string,
    remainingQuantity: string,
    tracking: { type: 'string', enum: [...TRACKING] },
    trackingRequirement: {
      type: 'string',
      enum: ['not_required', 'required', 'satisfied'],
    },
    lots: { type: 'array', items: lot },
  },
  required: [
    'id',
    'product',
    'uom',
    'expectedQuantity',
    'doneQuantity',
    'remainingQuantity',
    'tracking',
    'trackingRequirement',
    'lots',
  ],
}
const detail = {
  ...summary,
  properties: { ...summary.properties, lines: { type: 'array', items: line } },
  required: [...summary.required, 'lines'],
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

const numberString = (value: unknown): string => String(Number(value ?? 0))
const pickingState = (value: unknown): string => {
  if (value === 'done') return 'done'
  if (value === 'cancel') return 'cancelled'
  if (value === 'assigned') return 'ready'
  return 'waiting'
}
/**
 * The published contract calls this "an opaque strong version derived from the
 * canonical picking aggregate", so it has to be derived from all of it. Hashing
 * the stock row alone left out everything the projection resolves elsewhere —
 * the product and unit names, the company — and renaming a unit of measure
 * changed the answer while leaving the version untouched, which is the one
 * direction a validator must never be wrong in.
 *
 * Hashing the built representation also pins the key order to this file rather
 * than to whatever order a driver hands its columns back in.
 */
const aggregateVersion = (content: Row): string => `pkv_${sha256(JSON.stringify(content))}`

type References = {
  company: Row
  products: Map<string, Row>
  units: Map<string, Row>
}

const referencesFor = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  rows: Row[],
  companyId: string,
): Promise<References> => {
  const moves = rows.flatMap((row) => (Array.isArray(row.moves) ? (row.moves as Row[]) : []))
  const productIds = [...new Set(moves.map((move) => String(move.productId)))]
  const unitIds = [...new Set(moves.map((move) => String(move.productUomId)))]
  const [company, products, units] = (await Promise.all([
    ctx.call('company.getCompany', { id: companyId }, url, req),
    ctx.call('product.listVariants', { ids: productIds, limit: Math.max(productIds.length, 1) }, url, req),
    ctx.call('uom.listUnits', { ids: unitIds, limit: Math.max(unitIds.length, 1) }, url, req),
  ])) as [Row, Row[], Row[]]
  return {
    company,
    products: new Map(products.map((row) => [String(row.id), row])),
    units: new Map(units.map((row) => [String(row.id), row])),
  }
}

const namedOf = (row: unknown): { id: string; name: string } => {
  const value = (row ?? {}) as Row
  return { id: String(value.id), name: String(value.name) }
}

const lineOf = (move: Row, refs: References) => {
  const expected = Number(move.productUomQty ?? 0)
  const done = Number(move.quantity ?? 0)
  const tracking = TRACKING.includes(move.tracking as never) ? String(move.tracking) : 'none'
  const moveLines = Array.isArray(move.lines) ? (move.lines as Row[]) : []
  const lots = new Map<string, { id?: string; name: string; quantity: number }>()
  for (const moveLine of moveLines) {
    const found = moveLine.lot as Row | null
    if (!found) continue
    const id = String(found.id)
    const current = lots.get(id) ?? { id, name: String(found.name), quantity: 0 }
    current.quantity += Number(moveLine.quantity ?? 0)
    lots.set(id, current)
  }
  const trackedQuantity = [...lots.values()].reduce((sum, entry) => sum + entry.quantity, 0)
  const requirement =
    tracking === 'none' ? 'not_required' : trackedQuantity + 1e-12 >= expected ? 'satisfied' : 'required'
  const variant = refs.products.get(String(move.productId)) ?? {}
  const unit = refs.units.get(String(move.productUomId)) ?? {}
  return {
    id: String(move.id),
    product: {
      id: String(move.productId),
      name: String(variant.name ?? move.name),
      ...(variant.defaultCode ? { sku: String(variant.defaultCode) } : {}),
    },
    uom: { id: String(move.productUomId), name: String(unit.name ?? move.productUomId) },
    expectedQuantity: numberString(expected),
    doneQuantity: numberString(done),
    remainingQuantity: numberString(Math.max(0, expected - done)),
    tracking,
    trackingRequirement: requirement,
    lots: [...lots.values()].map((entry) => ({
      ...(entry.id ? { id: entry.id } : {}),
      name: entry.name,
      quantity: numberString(entry.quantity),
    })),
  }
}

const project = (row: Row, refs: References, includeLines: boolean): Row => {
  const moves = Array.isArray(row.moves) ? (row.moves as Row[]) : []
  const lines = moves.map((move) => lineOf(move, refs))
  const pickingType = (row.pickingType ?? {}) as Row
  const code = PICKING_TYPE_CODES.includes(pickingType.code as never) ? String(pickingType.code) : 'internal'
  const origins = [...new Set(moves.map((move) => String(move.origin ?? '').trim()).filter(Boolean))]
  const tracked = lines.filter((entry) => entry.tracking !== 'none')
  const content: Row = {
    id: String(row.id),
    title: String(row.name),
    state: pickingState(row.state),
    context: {
      company: namedOf(refs.company),
      ...(row.warehouse ? { warehouse: namedOf(row.warehouse) } : {}),
      sourceLocation: namedOf(row.sourceLocation),
      destinationLocation: namedOf(row.destinationLocation),
      operation: { code, name: String(pickingType.name ?? code) },
      sourceDocument: origins.length ? { type: 'other', reference: origins.join(', ') } : { type: 'none' },
    },
    progress: {
      lineCount: lines.length,
      completedLineCount: lines.filter((entry) => Number(entry.remainingQuantity) <= 1e-12).length,
    },
    tracking: {
      lotOrSerialRequired: tracked.length > 0,
      allRequirementsSatisfied: tracked.every((entry) => entry.trackingRequirement === 'satisfied'),
    },
    quality: { status: 'unavailable', requirements: [] },
    nextAction: {
      code: 'review_in_ketsuite',
      label: 'Continue in KetSuite',
      supported: false,
      reason: 'MOBILE_WAREHOUSE_READ_ONLY',
    },
    ...(row.scheduledDate ? { scheduledAt: String(row.scheduledDate) } : {}),
    // Lines carry the resolved labels, so they belong to the hashed content even
    // on the list, where they are not returned: a picking must not report two
    // different versions depending on which screen asked for it.
    lines,
  }
  const version = aggregateVersion(content)
  const { lines: _hashedLines, ...withoutLines } = content
  const base: Row = {
    ...withoutLines,
    sourceReference: {
      type: 'stock_picking',
      id: String(row.id),
      displayName: String(row.name),
      version,
    },
    version,
  }
  return includeLines ? { ...base, lines } : base
}

const notFound = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'stock_staff_channel.pickingNotFound', {
    messageKey: 'stock_staff_channel.error.pickingNotFound',
  }),
})

export const channelRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'warehouse/pickings',
    operationId: 'staff.warehouse.pickings.list',
    summary: 'List warehouse transfers available in the signed-in staff company.',
    auth: 'required',
    capability: { key: 'warehouse.pickings', action: 'read' },
    request: {
      query: {
        type: 'object',
        properties: {
          cursor: string,
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
    responses: { '200': envelope(page) },
    handler: async (ctx, url, req, _params, request) => {
      const limit = positive(url.searchParams.get('limit'), 20, 100)
      const offset = offsetOf(url.searchParams.get('cursor'))
      const rows = (await ctx.call('stock.listPickingViews', { limit: limit + 1, offset }, url, req)) as Row[]
      const refs = await referencesFor(ctx, url, req, rows, String(request.identity!.companyId))
      const hasMore = rows.length > limit
      return {
        data: {
          items: rows.slice(0, limit).map((row) => project(row, refs, false)),
          nextCursor: hasMore ? cursorOf(offset + limit) : null,
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'warehouse/pickings/{id}',
    operationId: 'staff.warehouse.pickings.get',
    summary: 'Read one warehouse transfer and its execution lines.',
    auth: 'required',
    capability: { key: 'warehouse.pickings', action: 'read' },
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
      const row = (await ctx.call('stock.getPickingView', { id: params.id }, url, req)) as Row | null
      if (!row) return notFound(ctx, url, req)
      const refs = await referencesFor(ctx, url, req, [row], String(request.identity!.companyId))
      const data = project(row, refs, true)
      return { data, headers: { etag: `"${String(data.version)}"` } }
    },
  }),
)
