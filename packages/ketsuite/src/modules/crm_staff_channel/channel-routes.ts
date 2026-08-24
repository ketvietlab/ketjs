// Read-only CRM pipeline projections for staff clients.

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, routesOf } from '../channel_api/core.ts'
import { CASE_KINDS, TERMINAL_STATES } from '../crm/types.ts'

type Req = Parameters<Route>[1]
type Row = Record<string, unknown>

const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }
const party = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, name: string },
  required: ['id', 'name'],
}
const nullableParty = { ...party, type: ['object', 'null'] }
const stage = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    name: string,
    terminalState: { type: 'string', enum: [...TERMINAL_STATES] },
  },
  required: ['id', 'name', 'terminalState'],
}
const summary = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    name: string,
    type: { type: 'string', enum: [...CASE_KINDS] },
    stage,
    customer: nullableParty,
    assignee: nullableParty,
    expectedRevenue: string,
    probability: string,
    outcome: { type: 'string', enum: ['pending', 'won', 'lost'] },
    version: { type: 'integer', minimum: 1 },
  },
  required: [
    'id',
    'name',
    'type',
    'stage',
    'customer',
    'assignee',
    'expectedRevenue',
    'probability',
    'outcome',
    'version',
  ],
}
const nextActivity = {
  type: ['object', 'null'],
  additionalProperties: false,
  properties: {
    id: string,
    type: party,
    summary: string,
    dueDate: string,
  },
  required: ['id', 'type', 'summary', 'dueDate'],
}
const detail = {
  ...summary,
  properties: {
    ...summary.properties,
    priority: string,
    expectedClosing: nullableString,
    description: nullableString,
    nextActivity,
    readOnly: { type: 'boolean', const: true },
  },
  required: [...summary.required, 'priority', 'expectedClosing', 'description', 'nextActivity', 'readOnly'],
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
const cursorValue = (cursor: string | null): string => {
  if (!cursor) return '0'
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      offset?: unknown
    }
    return Number.isInteger(parsed.offset) && Number(parsed.offset) >= 0 ? String(parsed.offset) : '0'
  } catch {
    return '0'
  }
}
const cursorOf = (cursor: unknown): string | null => {
  if (cursor == null || cursor === '') return null
  const offset = Number(cursor)
  return Number.isInteger(offset) && offset >= 0
    ? Buffer.from(JSON.stringify({ offset })).toString('base64url')
    : null
}

const outcomeOf = (row: Row): string => {
  if (row.terminalState === 'won') return 'won'
  if (row.terminalState === 'lost') return 'lost'
  return 'pending'
}
const projectSummary = (row: Row) => ({
  id: String(row.id),
  name: String(row.name),
  type: String(row.kind),
  stage: {
    id: String(row.stageId),
    name: String(row.stageName ?? row.stageId),
    terminalState: String(row.terminalState),
  },
  customer:
    row.partnerId == null
      ? null
      : { id: String(row.partnerId), name: String(row.partnerName ?? row.partnerId) },
  assignee:
    row.assigneeUserId == null
      ? null
      : { id: String(row.assigneeUserId), name: String(row.assigneeName ?? row.assigneeUserId) },
  expectedRevenue: String(row.expectedRevenue ?? '0'),
  probability: String(row.probability ?? '0'),
  outcome: outcomeOf(row),
  version: Number(row.version),
})

const pendingActivityOf = async (ctx: ServeContext, row: Row, url: URL, req: Req) => {
  const activities = (Array.isArray(row.activities) ? (row.activities as Row[]) : [])
    .filter((activity) => activity.active !== false && activity.doneAt == null && activity.canceledAt == null)
    .sort(
      (left, right) =>
        String(left.dueDate).localeCompare(String(right.dueDate)) ||
        String(left.id).localeCompare(String(right.id)),
    )
  const activity = activities[0]
  if (!activity) return null
  const types = (await ctx.call('activity.listTypes', {}, url, req)) as Row[]
  const type = types.find((candidate) => String(candidate.id) === String(activity.typeId))
  return {
    id: String(activity.id),
    type: { id: String(activity.typeId), name: String(type?.name ?? activity.typeId) },
    summary: String(activity.summary),
    dueDate: String(activity.dueDate),
  }
}

const notFound = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'crm_staff_channel.leadNotFound', {
    messageKey: 'crm_staff_channel.error.leadNotFound',
  }),
})

export const channelRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'crm/leads',
    operationId: 'staff.crm.leads.list',
    summary: 'List actor-visible CRM leads and opportunities without mutation actions.',
    auth: 'required',
    capability: { key: 'crm.pipeline', action: 'read' },
    request: {
      query: {
        type: 'object',
        additionalProperties: false,
        properties: {
          query: { type: 'string', minLength: 2 },
          type: { type: 'string', enum: [...CASE_KINDS] },
          outcome: { type: 'string', enum: ['pending', 'won', 'lost'] },
          cursor: string,
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
    },
    responses: { '200': envelope(page) },
    handler: async (ctx, url, req) => {
      const limit = positive(url.searchParams.get('limit'), 20, 50)
      const outcome = url.searchParams.get('outcome')
      const result = (await ctx.call(
        'crm.case.list',
        {
          search: url.searchParams.get('query') || undefined,
          kind: url.searchParams.get('type') || undefined,
          terminalState: outcome === 'pending' ? 'open' : outcome || undefined,
          cursor: cursorValue(url.searchParams.get('cursor')),
          limit,
        },
        url,
        req,
      )) as { rows?: Row[]; nextCursor?: unknown }
      const rows = Array.isArray(result.rows) ? result.rows : []
      return {
        data: {
          items: rows.map(projectSummary),
          nextCursor: cursorOf(result.nextCursor),
        },
      }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'crm/leads/{id}',
    operationId: 'staff.crm.leads.get',
    summary: 'Read one actor-visible CRM record without exposing a writable aggregate.',
    auth: 'required',
    capability: { key: 'crm.pipeline', action: 'read' },
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
      const row = (await ctx.call('crm.case.get', { id: params.id }, url, req)) as Row | null
      if (!row) return notFound(ctx, url, req)
      return {
        data: {
          ...projectSummary(row),
          priority: String(row.priority),
          expectedClosing: row.expectedClosing == null ? null : String(row.expectedClosing),
          description: row.description == null ? null : String(row.description),
          nextActivity: await pendingActivityOf(ctx, row, url, req),
          readOnly: true,
        },
      }
    },
  }),
)
