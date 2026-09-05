// Project work for staff clients: what somebody carrying issues needs on a
// phone, and nothing they cannot already see on the web.
//
// Every route here reaches Flow through `ctx.call`, never through the store.
// That is not a style preference — it is the whole reason this module can be
// this short. Membership (FLW-DEC-012) is enforced inside Flow's functions, so
// a channel built on those functions is scoped to the caller's projects for
// free, and a channel built on queries would have needed the rule written a
// second time and kept in step with the first.
//
// See FLW-DEC-019.

import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, routesOf } from '../channel_api/core.ts'
import { emptyIssueListState } from '../flow/search.ts'
import { commandRecordId } from '../flow/operations.ts'
import { ISSUE_PRIORITIES } from '../flow/types.ts'

type Req = Parameters<Route>[1]
type Row = Record<string, unknown>
type Issue = { field?: string; code?: string; params?: Record<string, unknown> }

/**
 * The id of a record a command creates — the same device `crm_staff_channel`
 * uses, for the same reason.
 *
 * A retry carries the same idempotency key, so everything the call is
 * deduplicated on has to be the same too. A fresh uuid per attempt makes the
 * second attempt look like a different request, and the key then refuses it
 * with a conflict — telling a caller its create failed when it had in fact
 * succeeded. Deriving the id from the namespace the call is already
 * deduplicated under makes a replay byte-identical, so it replays.
 */

const string = { type: 'string' }
const nullableString = { type: ['string', 'null'] }

const project = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string, key: string, name: string },
  required: ['id', 'key', 'name'],
}

const issueSummary = {
  type: 'object',
  additionalProperties: false,
  properties: {
    id: string,
    projectId: string,
    title: string,
    columnId: string,
    columnName: nullableString,
    priority: { type: 'string', enum: [...ISSUE_PRIORITIES] },
    assigneeUserId: nullableString,
    assigneeName: nullableString,
    dueDate: nullableString,
    updatedAt: string,
  },
  required: ['id', 'projectId', 'title', 'columnId', 'priority', 'updatedAt'],
}

const issueDetail = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ...issueSummary.properties,
    description: nullableString,
    epicId: nullableString,
    sprintId: nullableString,
    version: { type: 'integer' },
  },
  required: [...issueSummary.required, 'version'],
}

const page = {
  type: 'object',
  additionalProperties: false,
  properties: {
    items: { type: 'array', items: issueSummary },
    nextCursor: nullableString,
  },
  required: ['items', 'nextCursor'],
}

const projectList = {
  type: 'object',
  additionalProperties: false,
  properties: { items: { type: 'array', items: project } },
  required: ['items'],
}

const overview = {
  type: 'object',
  additionalProperties: false,
  properties: {
    projectCount: { type: 'integer' },
    total: { type: 'integer' },
    done: { type: 'integer' },
    overdue: { type: 'integer' },
    waiting: { type: 'integer' },
    working: { type: 'integer' },
    asOf: string,
  },
  required: ['projectCount', 'total', 'done', 'overdue', 'waiting', 'working', 'asOf'],
}

const envelope = (data: Row) => ({
  description: 'ok',
  content: { 'application/json': { schema: data } },
})

const text = (value: unknown): string | null => {
  const held = value == null ? '' : String(value)
  return held ? held : null
}

/** The fields a staff client is given, and deliberately not the rest of the row. */
const projectIssue = (row: Row): Row => ({
  id: String(row.id),
  projectId: String(row.projectId),
  title: String(row.title ?? ''),
  columnId: String(row.columnId ?? ''),
  columnName: text(row.columnName),
  priority: String(row.priority ?? '2'),
  assigneeUserId: text(row.assigneeUserId),
  assigneeName: text(row.assigneeName),
  dueDate: text(row.dueDate),
  updatedAt: String(row.updatedAt ?? ''),
})

const projectDetail = (row: Row): Row => ({
  ...projectIssue(row),
  description: text(row.previewText ?? row.description),
  epicId: text(row.epicId),
  sprintId: text(row.sprintId),
  version: Number(row.version ?? 0),
})

const positive = (value: unknown, fallback: number, cap: number): number => {
  const held = Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(held) && held > 0 ? Math.min(held, cap) : fallback
}

const cursorValue = (value: string | null): string | undefined => value || undefined
const cursorOf = (value: unknown): string | null => (value == null ? null : String(value))

/**
 * Not found, which is also the answer for an issue in somebody else's project.
 *
 * Flow answers `null` for both, on purpose: telling a caller that an issue
 * exists but is not theirs tells them a project is there, which is the half of
 * the answer FLW-DEC-012 spent a wave learning to withhold. The channel keeps
 * that shape rather than inventing a 403 that would give it straight back.
 */
const notFound = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'flow_staff_channel.issueNotFound', {
    messageKey: 'flow_staff_channel.error.issueNotFound',
  }),
})

