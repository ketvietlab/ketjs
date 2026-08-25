// Staff-facing hospitality workspace.
//
// Hospitality Core owns every operational transition. This facade resolves the
// property from actor-visible domain reads, publishes strong projection versions,
// and sends commands back through ctx.call so function permissions remain the
// final authority. Commands without a matching atomic domain function are
// rejected and never advertised as a successful operation.

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, routesOf, sha256 } from '../channel_api/core.ts'
import {
  BOOKING_TYPES,
  CLEANING_TASK_PRIORITIES,
  CLEANING_TASK_STATES,
  CLEANING_TASK_TYPES,
  RESERVATION_STATES,
} from '../hospitality_core/types.ts'

type Req = Parameters<Route>[1]
type Row = Record<string, unknown>
type Issue = { field?: string; code?: string; messageKey?: string; params?: Record<string, unknown> }

const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }
const reference = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, name: string },
  required: ['id', 'name'],
}
const nullableReference = { anyOf: [reference, { type: 'null' }] }
const schedule = {
  type: 'object',
  additionalProperties: false,
  properties: { checkIn: string, checkOut: string },
  required: ['checkIn', 'checkOut'],
}
const reservationSummary = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    reference: string,
    state: { type: 'string', enum: [...RESERVATION_STATES] },
    source: string,
    bookingType: { type: 'string', enum: [...BOOKING_TYPES] },
    guest: reference,
    roomType: reference,
    schedule,
    party: {
      type: 'object',
      additionalProperties: false,
      properties: {
        adults: { type: 'integer', minimum: 0 },
        children: { type: 'integer', minimum: 0 },
      },
      required: ['adults', 'children'],
    },
    version: string,
  },
  required: [
    'id',
    'reference',
    'state',
    'source',
    'bookingType',
    'guest',
    'roomType',
    'schedule',
    'party',
    'version',
  ],
}
const housekeepingTask = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    reference: string,
    state: { type: 'string', enum: [...CLEANING_TASK_STATES] },
    taskType: { type: 'string', enum: [...CLEANING_TASK_TYPES] },
    priority: { type: 'string', enum: [...CLEANING_TASK_PRIORITIES] },
    room: reference,
    assignee: nullableReference,
    requestedAt: nullableString,
    availableActions: { type: 'array', items: string },
    readOnly: { type: 'boolean' },
    version: string,
  },
  required: [
    'id',
    'reference',
    'state',
    'taskType',
    'priority',
    'room',
    'assignee',
    'requestedAt',
    'availableActions',
    'readOnly',
    'version',
  ],
}
const page = (item: unknown) => ({
  type: 'object',
  additionalProperties: false,
  properties: { items: { type: 'array', items: item }, nextCursor: nullableString },
  required: ['items', 'nextCursor'],
})
const envelope = (data: unknown) => ({
  type: 'object',
  properties: { data, error: {}, meta: { type: 'object' } },
})
const mutation = {
  type: 'object',
  properties: {
    outcome: string,
    version: string,
    reservation: { type: 'object' },
    stay: { type: 'object' },
    folio: { type: 'object' },
    task: { type: 'object' },
    charge: { type: 'object' },
    payment: { type: 'object' },
  },
  required: ['outcome', 'version'],
}

const named = (row: unknown): { id: string; name: string } => {
  const value = (row ?? {}) as Row
  return { id: String(value.id), name: String(value.name ?? value.code ?? value.id) }
}
const maybeNamed = (row: unknown): { id: string; name: string } | null => (row ? named(row) : null)
const hashVersion = (prefix: string, value: unknown): string => `${prefix}_${sha256(JSON.stringify(value))}`
const reservationVersion = (row: Row): string =>
  hashVersion('hrv', {
    id: row.id,
    propertyId: row.propertyId,
    roomTypeId: row.roomTypeId,
    partnerId: row.partnerId,
    stayId: row.stayId,
    folioId: row.folioId,
    provider: row.provider,
    bookingType: row.bookingType,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    adults: row.adults,
    children: row.children,
    state: row.state,
    updatedAt: row.updatedAt,
  })
const stayVersion = (row: Row): string =>
  hashVersion('hsv', {
    id: row.id,
    propertyId: row.propertyId,
    reservationId: row.reservationId,
    folioId: row.folioId,
    partnerId: row.partnerId,
    roomTypeId: row.roomTypeId,
    currentRoomId: row.currentRoomId,
    bookingType: row.bookingType,
    checkIn: row.checkIn,
    checkOut: row.checkOut,
    state: row.state,
    checkedInAt: row.checkedInAt,
    checkedOutAt: row.checkedOutAt,
  })
const folioVersion = (row: Row): string =>
  hashVersion('hfv', {
    id: row.id,
    propertyId: row.propertyId,
    partnerId: row.partnerId,
    state: row.state,
    amountTotal: row.amountTotal,
    version: row.version,
    closedAt: row.closedAt,
  })
