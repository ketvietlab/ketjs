import type { Route, ServeContext } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import {
  channelCommandId,
  channelError,
  defineChannelRoute,
  routesOf,
  type PosIdentity,
} from '../channel_api/core.ts'

type Req = Parameters<Route>[1]

const string = { type: 'string' }
const integer = { type: 'integer', minimum: 0 }
const nullableString = { type: ['string', 'null'] }
const object = { type: 'object' }
const n = (value: unknown) => Number(value ?? 0)
const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })
const envelope = (data: unknown) => ({
  type: 'object',
  properties: { data, error: {}, meta: { type: 'object' } },
})
const idParams = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string },
  required: ['id'],
}
const lineParams = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, lineId: string },
  required: ['id', 'lineId'],
}
const tenderParams = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, tenderId: string },
  required: ['id', 'tenderId'],
}
const movementParams = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, movementId: string },
  required: ['id', 'movementId'],
}
const expectedBody = {
  type: 'object',
  additionalProperties: false,
  properties: { expectedRevision: integer },
  required: ['expectedRevision'],
}
const orderLine = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    productId: string,
    uomId: string,
    name: string,
    quantity: string,
    unitPrice: string,
    discount: string,
    taxIds: { type: 'array', items: string },
    amountUntaxed: string,
    amountTotal: string,
    sequence: integer,
    quoteRevision: nullableString,
  },
  required: [
    'id',
    'productId',
    'uomId',
    'name',
    'quantity',
    'unitPrice',
    'discount',
    'taxIds',
    'amountUntaxed',
    'amountTotal',
    'sequence',
    'quoteRevision',
  ],
}
const tender = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    paymentMethodId: string,
    state: string,
    kind: string,
    tenderedAmount: string,
    appliedAmount: string,
    change: string,
    reference: nullableString,
    paymentDate: string,
  },
  required: [
    'id',
    'paymentMethodId',
    'state',
    'kind',
    'tenderedAmount',
    'appliedAmount',
    'change',
    'reference',
    'paymentDate',
  ],
}
const order = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    name: string,
    uuid: string,
    reference: string,
    state: string,
    shiftId: string,
    customerId: nullableString,
    note: nullableString,
    currency: string,
    amountUntaxed: string,
    amountTax: string,
    amountExact: string,
    amountRounding: string,
    amountTotal: string,
    amountPaid: string,
    amountReturn: string,
    priceBookRevision: nullableString,
    revision: integer,
    lines: { type: 'array', items: orderLine },
    tenders: { type: 'array', items: tender },
    allowedActions: { type: 'array', items: string },
  },
  required: [
    'id',
    'name',
    'uuid',
    'reference',
    'state',
    'shiftId',
    'customerId',
    'note',
    'currency',
    'amountUntaxed',
    'amountTax',
    'amountExact',
    'amountRounding',
    'amountTotal',
    'amountPaid',
    'amountReturn',
    'priceBookRevision',
    'revision',
    'lines',
    'tenders',
    'allowedActions',
  ],
}
const shift = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    name: string,
    state: string,
    operatorId: string,
    deviceId: nullableString,
    openedAt: nullableString,
    closedAt: nullableString,
    openingCash: string,
    expectedCash: string,
    countedCash: string,
    difference: string,
    cashMovementTotal: string,
    varianceStatus: string,
    varianceReason: nullableString,
    varianceNote: nullableString,
    varianceApprovedBy: nullableString,
    cashAdjustmentId: nullableString,
    revision: integer,
    orderCount: integer,
  },
  required: [
    'id',
    'name',
    'state',
    'operatorId',
    'deviceId',
    'openedAt',
    'closedAt',
    'openingCash',
    'expectedCash',
    'countedCash',
    'difference',
    'cashMovementTotal',
    'varianceStatus',
    'varianceReason',
    'varianceNote',
    'varianceApprovedBy',
    'cashAdjustmentId',
    'revision',
    'orderCount',
  ],
}

const failure = (ctx: ServeContext, url: URL, req: Req, result: unknown) => {
  const issues = Array.isArray((result as { errors?: unknown })?.errors)
    ? ((result as { errors: Row[] }).errors ?? [])
    : []
  const conflict = issues.some((issue) =>
    ['expectedRevision', 'state', 'quoteRevision', 'priceBookRevision'].includes(String(issue.field)),
  )
  return {
    status: conflict ? 409 : 422,
    error: channelError(ctx, url, req, conflict ? 'pos.commandConflict' : 'pos.commandInvalid', {
      messageKey: conflict ? 'pos_channel.error.commandConflict' : 'pos_channel.error.commandInvalid',
      fieldErrors: Object.fromEntries(
        issues.map((issue) => [
          String(issue.field ?? 'command'),
          {
            code: 'pos.invalidField',
            messageKey: 'pos_channel.error.invalidField',
            params: {},
          },
        ]),
      ),
      retryable: conflict,
    }),
  }
}

