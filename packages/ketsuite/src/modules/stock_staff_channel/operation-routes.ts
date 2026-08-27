import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, routesOf, sha256 } from '../channel_api/core.ts'
import { claimSchema, detailSchema, projectPicking, referencesFor } from './channel-routes.ts'

type Req = Parameters<Route>[1]
type Row = Record<string, unknown>

const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }
const decimal = { type: 'string', pattern: '^(?:0|[1-9]\\d*)(?:\\.\\d{1,6})?$' }
const envelope = (data: unknown) => ({
  type: 'object',
  properties: { data, error: {}, meta: { type: 'object' } },
})
const params = (name = 'id') => ({
  type: 'object',
  additionalProperties: false,
  properties: { [name]: string },
  required: [name],
})
const expectedBody = (properties: Row = {}, required: string[] = []) => ({
  type: 'object',
  additionalProperties: false,
  properties: { expectedVersion: string, ...properties },
  required: ['expectedVersion', ...required],
})
const named = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, name: string },
  required: ['id', 'name'],
}
const claimResult = {
  type: 'object',
  additionalProperties: false,
  properties: { picking: detailSchema, claim: claimSchema },
  required: ['picking', 'claim'],
}
const completionResult = {
  type: 'object',
  additionalProperties: false,
  properties: {
    picking: detailSchema,
    claim: claimSchema,
    transition: {
      type: 'object',
      additionalProperties: false,
      properties: {
        state: { type: 'string', const: 'done' },
        confirmedAt: { type: 'string', format: 'date-time' },
        lineCount: { type: 'integer', minimum: 1 },
      },
      required: ['state', 'confirmedAt', 'lineCount'],
    },
  },
  required: ['picking', 'claim', 'transition'],
}
const domainFailure = (ctx: ServeContext, url: URL, req: Req, result: Row) => {
  const errors = Array.isArray(result.errors) ? (result.errors as Row[]) : []
  const conflict = errors.some((error) => String(error.code).includes('versionConflict'))
  return {
    status: conflict ? 409 : 422,
    error: channelError(
      ctx,
      url,
      req,
      conflict ? 'stock_staff_channel.conflict' : 'stock_staff_channel.invalid',
      {
        messageKey: conflict ? 'stock_staff_channel.error.conflict' : 'stock_staff_channel.error.invalid',
        details: { errors },
      },
    ),
  }
}
const missing = (ctx: ServeContext, url: URL, req: Req, code = 'pickingNotFound') => ({
  status: 404,
  error: channelError(ctx, url, req, `stock_staff_channel.${code}`, {
    messageKey: 'stock_staff_channel.error.pickingNotFound',
  }),
})
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
const commandId = (kind: string, namespace: string, key: string): string =>
  `${kind}_${sha256(`${namespace}\n${key}`)}`
type StaffIdentity = { companyId: string | null; userId: string }
const callOptions = (request: { identity: StaffIdentity | null }, fn: string, key: string) => ({
  idempotencyKey: key,
  idempotencyNamespace: `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:${fn}`,
})
const loadPicking = async (ctx: ServeContext, url: URL, req: Req, id: string, identity: StaffIdentity) => {
  const row = (await ctx.call('stock.getPickingView', { id }, url, req)) as Row | null
  if (!row) return null
  const refs = await referencesFor(ctx, url, req, [row], String(identity.companyId), identity.userId)
  return { row, data: projectPicking(row, refs, true) }
}
const expected = (req: Req, body: Row, current: string): boolean => {
  const supplied = String(body.expectedVersion ?? '')
  const header = String(req.headers['if-match'] ?? '')
    .replace(/^W\//, '')
    .replace(/^"|"$/g, '')
  return supplied === current && (!header || header === supplied)
}
const versionConflict = (ctx: ServeContext, url: URL, req: Req) =>
  domainFailure(ctx, url, req, {
    errors: [{ field: 'expectedVersion', code: 'stock_staff_channel.error.versionConflict' }],
  })
const releasedClaim = (claim: Row, reason: unknown, userId: string): Row => ({
  ...claim,
  state: 'released',
  ownedByCurrentActor: false,
  releasedBy: { id: userId, name: String((claim.claimant as Row)?.name ?? userId) },
  releaseReason: String(reason),
  releasedAt: new Date().toISOString(),
})

const executionLineInput = {
  type: 'object',
  additionalProperties: false,
  properties: {
    moveId: string,
    moveLineId: string,
    productId: string,
    quantity: decimal,
    sourceLocationId: string,
    destinationLocationId: string,
    lotId: string,
    lotName: string,
    expirationDate: string,
    sourcePackageId: string,
    packageName: string,
    resultPackageName: string,
  },
  required: ['quantity', 'destinationLocationId'],
}
const executionReservation = {
  type: 'object',
  additionalProperties: false,
  properties: {
    moveLineId: string,
    quantity: string,
    sourceLocationId: string,
    destinationLocationId: string,
    uomId: string,
    lotId: string,
    sourcePackageId: string,
    resultPackageId: string,
    entirePackage: { type: 'boolean' },
  },
  required: ['moveLineId', 'quantity', 'sourceLocationId', 'destinationLocationId', 'uomId'],
}
const executionMove = {
  type: 'object',
  additionalProperties: false,
  properties: {
    moveId: string,
    productId: string,
    quantity: string,
    tracking: { type: 'string', enum: ['none', 'lot', 'serial'] },
    uomId: string,
    destinationLocationId: string,
    reservations: { type: 'array', items: executionReservation },
  },
  required: ['moveId', 'productId', 'quantity', 'tracking', 'uomId'],
}
const executionPreviewSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'string', const: 'mobile.warehouse.execution/1' },
    pickingId: string,
    operation: { type: 'string', enum: ['incoming', 'outgoing', 'internal'] },
    expectedVersion: string,
    policy: { type: 'object' },
    quality: { type: 'object' },
    moves: { type: 'array', items: executionMove },
  },
  required: ['schemaVersion', 'pickingId', 'operation', 'expectedVersion', 'policy', 'quality', 'moves'],
}
const executedLine = {
  type: 'object',
  additionalProperties: false,
  properties: {
    moveLineId: string,
    productId: string,
    quantity: string,
    sourceLocationId: string,
    destinationLocationId: string,
    lotId: string,
    packageId: string,
    sourcePackageId: string,
    resultPackageId: string,
  },
  required: ['moveLineId', 'productId', 'quantity', 'destinationLocationId'],
}
const executionResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'string', const: 'mobile.warehouse.execution/1' },
    status: { type: 'string', const: 'done' },
    pickingId: string,
    backorderIds: { type: 'array', items: string },
    lines: { type: 'array', items: executedLine },
  },
  required: ['schemaVersion', 'status', 'pickingId', 'backorderIds', 'lines'],
}