const taskVersion = (row: Row): string =>
  hashVersion('hkv', {
    id: row.id,
    propertyId: row.propertyId,
    roomId: row.roomId,
    stayId: row.stayId,
    taskType: row.taskType,
    priority: row.priority,
    state: row.state,
    assigneeId: row.assigneeId,
    requestedAt: row.requestedAt,
    startedAt: row.startedAt,
    doneAt: row.doneAt,
  })

const projectProperty = (row: Row) => ({
  id: String(row.id),
  code: String(row.code),
  name: String(row.name),
  timezone: String(row.timezone ?? 'UTC'),
  defaultCheckIn: String(row.defaultCheckIn ?? '14:00'),
  defaultCheckOut: String(row.defaultCheckOut ?? '12:00'),
  roomCount: Array.isArray(row.rooms) ? row.rooms.length : Number(row.rooms ?? 0),
})
const projectReservation = (row: Row) => ({
  id: String(row.id),
  reference: String(row.code ?? row.id),
  state: String(row.state),
  source: String(row.provider ?? 'direct'),
  bookingType: String(row.bookingType),
  guest: named(row.partner ?? { id: row.partnerId, name: row.partnerId }),
  roomType: named(row.roomType ?? { id: row.roomTypeId, name: row.roomTypeId }),
  schedule: { checkIn: String(row.checkIn), checkOut: String(row.checkOut) },
  party: { adults: Number(row.adults ?? 0), children: Number(row.children ?? 0) },
  version: reservationVersion(row),
})
const projectStay = (row: Row) => ({
  id: String(row.id),
  reference: String(row.code ?? row.id),
  state: String(row.state),
  bookingType: String(row.bookingType),
  guest: named(row.partner ?? { id: row.partnerId, name: row.partnerId }),
  roomType: named(row.roomType ?? { id: row.roomTypeId, name: row.roomTypeId }),
  room: maybeNamed(row.currentRoom),
  schedule: { checkIn: String(row.checkIn), checkOut: String(row.checkOut) },
  version: stayVersion(row),
})
const projectFolio = (row: Row) => ({
  id: String(row.id),
  reference: String(row.code ?? row.id),
  state: String(row.state),
  amountTotal: String(row.amountTotal ?? '0'),
  version: folioVersion(row),
})
const taskActions = (row: Row): string[] =>
  row.state === 'todo' ? ['start', 'cancel'] : row.state === 'in_progress' ? ['complete', 'cancel'] : []
const projectTask = (row: Row, assignees: Map<string, Row> = new Map()) => ({
  id: String(row.id),
  reference: String(row.code ?? row.id),
  state: String(row.state),
  taskType: String(row.taskType),
  priority: String(row.priority),
  room: named(row.room ?? { id: row.roomId, name: row.roomId }),
  assignee:
    row.assigneeId == null
      ? null
      : named(assignees.get(String(row.assigneeId)) ?? { id: row.assigneeId, name: row.assigneeId }),
  requestedAt: row.requestedAt == null ? null : String(row.requestedAt),
  availableActions: taskActions(row),
  readOnly: taskActions(row).length === 0,
  version: taskVersion(row),
})

const positive = (value: string | null, fallback: number, maximum: number): number => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? Math.min(number, maximum) : fallback
}
const offsetOf = (cursor: string | null): number => {
  if (!cursor) return 0
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: unknown }
    return Number.isInteger(value.offset) && Number(value.offset) >= 0 ? Number(value.offset) : 0
  } catch {
    return 0
  }
}
const cursorOf = (offset: number): string => Buffer.from(JSON.stringify({ offset })).toString('base64url')
const pageRows = <T>(rows: T[], cursor: string | null, limit: number) => {
  const offset = offsetOf(cursor)
  const items = rows.slice(offset, offset + limit)
  return { items, nextCursor: offset + limit < rows.length ? cursorOf(offset + limit) : null }
}
const localDateAt = (value: Date, timezone: string): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(value)
    .replaceAll('/', '-')
const localDate = (timezone: string): string => localDateAt(new Date(), timezone)
const dayBounds = (date: string): { from: string; to: string } => {
  const center = Date.parse(`${date}T00:00:00.000Z`)
  return {
    // Every IANA offset falls inside this three-day UTC window. The exact
    // property-local date is applied after the domain read.
    from: new Date(center - 86_400_000).toISOString(),
    to: new Date(center + 172_799_999).toISOString(),
  }
}