const notFound = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'pos.notFound', {
    messageKey: 'pos_channel.error.notFound',
  }),
})

const keyOf = (ctx: ServeContext, url: URL, req: Req) => {
  const key = String(req.headers['idempotency-key'] ?? '').trim()
  if (key.length >= 8 && key.length <= 200) return key
  return {
    status: 400,
    error: channelError(ctx, url, req, 'channel_api.idempotencyRequired', {
      messageKey: 'channel_api.error.idempotencyRequired',
    }),
  }
}

const projectOrder = (row: Row) => ({
  id: String(row.id),
  name: String(row.name),
  uuid: String(row.uuid),
  reference: String(row.posReference),
  state: String(row.state),
  shiftId: String(row.sessionId),
  customerId: row.partnerId == null ? null : String(row.partnerId),
  note: row.note == null ? null : String(row.note),
  currency: String(row.currency),
  amountUntaxed: String(row.amountUntaxed),
  amountTax: String(row.amountTax),
  amountExact: String(row.amountExact ?? row.amountTotal),
  amountRounding: String(row.amountRounding ?? 0),
  amountTotal: String(row.amountTotal),
  amountPaid: String(row.amountPaid),
  amountReturn: String(row.amountReturn),
  priceBookRevision: row.priceBookRevision == null ? null : String(row.priceBookRevision),
  revision: Number(row.revision ?? 0),
  lines: (Array.isArray(row.lines) ? (row.lines as Row[]) : [])
    .map((line) => ({
      id: String(line.id),
      productId: String(line.productId),
      uomId: String(line.productUomId),
      name: String(line.name),
      quantity: String(line.qty),
      unitPrice: String(line.priceUnit),
      discount: String(line.discount),
      taxIds: Array.isArray(line.taxIds) ? line.taxIds.map(String) : line.taxId ? [String(line.taxId)] : [],
      amountUntaxed: String(line.priceSubtotal),
      amountTotal: String(line.priceSubtotalIncl),
      sequence: Number(line.sequence),
      quoteRevision: line.quoteRevision == null ? null : String(line.quoteRevision),
    }))
    .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id)),
  tenders: (Array.isArray(row.payments) ? (row.payments as Row[]) : []).map((payment) => ({
    id: String(payment.id),
    paymentMethodId: String(payment.paymentMethodId),
    state: String(payment.state ?? 'captured'),
    kind: String(payment.kind ?? 'manual'),
    tenderedAmount: String(payment.tenderedAmount ?? payment.amount),
    appliedAmount: String(payment.appliedAmount ?? payment.amount),
    change: String(n(payment.tenderedAmount ?? payment.amount) - n(payment.appliedAmount ?? payment.amount)),
    reference: payment.reference == null ? null : String(payment.reference),
    paymentDate: String(payment.paymentDate),
  })),
  allowedActions:
    row.state === 'draft'
      ? [
          'update',
          'add_line',
          'update_line',
          'remove_line',
          'reorder_lines',
          'add_tender',
          'void_tender',
          'finalize',
          'cancel',
        ]
      : [],
})

const orderFor = async (ctx: ServeContext, url: URL, req: Req, id: string, identity: PosIdentity) => {
  const row = (await ctx.call('pos.getOrder', { id }, url, req)) as Row | null
  if (!row || String(row.configId) !== String(identity.posConfigId)) return null
  if (row.state === 'draft' && row.deviceId && String(row.deviceId) !== String(identity.deviceId)) return null
  return row
}

const orderResult = async (ctx: ServeContext, url: URL, req: Req, id: string, identity: PosIdentity) => {
  const row = await orderFor(ctx, url, req, id, identity)
  if (!row) return notFound(ctx, url, req)
  const data = projectOrder(row)
  return { data, headers: { etag: `"pos-order-${data.revision}"` } }
}

