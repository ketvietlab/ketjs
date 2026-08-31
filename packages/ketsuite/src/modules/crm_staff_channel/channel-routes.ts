// CRM pipeline projections and explicit commands for staff clients.

import { createHash } from 'node:crypto'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, routesOf } from '../channel_api/core.ts'
import { CASE_KINDS, TERMINAL_STATES } from '../crm/types.ts'

type Req = Parameters<Route>[1]
type Row = Record<string, unknown>
type Issue = { field?: string; code?: string; params?: Record<string, unknown> }

/**
 * The id of a record a command creates.
 *
 * A retry carries the same idempotency key, so everything the call is
 * deduplicated on has to be the same too. A fresh uuid per attempt made the
 * second attempt look like a different request, and the key refused it with a
 * conflict — telling a caller its create failed when it had in fact succeeded,
 * which is the opposite of what an idempotency key is for. Worse, the natural
 * answer to that conflict is to retry under a new key, and that is how the
 * duplicate the key exists to prevent finally gets written.
 *
 * Deriving the id from the namespace the call is already deduplicated under
 * makes a replay byte-identical, so it replays.
 */
const commandId = (namespace: string, key: string): string => {
  const hex = createHash('sha256').update(`${namespace}\n${key}`).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * The channel says `pending` where the domain says `open`; the rest of the
 * vocabulary is the domain's. Spelling the list out by hand meant a terminal
 * state added upstream would report itself as `pending` — wrong, and quiet.
 * Derived, a new state travels into the published enum and out of the projection
 * together.
 */
const OUTCOMES = TERMINAL_STATES.map((state) => (state === 'open' ? 'pending' : state))
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
    outcome: { type: 'string', enum: [...OUTCOMES] },
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
const mobileStage = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, name: string, isWon: { type: 'boolean' } },
  required: ['id', 'name', 'isWon'],
}
const activityTypeOption = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    name: string,
    minimumDueDate: string,
    suggestedDueDate: string,
    maximumDueDate: string,
  },
  required: ['id', 'name', 'minimumDueDate', 'suggestedDueDate', 'maximumDueDate'],
}
const workflowActions = [
  'transition',
  'assign',
  'schedule_activity',
  'complete_activity',
  'mark_won',
  'mark_lost',
]
const detail = {
  ...summary,
  properties: {
    ...summary.properties,
    priority: string,
    expectedClosing: nullableString,
    description: nullableString,
    nextActivity,
    activityDeadline: nullableString,
    activityTypeOptions: { type: 'array', items: activityTypeOption },
    assigneeOptions: { type: 'array', items: party },
    lossReasonOptions: { type: 'array', items: party },
    stageOptions: { type: 'array', items: mobileStage },
    workflowActions: {
      type: 'array',
      items: { type: 'string', enum: workflowActions },
    },
    readOnly: { type: 'boolean', const: true },
  },
  required: [
    ...summary.required,
    'priority',
    'expectedClosing',
    'description',
    'nextActivity',
    'activityDeadline',
    'activityTypeOptions',
    'assigneeOptions',
    'lossReasonOptions',
    'stageOptions',
    'workflowActions',
    'readOnly',
  ],
}
const page = {
  type: 'object',
  additionalProperties: false,
  properties: { items: { type: 'array', items: summary }, nextCursor: nullableString },
  required: ['items', 'nextCursor'],
}
const overview = {
  type: 'object',
  additionalProperties: false,
  properties: {
    leadCount: { type: 'integer', minimum: 0 },
    opportunityCount: { type: 'integer', minimum: 0 },
    openOpportunityCount: { type: 'integer', minimum: 0 },
    overdueActivityCount: { type: 'integer', minimum: 0 },
    expectedRevenue: string,
    asOf: { type: 'string', format: 'date' },
  },
  required: [
    'leadCount',
    'opportunityCount',
    'openOpportunityCount',
    'overdueActivityCount',
    'expectedRevenue',
    'asOf',
  ],
}
const mutation = {
  type: 'object',
  additionalProperties: false,
  properties: {
    outcome: {
      type: 'string',
      enum: [
        'created',
        'transitioned',
        'assigned',
        'activity_scheduled',
        'activity_completed',
        'won',
        'lost',
      ],
    },
    lead: detail,
  },
  required: ['outcome', 'lead'],
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
  const state = String(row.terminalState)
  return state === 'open' ? 'pending' : state
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

const domainFailure = (ctx: ServeContext, url: URL, req: Req, result: unknown) => {
  const issues = Array.isArray((result as { errors?: unknown })?.errors)
    ? ((result as { errors: Issue[] }).errors ?? [])
    : []
  const first = issues[0] ?? {}
  const messageKey = first.code ?? 'crm_staff_channel.error.invalidRequest'
  const status =
    first.code === 'crm.error.notFound' ? 404 : first.code === 'crm.error.stageConflict' ? 409 : 422
  return {
    status,
    error: channelError(ctx, url, req, first.code ?? 'crm_staff_channel.invalidRequest', {
      messageKey,
      params: first.params ?? {},
      fieldErrors: Object.fromEntries(
        issues
          .filter((issue) => issue.field)
          .map((issue) => [
            String(issue.field),
            {
              code: issue.code ?? 'crm_staff_channel.invalidRequest',
              messageKey: issue.code ?? messageKey,
              params: issue.params ?? {},
            },
          ]),
      ),
    }),
  }
}

const idempotencyKey = (ctx: ServeContext, url: URL, req: Req): string | ReturnType<typeof domainFailure> => {
  const key = String(req.headers['idempotency-key'] ?? '').trim()
  if (key.length >= 8 && key.length <= 200) return key
  return {
    status: 400,
    error: channelError(ctx, url, req, 'channel_api.idempotencyRequired', {
      messageKey: 'channel_api.error.idempotencyRequired',
    }),
  }
}

const dateOffset = (base: string, days: number): string => {
  const value = new Date(`${base}T00:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
}

const projectDetail = async (ctx: ServeContext, row: Row, url: URL, req: Req) => {
  const today = new Date().toISOString().slice(0, 10)
  const [nextActivityValue, activityTypes] = await Promise.all([
    pendingActivityOf(ctx, row, url, req),
    ctx.call('activity.listTypes', {}, url, req) as Promise<Row[]>,
  ])
  const pending = outcomeOf(row) === 'pending'
  const actions = pending
    ? [
        'transition',
        'assign',
        'schedule_activity',
        ...(nextActivityValue ? ['complete_activity'] : []),
        ...(row.kind === 'opportunity' ? ['mark_won', 'mark_lost'] : []),
      ]
    : []
  return {
    ...projectSummary(row),
    priority: String(row.priority),
    expectedClosing: row.expectedClosing == null ? null : String(row.expectedClosing),
    description: row.description == null ? null : String(row.description),
    nextActivity: nextActivityValue,
    activityDeadline: nextActivityValue?.dueDate ?? null,
    activityTypeOptions: activityTypes
      .filter((type) => type.active !== false)
      .map((type) => ({
        id: String(type.id),
        name: String(type.name),
        minimumDueDate: today,
        suggestedDueDate: dateOffset(today, Number(type.defaultDelayDays ?? 0)),
        maximumDueDate: dateOffset(today, 90),
      })),
    assigneeOptions: Array.isArray(row.assigneeOptions)
      ? (row.assigneeOptions as Row[]).map((assignee) => ({
          id: String(assignee.id),
          name: String(assignee.name),
        }))
      : [],
    lossReasonOptions: [
      { id: 'budget', name: 'Budget' },
      { id: 'timing', name: 'Timing' },
      { id: 'competitor', name: 'Competitor' },
      { id: 'unreachable', name: 'Unreachable' },
      { id: 'other', name: 'Other' },
    ],
    stageOptions: Array.isArray(row.stageOptions)
      ? (row.stageOptions as Row[]).map((stage) => ({
          id: String(stage.id),
          name: String(stage.name),
          isWon: stage.terminalState === 'won',
        }))
      : [],
    workflowActions: actions,
    // This remains a narrow projection: writes are explicit commands below, not a
    // promise that an arbitrary edited detail object can be saved back.
    readOnly: true,
  }
}

const mutate =
  (
    fn: 'crm.case.move' | 'crm.case.assign' | 'crm.case.markWon' | 'crm.case.markLost',
    outcome: 'transitioned' | 'assigned' | 'won' | 'lost',
    input: (body: Record<string, unknown>, id: string) => Record<string, unknown>,
  ) =>
  async (
    ctx: ServeContext,
    url: URL,
    req: Req,
    params: Record<string, string>,
    request: { body: Row; identity: { companyId: string | null; userId: string } | null },
  ) => {
    const key = idempotencyKey(ctx, url, req)
    if (typeof key !== 'string') return key
    const identity = request.identity!
    const result = (await ctx.call(fn, { ...input(request.body, params.id), idempotencyKey: key }, url, req, {
      idempotencyKey: key,
      idempotencyNamespace: `staff:${String(identity.companyId)}:${identity.userId}:${fn}`,
    })) as { ok?: boolean; version?: unknown }
    if (!result.ok) return domainFailure(ctx, url, req, result)
    const row = (await ctx.call('crm.case.get', { id: params.id }, url, req)) as Row | null
    if (!row) return notFound(ctx, url, req)
    return {
      data: { outcome, lead: await projectDetail(ctx, row, url, req) },
      headers: { etag: `"${String(result.version ?? row.version)}"` },
    }
  }

const commandBody = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  additionalProperties: false,
  properties: {
    ...properties,
    expectedVersion: { type: 'integer', minimum: 1 },
  },
  required: [...required, 'expectedVersion'],
})

const leadParams = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string },
  required: ['id'],
}

const currentLead = async (ctx: ServeContext, url: URL, req: Req, id: string) =>
  (await ctx.call('crm.case.get', { id }, url, req)) as Row | null

const versionFailure = (ctx: ServeContext, url: URL, req: Req, row: Row) =>
  domainFailure(ctx, url, req, {
    errors: [
      {
        field: 'expectedVersion',
        code: 'crm.error.stageConflict',
        params: { current: row.version },
      },
    ],
  })

const refreshedMutation = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  id: string,
  outcome: 'created' | 'activity_scheduled' | 'activity_completed',
) => {
  const row = await currentLead(ctx, url, req, id)
  if (!row) return notFound(ctx, url, req)
  return {
    data: { outcome, lead: await projectDetail(ctx, row, url, req) },
    headers: { etag: `"${String(row.version)}"` },
  }
}

export const channelRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'crm/overview',
    operationId: 'staff.crm.overview',
    summary: 'Read an exact actor-visible CRM pipeline and overdue-activity aggregate.',
    auth: 'required',
    capability: { key: 'crm.pipeline', action: 'read' },
    request: {
      query: {
        type: 'object',
        additionalProperties: false,
        properties: { today: { type: 'string', format: 'date' } },
        required: ['today'],
      },
    },
    responses: { '200': envelope(overview) },
    handler: async (ctx, url, req) => {
      const today = String(url.searchParams.get('today'))
      const data = (await ctx.call('crm.overview', { today }, url, req)) as Row
      return { data: { ...data, asOf: today } }
    },
  }),
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
        properties: {
          query: { type: 'string', minLength: 2 },
          type: { type: 'string', enum: [...CASE_KINDS] },
          outcome: { type: 'string', enum: [...OUTCOMES] },
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
    method: 'POST',
    path: 'crm/leads/create',
    operationId: 'staff.crm.leads.create',
    summary: 'Create a lead or opportunity owned by the authenticated staff actor.',
    auth: 'required',
    capability: { key: 'crm.pipeline', action: 'create' },
    request: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          type: { type: 'string', enum: [...CASE_KINDS] },
          partnerId: string,
          expectedRevenue: { type: 'string', pattern: '^\\d+(?:\\.\\d+)?$' },
        },
        required: ['name', 'type', 'expectedRevenue'],
      },
    },
    responses: { '200': envelope(mutation) },
    idempotent: true,
    handler: async (ctx, url, req, _params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const identity = request.identity!
      const namespace = `staff:${String(identity.companyId)}:${identity.userId}:crm.case.save`
      const id = commandId(namespace, key)
      const result = (await ctx.call(
        'crm.case.save',
        {
          id,
          kind: request.body.type,
          name: request.body.name,
          partnerId: request.body.partnerId,
          expectedRevenue: request.body.expectedRevenue,
          idempotencyKey: key,
        },
        url,
        req,
        {
          idempotencyKey: key,
          idempotencyNamespace: namespace,
        },
      )) as { ok?: boolean; id?: unknown }
      if (!result.ok) return domainFailure(ctx, url, req, result)
      return refreshedMutation(ctx, url, req, String(result.id ?? id), 'created')
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
      return { data: await projectDetail(ctx, row, url, req) }
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'crm/leads/{id}/transition',
    operationId: 'staff.crm.leads.transition',
    summary: 'Move an actor-visible CRM record with optimistic concurrency and replay protection.',
    auth: 'required',
    capability: { key: 'crm.pipeline', action: 'transition' },
    request: {
      params: leadParams,
      body: commandBody({ stageId: string }, ['stageId']),
    },
    responses: {
      '200': envelope(mutation),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    idempotent: true,
    handler: mutate('crm.case.move', 'transitioned', (body, id) => ({
      id,
      stageId: body.stageId,
      expectedVersion: body.expectedVersion,
    })),
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'crm/leads/{id}/assign',
    operationId: 'staff.crm.leads.assign',
    summary: 'Assign an actor-visible CRM record inside its current team.',
    auth: 'required',
    capability: { key: 'crm.pipeline', action: 'assign' },
    request: {
      params: leadParams,
      body: commandBody({ assigneeUserId: string }, ['assigneeUserId']),
    },
    responses: {
      '200': envelope(mutation),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    idempotent: true,
    handler: mutate('crm.case.assign', 'assigned', (body, id) => ({
      id,
      assigneeUserId: body.assigneeUserId,
      expectedVersion: body.expectedVersion,
    })),
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'crm/leads/{id}/won',
    operationId: 'staff.crm.leads.markWon',
    summary: 'Move an actor-visible opportunity to the canonical won stage.',
    auth: 'required',
    capability: { key: 'crm.pipeline', action: 'mark_won' },
    request: { params: leadParams, body: commandBody({}, []) },
    responses: {
      '200': envelope(mutation),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    idempotent: true,
    handler: mutate('crm.case.markWon', 'won', (body, id) => ({
      id,
      expectedVersion: body.expectedVersion,
    })),
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'crm/leads/{id}/lost',
    operationId: 'staff.crm.leads.markLost',
    summary: 'Move an actor-visible opportunity to the canonical lost stage.',
    auth: 'required',
    capability: { key: 'crm.pipeline', action: 'mark_lost' },
    request: {
      params: leadParams,
      body: commandBody({ lostReason: { type: 'string', minLength: 1, maxLength: 500 } }, ['lostReason']),
    },
    responses: {
      '200': envelope(mutation),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    idempotent: true,
    handler: mutate('crm.case.markLost', 'lost', (body, id) => ({
      id,
      lostReason: body.lostReason,
      expectedVersion: body.expectedVersion,
    })),
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'crm/leads/{id}/activities',
    operationId: 'staff.crm.leads.scheduleActivity',
    summary: 'Schedule the next CRM activity against a current lead version.',
    auth: 'required',
    capability: { key: 'crm.pipeline', action: 'schedule_activity' },
    request: {
      params: leadParams,
      body: commandBody(
        {
          activityTypeId: string,
          dueDate: { type: 'string', format: 'date' },
          note: { type: 'string', maxLength: 2000 },
        },
        ['activityTypeId', 'dueDate'],
      ),
    },
    responses: {
      '200': envelope(mutation),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const row = await currentLead(ctx, url, req, params.id)
      if (!row) return notFound(ctx, url, req)
      if (Number(row.version) !== Number(request.body.expectedVersion))
        return versionFailure(ctx, url, req, row)
      const types = (await ctx.call('activity.listTypes', {}, url, req)) as Row[]
      const type = types.find((candidate) => String(candidate.id) === String(request.body.activityTypeId))
      if (!type)
        return domainFailure(ctx, url, req, {
          errors: [{ field: 'activityTypeId', code: 'crm.error.notFound' }],
        })
      const identity = request.identity!
      const result = (await ctx.call(
        'crm.activity.schedule',
        {
          id: commandId(`staff:${String(identity.companyId)}:${identity.userId}:crm.activity.schedule`, key),
          caseId: params.id,
          typeId: request.body.activityTypeId,
          summary: type.name,
          note: request.body.note,
          dueDate: request.body.dueDate,
          idempotencyKey: key,
        },
        url,
        req,
        {
          idempotencyKey: key,
          idempotencyNamespace: `staff:${String(identity.companyId)}:${identity.userId}:crm.activity.schedule`,
        },
      )) as { ok?: boolean }
      if (!result.ok) return domainFailure(ctx, url, req, result)
      return refreshedMutation(ctx, url, req, params.id, 'activity_scheduled')
    },
  }),
  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'crm/leads/{id}/activities/{activityId}/complete',
    operationId: 'staff.crm.leads.completeActivity',
    summary: 'Complete one pending activity owned by the actor-visible CRM record.',
    auth: 'required',
    capability: { key: 'crm.pipeline', action: 'complete_activity' },
    request: {
      params: {
        type: 'object',
        additionalProperties: false,
        properties: { id: string, activityId: string },
        required: ['id', 'activityId'],
      },
      body: commandBody(
        {
          completedDate: { type: 'string', format: 'date' },
          feedback: { type: 'string', maxLength: 2000 },
        },
        ['completedDate'],
      ),
    },
    responses: {
      '200': envelope(mutation),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const row = await currentLead(ctx, url, req, params.id)
      if (!row) return notFound(ctx, url, req)
      if (Number(row.version) !== Number(request.body.expectedVersion))
        return versionFailure(ctx, url, req, row)
      const belongsToLead = (Array.isArray(row.activities) ? (row.activities as Row[]) : []).some(
        (activity) => String(activity.id) === params.activityId,
      )
      if (!belongsToLead) return notFound(ctx, url, req)
      const identity = request.identity!
      const result = (await ctx.call(
        'crm.activity.complete',
        {
          id: params.activityId,
          feedback: request.body.feedback,
          completedDate: request.body.completedDate,
          idempotencyKey: key,
        },
        url,
        req,
        {
          idempotencyKey: key,
          idempotencyNamespace: `staff:${String(identity.companyId)}:${identity.userId}:crm.activity.complete`,
        },
      )) as { ok?: boolean }
      if (!result.ok) return domainFailure(ctx, url, req, result)
      return refreshedMutation(ctx, url, req, params.id, 'activity_completed')
    },
  }),
)