/** A command Flow refused, said in the channel's words. */
const domainFailure = (ctx: ServeContext, url: URL, req: Req, result: unknown) => {
  const issues = Array.isArray((result as { errors?: unknown })?.errors)
    ? ((result as { errors: Issue[] }).errors ?? [])
    : []
  const first = issues[0] ?? {}
  // A version conflict is worth its own status: the caller's answer is to read
  // the issue again and retry, which is a different instruction from "this
  // request was wrong".
  const status = first.code === 'flow.error.notFound' ? 404 : first.code === 'flow.error.conflict' ? 409 : 422
  return {
    status,
    error: channelError(ctx, url, req, first.code ?? 'flow_staff_channel.invalidRequest', {
      messageKey: first.code ?? 'flow_staff_channel.error.invalidRequest',
      params: first.params ?? {},
      fieldErrors: Object.fromEntries(
        issues
          .filter((issue) => issue.field)
          .map((issue) => [
            String(issue.field),
            {
              code: issue.code ?? 'flow_staff_channel.invalidRequest',
              messageKey: issue.code ?? 'flow_staff_channel.error.invalidRequest',
              params: issue.params ?? {},
            },
          ]),
      ),
    }),
  }
}

/**
 * The replay key, taken from the header the way every staff channel takes it.
 *
 * Defined here rather than imported because ten channel modules each carry
 * their own copy of these ten lines. Lifting them into `channel_api` is worth
 * doing and is not this change: it would touch every one of them, and a Flow
 * PR is the wrong place to find out that one of them differed.
 */
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

const issueParams = {
  type: 'object',
  additionalProperties: false,
  properties: { id: string },
  required: ['id'],
}

/**
 * Every command body carries the version it was written against.
 *
 * A phone holds a stale issue for as long as it is in somebody's pocket, so a
 * command that did not say which version it meant would quietly overwrite work
 * done on the web in between.
 */
const commandBody = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  additionalProperties: false,
  properties: { ...properties, expectedVersion: { type: 'integer', minimum: 1 } },
  required: [...required, 'expectedVersion'],
})

type CommandRequest = { body: Row; identity: { companyId: string | null; userId: string } | null }

/** Replay protection is per company, per person, per command — never wider. */
const namespaceOf = (request: CommandRequest, fn: string): string =>
  `staff:${String(request.identity?.companyId)}:${String(request.identity?.userId)}:${fn}`

/** The issue as it now is, or not-found if the command took it out of reach. */
const after = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  id: string,
): Promise<{ data: Row } | ReturnType<typeof notFound>> => {
  const row = (await ctx.call('flow.issue.get', { id }, url, req)) as Row | null
  return row ? { data: projectDetail(row) } : notFound(ctx, url, req)
}