const notFound = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'hospitality_staff_channel.notFound', {
    messageKey: 'hospitality_staff_channel.error.notFound',
  }),
})
const domainFailure = (ctx: ServeContext, url: URL, req: Req, result: unknown) => {
  const issues = Array.isArray((result as { errors?: unknown })?.errors)
    ? ((result as { errors: Issue[] }).errors ?? [])
    : []
  const first = issues[0] ?? {}
  const conflict = String(first.code ?? '').includes('conflict')
  return {
    status: conflict ? 409 : 422,
    error: channelError(ctx, url, req, first.code ?? 'hospitality_staff_channel.invalidRequest', {
      messageKey: first.messageKey ?? 'hospitality_staff_channel.error.invalidRequest',
      params: first.params ?? {},
      fieldErrors: Object.fromEntries(
        issues
          .filter((issue) => issue.field)
          .map((issue) => [
            String(issue.field),
            {
              code: issue.code ?? 'hospitality_staff_channel.invalidRequest',
              messageKey: issue.messageKey ?? 'hospitality_staff_channel.error.invalidRequest',
              params: issue.params ?? {},
            },
          ]),
      ),
    }),
  }
}
const versionFailure = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 409,
  error: channelError(ctx, url, req, 'hospitality_staff_channel.versionConflict', {
    messageKey: 'hospitality_staff_channel.error.versionConflict',
  }),
})
const unsupported = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 422,
  error: channelError(ctx, url, req, 'hospitality_staff_channel.unsupportedOperation', {
    messageKey: 'hospitality_staff_channel.error.unsupportedOperation',
  }),
})
const idempotencyKey = (ctx: ServeContext, url: URL, req: Req) => {
  const key = String(req.headers['idempotency-key'] ?? '').trim()
  return key.length >= 8 && key.length <= 200
    ? key
    : {
        status: 400,
        error: channelError(ctx, url, req, 'channel_api.idempotencyRequired', {
          messageKey: 'channel_api.error.idempotencyRequired',
        }),
      }
}
const commandId = (namespace: string, key: string): string => `staff:${sha256(`${namespace}\n${key}`)}`
const requestVersion = (req: Req, body: Row): string => {
  const header = String(req.headers['if-match'] ?? '')
    .replace(/^W\//, '')
    .replace(/^"|"$/g, '')
  const expected = String(body.expectedVersion ?? '')
  return header && expected && header === expected ? expected : ''
}
const propertyFor = async (ctx: ServeContext, url: URL, req: Req, id: string): Promise<Row | null> =>
  (await ctx.call('hospitality_core.getProperty', { id }, url, req)) as Row | null
const sameProperty = (row: Row | null, propertyId: string): row is Row =>
  Boolean(row && String(row.propertyId) === propertyId)
const usersById = async (ctx: ServeContext, url: URL, req: Req, tasks: Row[]): Promise<Map<string, Row>> => {
  const ids = [
    ...new Set(
      tasks
        .map((task) => task.assigneeId)
        .filter(Boolean)
        .map(String),
    ),
  ]
  if (!ids.length) return new Map()
  const rows = (await ctx.call('user.listUsers', { ids, includeArchived: true }, url, req)) as Row[]
  return new Map(rows.map((row) => [String(row.id), row]))
}

const detailReservation = async (ctx: ServeContext, url: URL, req: Req, row: Row) => {
  const propertyRow = await propertyFor(ctx, url, req, String(row.propertyId))
  const stayRow = row.stay as Row | null
  return {
    ...projectReservation(row),
    property: propertyRow ? projectProperty(propertyRow) : null,
    readOnly: row.provider !== 'direct',
    stay: stayRow ? projectStay(stayRow) : null,
    folio: row.folio ? projectFolio(row.folio as Row) : null,
  }
}
const detailStay = async (ctx: ServeContext, url: URL, req: Req, row: Row) => {
  const propertyRow = await propertyFor(ctx, url, req, String(row.propertyId))
  const folio = (await ctx.call('hospitality_core.getFolio', { id: row.folioId }, url, req)) as Row | null
  const guests = Array.isArray(row.guests) ? (row.guests as Row[]) : []
  return {
    ...projectStay(row),
    property: propertyRow ? projectProperty(propertyRow) : null,
    folio: folio ? projectFolio(folio) : null,
    guests: guests.map((guest) => ({
      id: String(guest.id),
      name: String(guest.name),
      isPrimary: guest.isPrimary === true,
    })),
  }
}
const detailFolio = async (ctx: ServeContext, url: URL, req: Req, row: Row) => {
  const billing = (await ctx.call(
    'hospitality_billing.getFolioBilling',
    { folioId: row.id },
    url,
    req,
  )) as Row | null
  const charges = Array.isArray(row.charges) ? (row.charges as Row[]) : []
  return {
    ...projectFolio(row),
    guest: named(row.partner ?? { id: row.partnerId, name: row.partnerId }),
    charges: charges.map((charge) => ({
      id: String(charge.id),
      description: String(charge.description),
      chargeType: String(charge.type),
      quantity: String(charge.quantity),
      unitPrice: String(charge.unitPrice),
      amount: String(charge.amount),
      occurredAt: String(charge.occurredAt),
      state: String(charge.state),
    })),
    invoice: billing?.moveId
      ? {
          id: String(billing.moveId),
          reference: String(billing.moveName ?? billing.moveId),
          state: String(billing.moveState),
          paymentStatus: String(billing.paymentState),
          amountTotal: String(billing.amountTotal ?? '0'),
          amountDue: String(billing.amountDue ?? '0'),
        }
      : null,
  }
}

const propertyQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { propertyId: string },
  required: ['propertyId'],
}
const idParams = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string },
  required: ['id'],
}
const expectedVersionBody = {
  type: 'object',
  additionalProperties: false,
  properties: { expectedVersion: string },
  required: ['expectedVersion'],
}

