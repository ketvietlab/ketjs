// Staff notification inbox facade.
//
// Mail owns recipient isolation and read markers. Navigation destinations are
// derived only from known public thread targets; unknown and private targets stay
// readable but cannot turn notification data into an arbitrary client route.

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, routesOf } from '../channel_api/core.ts'

type Req = Parameters<Route>[1]
type Row = Record<string, unknown>

const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }
const destination = {
  type: 'object',
  additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['sales_order', 'warehouse_picking'] },
    id: string,
  },
  required: ['kind', 'id'],
}
const item = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    eventType: string,
    title: string,
    body: string,
    createdAt: string,
    readAt: nullableString,
    destination,
  },
  required: ['id', 'eventType', 'title', 'body', 'createdAt', 'readAt'],
}
const page = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: { type: 'array', items: item },
    total: { type: 'integer', minimum: 0 },
    page: { type: 'integer', minimum: 1 },
    pageSize: { type: 'integer', minimum: 1, maximum: 100 },
    unreadCount: { type: 'integer', minimum: 0 },
  },
  required: ['items', 'total', 'page', 'pageSize', 'unreadCount'],
}
const count = {
  type: 'object',
  additionalProperties: false,
  properties: { count: { type: 'integer', minimum: 0 } },
  required: ['count'],
}
const marked = {
  type: 'object',
  additionalProperties: false,
  properties: { ok: { type: 'boolean', const: true }, count: { type: 'integer', minimum: 0 } },
  required: ['ok', 'count'],
}
const envelope = (data: unknown) => ({
  type: 'object',
  properties: { data, error: {}, meta: { type: 'object' } },
})

const positive = (value: string | null, fallback: number, maximum: number): number => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? Math.min(number, maximum) : fallback
}
const boolean = (value: string | null): boolean => value === 'true'

const destinationOf = (row: Row): { kind: string; id: string } | null => {
  const id = row.targetId == null ? '' : String(row.targetId)
  if (!id) return null
  if (row.targetModel === 'sale.Order') return { kind: 'sales_order', id }
  if (row.targetModel === 'stock.Picking') return { kind: 'warehouse_picking', id }
  return null
}
const project = (row: Row) => {
  const target = destinationOf(row)
  return {
    id: String(row.id),
    eventType: `mail.${String(row.kind)}`,
    title: String(row.subject ?? row.targetName ?? row.kind),
    body: String(row.body),
    createdAt: String(row.createdAt),
    readAt: row.readAt == null ? null : String(row.readAt),
    ...(target ? { destination: target } : {}),
  }
}

const notFound = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'mail_staff_channel.notificationNotFound', {
    messageKey: 'mail_staff_channel.error.notificationNotFound',
  }),
})

export const channelRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'notifications',
    operationId: 'staff.notifications.list',
    summary: 'List the signed-in staff member’s notifications.',
    auth: 'required',
    capability: { key: 'mail.notifications', action: 'read' },
    request: {
      query: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1 },
          pageSize: { type: 'integer', minimum: 1, maximum: 100 },
          unreadOnly: { type: 'boolean' },
        },
      },
    },
    responses: { '200': envelope(page) },
    handler: async (ctx, url, req) => {
      const pageNumber = positive(url.searchParams.get('page'), 1, 1_000_000)
      const pageSize = positive(url.searchParams.get('pageSize'), 20, 100)
      const unreadOnly = boolean(url.searchParams.get('unreadOnly'))
      const [rows, total, unread] = (await Promise.all([
        ctx.call(
          'mail.listInbox',
          { unreadOnly, limit: pageSize, offset: (pageNumber - 1) * pageSize },
          url,
          req,
        ),
        ctx.call('mail.countInbox', { unreadOnly }, url, req),
        ctx.call('mail.countUnread', {}, url, req),
      ])) as [Row[], { count: number }, { count: number }]
      return {
        data: {
          items: rows.map(project),
          total: total.count,
          page: pageNumber,
          pageSize,
          unreadCount: unread.count,
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'notifications/unread-count',
    operationId: 'staff.notifications.unreadCount',
    summary: 'Count unread notifications for the signed-in staff member.',
    auth: 'required',
    capability: { key: 'mail.notifications', action: 'read' },
    responses: { '200': envelope(count) },
    handler: async (ctx, url, req) => ({ data: await ctx.call('mail.countUnread', {}, url, req) }),
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'PATCH',
    path: 'notifications/{id}/read',
    operationId: 'staff.notifications.markRead',
    summary: 'Mark one actor-owned notification as read.',
    auth: 'required',
    capability: { key: 'mail.notifications', action: 'read' },
    request: {
      params: {
        type: 'object',
        additionalProperties: false,
        properties: { id: string },
        required: ['id'],
      },
    },
    responses: { '200': envelope(marked), '404': envelope({ type: 'null' }) },
    handler: async (ctx, url, req, params) => {
      try {
        await ctx.call('mail.markInboxRead', { id: params.id, readAt: new Date().toISOString() }, url, req)
        return { data: { ok: true, count: 1 } }
      } catch (error) {
        if ((error as { code?: unknown }).code === 'E_MAIL_NOTIFICATION_NOT_FOUND')
          return notFound(ctx, url, req)
        throw error
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'notifications/read-all',
    operationId: 'staff.notifications.markAllRead',
    summary: 'Mark every currently unread actor-owned notification as read.',
    auth: 'required',
    capability: { key: 'mail.notifications', action: 'read' },
    responses: { '200': envelope(marked) },
    handler: async (ctx, url, req) => {
      const result = (await ctx.call(
        'mail.markAllInboxRead',
        { readAt: new Date().toISOString() },
        url,
        req,
      )) as { ok: boolean; count: number }
      return { data: { ok: true, count: result.count } }
    },
  }),
)