const operationOf = (row: Row): 'incoming' | 'outgoing' | 'internal' => {
  const code = String((row.pickingType as Row | null)?.code ?? 'internal')
  return code === 'incoming' || code === 'outgoing' ? code : 'internal'
}
const executionPreview = (row: Row): Row => {
  const operation = operationOf(row)
  const moves = (Array.isArray(row.moves) ? (row.moves as Row[]) : []).map((move) => ({
    moveId: String(move.id),
    productId: String(move.productId),
    quantity: String(move.productUomQty),
    tracking: ['lot', 'serial'].includes(String(move.tracking)) ? String(move.tracking) : 'none',
    uomId: String(move.productUomId),
    destinationLocationId: String(move.locationDestId),
    reservations: (Array.isArray(move.lines) ? (move.lines as Row[]) : []).map((line) => ({
      moveLineId: String(line.id),
      quantity: String(line.quantity),
      sourceLocationId: String(line.locationId),
      destinationLocationId: String(line.locationDestId),
      uomId: String(line.productUomId),
      ...(line.lotId ? { lotId: String(line.lotId) } : {}),
    })),
  }))
  const content = {
    schemaVersion: 'mobile.warehouse.execution/1',
    pickingId: String(row.id),
    operation,
    policy: {
      allowPartial: true,
      createBackorder: 'always',
      maxOveragePercent: '0',
      requireExpiration: false,
    },
    quality: { status: 'unavailable', requirements: [], blockingReason: 'QUALITY_DOMAIN_UNAVAILABLE' },
    moves,
  }
  return {
    ...content,
    expectedVersion: `${operation === 'incoming' ? 'rpv' : 'opv'}_${sha256(JSON.stringify(content))}`,
  }
}

const returnLine = {
  type: 'object',
  additionalProperties: false,
  properties: {
    moveLineId: string,
    quantity: string,
    sourceLocationId: string,
    destinationLocationId: string,
    uomId: string,
    sourceMoveLineId: string,
    productId: string,
    tracking: { type: 'string', enum: ['none', 'lot', 'serial'] },
    lotId: string,
  },
  required: [
    'moveLineId',
    'quantity',
    'sourceLocationId',
    'destinationLocationId',
    'uomId',
    'sourceMoveLineId',
    'productId',
    'tracking',
  ],
}
const returnPreviewSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'string', const: 'mobile.warehouse.return-execution/1' },
    sourcePickingId: string,
    destinationLocationId: string,
    expectedVersion: string,
    lines: { type: 'array', items: returnLine },
  },
  required: ['schemaVersion', 'sourcePickingId', 'destinationLocationId', 'expectedVersion', 'lines'],
}
const returnInput = {
  type: 'object',
  additionalProperties: false,
  properties: {
    sourceMoveLineId: string,
    productId: string,
    quantity: decimal,
    sourceLocationId: string,
    destinationLocationId: string,
    lotId: string,
    sourcePackageId: string,
  },
  required: ['sourceMoveLineId', 'productId', 'quantity', 'sourceLocationId', 'destinationLocationId'],
}
const returnResultSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: { type: 'string', const: 'mobile.warehouse.return-execution/1' },
    status: { type: 'string', const: 'done' },
    sourcePickingId: string,
    returnPickingId: string,
    lines: { type: 'array', items: executedLine },
  },
  required: ['schemaVersion', 'status', 'sourcePickingId', 'returnPickingId', 'lines'],
}
const returnPreview = (row: Row): Row => {
  const lines = (Array.isArray(row.moves) ? (row.moves as Row[]) : []).flatMap((move) =>
    (Array.isArray(move.lines) ? (move.lines as Row[]) : []).flatMap((line) =>
      Number(line.quantity) > 0
        ? [
            {
              moveLineId: String(line.id),
              sourceMoveLineId: String(line.id),
              productId: String(move.productId),
              quantity: String(line.quantity),
              sourceLocationId: String(row.locationDestId),
              destinationLocationId: String(row.locationId),
              uomId: String(line.productUomId),
              tracking: ['lot', 'serial'].includes(String(move.tracking)) ? String(move.tracking) : 'none',
              ...(line.lotId ? { lotId: String(line.lotId) } : {}),
            },
          ]
        : [],
    ),
  )
  const content = {
    schemaVersion: 'mobile.warehouse.return-execution/1',
    sourcePickingId: String(row.id),
    destinationLocationId: String(row.locationId),
    lines,
  }
  return { ...content, expectedVersion: `orv_${sha256(JSON.stringify(content))}` }
}

const scanLineSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    productId: string,
    productName: string,
    uomName: string,
    expectedQuantity: string,
    scannedQuantity: string,
    state: { type: 'string', enum: ['pending', 'complete'] },
  },
  required: ['id', 'productId', 'productName', 'uomName', 'expectedQuantity', 'scannedQuantity', 'state'],
}
const scanSessionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    publicId: string,
    version: string,
    state: { type: 'string', enum: ['active', 'paused', 'ready', 'expired', 'cancelled'] },
    operation: { type: 'string', enum: ['incoming', 'outgoing', 'internal'] },
    operationLabel: string,
    origin: string,
    expiresAt: string,
    warehouse: named,
    picking: named,
    progress: { type: 'object' },
    prompt: { type: 'object' },
    feedback: { type: 'object' },
    lines: { type: 'array', items: scanLineSchema },
  },
  required: [
    'publicId',
    'version',
    'state',
    'operation',
    'operationLabel',
    'expiresAt',
    'warehouse',
    'picking',
    'progress',
    'prompt',
    'lines',
  ],
}
const scanProjection = (context: Row): Row => {
  const session = context.session as Row
  const picking = context.picking as Row
  const type = (context.type ?? {}) as Row
  const warehouse = (context.warehouse ?? {}) as Row
  const moves = context.moves as Row[]
  const events = context.events as Row[]
  const products = new Map((context.products as Row[]).map((row) => [String(row.id), row]))
  const templates = new Map((context.templates as Row[]).map((row) => [String(row.id), row]))
  const units = new Map((context.units as Row[]).map((row) => [String(row.id), row]))
  const lines = moves.slice(0, 100).map((move) => {
    const product = products.get(String(move.productId)) ?? {}
    const template = templates.get(String(product.templateId)) ?? {}
    const unit = units.get(String(move.productUomId)) ?? {}
    const scanned = events
      .filter((event) => event.moveId === move.id)
      .reduce((sum, event) => sum + Number(event.quantity), 0)
    const expectedQuantity = Number(move.productUomQty)
    return {
      id: String(move.id),
      productId: String(move.productId),
      productName: String(template.name ?? product.defaultCode ?? move.name),
      uomName: String(unit.name ?? move.productUomId),
      expectedQuantity: String(expectedQuantity),
      scannedQuantity: String(scanned),
      state: scanned + 1e-12 >= expectedQuantity ? 'complete' : 'pending',
    }
  })
  const expectedTotal = lines.reduce((sum, line) => sum + Number(line.expectedQuantity), 0)
  const scannedTotal = lines.reduce((sum, line) => sum + Number(line.scannedQuantity), 0)
  const completeLines = lines.filter((line) => line.state === 'complete').length
  const expired = Date.parse(String(session.expiresAt)) <= Date.now()
  const state = expired
    ? 'expired'
    : session.state === 'active' && completeLines === lines.length
      ? 'ready'
      : String(session.state)
  const promptKind = state === 'active' ? 'scan_product' : state
  const content: Row = {
    publicId: String(session.id),
    state,
    operation: operationOf({ pickingType: type }),
    operationLabel: String(type.name ?? type.code ?? 'Warehouse transfer'),
    ...(picking.origin ? { origin: String(picking.origin) } : {}),
    expiresAt: String(session.expiresAt),
    warehouse: {
      id: String(warehouse.id ?? type.warehouseId ?? 'warehouse'),
      name: String(warehouse.name ?? 'Warehouse'),
    },
    picking: { id: String(picking.id), name: String(picking.name) },
    progress: {
      expected: String(expectedTotal),
      scanned: String(scannedTotal),
      percent: expectedTotal ? Math.min(100, Math.round((scannedTotal / expectedTotal) * 100)) : 100,
      completeLines,
      totalLines: lines.length,
    },
    prompt: {
      kind: promptKind,
      expectedKinds: state === 'active' ? ['product_barcode', 'sku'] : [],
      title: state === 'active' ? 'Scan the next product' : `Session ${state}`,
      detail:
        state === 'active'
          ? 'Scan a barcode assigned to this transfer.'
          : 'No product scan is accepted in this state.',
    },
    ...(session.feedbackKind
      ? {
          feedback: {
            kind: String(session.feedbackKind),
            reason: String(session.feedbackReason),
            announce: String(session.feedbackAnnounce),
          },
        }
      : {}),
    lines,
  }
  return {
    ...content,
    version: `msv_${sha256(JSON.stringify({ content, revision: session.version, events }))}`,
  }
}
const loadScan = async (ctx: ServeContext, url: URL, req: Req, id: string): Promise<Row | null> => {
  const context = (await ctx.call(
    'stock_staff_channel.getScanContext',
    { sessionId: id },
    url,
    req,
  )) as Row | null
  return context ? scanProjection(context) : null
}

const countLineSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    publicId: string,
    version: string,
    product: { type: 'object' },
    location: named,
    lot: named,
    package: named,
    owner: named,
    uom: named,
    isCounted: { type: 'boolean' },
    countedQuantity: nullableString,
    systemQuantity: nullableString,
  },
  required: ['publicId', 'version', 'product', 'location', 'uom', 'isCounted'],
}
const countAttemptSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    publicId: string,
    version: string,
    state: string,
    leaseExpiresAt: nullableString,
    lineCount: { type: 'integer' },
    countedLineCount: { type: 'integer' },
    lines: { type: 'array', items: countLineSchema },
  },
  required: ['publicId', 'version', 'state', 'lineCount', 'countedLineCount', 'lines'],
}
const countSessionSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    publicId: string,
    version: string,
    state: string,
    mode: { type: 'string', enum: ['guided', 'blind', 'double_blind'] },
    expiresAt: string,
    cutoffAt: string,
    warehouse: named,
    location: named,
    product: { type: 'object' },
    lineCount: { type: 'integer' },
    countedLineCount: { type: 'integer' },
    claimable: { type: 'boolean' },
    attemptPublicId: nullableString,
    attempt: countAttemptSchema,
  },
  required: [
    'publicId',
    'version',
    'state',
    'mode',
    'expiresAt',
    'cutoffAt',
    'warehouse',
    'location',
    'product',
    'lineCount',
    'countedLineCount',
    'claimable',
  ],
}
const countCommandSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    schemaVersion: string,
    sessionPublicId: string,
    sessionVersion: string,
    attemptPublicId: string,
    attemptVersion: string,
    attemptState: string,
    leaseExpiresAt: nullableString,
    lineCount: { type: 'integer' },
    countedLineCount: { type: 'integer' },
    linePublicId: string,
    lineVersion: string,
    countedQuantity: string,
    requiredAttemptCount: { type: 'integer' },
    completedAttemptCount: { type: 'integer' },
    sessionState: string,
  },
  required: ['schemaVersion', 'sessionPublicId', 'sessionVersion', 'attemptPublicId', 'attemptVersion'],
}
/**
 * Two different promises, so two different tokens.
 *
 * `version` is what a later command is checked against, so it has to mean the
 * count's own state: which lines are counted, at what quantity, at which row
 * revision. It used to be the row counter with a prefix on it — `ics_1` — and
 * recording a line advances the line and the attempt while leaving the session
 * row alone, so a session's progress went from nothing counted to one counted
 * under an unchanged token, and a conditional GET answered 304 with the old
 * progress.
 *
 * The ETag is the weaker, wider promise: this body has not changed. It covers
 * the labels too — warehouse, location, product, lot, unit — which the version
 * deliberately does not, because those belong to other people. An administrator
 * renaming a location must not reach into a counter's handheld and refuse the
 * next quantity they type.
 */