export const channelRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'hospitality/context',
    operationId: 'staff.hospitality.context',
    summary: 'List actor-visible hospitality properties and their operational defaults.',
    auth: 'required',
    capability: { key: 'hospitality.properties', action: 'read' },
    responses: { '200': envelope({ type: 'object' }) },
    handler: async (ctx, url, req) => {
      const rows = (await ctx.call('hospitality_core.listProperties', {}, url, req)) as Row[]
      const details = (await Promise.all(
        rows.map((row) => propertyFor(ctx, url, req, String(row.id))),
      )) as Array<Row | null>
      const properties = rows.map((row, index) => projectProperty({ ...row, ...(details[index] ?? {}) }))
      return {
        data: {
          defaultPropertyId: properties[0]?.id ?? null,
          properties,
          permissions: { canManage: true, canManageFinancials: true, canRefund: false },
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'hospitality/front-desk/today',
    operationId: 'staff.hospitality.frontDesk.today',
    summary: 'Read the current property-local arrival, in-house and departure board.',
    auth: 'required',
    capability: { key: 'hospitality.reservations', action: 'read' },
    request: { query: propertyQuery },
    responses: { '200': envelope({ type: 'object' }), '404': envelope({ type: 'null' }) },
    handler: async (ctx, url, req) => {
      const propertyId = String(url.searchParams.get('propertyId'))
      const propertyRow = await propertyFor(ctx, url, req, propertyId)
      if (!propertyRow) return notFound(ctx, url, req)
      const businessDate = localDate(String(propertyRow.timezone ?? 'UTC'))
      const bounds = dayBounds(businessDate)
      const [arrivals, inHouse, departures] = (await Promise.all([
        ctx.call(
          'hospitality_core.listReservations',
          { propertyId, state: 'confirmed', from: bounds.from, to: bounds.to },
          url,
          req,
        ),
        ctx.call('hospitality_core.listStays', { propertyId, state: 'checked_in' }, url, req),
        ctx.call(
          'hospitality_core.listStays',
          { propertyId, state: 'checked_in', from: bounds.from, to: bounds.to },
          url,
          req,
        ),
      ])) as [Row[], Row[], Row[]]
      const timezone = String(propertyRow.timezone ?? 'UTC')
      const arriving = arrivals.filter(
        (row) => localDateAt(new Date(String(row.checkIn)), timezone) === businessDate,
      )
      const departing = departures.filter(
        (row) => localDateAt(new Date(String(row.checkOut)), timezone) === businessDate,
      )
      return {
        data: {
          property: projectProperty(propertyRow),
          businessDate,
          counts: { arrivals: arriving.length, inHouse: inHouse.length, departures: departing.length },
          arrivals: arriving.map(projectReservation),
          inHouse: inHouse.map(projectStay),
          departures: departing.map(projectStay),
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'hospitality/reservations',
    operationId: 'staff.hospitality.reservations.list',
    summary: 'List actor-visible reservations for one property.',
    auth: 'required',
    capability: { key: 'hospitality.reservations', action: 'read' },
    request: {
      query: {
        type: 'object',
        additionalProperties: false,
        properties: {
          propertyId: string,
          query: { type: 'string', minLength: 2 },
          status: { type: 'string', enum: ['all', ...RESERVATION_STATES] },
          dateFrom: { type: 'string', format: 'date' },
          dateTo: { type: 'string', format: 'date' },
          cursor: string,
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
        required: ['propertyId'],
      },
    },
    responses: { '200': envelope(page(reservationSummary)) },
    handler: async (ctx, url, req) => {
      const propertyId = String(url.searchParams.get('propertyId'))
      const status = url.searchParams.get('status')
      const rows = (await ctx.call(
        'hospitality_core.listReservations',
        {
          propertyId,
          state: status && status !== 'all' ? status : undefined,
          from: url.searchParams.get('dateFrom')
            ? `${url.searchParams.get('dateFrom')}T00:00:00.000Z`
            : undefined,
          to: url.searchParams.get('dateTo') ? `${url.searchParams.get('dateTo')}T23:59:59.999Z` : undefined,
        },
        url,
        req,
      )) as Row[]
      const query = String(url.searchParams.get('query') ?? '').toLocaleLowerCase()
      const projected = rows
        .map(projectReservation)
        .filter((row) => !query || `${row.reference} ${row.guest.name}`.toLocaleLowerCase().includes(query))
      return {
        data: pageRows(
          projected,
          url.searchParams.get('cursor'),
          positive(url.searchParams.get('limit'), 20, 50),
        ),
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'hospitality/reservations/{id}',
    operationId: 'staff.hospitality.reservations.get',
    summary: 'Read one actor-visible reservation aggregate.',
    auth: 'required',
    capability: { key: 'hospitality.reservations', action: 'read' },
    request: { params: idParams },
    responses: { '200': envelope({ type: 'object' }), '404': envelope({ type: 'null' }) },
    handler: async (ctx, url, req, params) => {
      const row = (await ctx.call(
        'hospitality_core.getReservation',
        { id: params.id },
        url,
        req,
      )) as Row | null
      if (!row) return notFound(ctx, url, req)
      return { data: await detailReservation(ctx, url, req, row) }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'hospitality/stays/{id}',
    operationId: 'staff.hospitality.stays.get',
    summary: 'Read one stay, its guests, room and folio reference.',
    auth: 'required',
    capability: { key: 'hospitality.stays', action: 'read' },
    request: { params: idParams, query: propertyQuery },
    responses: { '200': envelope({ type: 'object' }), '404': envelope({ type: 'null' }) },
    handler: async (ctx, url, req, params) => {
      const row = (await ctx.call('hospitality_core.getStay', { id: params.id }, url, req)) as Row | null
      if (!sameProperty(row, String(url.searchParams.get('propertyId')))) return notFound(ctx, url, req)
      return { data: await detailStay(ctx, url, req, row) }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'hospitality/folios/{id}',
    operationId: 'staff.hospitality.folios.get',
    summary: 'Read one operational folio and its billing projection.',
    auth: 'required',
    capability: { key: 'hospitality.folios', action: 'read' },
    request: { params: idParams, query: propertyQuery },
    responses: { '200': envelope({ type: 'object' }), '404': envelope({ type: 'null' }) },
    handler: async (ctx, url, req, params) => {
      const row = (await ctx.call('hospitality_core.getFolio', { id: params.id }, url, req)) as Row | null
      if (!sameProperty(row, String(url.searchParams.get('propertyId')))) return notFound(ctx, url, req)
      return { data: await detailFolio(ctx, url, req, row) }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'hospitality/housekeeping/tasks',
    operationId: 'staff.hospitality.housekeeping.tasks.list',
    summary: 'List actor-visible housekeeping tasks with record-valid actions.',
    auth: 'required',
    capability: { key: 'hospitality.housekeeping.tasks', action: 'read' },
    request: {
      query: {
        type: 'object',
        additionalProperties: false,
        properties: {
          propertyId: string,
          status: { type: 'string', enum: ['all', ...CLEANING_TASK_STATES] },
          assignedToMe: { type: 'boolean' },
          cursor: string,
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
        required: ['propertyId'],
      },
    },
    responses: { '200': envelope(page(housekeepingTask)) },
    handler: async (ctx, url, req, _params, request) => {
      const status = url.searchParams.get('status')
      const assigned = url.searchParams.get('assignedToMe') === 'true' ? request.identity!.userId : undefined
      const rows = (await ctx.call(
        'hospitality_core.listCleaningTasks',
        {
          propertyId: url.searchParams.get('propertyId'),
          state: status && status !== 'all' ? status : undefined,
          assigneeId: assigned,
          limit: 500,
        },
        url,
        req,
      )) as Row[]
      const assignees = await usersById(ctx, url, req, rows)
      return {
        data: pageRows(
          rows.map((row) => projectTask(row, assignees)),
          url.searchParams.get('cursor'),
          positive(url.searchParams.get('limit'), 20, 50),
        ),
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'hospitality/operations/context',
    operationId: 'staff.hospitality.operations.context',
    summary: 'Read the bounded references used by supported hospitality commands.',
    auth: 'required',
    capability: { key: 'hospitality.operations', action: 'read' },
    request: { query: propertyQuery },
    responses: { '200': envelope({ type: 'object' }), '404': envelope({ type: 'null' }) },
    handler: async (ctx, url, req) => {
      const propertyId = String(url.searchParams.get('propertyId'))
      const propertyRow = await propertyFor(ctx, url, req, propertyId)
      if (!propertyRow) return notFound(ctx, url, req)
      const [roomTypes, rooms, stays, folios, users, journals] = (await Promise.all([
        ctx.call('hospitality_core.listRoomTypes', { propertyId }, url, req),
        ctx.call('hospitality_core.listRooms', { propertyId, limit: 500 }, url, req),
        ctx.call('hospitality_core.listStays', { propertyId }, url, req),
        ctx.call('hospitality_core.listFolios', { propertyId }, url, req),
        ctx.call('user.listUsers', { limit: 500 }, url, req),
        ctx.call('account.listJournals', {}, url, req),
      ])) as [Row[], Row[], Row[], Row[], Row[], Row[]]
      return {
        data: {
          property: projectProperty(propertyRow),
          roomTypes: roomTypes.map(named),
          rooms: rooms.map((room) => ({
            id: String(room.id),
            name: String(room.name),
            roomType: named(room.roomType ?? { id: room.roomTypeId, name: room.roomTypeId }),
            state: String(room.status),
          })),
          stays: await Promise.all(stays.map((stay) => detailStay(ctx, url, req, stay))),
          folios: folios.map(projectFolio),
          housekeepingAssignees: users.map(named),
          paymentJournals: journals
            .filter((journal) => ['bank', 'cash'].includes(String(journal.type)))
            .map((journal) => ({ ...named(journal), type: String(journal.type) })),
          supportedOperations: [...SUPPORTED_OPERATIONS],
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'hospitality/housekeeping/tasks/{id}/start',
    operationId: 'staff.hospitality.housekeeping.tasks.start',
    summary: 'Start a housekeeping task with replay and optimistic-concurrency protection.',
    auth: 'required',
    capability: { key: 'hospitality.housekeeping.tasks', action: 'start' },
    request: { params: idParams, query: propertyQuery, body: expectedVersionBody },
    responses: {
      '200': envelope(mutation),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    idempotent: true,
    handler: housekeepingMutation('start'),
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'hospitality/housekeeping/tasks/{id}/complete',
    operationId: 'staff.hospitality.housekeeping.tasks.complete',
    summary: 'Complete a housekeeping task with replay and optimistic-concurrency protection.',
    auth: 'required',
    capability: { key: 'hospitality.housekeeping.tasks', action: 'complete' },
    request: { params: idParams, query: propertyQuery, body: expectedVersionBody },
    responses: {
      '200': envelope(mutation),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    idempotent: true,
    handler: housekeepingMutation('complete'),
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'hospitality/operations/{operation}',
    operationId: 'staff.hospitality.operations.execute',
    summary: 'Execute one supported hospitality domain command.',
    auth: 'required',
    capability: { key: 'hospitality.operations', action: 'execute' },
    request: {
      params: {
        type: 'object',
        additionalProperties: false,
        properties: { operation: string },
        required: ['operation'],
      },
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          propertyId: string,
          expectedVersion: string,
          reservationId: string,
          stayId: string,
          folioId: string,
          roomId: string,
          roomTypeId: string,
          journalId: string,
          assigneeId: string,
          guestId: string,
          guestName: string,
          name: string,
          reason: string,
          bookingType: { type: 'string', enum: [...BOOKING_TYPES] },
          checkIn: { type: 'string', format: 'date-time' },
          checkOut: { type: 'string', format: 'date-time' },
          adults: { type: 'integer', minimum: 0 },
          children: { type: 'integer', minimum: 0 },
          chargeType: string,
          description: string,
          quantity: string,
          unitPrice: string,
          amount: string,
          taskType: { type: 'string', enum: [...CLEANING_TASK_TYPES] },
          priority: { type: 'string', enum: [...CLEANING_TASK_PRIORITIES] },
        },
        required: ['propertyId'],
      },
    },
    responses: {
      '200': envelope(mutation),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    idempotent: true,
    handler: operationMutation,
  }),
)

const SUPPORTED_OPERATIONS = new Set([
  'hospitality.reservations.create',
  'hospitality.reservations.update',
  'hospitality.reservations.cancel',
  'hospitality.stays.check_in',
  'hospitality.stays.check_out',
  'hospitality.rooms.assign',
  'hospitality.rooms.change',
  'hospitality.rooms.upgrade',
  'hospitality.stays.guests.add',
  'hospitality.folios.add_charge',
  'hospitality.folios.create_invoice',
  'hospitality.payments.collect',
  'hospitality.housekeeping.tasks.create',
  'hospitality.housekeeping.tasks.cancel',
])

function housekeepingMutation(action: 'start' | 'complete') {
  return async (
    ctx: ServeContext,
    url: URL,
    req: Req,
    params: Record<string, string>,
    request: { body: Row; identity: { companyId: string | null; userId: string } | null },
  ) => {
    const key = idempotencyKey(ctx, url, req)
    if (typeof key !== 'string') return key
    const expected = requestVersion(req, request.body)
    if (!expected) return versionFailure(ctx, url, req)
    const propertyId = String(url.searchParams.get('propertyId'))
    const row = (await ctx.call(
      'hospitality_core.getCleaningTask',
      { id: params.id },
      url,
      req,
    )) as Row | null
    if (!sameProperty(row, propertyId)) return notFound(ctx, url, req)
    if (taskVersion(row) !== expected) return versionFailure(ctx, url, req)
    const fn =
      action === 'start' ? 'hospitality_core.startCleaningTask' : 'hospitality_core.completeCleaningTask'
    const result = (await ctx.call(
      fn,
      { id: params.id, ...(action === 'start' ? { assigneeId: request.identity!.userId } : {}) },
      url,
      req,
      {
        idempotencyKey: key,
        idempotencyNamespace: `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:${fn}`,
      },
    )) as Row
    if (result.ok !== true) return domainFailure(ctx, url, req, result)
    const refreshed = (await ctx.call('hospitality_core.getCleaningTask', { id: params.id }, url, req)) as Row
    const assignees = await usersById(ctx, url, req, [refreshed])
    const task = projectTask(refreshed, assignees)
    return { data: { outcome: action === 'start' ? 'started' : 'completed', version: task.version, task } }
  }
}

async function operationMutation(
  ctx: ServeContext,
  url: URL,
  req: Req,
  params: Record<string, string>,
  request: { body: Row; identity: { companyId: string | null; userId: string } | null },
) {
  const operation = params.operation
  if (!SUPPORTED_OPERATIONS.has(operation)) return unsupported(ctx, url, req)
  const key = idempotencyKey(ctx, url, req)
  if (typeof key !== 'string') return key
  const body = request.body
  const propertyId = String(body.propertyId)
  if (!(await propertyFor(ctx, url, req, propertyId))) return notFound(ctx, url, req)
  const namespace = `staff:${String(request.identity!.companyId)}:${request.identity!.userId}:${operation}`
  const id = commandId(namespace, key)
  const options = { idempotencyKey: key, idempotencyNamespace: namespace }

  const current = async (kind: 'reservation' | 'stay' | 'folio' | 'task', resourceId: unknown) => {
    const fn = {
      reservation: 'hospitality_core.getReservation',
      stay: 'hospitality_core.getStay',
      folio: 'hospitality_core.getFolio',
      task: 'hospitality_core.getCleaningTask',
    }[kind]
    const row = (await ctx.call(fn, { id: resourceId }, url, req)) as Row | null
    if (!sameProperty(row, propertyId)) return null
    return row
  }
  const requireVersion = async (kind: 'reservation' | 'stay' | 'folio' | 'task', resourceId: unknown) => {
    const row = await current(kind, resourceId)
    if (!row) return { error: notFound(ctx, url, req) }
    const expected = requestVersion(req, body)
    const actual =
      kind === 'reservation'
        ? reservationVersion(row)
        : kind === 'stay'
          ? stayVersion(row)
          : kind === 'folio'
            ? folioVersion(row)
            : taskVersion(row)
    return expected && expected === actual ? { row } : { error: versionFailure(ctx, url, req) }
  }
  const call = async (fn: string, input: Row) => {
    const result = (await ctx.call(fn, input, url, req, options)) as Row
    return result.ok === true ? result : domainFailure(ctx, url, req, result)
  }
  const failed = (value: unknown): value is ReturnType<typeof domainFailure> =>
    typeof value === 'object' && value !== null && 'status' in value && 'error' in value

  let result: Row | ReturnType<typeof domainFailure>
  let outcome = ''
  let resource: 'reservation' | 'stay' | 'folio' | 'task'
  let resourceId: string

  switch (operation) {
    case 'hospitality.reservations.create': {
      const partnerId = String(body.guestId ?? `${id}:guest`)
      if (!body.guestId) {
        const guest = (await ctx.call(
          'partner.savePartner',
          { id: partnerId, kind: 'person', name: body.guestName },
          url,
          req,
          options,
        )) as Row
        if (guest.ok !== true) return domainFailure(ctx, url, req, guest)
      }
      result = await call('hospitality_core.createReservation', {
        id,
        propertyId,
        roomTypeId: body.roomTypeId,
        partnerId,
        bookingType: body.bookingType,
        checkIn: body.checkIn,
        checkOut: body.checkOut,
        adults: body.adults,
        children: body.children,
      })
      outcome = 'created'
      resource = 'reservation'
      resourceId = failed(result) ? '' : String(result.id ?? id)
      break
    }
    case 'hospitality.reservations.update': {
      const held = await requireVersion('reservation', body.reservationId)
      if (held.error) return held.error
      const row = held.row!
      result = await call('hospitality_core.amendReservation', {
        id: body.reservationId,
        partnerId: body.guestId ?? row.partnerId,
        roomTypeId: body.roomTypeId ?? row.roomTypeId,
        bookingType: body.bookingType ?? row.bookingType,
        checkIn: body.checkIn ?? row.checkIn,
        checkOut: body.checkOut ?? row.checkOut,
        adults: body.adults ?? row.adults,
        children: body.children ?? row.children,
      })
      outcome = 'updated'
      resource = 'reservation'
      resourceId = String(body.reservationId)
      break
    }
    case 'hospitality.reservations.cancel': {
      const held = await requireVersion('reservation', body.reservationId)
      if (held.error) return held.error
      result = await call('hospitality_core.cancelReservation', {
        id: body.reservationId,
        reason: body.reason,
      })
      outcome = 'cancelled'
      resource = 'reservation'
      resourceId = String(body.reservationId)
      break
    }
    case 'hospitality.stays.check_in':
    case 'hospitality.rooms.assign': {
      const held = await requireVersion('stay', body.stayId)
      if (held.error) return held.error
      result = await call('hospitality_core.checkIn', {
        stayId: body.stayId,
        roomId: body.roomId,
        assignmentId: `${id}:assignment`,
        earlyReason: body.reason,
      })
      outcome = operation.endsWith('assign') ? 'assigned' : 'checked_in'
      resource = 'stay'
      resourceId = String(body.stayId)
      break
    }
    case 'hospitality.stays.check_out': {
      const held = await requireVersion('stay', body.stayId)
      if (held.error) return held.error
      result = await call('hospitality_core.checkOut', { stayId: body.stayId, taskId: `${id}:task` })
      outcome = 'checked_out'
      resource = 'stay'
      resourceId = String(body.stayId)
      break
    }
    case 'hospitality.rooms.change':
    case 'hospitality.rooms.upgrade': {
      const held = await requireVersion('stay', body.stayId)
      if (held.error) return held.error
      result = await call('hospitality_core.moveRoom', {
        stayId: body.stayId,
        roomId: body.roomId,
        assignmentId: `${id}:assignment`,
        reason: body.reason,
        allowRoomTypeChange: operation.endsWith('upgrade'),
      })
      outcome = operation.endsWith('upgrade') ? 'upgraded' : 'changed'
      resource = 'stay'
      resourceId = String(body.stayId)
      break
    }
    case 'hospitality.stays.guests.add': {
      const held = await requireVersion('stay', body.stayId)
      if (held.error) return held.error
      result = await call('hospitality_core.addStayGuest', {
        id,
        stayId: body.stayId,
        name: body.name,
      })
      outcome = 'guest_added'
      resource = 'stay'
      resourceId = String(body.stayId)
      break
    }
    case 'hospitality.folios.add_charge': {
      const held = await requireVersion('folio', body.folioId)
      if (held.error) return held.error
      result = await call('hospitality_core.addCharge', {
        id,
        folioId: body.folioId,
        description: body.description,
        type: body.chargeType,
        quantity: body.quantity,
        unitPrice: body.unitPrice,
        sourceKey: id,
      })
      outcome = 'charge_added'
      resource = 'folio'
      resourceId = String(body.folioId)
      break
    }
    case 'hospitality.folios.create_invoice': {
      const held = await requireVersion('folio', body.folioId)
      if (held.error) return held.error
      result = await call('hospitality_billing.invoiceFolio', { folioId: body.folioId })
      outcome = 'invoice_created'
      resource = 'folio'
      resourceId = String(body.folioId)
      break
    }
    case 'hospitality.payments.collect': {
      const held = await requireVersion('folio', body.folioId)
      if (held.error) return held.error
      result = await call('hospitality_billing.recordFolioPayment', {
        id,
        folioId: body.folioId,
        journalId: body.journalId,
        amount: body.amount,
      })
      outcome = 'payment_collected'
      resource = 'folio'
      resourceId = String(body.folioId)
      break
    }
    case 'hospitality.housekeeping.tasks.create': {
      result = await call('hospitality_core.createCleaningTask', {
        id,
        code: id.slice(-12).toUpperCase(),
        roomId: body.roomId,
        taskType: body.taskType,
        priority: body.priority,
        assigneeId: body.assigneeId,
      })
      outcome = 'created'
      resource = 'task'
      resourceId = failed(result) ? '' : String(result.id ?? id)
      break
    }
    case 'hospitality.housekeeping.tasks.cancel': {
      const held = await requireVersion('task', body.taskId)
      if (held.error) return held.error
      result = await call('hospitality_core.cancelCleaningTask', { id: body.taskId })
      outcome = 'cancelled'
      resource = 'task'
      resourceId = String(body.taskId)
      break
    }
    default:
      return unsupported(ctx, url, req)
  }
  if (failed(result)) return result
  const refreshed = await current(resource!, resourceId!)
  if (!refreshed) return notFound(ctx, url, req)
  if (resource! === 'reservation') {
    const value = await detailReservation(ctx, url, req, refreshed)
    return { data: { outcome, version: value.version, reservation: value } }
  }
  if (resource! === 'stay') {
    const value = await detailStay(ctx, url, req, refreshed)
    return { data: { outcome, version: value.version, stay: value } }
  }
  if (resource! === 'folio') {
    const value = await detailFolio(ctx, url, req, refreshed)
    return { data: { outcome, version: value.version, folio: value } }
  }
  const assignees = await usersById(ctx, url, req, [refreshed])
  const value = projectTask(refreshed, assignees)
  return { data: { outcome, version: value.version, task: value } }
}