const projectShift = (row: Row) => ({
  id: String(row.id),
  name: String(row.name),
  state: String(row.state),
  operatorId: String(row.userId),
  deviceId: row.deviceId == null ? null : String(row.deviceId),
  openedAt: row.startAt == null ? null : String(row.startAt),
  closedAt: row.stopAt == null ? null : String(row.stopAt),
  openingCash: String(row.cashRegisterBalanceStart),
  expectedCash: String(row.cashRegisterBalanceEnd),
  countedCash: String(row.cashRegisterBalanceEndReal),
  difference: String(row.cashRegisterDifference),
  cashMovementTotal: String(
    (Array.isArray(row.cashMovements) ? (row.cashMovements as Row[]) : []).reduce(
      (sum, movement) => sum + (movement.direction === 'in' ? n(movement.amount) : -n(movement.amount)),
      0,
    ),
  ),
  varianceStatus: String(row.varianceStatus ?? 'none'),
  varianceReason: row.varianceReason == null ? null : String(row.varianceReason),
  varianceNote: row.varianceNote == null ? null : String(row.varianceNote),
  varianceApprovedBy: row.varianceApprovedBy == null ? null : String(row.varianceApprovedBy),
  cashAdjustmentId: row.cashAdjustmentId == null ? null : String(row.cashAdjustmentId),
  revision: Number(row.revision ?? 0),
  orderCount: Array.isArray(row.orders) ? row.orders.length : 0,
})

const shiftFor = async (ctx: ServeContext, url: URL, req: Req, id: string, identity: PosIdentity) => {
  const row = (await ctx.call('pos.getSession', { id }, url, req)) as Row | null
  if (!row || String(row.configId) !== String(identity.posConfigId)) return null
  if (row.deviceId && String(row.deviceId) !== String(identity.deviceId)) return null
  return row
}

const managerShiftFor = async (ctx: ServeContext, url: URL, req: Req, id: string, identity: PosIdentity) => {
  const row = (await ctx.call('pos.getSession', { id }, url, req)) as Row | null
  return row && String(row.configId) === String(identity.posConfigId) ? row : null
}

const shiftResult = async (ctx: ServeContext, url: URL, req: Req, id: string, identity: PosIdentity) => {
  const row = await shiftFor(ctx, url, req, id, identity)
  if (!row) return notFound(ctx, url, req)
  const data = projectShift(row)
  return { data, headers: { etag: `"pos-shift-${data.revision}"` } }
}

const commandOptions = (identity: PosIdentity, action: string, key: string) => ({
  idempotencyKey: key,
  idempotencyNamespace: `pos:${identity.companyId}:${identity.posConfigId}:${identity.deviceId}:${action}`,
})

const lifecycleFunction = async (ctx: ServeContext, req: Req, preferred: string, fallback: string) =>
  (await ctx.live(req)).functions[preferred] ? preferred : fallback

