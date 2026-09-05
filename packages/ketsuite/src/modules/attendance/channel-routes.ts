// Attendance on the staff channel.
//
// The first vertical to answer on /api/staff/v1/, and a thin one on purpose:
// every route here hands the session's own employee to a function that already
// existed. Nothing about who the caller is arrives from the client — the
// framework resolves the actor from the session, and attendance resolves the
// employee from the actor, so an operator can only ever punch their own clock.

import { channelError, defineChannelRoute, idempotencyKey, routesOf } from '../channel_api/core.ts'
import type { Route, ServeContext } from '@ketvietlab/ketjs'

type Req = Parameters<Route>[1]
type Issue = { field?: string; code?: string }

const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }
const envelope = (data: unknown) => ({
  type: 'object',
  properties: { data, error: {}, meta: { type: 'object' } },
})
const object = { type: 'object' }
const clockStatus = {
  type: 'object',
  additionalProperties: false,
  properties: {
    onClock: { type: 'boolean' },
    sessionId: nullableString,
    startAt: { ...nullableString, format: 'date-time' },
    branchId: nullableString,
  },
  required: ['onClock'],
}
const attendanceSession = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    branchId: string,
    startAt: { ...string, format: 'date-time' },
    stopAt: { ...nullableString, format: 'date-time' },
    correctedStartAt: { ...nullableString, format: 'date-time' },
    correctedStopAt: { ...nullableString, format: 'date-time' },
    state: string,
    workedHours: { type: 'string', pattern: '^\\d+(?:\\.\\d{2})$' },
  },
  required: [
    'id',
    'branchId',
    'startAt',
    'stopAt',
    'correctedStartAt',
    'correctedStopAt',
    'state',
    'workedHours',
  ],
}
const attendancePage = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dateFrom: { ...string, format: 'date' },
    dateTo: { ...string, format: 'date' },
    items: { type: 'array', items: attendanceSession },
    nextCursor: nullableString,
  },
  required: ['dateFrom', 'dateTo', 'items', 'nextCursor'],
}
const punchResult = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['in', 'out'] },
    occurredAt: { ...string, format: 'date-time' },
    sessionId: string,
  },
  required: ['kind', 'occurredAt', 'sessionId'],
}

const localDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  return new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
}

const recordsQuery = (ctx: ServeContext, url: URL, req: Req, today: string) => {
  const defaultFrom = new Date(`${today}T00:00:00.000Z`)
  defaultFrom.setUTCDate(defaultFrom.getUTCDate() - 30)
  const dateFrom = url.searchParams.get('dateFrom') ?? defaultFrom.toISOString().slice(0, 10)
  const dateTo = url.searchParams.get('dateTo') ?? today
  const cursor = url.searchParams.get('cursor') ?? '0'
  const limitText = url.searchParams.get('limit') ?? '20'
  const offset = /^\d+$/.test(cursor) ? Number(cursor) : -1
  const limit = /^\d+$/.test(limitText) ? Number(limitText) : -1
  const days =
    localDate(dateFrom) && localDate(dateTo)
      ? (Date.parse(`${dateTo}T00:00:00.000Z`) - Date.parse(`${dateFrom}T00:00:00.000Z`)) / 86_400_000
      : -1
  if (days < 0 || days > 93 || offset < 0 || limit < 1 || limit > 100) {
    return {
      status: 400,
      error: channelError(ctx, url, req, 'channel_api.validation', {
        messageKey: 'channel_api.error.validation',
      }),
    }
  }
  return { dateFrom, dateTo, offset, limit }
}

/** A domain refusal, carried out with the key the module already translates. */
const refused = (ctx: ServeContext, url: URL, req: Req, result: unknown, status = 422) => {
  const first = ((result as { errors?: Issue[] })?.errors ?? [])[0] ?? {}
  const messageKey = first.code ?? 'attendance.error.invalid'
  return {
    status,
    error: channelError(ctx, url, req, messageKey, {
      messageKey,
      ...(first.field
        ? { fieldErrors: { [first.field]: { code: messageKey, messageKey, params: {} } } }
        : {}),
    }),
  }
}