const countToken = (prefix: 'ics' | 'ica' | 'icl', row: Row, state: unknown): string =>
  `${prefix}_${sha256(JSON.stringify({ state, revision: Number(row.version) }))}`
const countEtag = (data: Row): string => `icb_${sha256(JSON.stringify(data))}`
const countProjection = (context: Row): Row => {
  const session = context.session as Row
  const attempt = context.attempt as Row | null
  const lines = context.lines as Row[]
  const warehouse = (context.warehouse ?? {}) as Row
  const location = (context.location ?? {}) as Row
  const product = (context.product ?? {}) as Row
  const template = (context.template ?? {}) as Row
  const units = new Map((context.units as Row[]).map((row) => [String(row.id), row]))
  const lots = new Map((context.lots as Row[]).map((row) => [String(row.id), row]))
  const projectedLines = lines.map((line) => {
    const unit = units.get(String(line.productUomId)) ?? {}
    const lot = line.lotId ? lots.get(String(line.lotId)) : null
    const content = {
      publicId: String(line.id),
      product: {
        id: String(product.id),
        name: String(template.name ?? product.defaultCode ?? product.id),
        ...(product.defaultCode ? { sku: String(product.defaultCode) } : {}),
      },
      location: { id: String(location.id), name: String(location.name) },
      ...(lot ? { lot: { id: String(lot.id), name: String(lot.name) } } : {}),
      uom: { id: String(line.productUomId), name: String(unit.name ?? line.productUomId) },
      isCounted: line.isCounted === true,
      ...(line.isCounted ? { countedQuantity: String(line.countedQuantity) } : {}),
      ...(session.mode === 'guided' ? { systemQuantity: String(line.systemQuantity) } : {}),
    }
    return {
      ...content,
      version: countToken('icl', line, {
        publicId: content.publicId,
        isCounted: content.isCounted,
        countedQuantity: line.isCounted ? String(line.countedQuantity) : null,
        systemQuantity: String(line.systemQuantity),
      }),
    }
  })
  const attemptContent = attempt
    ? {
        publicId: String(attempt.id),
        state: String(attempt.state),
        ...(attempt.leaseExpiresAt ? { leaseExpiresAt: String(attempt.leaseExpiresAt) } : {}),
        lineCount: projectedLines.length,
        countedLineCount: projectedLines.filter((line) => line.isCounted).length,
        lines: projectedLines,
      }
    : null
  const projectedAttempt =
    attempt && attemptContent
      ? {
          ...attemptContent,
          version: countToken('ica', attempt, {
            publicId: attemptContent.publicId,
            state: attemptContent.state,
            lineCount: attemptContent.lineCount,
            countedLineCount: attemptContent.countedLineCount,
            lines: projectedLines.map((line) => line.version),
          }),
        }
      : null
  const sessionContent = {
    publicId: String(session.id),
    state: String(session.state),
    mode: String(session.mode),
    expiresAt: String(session.expiresAt),
    cutoffAt: String(session.cutoffAt),
    warehouse: { id: String(warehouse.id), name: String(warehouse.name) },
    location: { id: String(location.id), name: String(location.name) },
    product: {
      id: String(product.id),
      name: String(template.name ?? product.defaultCode ?? product.id),
      ...(product.defaultCode ? { sku: String(product.defaultCode) } : {}),
    },
    lineCount: projectedLines.length,
    countedLineCount: projectedLines.filter((line) => line.isCounted).length,
    claimable: !attempt && ['ready', 'in_progress'].includes(String(session.state)),
    ...(attempt ? { attemptPublicId: String(attempt.id), attempt: projectedAttempt } : {}),
  }
  return {
    ...sessionContent,
    version: countToken('ics', session, {
      publicId: sessionContent.publicId,
      state: sessionContent.state,
      mode: sessionContent.mode,
      lineCount: sessionContent.lineCount,
      countedLineCount: sessionContent.countedLineCount,
      attempt: projectedAttempt?.version ?? null,
    }),
  }
}
const loadCount = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  input: { sessionId?: string; attemptId?: string; lineId?: string },
) => {
  const context = (await ctx.call('stock_staff_channel.getCountContext', input, url, req)) as Row | null
  return context ? { context, data: countProjection(context) } : null
}
/**
 * The command echo reads its tokens off the projection rather than rebuilding them.
 *
 * Two places computing the same token is how they come to disagree, and a
 * mutation response whose `attemptVersion` does not match what the next GET
 * hands out sends the caller straight into a 409 it cannot clear.
 */
const countCommand = (context: Row, projection: Row, schemaVersion: string, lineId?: string): Row => {
  const session = context.session as Row
  const attempt = context.attempt as Row
  const lines = context.lines as Row[]
  const projectedAttempt = (projection.attempt ?? {}) as Row
  const projectedLine = ((projectedAttempt.lines ?? []) as Row[]).find(
    (held) => String(held.publicId) === String(lineId),
  )
  return {
    schemaVersion,
    sessionPublicId: String(session.id),
    sessionVersion: String(projection.version),
    attemptPublicId: String(attempt.id),
    attemptVersion: String(projectedAttempt.version),
    attemptState: String(attempt.state),
    ...(attempt.leaseExpiresAt ? { leaseExpiresAt: String(attempt.leaseExpiresAt) } : {}),
    lineCount: lines.length,
    countedLineCount: lines.filter((held) => held.isCounted === true).length,
    ...(projectedLine
      ? {
          linePublicId: String(projectedLine.publicId),
          lineVersion: String(projectedLine.version),
          countedQuantity: String(projectedLine.countedQuantity),
        }
      : {}),
    requiredAttemptCount: Number(session.requiredAttemptCount),
    completedAttemptCount: Number(session.completedAttemptCount),
    sessionState: String(session.state),
  }
}

