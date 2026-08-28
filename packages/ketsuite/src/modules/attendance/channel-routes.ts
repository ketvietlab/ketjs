// Attendance on the staff channel.
//
// The first vertical to answer on /api/staff/v1/, and a thin one on purpose:
// every route here hands the session's own employee to a function that already
// existed. Nothing about who the caller is arrives from the client — the
// framework resolves the actor from the session, and attendance resolves the
// employee from the actor, so an operator can only ever punch their own clock.

import { channelError, defineChannelRoute, routesOf } from '../channel_api/core.ts'
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
  },
  required: ['id', 'branchId', 'startAt', 'stopAt', 'correctedStartAt', 'correctedStopAt', 'state'],
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
    responses: { '200': envelope({ type: 'array', items: attendanceSession }) },
    handler: async (ctx, url, req) => {
      const month = url.searchParams.get('month')
      const rows = (await ctx.call(
        'attendance.session.mine',
        { ...(month ? { month } : {}) },
        url,
        req,
      )) as Array<Record<string, unknown>>
      return {
        data: [...rows].sort((a, b) => String(b.startAt).localeCompare(String(a.startAt))),
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
    request: { body: object },
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
    request: { body: object },
    responses: { '201': envelope(punchResult) },
    idempotent: true,
    handler: (ctx, url, req, _params, request) => punch('out')(ctx, url, req, request.identity!),
  }),
)