const punch =
  (expect: 'in' | 'out') =>
  async (ctx: ServeContext, url: URL, req: Req, identity: { companyId: string | null; userId: string }) => {
    const key = idempotencyKey(ctx, url, req)
    if (typeof key !== 'string') return key
    const namespace = `staff:${identity.companyId ?? 'none'}:${identity.userId}:attendance.punch.self:${expect}`
    // ctx.call, not callUnchecked: whether this operator may punch at all is the
    // framework's answer, from the permissions their session carries.
    const result = (await ctx.call('attendance.punch.self', { expect }, url, req, {
      idempotencyKey: key,
      idempotencyNamespace: namespace,
    })) as {
      ok?: boolean
      kind?: string
      occurredAt?: string
      sessionId?: string
      errors?: Issue[]
    }
    return result.ok
      ? {
          status: 201,
          data: { kind: result.kind, occurredAt: result.occurredAt, sessionId: result.sessionId },
        }
      : refused(ctx, url, req, result, 409)
  }

export const channelRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'attendance/status',
    operationId: 'staff.attendance.status',
    summary: 'Whether the signed-in operator is on the clock, and since when.',
    auth: 'required',
    capability: { key: 'attendance.records', action: 'read' },
    responses: { '200': envelope(clockStatus) },
    handler: async (ctx, url, req) => ({
      data: await ctx.call('attendance.clock.mine', {}, url, req),
    }),
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'attendance/records',
    operationId: 'staff.attendance.records.list',
    summary: 'The operator’s own attendance sessions, newest first.',
    auth: 'required',
    capability: { key: 'attendance.records', action: 'read' },
    request: {
      query: {
        type: 'object',
        properties: {
          dateFrom: { type: 'string', format: 'date' },
          dateTo: { type: 'string', format: 'date' },
          cursor: { type: 'string', pattern: '^\\d+$' },
          limit: { type: 'integer', minimum: 1, maximum: 100 },
        },
      },
    },
    responses: { '200': envelope(attendancePage) },
    handler: async (ctx, url, req) => {
      const calendar = (await ctx.call('attendance.calendar.mine', {}, url, req)) as { today: string }
      const query = recordsQuery(ctx, url, req, calendar.today)
      if ('status' in query) return query
      const rows = (await ctx.call(
        'attendance.session.mine',
        {
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          offset: query.offset,
          limit: query.limit + 1,
        },
        url,
        req,
      )) as Array<Record<string, unknown>>
      const hasMore = rows.length > query.limit
      return {
        data: {
          dateFrom: query.dateFrom,
          dateTo: query.dateTo,
          items: rows.slice(0, query.limit),
          nextCursor: hasMore ? String(query.offset + query.limit) : null,
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'attendance/check-in',
    operationId: 'staff.attendance.checkIn',
    summary: 'Start a shift. Refused when one is already open.',
    auth: 'required',
    capability: { key: 'attendance.records', action: 'check_in' },
    request: {
      headers: {
        type: 'object',
        properties: { 'Idempotency-Key': { type: 'string', minLength: 8, maxLength: 200 } },
        required: ['Idempotency-Key'],
      },
      body: object,
    },
    responses: { '201': envelope(punchResult) },
    idempotent: true,
    handler: (ctx, url, req, _params, request) => punch('in')(ctx, url, req, request.identity!),
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'attendance/check-out',
    operationId: 'staff.attendance.checkOut',
    summary: 'End the open shift. Refused when there is none.',
    auth: 'required',
    capability: { key: 'attendance.records', action: 'check_out' },
    request: {
      headers: {
        type: 'object',
        properties: { 'Idempotency-Key': { type: 'string', minLength: 8, maxLength: 200 } },
        required: ['Idempotency-Key'],
      },
      body: object,
    },
    responses: { '201': envelope(punchResult) },
    idempotent: true,
    handler: (ctx, url, req, _params, request) => punch('out')(ctx, url, req, request.identity!),
  }),
)