const mutationResponses = {
  '200': envelope({ type: 'object' }),
  '409': envelope({ type: 'null' }),
  '422': envelope({ type: 'null' }),
}

export const operationRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'warehouse/pickings/{id}/claim',
    operationId: 'staff.warehouse.pickings.claim',
    summary: 'Claim a warehouse transfer for the verified staff actor.',
    auth: 'required',
    capability: { key: 'warehouse.pickings', action: 'claim' },
    request: {
      params: params(),
      body: expectedBody({ reason: { type: 'string', minLength: 3, maxLength: 500 } }, ['reason']),
    },
    responses: { ...mutationResponses, '200': envelope(claimResult) },
    idempotent: true,
    rateLimit: { action: 'staff.warehouse.pickings.claim', limit: 120, windowMs: 60_000 },
    /**
     * The retry has to reach the command, so it is answered before the precondition.
     *
     * Claiming moves the aggregate version, because the version covers the claim.
     * That put two correct-looking rules against each other: a replay of one POST
     * carries the `expectedVersion` it was written with, which is by then stale,
     * so the honest retry was refused 409 — the caller told it had been beaten to
     * its own claim. A command already executed under this key is not a stale
     * write, it is the same write; recognising it first is what makes the
     * `Idempotency-Key` mean anything here.
     */
    handler: async (ctx, url, req, routeParams, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const before = await loadPicking(ctx, url, req, routeParams.id, request.identity!)
      if (!before) return missing(ctx, url, req)
      const namespace = `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:warehouse.claim:${routeParams.id}`
      const claimId = commandId('staff_wclaim', namespace, key)
      const replayed = String((before.data.claim as Row | undefined)?.id ?? '') === claimId
      if (!replayed && !expected(req, request.body, String(before.data.version)))
        return versionConflict(ctx, url, req)
      const result = (await ctx.call(
        'stock_staff_channel.claimPicking',
        { id: claimId, pickingId: routeParams.id, reason: request.body.reason },
        url,
        req,
        callOptions(request, 'stock_staff_channel.claimPicking', key),
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      const after = await loadPicking(ctx, url, req, routeParams.id, request.identity!)
      if (!after?.data.claim) return missing(ctx, url, req)
      return {
        data: { picking: after.data, claim: after.data.claim },
        headers: { etag: `"${String(after.data.version)}"` },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'warehouse/pickings/{id}/release',
    operationId: 'staff.warehouse.pickings.release',
    summary: 'Release a transfer claim owned by the verified staff actor.',
    auth: 'required',
    capability: { key: 'warehouse.pickings', action: 'claim' },
    request: {
      params: params(),
      body: expectedBody({ reason: { type: 'string', minLength: 3, maxLength: 500 } }, ['reason']),
    },
    responses: { ...mutationResponses, '200': envelope(claimResult) },
    idempotent: true,
    rateLimit: { action: 'staff.warehouse.pickings.release', limit: 120, windowMs: 60_000 },
    handler: async (ctx, url, req, routeParams, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const before = await loadPicking(ctx, url, req, routeParams.id, request.identity!)
      if (!before) return missing(ctx, url, req)
      if (!expected(req, request.body, String(before.data.version))) return versionConflict(ctx, url, req)
      const heldClaim = before.data.claim as Row | undefined
      const result = (await ctx.call(
        'stock_staff_channel.releasePicking',
        { pickingId: routeParams.id, reason: request.body.reason },
        url,
        req,
        callOptions(request, 'stock_staff_channel.releasePicking', key),
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      const after = await loadPicking(ctx, url, req, routeParams.id, request.identity!)
      if (!after || !heldClaim) return missing(ctx, url, req)
      return {
        data: {
          picking: after.data,
          claim: releasedClaim(heldClaim, request.body.reason, request.identity!.userId),
        },
        headers: { etag: `"${String(after.data.version)}"` },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'warehouse/pickings/{id}/complete',
    operationId: 'staff.warehouse.pickings.complete',
    summary: 'Complete a claimed outgoing transfer from exact barcode evidence.',
    auth: 'required',
    capability: { key: 'warehouse.pickings', action: 'complete' },
    request: {
      params: params(),
      body: expectedBody(
        {
          reason: { type: 'string', minLength: 3, maxLength: 500 },
          lines: {
            type: 'array',
            minItems: 1,
            maxItems: 500,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                lineId: string,
                barcode: { type: 'string', minLength: 1, maxLength: 128 },
                quantity: decimal,
              },
              required: ['lineId', 'barcode', 'quantity'],
            },
          },
        },
        ['lines', 'reason'],
      ),
    },
    responses: { ...mutationResponses, '200': envelope(completionResult) },
    idempotent: true,
    rateLimit: { action: 'staff.warehouse.pickings.complete', limit: 60, windowMs: 60_000 },
    handler: async (ctx, url, req, routeParams, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const before = await loadPicking(ctx, url, req, routeParams.id, request.identity!)
      if (!before) return missing(ctx, url, req)
      if (!expected(req, request.body, String(before.data.version))) return versionConflict(ctx, url, req)
      const heldClaim = before.data.claim as Row | undefined
      const result = (await ctx.call(
        'stock_staff_channel.completeGuidedPicking',
        { pickingId: routeParams.id, lines: request.body.lines, reason: request.body.reason },
        url,
        req,
        callOptions(request, 'stock_staff_channel.completeGuidedPicking', key),
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      const after = await loadPicking(ctx, url, req, routeParams.id, request.identity!)
      if (!after || !heldClaim) return missing(ctx, url, req)
      return {
        data: {
          picking: after.data,
          claim: releasedClaim(heldClaim, request.body.reason, request.identity!.userId),
          transition: {
            state: 'done',
            confirmedAt: String(result.completedAt),
            lineCount: (request.body.lines as unknown[]).length,
          },
        },
        headers: { etag: `"${String(after.data.version)}"` },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'warehouse/pickings/{id}/execution',
    operationId: 'staff.warehouse.pickings.execution.get',
    summary: 'Read the canonical execution preview for a warehouse transfer.',
    auth: 'required',
    capability: { key: 'warehouse.pickings', action: 'complete' },
    request: { params: params() },
    responses: { '200': envelope(executionPreviewSchema), '404': envelope({ type: 'null' }) },
    handler: async (ctx, url, req, routeParams) => {
      const row = (await ctx.call('stock.getPickingView', { id: routeParams.id }, url, req)) as Row | null
      if (!row) return missing(ctx, url, req)
      const data = executionPreview(row)
      return { data, headers: { etag: `"${String(data.expectedVersion)}"` } }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'warehouse/pickings/{id}/execution/complete',
    operationId: 'staff.warehouse.pickings.execution.complete',
    summary: 'Complete a claimed transfer with canonical move-line evidence.',
    auth: 'required',
    capability: { key: 'warehouse.pickings', action: 'complete' },
    request: {
      params: params(),
      body: expectedBody(
        { lines: { type: 'array', minItems: 1, maxItems: 200, items: executionLineInput } },
        ['lines'],
      ),
    },
    responses: { ...mutationResponses, '200': envelope(executionResultSchema) },
    idempotent: true,
    rateLimit: { action: 'staff.warehouse.pickings.execution.complete', limit: 60, windowMs: 60_000 },
    handler: async (ctx, url, req, routeParams, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const row = (await ctx.call('stock.getPickingView', { id: routeParams.id }, url, req)) as Row | null
      if (!row) return missing(ctx, url, req)
      const preview = executionPreview(row)
      if (!expected(req, request.body, String(preview.expectedVersion))) return versionConflict(ctx, url, req)
      const result = (await ctx.call(
        'stock_staff_channel.completeExecution',
        { pickingId: routeParams.id, lines: request.body.lines },
        url,
        req,
        callOptions(request, 'stock_staff_channel.completeExecution', key),
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      return {
        data: {
          schemaVersion: 'mobile.warehouse.execution/1',
          status: 'done',
          pickingId: routeParams.id,
          backorderIds: result.backorderIds ?? [],
          lines: result.lines,
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'warehouse/pickings/{id}/return-execution',
    operationId: 'staff.warehouse.pickings.returnExecution.get',
    summary: 'Read the reverse-movement preview for a completed transfer.',
    auth: 'required',
    capability: { key: 'warehouse.pickings', action: 'complete' },
    request: { params: params() },
    responses: { '200': envelope(returnPreviewSchema), '404': envelope({ type: 'null' }) },
    handler: async (ctx, url, req, routeParams) => {
      const row = (await ctx.call('stock.getPickingView', { id: routeParams.id }, url, req)) as Row | null
      if (row?.state !== 'done') return missing(ctx, url, req)
      const data = returnPreview(row)
      return { data, headers: { etag: `"${String(data.expectedVersion)}"` } }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'warehouse/pickings/{id}/return-execution/complete',
    operationId: 'staff.warehouse.pickings.returnExecution.complete',
    summary: 'Complete a claimed reverse warehouse movement.',
    auth: 'required',
    capability: { key: 'warehouse.pickings', action: 'complete' },
    request: {
      params: params(),
      body: expectedBody({ lines: { type: 'array', minItems: 1, maxItems: 200, items: returnInput } }, [
        'lines',
      ]),
    },
    responses: { ...mutationResponses, '200': envelope(returnResultSchema) },
    idempotent: true,
    rateLimit: { action: 'staff.warehouse.pickings.returnExecution.complete', limit: 60, windowMs: 60_000 },
    handler: async (ctx, url, req, routeParams, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const row = (await ctx.call('stock.getPickingView', { id: routeParams.id }, url, req)) as Row | null
      if (row?.state !== 'done') return missing(ctx, url, req)
      const preview = returnPreview(row)
      if (!expected(req, request.body, String(preview.expectedVersion))) return versionConflict(ctx, url, req)
      const namespace = `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:warehouse.return:${routeParams.id}`
      const returnPickingId = commandId('staff_wreturn', namespace, key)
      const result = (await ctx.call(
        'stock_staff_channel.completeReturnExecution',
        { sourcePickingId: routeParams.id, returnPickingId, lines: request.body.lines },
        url,
        req,
        callOptions(request, 'stock_staff_channel.completeReturnExecution', key),
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      return {
        data: {
          schemaVersion: 'mobile.warehouse.return-execution/1',
          status: 'done',
          sourcePickingId: routeParams.id,
          returnPickingId,
          lines: result.lines,
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'warehouse/pickings/{id}/scan-sessions',
    operationId: 'staff.warehouse.scanSessions.start',
    summary: 'Start or replay a scan session for a claimed transfer.',
    auth: 'required',
    capability: { key: 'warehouse.pickings', action: 'scan' },
    request: { params: params(), body: expectedBody() },
    responses: { ...mutationResponses, '200': envelope(scanSessionSchema) },
    idempotent: true,
    rateLimit: { action: 'staff.warehouse.scanSessions.start', limit: 60, windowMs: 60_000 },
    handler: async (ctx, url, req, routeParams, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const held = await loadPicking(ctx, url, req, routeParams.id, request.identity!)
      if (!held) return missing(ctx, url, req)
      if (!expected(req, request.body, String(held.data.version))) return versionConflict(ctx, url, req)
      const namespace = `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:warehouse.scan:${routeParams.id}`
      const id = commandId('staff_wscan', namespace, key)
      const result = (await ctx.call(
        'stock_staff_channel.startScanSession',
        { id, pickingId: routeParams.id },
        url,
        req,
        callOptions(request, 'stock_staff_channel.startScanSession', key),
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      const data = await loadScan(ctx, url, req, id)
      return data
        ? { data, headers: { etag: `"${String(data.version)}"` } }
        : missing(ctx, url, req, 'scanSession')
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'warehouse/scan-sessions/{publicId}',
    operationId: 'staff.warehouse.scanSessions.get',
    summary: 'Read a scan session owned by the verified staff actor.',
    auth: 'required',
    capability: { key: 'warehouse.pickings', action: 'scan' },
    request: { params: params('publicId') },
    responses: { '200': envelope(scanSessionSchema), '404': envelope({ type: 'null' }) },
    handler: async (ctx, url, req, routeParams) => {
      const data = await loadScan(ctx, url, req, routeParams.publicId)
      return data
        ? { data, headers: { etag: `"${String(data.version)}"` } }
        : missing(ctx, url, req, 'scanSession')
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'warehouse/scan-sessions/{publicId}/events',
    operationId: 'staff.warehouse.scanSessions.events.submit',
    summary: 'Submit one private barcode event to an active scan session.',
    auth: 'required',
    capability: { key: 'warehouse.pickings', action: 'scan' },
    request: {
      params: params('publicId'),
      body: expectedBody({ scan: { type: 'string', minLength: 1, maxLength: 65_536, writeOnly: true } }, [
        'scan',
      ]),
    },
    responses: { ...mutationResponses, '200': envelope(scanSessionSchema) },
    idempotent: true,
    rateLimit: { action: 'staff.warehouse.scanSessions.events.submit', limit: 300, windowMs: 60_000 },
    handler: async (ctx, url, req, routeParams, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const before = await loadScan(ctx, url, req, routeParams.publicId)
      if (!before) return missing(ctx, url, req, 'scanSession')
      if (!expected(req, request.body, String(before.version))) return versionConflict(ctx, url, req)
      const context = (await ctx.call(
        'stock_staff_channel.getScanContext',
        { sessionId: routeParams.publicId },
        url,
        req,
      )) as Row
      const result = (await ctx.call(
        'stock_staff_channel.submitScanEvent',
        {
          sessionId: routeParams.publicId,
          expectedVersion: Number((context.session as Row).version),
          scan: request.body.scan,
          idempotencyKey: key,
        },
        url,
        req,
        callOptions(request, 'stock_staff_channel.submitScanEvent', key),
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      const data = await loadScan(ctx, url, req, routeParams.publicId)
      return data
        ? { data, headers: { etag: `"${String(data.version)}"` } }
        : missing(ctx, url, req, 'scanSession')
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'warehouse/scan-sessions/{publicId}/transitions',
    operationId: 'staff.warehouse.scanSessions.transition',
    summary: 'Pause, resume, or cancel a scan session.',
    auth: 'required',
    capability: { key: 'warehouse.pickings', action: 'scan' },
    request: {
      params: params('publicId'),
      body: expectedBody({ targetState: { type: 'string', enum: ['active', 'paused', 'cancelled'] } }, [
        'targetState',
      ]),
    },
    responses: { ...mutationResponses, '200': envelope(scanSessionSchema) },
    idempotent: true,
    rateLimit: { action: 'staff.warehouse.scanSessions.transition', limit: 120, windowMs: 60_000 },
    handler: async (ctx, url, req, routeParams, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const before = await loadScan(ctx, url, req, routeParams.publicId)
      if (!before) return missing(ctx, url, req, 'scanSession')
      if (!expected(req, request.body, String(before.version))) return versionConflict(ctx, url, req)
      const context = (await ctx.call(
        'stock_staff_channel.getScanContext',
        { sessionId: routeParams.publicId },
        url,
        req,
      )) as Row
      const result = (await ctx.call(
        'stock_staff_channel.transitionScanSession',
        {
          sessionId: routeParams.publicId,
          expectedVersion: Number((context.session as Row).version),
          targetState: request.body.targetState,
        },
        url,
        req,
        callOptions(request, 'stock_staff_channel.transitionScanSession', key),
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      const data = await loadScan(ctx, url, req, routeParams.publicId)
      return data
        ? { data, headers: { etag: `"${String(data.version)}"` } }
        : missing(ctx, url, req, 'scanSession')
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'warehouse/count-sessions',
    operationId: 'staff.warehouse.countSessions.list',
    summary: 'List inventory count sessions visible in the signed-in company.',
    auth: 'required',
    capability: { key: 'warehouse.counts', action: 'read' },
    request: {
      query: {
        type: 'object',
        properties: { cursor: string, limit: { type: 'integer', minimum: 1, maximum: 100 } },
      },
    },
    responses: {
      '200': envelope({
        type: 'object',
        properties: { items: { type: 'array', items: countSessionSchema }, nextCursor: nullableString },
        required: ['items', 'nextCursor'],
      }),
    },
    handler: async (ctx, url, req) => {
      const limit = Math.max(1, Math.min(100, Number(url.searchParams.get('limit')) || 20))
      const offset = Math.max(0, Number(url.searchParams.get('cursor')) || 0)
      const rows = (await ctx.call(
        'stock_staff_channel.listCountSessions',
        { limit: limit + 1, offset },
        url,
        req,
      )) as Row[]
      const items: Row[] = []
      for (const row of rows.slice(0, limit)) {
        const held = await loadCount(ctx, url, req, { sessionId: String(row.id) })
        if (held) items.push(held.data)
      }
      return { data: { items, nextCursor: rows.length > limit ? String(offset + limit) : null } }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'warehouse/count-sessions/{publicId}',
    operationId: 'staff.warehouse.countSessions.get',
    summary: 'Read one inventory count session and the actor own attempt.',
    auth: 'required',
    capability: { key: 'warehouse.counts', action: 'read' },
    request: { params: params('publicId') },
    responses: { '200': envelope(countSessionSchema), '404': envelope({ type: 'null' }) },
    handler: async (ctx, url, req, routeParams) => {
      const held = await loadCount(ctx, url, req, { sessionId: routeParams.publicId })
      return held
        ? { data: held.data, headers: { etag: `"${countEtag(held.data)}"` } }
        : missing(ctx, url, req, 'countSession')
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'warehouse/count-sessions/{publicId}/claim',
    operationId: 'staff.warehouse.countSessions.claim',
    summary: 'Claim an inventory count session and snapshot its positions.',
    auth: 'required',
    capability: { key: 'warehouse.counts', action: 'claim' },
    request: { params: params('publicId'), body: expectedBody() },
    responses: { ...mutationResponses, '200': envelope(countCommandSchema) },
    idempotent: true,
    rateLimit: { action: 'staff.warehouse.countSessions.claim', limit: 60, windowMs: 60_000 },
    handler: async (ctx, url, req, routeParams, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const before = await loadCount(ctx, url, req, { sessionId: routeParams.publicId })
      if (!before) return missing(ctx, url, req, 'countSession')
      if (!expected(req, request.body, String(before.data.version))) return versionConflict(ctx, url, req)
      const version = Number((before.context.session as Row).version)
      const attemptId = commandId(
        'staff_wcount_attempt',
        `${request.identity!.userId}:${routeParams.publicId}`,
        key,
      )
      const result = (await ctx.call(
        'stock_staff_channel.claimCountSession',
        { sessionId: routeParams.publicId, expectedVersion: version, attemptId },
        url,
        req,
        callOptions(request, 'stock_staff_channel.claimCountSession', key),
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      const after = await loadCount(ctx, url, req, { sessionId: routeParams.publicId })
      if (!after) return missing(ctx, url, req, 'countSession')
      const data = countCommand(after.context, after.data, 'vidoo.inventory.count.claim/1')
      return { data, headers: { etag: `"${countEtag(after.data)}"` } }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'warehouse/count-attempts/{publicId}/resume',
    operationId: 'staff.warehouse.countAttempts.resume',
    summary: 'Renew the verified actor lease on an inventory count attempt.',
    auth: 'required',
    capability: { key: 'warehouse.counts', action: 'count' },
    request: { params: params('publicId'), body: expectedBody() },
    responses: { ...mutationResponses, '200': envelope(countCommandSchema) },
    idempotent: true,
    rateLimit: { action: 'staff.warehouse.countAttempts.resume', limit: 120, windowMs: 60_000 },
    handler: async (ctx, url, req, routeParams, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const before = await loadCount(ctx, url, req, { attemptId: routeParams.publicId })
      if (!before?.context.attempt) return missing(ctx, url, req, 'countAttempt')
      const attempt = before.context.attempt as Row
      if (!expected(req, request.body, String(((before.data.attempt ?? {}) as Row).version)))
        return versionConflict(ctx, url, req)
      const version = Number(attempt.version)
      const result = (await ctx.call(
        'stock_staff_channel.resumeCountAttempt',
        { attemptId: routeParams.publicId, expectedVersion: version },
        url,
        req,
        callOptions(request, 'stock_staff_channel.resumeCountAttempt', key),
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      const after = await loadCount(ctx, url, req, { attemptId: routeParams.publicId })
      if (!after) return missing(ctx, url, req, 'countAttempt')
      const data = countCommand(after.context, after.data, 'vidoo.inventory.count.resume/1')
      return { data, headers: { etag: `"${countEtag(after.data)}"` } }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'warehouse/count-lines/{publicId}/entries',
    operationId: 'staff.warehouse.countLines.entries.record',
    summary: 'Record one canonical non-negative quantity on an owned count line.',
    auth: 'required',
    capability: { key: 'warehouse.counts', action: 'count' },
    request: { params: params('publicId'), body: expectedBody({ quantity: decimal }, ['quantity']) },
    responses: { ...mutationResponses, '200': envelope(countCommandSchema) },
    idempotent: true,
    rateLimit: { action: 'staff.warehouse.countLines.entries.record', limit: 300, windowMs: 60_000 },
    handler: async (ctx, url, req, routeParams, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const before = await loadCount(ctx, url, req, { lineId: routeParams.publicId })
      const line = before?.context.line as Row | null
      if (!before || !line) return missing(ctx, url, req, 'countLine')
      const lineToken = (((before.data.attempt ?? {}) as Row).lines as Row[] | undefined)?.find(
        (held) => String(held.publicId) === routeParams.publicId,
      )?.version
      if (!expected(req, request.body, String(lineToken))) return versionConflict(ctx, url, req)
      const version = Number(line.version)
      const result = (await ctx.call(
        'stock_staff_channel.recordCountLine',
        { lineId: routeParams.publicId, expectedVersion: version, quantity: request.body.quantity },
        url,
        req,
        callOptions(request, 'stock_staff_channel.recordCountLine', key),
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      const after = await loadCount(ctx, url, req, { lineId: routeParams.publicId })
      const afterLine = after?.context.line as Row | null
      if (!after || !afterLine) return missing(ctx, url, req, 'countLine')
      const data = countCommand(
        after.context,
        after.data,
        'vidoo.inventory.count.entry/1',
        routeParams.publicId,
      )
      return { data, headers: { etag: `"${countEtag(after.data)}"` } }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'warehouse/count-attempts/{publicId}/submit',
    operationId: 'staff.warehouse.countAttempts.submit',
    summary: 'Submit a fully counted attempt for review.',
    auth: 'required',
    capability: { key: 'warehouse.counts', action: 'submit' },
    request: { params: params('publicId'), body: expectedBody() },
    responses: { ...mutationResponses, '200': envelope(countCommandSchema) },
    idempotent: true,
    rateLimit: { action: 'staff.warehouse.countAttempts.submit', limit: 60, windowMs: 60_000 },
    handler: async (ctx, url, req, routeParams, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const before = await loadCount(ctx, url, req, { attemptId: routeParams.publicId })
      const attempt = before?.context.attempt as Row | null
      if (!before || !attempt) return missing(ctx, url, req, 'countAttempt')
      if (!expected(req, request.body, String(((before.data.attempt ?? {}) as Row).version)))
        return versionConflict(ctx, url, req)
      const version = Number(attempt.version)
      const result = (await ctx.call(
        'stock_staff_channel.submitCountAttempt',
        { attemptId: routeParams.publicId, expectedVersion: version },
        url,
        req,
        callOptions(request, 'stock_staff_channel.submitCountAttempt', key),
      )) as Row
      if (result.ok !== true) return domainFailure(ctx, url, req, result)
      const after = await loadCount(ctx, url, req, { attemptId: routeParams.publicId })
      if (!after) return missing(ctx, url, req, 'countAttempt')
      const data = countCommand(after.context, after.data, 'vidoo.inventory.count.submit/1')
      return { data, headers: { etag: `"${countEtag(after.data)}"` } }
    },
  }),
)