export const channelRoutes = routesOf(
  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'flow/overview',
    operationId: 'staff.flow.overview',
    summary: 'Read the caller’s own project workload as one aggregate.',
    auth: 'required',
    capability: { key: 'flow.work', action: 'read' },
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
      const [projects, buckets] = await Promise.all([
        ctx.call('flow.project.list', {}, url, req) as Promise<Row[]>,
        // Flow's own empty state rather than a hand-written object: the reads
        // that take one refuse a partial shape, and a copy here would drift
        // the first time a filter is added upstream.
        ctx.call(
          'flow.issue.buckets',
          { mine: true, today, listState: emptyIssueListState() },
          url,
          req,
        ) as Promise<Row>,
      ])
      return {
        data: {
          projectCount: Array.isArray(projects) ? projects.length : 0,
          total: Number(buckets.total ?? 0),
          done: Number(buckets.done ?? 0),
          overdue: Number(buckets.overdue ?? 0),
          waiting: Number(buckets.waiting ?? 0),
          working: Number(buckets.working ?? 0),
          asOf: today,
        },
      }
    },
  }),

  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'flow/projects',
    operationId: 'staff.flow.projects.list',
    summary: 'List the projects this caller is a member of.',
    auth: 'required',
    capability: { key: 'flow.work', action: 'read' },
    request: {
      query: {
        type: 'object',
        properties: { query: { type: 'string', minLength: 2 }, mine: { type: 'boolean' } },
      },
    },
    responses: { '200': envelope(projectList) },
    handler: async (ctx, url, req) => {
      const rows = (await ctx.call(
        'flow.project.list',
        {
          search: url.searchParams.get('query') || undefined,
          mine: url.searchParams.get('mine') === 'true' ? true : undefined,
        },
        url,
        req,
      )) as Row[]
      return {
        data: {
          items: (Array.isArray(rows) ? rows : []).map((row) => ({
            id: String(row.id),
            key: String(row.key ?? ''),
            name: String(row.name ?? ''),
          })),
        },
      }
    },
  }),

  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'flow/issues',
    operationId: 'staff.flow.issues.list',
    summary: 'List issues the caller may see, newest first, one page at a time.',
    auth: 'required',
    capability: { key: 'flow.work', action: 'read' },
    request: {
      query: {
        type: 'object',
        properties: {
          projectId: string,
          query: { type: 'string', minLength: 2 },
          mine: { type: 'boolean' },
          cursor: string,
          limit: { type: 'integer', minimum: 1, maximum: 50 },
        },
      },
    },
    responses: { '200': envelope(page) },
    handler: async (ctx, url, req) => {
      const search = url.searchParams.get('query')
      const result = (await ctx.call(
        'flow.issue.list',
        {
          projectId: url.searchParams.get('projectId') || undefined,
          mine: url.searchParams.get('mine') === 'true' ? true : undefined,
          cursor: cursorValue(url.searchParams.get('cursor')),
          limit: positive(url.searchParams.get('limit'), 20, 50),
          ...(search ? { listState: { ...emptyIssueListState(), q: search } } : {}),
        },
        url,
        req,
      )) as { rows?: Row[]; nextCursor?: unknown }
      const rows = Array.isArray(result.rows) ? result.rows : []
      return { data: { items: rows.map(projectIssue), nextCursor: cursorOf(result.nextCursor) } }
    },
  }),

  defineChannelRoute({
    profile: 'staff',
    method: 'GET',
    path: 'flow/issues/{id}',
    operationId: 'staff.flow.issues.get',
    summary: 'Read one issue, or answer not found when it is not the caller’s to read.',
    auth: 'required',
    capability: { key: 'flow.work', action: 'read' },
    responses: { '200': envelope(issueDetail) },
    handler: async (ctx, url, req, params) => {
      const held = (await ctx.call('flow.issue.get', { id: String(params.id) }, url, req)) as Row | null
      return held ? { data: projectDetail(held) } : notFound(ctx, url, req)
    },
  }),

  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'flow/issues/{id}/move',
    operationId: 'staff.flow.issues.move',
    summary: 'Move an issue to another column on its board.',
    auth: 'required',
    capability: { key: 'flow.work', action: 'transition' },
    request: { params: issueParams, body: commandBody({ columnId: string }, ['columnId']) },
    responses: {
      '200': envelope(issueDetail),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const id = String(params.id)
      const moved = (await ctx.call(
        'flow.issue.move',
        {
          id,
          columnId: String(request.body.columnId),
          expectedVersion: Number(request.body.expectedVersion),
          idempotencyKey: key,
        },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: namespaceOf(request, 'flow.issue.move') },
      )) as Row
      if (moved.ok !== true) return domainFailure(ctx, url, req, moved)
      return after(ctx, url, req, id)
    },
  }),

  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'flow/issues/{id}/assign',
    operationId: 'staff.flow.issues.assign',
    summary: 'Put an issue on somebody, or take it off.',
    auth: 'required',
    capability: { key: 'flow.work', action: 'assign' },
    request: {
      params: issueParams,
      body: commandBody({ assigneeUserId: nullableString }, ['assigneeUserId']),
    },
    responses: {
      '200': envelope(issueDetail),
      '404': envelope({ type: 'null' }),
      '409': envelope({ type: 'null' }),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const id = String(params.id)
      // Read first: `issue.save` writes the whole record, so the fields this
      // command does not change have to come from somewhere, and the read is
      // the membership check at the same time — Flow answers nothing for a
      // project this caller is not on.
      const held = (await ctx.call('flow.issue.get', { id }, url, req)) as Row | null
      if (!held) return notFound(ctx, url, req)
      // Flow has no assign-only command, and inventing one for the channel
      // would put a second way to write an issue beside the one the web uses.
      const saved = (await ctx.call(
        'flow.issue.save',
        {
          id,
          projectId: String(held.projectId),
          columnId: String(held.columnId),
          title: String(held.title ?? ''),
          assigneeUserId: request.body.assigneeUserId ?? null,
          expectedVersion: Number(request.body.expectedVersion),
          idempotencyKey: key,
        },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: namespaceOf(request, 'flow.issue.save') },
      )) as Row
      if (saved.ok !== true) return domainFailure(ctx, url, req, saved)
      return after(ctx, url, req, id)
    },
  }),

  defineChannelRoute({
    profile: 'staff',
    method: 'POST',
    path: 'flow/issues/{id}/comment',
    operationId: 'staff.flow.issues.comment',
    summary: 'Say something on an issue the caller can see.',
    auth: 'required',
    capability: { key: 'flow.work', action: 'comment' },
    request: {
      params: issueParams,
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { body: { type: 'string', minLength: 1 } },
        required: ['body'],
      },
    },
    responses: {
      '200': envelope({
        type: 'object',
        additionalProperties: false,
        properties: { id: string },
        required: ['id'],
      }),
      '404': envelope({ type: 'null' }),
    },
    idempotent: true,
    handler: async (ctx, url, req, params, request) => {
      const key = idempotencyKey(ctx, url, req)
      if (typeof key !== 'string') return key
      const id = String(params.id)
      if (!(await ctx.call('flow.issue.get', { id }, url, req))) return notFound(ctx, url, req)
      const commentId = commandRecordId(`flow.issue.comment:${id}`, key)
      const posted = (await ctx.call(
        'flow.issue.comment',
        { id: commentId, issueId: id, body: String(request.body.body), idempotencyKey: key },
        url,
        req,
        { idempotencyKey: key, idempotencyNamespace: namespaceOf(request, 'flow.issue.comment') },
      )) as Row
      if (posted.ok !== true) return domainFailure(ctx, url, req, posted)
      return { data: { id: commentId } }
    },
  }),
)