export const operationRoutes = routesOf(
  defineChannelRoute({
    profile: 'pos',
    method: 'POST',
    path: 'shifts',
    operationId: 'pos.shifts.create',
    summary: 'Create one opening-control shift in the live device configuration.',
    auth: 'required',
    request: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { openingCash: string, openingNotes: string },
        required: ['openingCash'],
      },
    },
    responses: {
      '200': envelope(shift),
      '400': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: async (ctx, url, req, _params, request) => {
      const key = keyOf(ctx, url, req)
      if (typeof key !== 'string') return key
      const identity = request.identity!
      const id = channelCommandId('shift', identity, key)
      const result = (await ctx.call(
        'pos.createSession',
        {
          id,
          configId: identity.posConfigId,
          userId: identity.operatorId,
          deviceId: identity.deviceId,
          openingCash: request.body.openingCash,
          openingNotes: request.body.openingNotes,
        },
        url,
        req,
        commandOptions(identity, 'shift.create', key),
      )) as Row
      if (result.ok !== true) return failure(ctx, url, req, result)
      return shiftResult(ctx, url, req, id, identity)
    },
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'GET',
    path: 'shifts/current',
    operationId: 'pos.shifts.current',
    summary: 'Read the active shift for the live device configuration, or null when none is open.',
    auth: 'required',
    responses: { '200': envelope({ anyOf: [shift, { type: 'null' }] }) },
    handler: async (ctx, url, req, _params, request) => {
      const identity = request.identity!
      const sessions = (await ctx.call('pos.listSessions', {}, url, req)) as Row[]
      const active = sessions
        .filter(
          (row) =>
            String(row.configId) === String(identity.posConfigId) &&
            (!row.deviceId || String(row.deviceId) === String(identity.deviceId)) &&
            ['opening_control', 'opened', 'closing_control'].includes(String(row.state)),
        )
        .sort((left, right) => String(right.startAt ?? '').localeCompare(String(left.startAt ?? '')))[0]
      if (!active) return { data: null }
      const row = (await ctx.call('pos.getSession', { id: active.id }, url, req)) as Row
      return { data: projectShift(row), headers: { etag: `"pos-shift-${Number(row.revision ?? 0)}"` } }
    },
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'GET',
    path: 'shifts/{id}',
    operationId: 'pos.shifts.get',
    summary: 'Read one canonical revisioned shift.',
    auth: 'required',
    request: { params: idParams },
    responses: { '200': envelope(shift), '404': envelope(object) },
    handler: (ctx, url, req, params, request) => shiftResult(ctx, url, req, params.id, request.identity!),
  }),
  ...(['open', 'start-closing'] as const).map((action) =>
    defineChannelRoute({
      profile: 'pos',
      method: 'POST',
      path: `shifts/{id}/${action}`,
      operationId: `pos.shifts.${action === 'open' ? 'open' : 'startClosing'}`,
      summary:
        action === 'open' ? 'Open an opening-control shift.' : 'Move an open shift to closing control.',
      auth: 'required',
      request: { params: idParams, body: expectedBody },
      responses: {
        '200': envelope(shift),
        '404': envelope(object),
        '409': envelope(object),
        '422': envelope(object),
      },
      idempotent: true,
      handler: async (ctx, url, req, params, request) => {
        const key = keyOf(ctx, url, req)
        if (typeof key !== 'string') return key
        const identity = request.identity!
        if (!(await shiftFor(ctx, url, req, params.id, identity))) return notFound(ctx, url, req)
        const result = (await ctx.call(
          action === 'open' ? 'pos.openSession' : 'pos.startClosing',
          { id: params.id, expectedRevision: request.body.expectedRevision },
          url,
          req,
          commandOptions(identity, `shift.${action}`, key),
        )) as Row
        if (result.ok !== true) return failure(ctx, url, req, result)
        return shiftResult(ctx, url, req, params.id, identity)
      },
    }),
  ),
  defineChannelRoute({
    profile: 'pos',
    method: 'POST',
    path: 'shifts/{id}/cash-movements',
    operationId: 'pos.shifts.cashMovements.create',
    summary: 'Record an immutable cash-in or cash-out movement in an open shift.',
    auth: 'required',
    capability: { key: 'pos.shifts', action: 'cash_movement' },
    request: {
      params: idParams,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          expectedRevision: integer,
          direction: string,
          amount: string,
          reason: string,
          note: string,
        },
        required: ['expectedRevision', 'direction', 'amount', 'reason'],
      },
    },
    responses: {
      '200': envelope(shift),
      '404': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = keyOf(ctx, url, req)
      if (typeof key !== 'string') return key
      const identity = request.identity!
      if (!(await shiftFor(ctx, url, req, params.id, identity))) return notFound(ctx, url, req)
      const result = (await ctx.call(
        'pos.recordCashMovement',
        {
          id: channelCommandId('cash-movement', identity, `${params.id}\n${key}`),
          sessionId: params.id,
          expectedRevision: request.body.expectedRevision,
          direction: request.body.direction,
          amount: request.body.amount,
          reason: request.body.reason,
          note: request.body.note,
          actorId: identity.operatorId,
          deviceId: identity.deviceId,
        },
        url,
        req,
        commandOptions(identity, 'shift.cash-movement.create', key),
      )) as Row
      if (result.ok !== true) return failure(ctx, url, req, result)
      return shiftResult(ctx, url, req, params.id, identity)
    },
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'POST',
    path: 'shifts/{id}/cash-movements/{movementId}/reverse',
    operationId: 'pos.shifts.cashMovements.reverse',
    summary: 'Correct a cash movement by appending one linked opposite movement.',
    auth: 'required',
    capability: { key: 'pos.shifts', action: 'cash_movement' },
    request: {
      params: movementParams,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { expectedRevision: integer, reason: string, note: string },
        required: ['expectedRevision', 'reason'],
      },
    },
    responses: {
      '200': envelope(shift),
      '404': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = keyOf(ctx, url, req)
      if (typeof key !== 'string') return key
      const identity = request.identity!
      if (!(await shiftFor(ctx, url, req, params.id, identity))) return notFound(ctx, url, req)
      const result = (await ctx.call(
        'pos.reverseCashMovement',
        {
          id: channelCommandId('cash-movement-reversal', identity, `${params.id}\n${key}`),
          sessionId: params.id,
          movementId: params.movementId,
          expectedRevision: request.body.expectedRevision,
          reason: request.body.reason,
          note: request.body.note,
          actorId: identity.operatorId,
          deviceId: identity.deviceId,
        },
        url,
        req,
        commandOptions(identity, 'shift.cash-movement.reverse', key),
      )) as Row
      if (result.ok !== true) return failure(ctx, url, req, result)
      return shiftResult(ctx, url, req, params.id, identity)
    },
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'POST',
    path: 'shifts/{id}/close',
    operationId: 'pos.shifts.close',
    summary: 'Close a balanced shift or seal a variance for manager review.',
    auth: 'required',
    request: {
      params: idParams,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          expectedRevision: integer,
          countedCash: string,
          closingNotes: string,
          varianceReason: string,
          varianceNote: string,
        },
        required: ['expectedRevision', 'countedCash'],
      },
    },
    responses: {
      '200': envelope(shift),
      '404': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = keyOf(ctx, url, req)
      if (typeof key !== 'string') return key
      const identity = request.identity!
      if (!(await shiftFor(ctx, url, req, params.id, identity))) return notFound(ctx, url, req)
      const result = (await ctx.call(
        'pos.closeSession',
        {
          id: params.id,
          expectedRevision: request.body.expectedRevision,
          closingCash: request.body.countedCash,
          closingNotes: request.body.closingNotes,
          varianceReason: request.body.varianceReason,
          varianceNote: request.body.varianceNote,
        },
        url,
        req,
        commandOptions(identity, 'shift.close', key),
      )) as Row
      if (result.ok !== true) return failure(ctx, url, req, result)
      return shiftResult(ctx, url, req, params.id, identity)
    },
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'POST',
    path: 'shifts/{id}/variance/recount',
    operationId: 'pos.shifts.variance.recount',
    summary: 'Record a manager recount and close the shift when the corrected count is within tolerance.',
    auth: 'required',
    capability: { key: 'pos.shifts', action: 'approve_variance' },
    request: {
      params: idParams,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { expectedRevision: integer, countedCash: string, note: string },
        required: ['expectedRevision', 'countedCash'],
      },
    },
    responses: {
      '200': envelope(shift),
      '404': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = keyOf(ctx, url, req)
      if (typeof key !== 'string') return key
      const identity = request.identity!
      if (!(await managerShiftFor(ctx, url, req, params.id, identity))) return notFound(ctx, url, req)
      const result = (await ctx.call(
        'pos.recountSession',
        {
          id: params.id,
          expectedRevision: request.body.expectedRevision,
          countedCash: request.body.countedCash,
          reviewedBy: identity.operatorId,
          note: request.body.note,
        },
        url,
        req,
        commandOptions(identity, 'shift.variance.recount', key),
      )) as Row
      if (result.ok !== true) return failure(ctx, url, req, result)
      const row = (await ctx.call('pos.getSession', { id: params.id }, url, req)) as Row
      return { data: projectShift(row), headers: { etag: `"pos-shift-${Number(row.revision ?? 0)}"` } }
    },
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'POST',
    path: 'shifts/{id}/variance/approve',
    operationId: 'pos.shifts.variance.approve',
    summary: 'Approve a sealed real variance and post a separate cash over/short adjustment.',
    auth: 'required',
    capability: { key: 'pos.shifts', action: 'approve_variance' },
    request: {
      params: idParams,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { expectedRevision: integer, note: string },
        required: ['expectedRevision'],
      },
    },
    responses: {
      '200': envelope(shift),
      '404': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = keyOf(ctx, url, req)
      if (typeof key !== 'string') return key
      const identity = request.identity!
      if (!(await managerShiftFor(ctx, url, req, params.id, identity))) return notFound(ctx, url, req)
      const result = (await ctx.call(
        'pos.approveSessionVariance',
        {
          id: params.id,
          expectedRevision: request.body.expectedRevision,
          approvedBy: identity.operatorId,
          note: request.body.note,
        },
        url,
        req,
        commandOptions(identity, 'shift.variance.approve', key),
      )) as Row
      if (result.ok !== true) return failure(ctx, url, req, result)
      const row = (await ctx.call('pos.getSession', { id: params.id }, url, req)) as Row
      return { data: projectShift(row), headers: { etag: `"pos-shift-${Number(row.revision ?? 0)}"` } }
    },
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'POST',
    path: 'orders',
    operationId: 'pos.orders.create',
    summary: 'Create or replay one empty revisioned POS draft owned by this device.',
    auth: 'required',
    request: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          uuid: string,
          shiftId: string,
          customerId: string,
          note: string,
          priceBookRevision: string,
        },
        required: ['uuid', 'shiftId', 'priceBookRevision'],
      },
    },
    responses: {
      '200': envelope(order),
      '400': envelope(object),
      '404': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: async (ctx, url, req, _params, request) => {
      const key = keyOf(ctx, url, req)
      if (typeof key !== 'string') return key
      const identity = request.identity!
      if (!(await shiftFor(ctx, url, req, String(request.body.shiftId), identity)))
        return notFound(ctx, url, req)
      const id = channelCommandId('order', identity, String(request.body.uuid))
      const result = (await ctx.call(
        'pos.createOrder',
        {
          id,
          uuid: request.body.uuid,
          sessionId: request.body.shiftId,
          partnerId: request.body.customerId,
          note: request.body.note,
          operatorId: identity.operatorId,
          deviceId: identity.deviceId,
          priceBookRevision: request.body.priceBookRevision,
        },
        url,
        req,
        commandOptions(identity, 'order.create', key),
      )) as Row
      if (result.ok !== true) return failure(ctx, url, req, result)
      return orderResult(ctx, url, req, String(result.id), identity)
    },
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'GET',
    path: 'orders/{id}/detail',
    operationId: 'pos.orders.get',
    summary: 'Read one canonical revisioned POS order.',
    auth: 'required',
    request: { params: idParams },
    responses: { '200': envelope(order), '404': envelope(object) },
    handler: (ctx, url, req, params, request) => orderResult(ctx, url, req, params.id, request.identity!),
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'PATCH',
    path: 'orders/{id}/update',
    operationId: 'pos.orders.update',
    summary: 'Update customer or note under the order revision.',
    auth: 'required',
    request: {
      params: idParams,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { expectedRevision: integer, customerId: nullableString, note: string },
        required: ['expectedRevision'],
      },
    },
    responses: {
      '200': envelope(order),
      '404': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = keyOf(ctx, url, req)
      if (typeof key !== 'string') return key
      const identity = request.identity!
      if (!(await orderFor(ctx, url, req, params.id, identity))) return notFound(ctx, url, req)
      const result = (await ctx.call(
        'pos.updateOrder',
        {
          id: params.id,
          expectedRevision: request.body.expectedRevision,
          partnerId: request.body.customerId ?? undefined,
          clearPartner: request.body.customerId === null,
          note: request.body.note,
        },
        url,
        req,
        commandOptions(identity, 'order.update', key),
      )) as Row
      if (result.ok !== true) return failure(ctx, url, req, result)
      return orderResult(ctx, url, req, params.id, identity)
    },
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'POST',
    path: 'orders/{id}/lines',
    operationId: 'pos.orders.lines.add',
    summary: 'Add one canonically quoted line under the order revision.',
    auth: 'required',
    request: {
      params: idParams,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          expectedRevision: integer,
          productId: string,
          uomId: string,
          quantity: string,
          quoteRevision: string,
        },
        required: ['expectedRevision', 'productId', 'uomId', 'quantity', 'quoteRevision'],
      },
    },
    responses: {
      '200': envelope(order),
      '404': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = keyOf(ctx, url, req)
      if (typeof key !== 'string') return key
      const identity = request.identity!
      const held = await orderFor(ctx, url, req, params.id, identity)
      if (!held) return notFound(ctx, url, req)
      const current = (await ctx.call(
        'pos_channel.priceBook',
        { posConfigId: identity.posConfigId, limit: 1 },
        url,
        req,
      )) as Row
      if (
        String(held.priceBookRevision ?? '') !== String(request.body.quoteRevision) ||
        String(current.revision ?? '') !== String(request.body.quoteRevision)
      )
        return failure(ctx, url, req, invalid('quoteRevision', 'the price book changed; reload it'))
      const result = (await ctx.call(
        'pos.addLine',
        {
          id: channelCommandId('line', identity, `${params.id}\n${key}`),
          orderId: params.id,
          productId: request.body.productId,
          productUomId: request.body.uomId,
          qty: request.body.quantity,
          quoteRevision: request.body.quoteRevision,
          expectedRevision: request.body.expectedRevision,
        },
        url,
        req,
        commandOptions(identity, 'order.line.add', key),
      )) as Row
      if (result.ok !== true) return failure(ctx, url, req, result)
      return orderResult(ctx, url, req, params.id, identity)
    },
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'PATCH',
    path: 'orders/{id}/lines/{lineId}/update',
    operationId: 'pos.orders.lines.update',
    summary: 'Requote and update one member line under the order revision.',
    auth: 'required',
    request: {
      params: lineParams,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          expectedRevision: integer,
          quantity: string,
          quoteRevision: string,
          sequence: integer,
        },
        required: ['expectedRevision', 'quantity'],
      },
    },
    responses: {
      '200': envelope(order),
      '404': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = keyOf(ctx, url, req)
      if (typeof key !== 'string') return key
      const identity = request.identity!
      if (!(await orderFor(ctx, url, req, params.id, identity))) return notFound(ctx, url, req)
      const result = (await ctx.call(
        'pos.updateLine',
        {
          id: params.lineId,
          orderId: params.id,
          expectedRevision: request.body.expectedRevision,
          qty: request.body.quantity,
          quoteRevision: request.body.quoteRevision,
          sequence: request.body.sequence,
        },
        url,
        req,
        commandOptions(identity, 'order.line.update', key),
      )) as Row
      if (result.ok !== true) return failure(ctx, url, req, result)
      return orderResult(ctx, url, req, params.id, identity)
    },
  }),
  ...(['discount', 'price-override'] as const).map((action) =>
    defineChannelRoute({
      profile: 'pos',
      method: 'POST',
      path: `orders/{id}/lines/{lineId}/${action}`,
      operationId: `pos.orders.lines.${action === 'discount' ? 'discount' : 'priceOverride'}`,
      summary:
        action === 'discount'
          ? 'Apply a staff-authorized line discount.'
          : 'Apply a manager-authorized manual unit price with an audit reason.',
      auth: 'required',
      capability: {
        key: 'pos.orders',
        action: action === 'discount' ? 'discount' : 'override_price',
      },
      request: {
        params: lineParams,
        body: {
          type: 'object',
          additionalProperties: false,
          properties: {
            expectedRevision: integer,
            ...(action === 'discount' ? { discount: string } : { unitPrice: string, reason: string }),
          },
          required:
            action === 'discount'
              ? ['expectedRevision', 'discount']
              : ['expectedRevision', 'unitPrice', 'reason'],
        },
      },
      responses: {
        '200': envelope(order),
        '404': envelope(object),
        '409': envelope(object),
        '422': envelope(object),
      },
      idempotent: true,
      handler: async (ctx, url, req, params, request) => {
        const key = keyOf(ctx, url, req)
        if (typeof key !== 'string') return key
        const identity = request.identity!
        const held = await orderFor(ctx, url, req, params.id, identity)
        if (!held) return notFound(ctx, url, req)
        const line = (Array.isArray(held.lines) ? (held.lines as Row[]) : []).find(
          (candidate) => String(candidate.id) === params.lineId,
        )
        if (!line) return notFound(ctx, url, req)
        const result = (await ctx.call(
          'pos.updateLine',
          {
            id: params.lineId,
            orderId: params.id,
            expectedRevision: request.body.expectedRevision,
            qty: line.qty,
            ...(action === 'discount'
              ? { discount: request.body.discount }
              : {
                  priceUnit: request.body.unitPrice,
                  overrideReason: request.body.reason,
                }),
            overrideBy: identity.operatorId,
          },
          url,
          req,
          commandOptions(identity, `order.line.${action}`, key),
        )) as Row
        if (result.ok !== true) return failure(ctx, url, req, result)
        return orderResult(ctx, url, req, params.id, identity)
      },
    }),
  ),
  defineChannelRoute({
    profile: 'pos',
    method: 'DELETE',
    path: 'orders/{id}/lines/{lineId}/remove',
    operationId: 'pos.orders.lines.remove',
    summary: 'Remove one member line under the order revision.',
    auth: 'required',
    request: { params: lineParams, body: expectedBody },
    responses: {
      '200': envelope(order),
      '404': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = keyOf(ctx, url, req)
      if (typeof key !== 'string') return key
      const identity = request.identity!
      if (!(await orderFor(ctx, url, req, params.id, identity))) return notFound(ctx, url, req)
      const result = (await ctx.call(
        'pos.removeLine',
        { id: params.lineId, orderId: params.id, expectedRevision: request.body.expectedRevision },
        url,
        req,
        commandOptions(identity, 'order.line.remove', key),
      )) as Row
      if (result.ok !== true) return failure(ctx, url, req, result)
      return orderResult(ctx, url, req, params.id, identity)
    },
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'POST',
    path: 'orders/{id}/lines/reorder',
    operationId: 'pos.orders.lines.reorder',
    summary: 'Replace line order using an exact membership list.',
    auth: 'required',
    request: {
      params: idParams,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { expectedRevision: integer, lineIds: { type: 'array', items: string } },
        required: ['expectedRevision', 'lineIds'],
      },
    },
    responses: {
      '200': envelope(order),
      '404': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = keyOf(ctx, url, req)
      if (typeof key !== 'string') return key
      const identity = request.identity!
      if (!(await orderFor(ctx, url, req, params.id, identity))) return notFound(ctx, url, req)
      const result = (await ctx.call(
        'pos.reorderLines',
        { id: params.id, expectedRevision: request.body.expectedRevision, lineIds: request.body.lineIds },
        url,
        req,
        commandOptions(identity, 'order.line.reorder', key),
      )) as Row
      if (result.ok !== true) return failure(ctx, url, req, result)
      return orderResult(ctx, url, req, params.id, identity)
    },
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'POST',
    path: 'orders/{id}/tenders',
    operationId: 'pos.orders.tenders.add',
    summary: 'Capture one cash or manual non-cash tender under the order revision.',
    auth: 'required',
    request: {
      params: idParams,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          expectedRevision: integer,
          paymentMethodId: string,
          tenderedAmount: string,
          reference: string,
        },
        required: ['expectedRevision', 'paymentMethodId', 'tenderedAmount'],
      },
    },
    responses: {
      '200': envelope(order),
      '404': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = keyOf(ctx, url, req)
      if (typeof key !== 'string') return key
      const identity = request.identity!
      if (!(await orderFor(ctx, url, req, params.id, identity))) return notFound(ctx, url, req)
      const result = (await ctx.call(
        'pos.addPayment',
        {
          id: channelCommandId('tender', identity, `${params.id}\n${key}`),
          orderId: params.id,
          expectedRevision: request.body.expectedRevision,
          paymentMethodId: request.body.paymentMethodId,
          tenderedAmount: request.body.tenderedAmount,
          reference: request.body.reference,
          operatorId: identity.operatorId,
          deviceId: identity.deviceId,
        },
        url,
        req,
        commandOptions(identity, 'order.tender.add', key),
      )) as Row
      if (result.ok !== true) return failure(ctx, url, req, result)
      return orderResult(ctx, url, req, params.id, identity)
    },
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'POST',
    path: 'orders/{id}/tenders/{tenderId}/void',
    operationId: 'pos.orders.tenders.void',
    summary: 'Void one captured tender before finalization.',
    auth: 'required',
    request: {
      params: tenderParams,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { expectedRevision: integer, reason: string },
        required: ['expectedRevision', 'reason'],
      },
    },
    responses: {
      '200': envelope(order),
      '404': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = keyOf(ctx, url, req)
      if (typeof key !== 'string') return key
      const identity = request.identity!
      if (!(await orderFor(ctx, url, req, params.id, identity))) return notFound(ctx, url, req)
      const result = (await ctx.call(
        'pos.voidPayment',
        {
          id: params.tenderId,
          orderId: params.id,
          expectedRevision: request.body.expectedRevision,
          reason: request.body.reason,
          operatorId: identity.operatorId,
        },
        url,
        req,
        commandOptions(identity, 'order.tender.void', key),
      )) as Row
      if (result.ok !== true) return failure(ctx, url, req, result)
      return orderResult(ctx, url, req, params.id, identity)
    },
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'POST',
    path: 'orders/{id}/finalize',
    operationId: 'pos.orders.finalize',
    summary: 'Finalize one fully covered order into stock, invoice and reconciled accounting.',
    auth: 'required',
    request: { params: idParams, body: expectedBody },
    responses: {
      '200': envelope(order),
      '404': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = keyOf(ctx, url, req)
      if (typeof key !== 'string') return key
      const identity = request.identity!
      if (!(await orderFor(ctx, url, req, params.id, identity))) return notFound(ctx, url, req)
      const result = (await ctx.call(
        await lifecycleFunction(ctx, req, 'loyalty_pos.validateOrder', 'pos.validateOrder'),
        { id: params.id, expectedRevision: request.body.expectedRevision },
        url,
        req,
        commandOptions(identity, 'order.finalize', key),
      )) as Row
      if (result.ok !== true) return failure(ctx, url, req, result)
      return orderResult(ctx, url, req, params.id, identity)
    },
  }),
  defineChannelRoute({
    profile: 'pos',
    method: 'POST',
    path: 'orders/{id}/cancel',
    operationId: 'pos.orders.cancel',
    summary: 'Cancel one draft under the order revision.',
    auth: 'required',
    request: { params: idParams, body: expectedBody },
    responses: {
      '200': envelope(order),
      '404': envelope(object),
      '409': envelope(object),
      '422': envelope(object),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = keyOf(ctx, url, req)
      if (typeof key !== 'string') return key
      const identity = request.identity!
      if (!(await orderFor(ctx, url, req, params.id, identity))) return notFound(ctx, url, req)
      const result = (await ctx.call(
        await lifecycleFunction(ctx, req, 'loyalty_pos.cancelOrder', 'pos.cancelOrder'),
        { id: params.id, expectedRevision: request.body.expectedRevision },
        url,
        req,
        commandOptions(identity, 'order.cancel', key),
      )) as Row
      if (result.ok !== true) return failure(ctx, url, req, result)
      return orderResult(ctx, url, req, params.id, identity)
    },
  }),
)

export {
  commandOptions,
  failure as posFailure,
  keyOf as posCommandKey,
  notFound as posNotFound,
  orderFor as posOrderFor,
}
