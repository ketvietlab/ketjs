import { createHash, randomUUID } from 'node:crypto'
import { encodeListState, json, parseListState, streamed, table, text, withHeaders } from '@ketvietlab/ketjs'
import type { IncomingMessage } from 'node:http'
import type { ListState, Row, Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { ISSUE_PRIORITIES } from '../flow/types.ts'
import { emptyIssueListState, issueListSearch } from '../flow/search.ts'
import { adminPage, inLocale, resultErrors } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'
import type { FormField } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { assigneeControl, epicControl, issueControl, tagsControl } from './relation-control.ts'
import {
  keepForListSearch,
  LIST_PAGE_SIZE,
  listFacets,
  listMenus,
  loadListGroups,
} from '../backend/list-search.ts'
import {
  boardScreen,
  epicsScreen,
  issueDetailScreen,
  issuesScreen,
  mapScreen,
  myWorkScreen,
  projectsScreen,
  settingsScreen,
  sprintsScreen,
  TEMPLATE_OPTIONS,
} from './screens.tsx'
import type { IssueDetailControls } from './screens.tsx'
import {
  applySnapshot,
  currentGeneration,
  getOrCreateLive,
  isLive,
  previewTextOf,
  publishPresence,
  publishUpdate,
  rollGeneration,
  snapshotBytes,
  tailTopic,
  topicBelongsTo,
  topicFor,
} from './sync.ts'

type Translator = ReturnType<ServeContext['translate']>

/** Column-name presets offered when creating a project — the "Custom" option types its own list. */
const COLUMN_TEMPLATES: Record<string, string[]> = {
  simple: ['To do', 'Done'],
  kanban: ['To do', 'In Progress', 'Done'],
  scrum: ['Backlog', 'To do', 'In Progress', 'Review', 'Done'],
}

const slugify = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'col'

/** The project behind the id in the URL, or null when the caller may not read it. */
async function projectOf(ctx: ServeContext, url: URL, req: Req, id: string): Promise<AnyRow | null> {
  try {
    return (await ctx.call('flow.project.get', { id }, url, req)) as AnyRow | null
  } catch {
    return null
  }
}

const errorsOf = (result: unknown, _: Translator): string[] =>
  resultErrors(result, _, 'flow_backend.error.invalid')

/**
 * The backlog list, narrowed to one reference field.
 *
 * `parseListState` reads filters from `filter` params carrying encoded rule
 * nodes — there is no `f.<key>=` convention anywhere in the framework, so the
 * board's "load more" and the epic cards, which both linked with one, landed
 * on the unfiltered project list instead. `encodeListState` writes the form
 * the parser on the other end actually reads.
 */
const issuesFilteredBy = (projectId: string, field: string, value: string): string =>
  encodeListState(
    { ...emptyIssueListState(), filters: [{ kind: 'rule', field, operator: 'equals', value }] },
    `/admin/flow/projects/${encodeURIComponent(projectId)}/issues`,
  )

const pager = (url: URL, state: ListState, rows: number, total: number) => {
  const link = (target: number) => encodeListState({ ...state, page: target }, url)
  const from = rows ? (state.page - 1) * LIST_PAGE_SIZE + 1 : 0
  const to = Math.min(state.page * LIST_PAGE_SIZE, total)
  return {
    from,
    to,
    total,
    prev: state.page > 1 ? link(state.page - 1) : null,
    next: to < total ? link(state.page + 1) : null,
  }
}

const issueFields = (_: Translator, row: AnyRow, controls: IssueDetailControls): FormField[] => [
  { name: 'title', label: _('flow_backend.field.title'), value: String(row.title ?? ''), required: true },
  {
    name: 'priority',
    label: _('flow_backend.field.priority'),
    type: 'select',
    value: String(row.priority ?? 'normal'),
    options: ISSUE_PRIORITIES.map((value) => ({
      value,
      label: _.resolves(`flow.priority.${value}`) ? _(`flow.priority.${value}`) : value,
    })),
  },
  { name: 'assigneeUserId', label: _('flow_backend.field.assignee'), control: controls.assignee },
  { name: 'epicId', label: _('flow_backend.field.epic'), control: controls.epic },
  { name: 'tagIds', label: _('flow_backend.field.tags'), control: controls.tags },
  { name: 'dueDate', label: _('flow_backend.field.dueDate'), type: 'date', value: String(row.dueDate ?? '') },
  {
    name: 'estimate',
    label: _('flow_backend.field.estimate'),
    type: 'decimal',
    value: row.estimate != null ? String(row.estimate) : '',
  },
]

const encoder = new TextEncoder()
const MAX_BODY_BYTES = 2 * 1024 * 1024

/**
 * The two things every mutating route here has to establish before it reads a
 * form or body. The admin authenticates with a session cookie, so a POST
 * arriving from another origin carries the signed-in user's credentials
 * without their intent. Direct copy of crm_backend/routes.ts's guard — every
 * other `_backend` module's mutating routes already carry this, `flow_backend`
 * (`/push`, `/leave`) was the one that didn't yet.
 */
const crossSite = (req: IncomingMessage): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}
const refusePost = (req: IncomingMessage) =>
  req.method === 'POST' && crossSite(req) ? text('Forbidden', { status: 403 }) : null
const onlyPost = (req: IncomingMessage) =>
  req.method !== 'POST'
    ? text('POST', { status: 405 })
    : crossSite(req)
      ? text('Forbidden', { status: 403 })
      : null

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.byteLength
    if (size > MAX_BODY_BYTES) throw new Error('request body too large')
    chunks.push(chunk)
  }
  if (!size) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const singleChunk = async function* (bytes: Uint8Array) {
  yield bytes
}

const permitted = async (
  ctx: ServeContext,
  fn: string,
  url: URL,
  req: IncomingMessage,
  issueId: string,
): Promise<Record<string, unknown> | null> => {
  try {
    return (await ctx.call(fn, { id: issueId }, url, req)) as Record<string, unknown> | null
  } catch {
    return null
  }
}

/** True once the caller has passed a read permission check for this issue. */
const readable = (ctx: ServeContext, url: URL, req: IncomingMessage, issueId: string) =>
  permitted(ctx, 'flow.issue.get', url, req, issueId)

/**
 * The same check for the routes that *change* the description.
 *
 * `/push` rewrites an issue's description and `/leave` persists that rewrite,
 * so gating them on `flow.issue.get` made the description the one piece of
 * Flow data whose write path was granted by a read permission: a role holding
 * only `flow.issue.get` and `flow.issue.list` could POST over any issue's
 * text. Permissions here are per-function-key (modules/user/roles.ts), so the
 * fix is a separate key an administrator grants deliberately.
 */
const writable = (ctx: ServeContext, url: URL, req: IncomingMessage, issueId: string) =>
  permitted(ctx, 'flow.issue.editDescription', url, req, issueId)

/**
 * Loads the durable snapshot into the live doc on first access.
 *
 * Every route that reads or writes the document calls this first. It used to
 * hang off `/content` alone, which meant a `/push` or a `/leave` arriving at a
 * process that had never opened the issue — after a restart, or from a plain
 * `curl` — worked against a blank document and then persisted it.
 *
 * Returns false when the durable snapshot could not be read, so a caller that
 * is about to overwrite it can decline instead.
 */
async function hydrate(
  ctx: ServeContext,
  url: URL,
  req: IncomingMessage,
  companyId: string,
  issueId: string,
  contentAttachmentId: unknown,
): Promise<boolean> {
  const { isNew } = getOrCreateLive(companyId, issueId)
  if (!isNew) return true
  // Unchecked, like `commitContent` in `flatten` below and for the same
  // reason: these are `exposure: 'internal'` helpers of a route that has
  // already run its own permission check, and `ctx.call` would ask for a
  // second grant nobody has any reason to hold. It used to be a checked call,
  // and it worked only because the line above usually returns first — a
  // reader-role viewer opening an issue this process had not already loaded
  // got `E_FN_NOT_PERMITTED` for a function they never named.
  const resolved = (await ctx.callUnchecked(
    'flow_backend.sync.resolveSnapshotKey',
    { attachmentId: contentAttachmentId },
    url,
    req,
  )) as { storeKey: string | null }
  // No stored snapshot is a genuine empty description, not a failure to read one.
  if (!resolved.storeKey) return true
  const storage = await ctx.storageOf(url, req)
  const found = await storage.get(resolved.storeKey)
  if (!found) return false
  const chunks: Uint8Array[] = []
  for await (const chunk of found.body) chunks.push(chunk)
  applySnapshot(companyId, issueId, Buffer.concat(chunks))
  return true
}

/** Flattens the live doc, writes the bytes, and records the result — then rolls the topic. */
async function flatten(
  ctx: ServeContext,
  url: URL,
  req: IncomingMessage,
  companyId: string,
  issueId: string,
): Promise<void> {
  const bytes = snapshotBytes(companyId, issueId)
  // Nothing to flatten is not the same as an empty description: persisting a
  // document this process does not hold would replace the real one with a
  // blank. See sync.ts's note on snapshotBytes.
  if (!bytes) return
  const checksum = createHash('sha256').update(bytes).digest('hex')
  const storeKey = `blobs/${companyId}/${checksum.slice(0, 2)}/${checksum}`
  const storage = await ctx.storageOf(url, req)
  await storage.put(storeKey, singleChunk(bytes), { type: 'application/octet-stream', size: bytes.length })
  await ctx.callUnchecked(
    'flow_backend.sync.commitContent',
    { issueId, storeKey, checksum, size: bytes.length, previewText: previewTextOf(companyId, issueId) },
    url,
    req,
  )
  await rollGeneration(companyId, issueId)
}

export const routes: Record<string, RouteEntry> = {
  '/admin/flow': () => async (url, req) =>
    req.method === 'GET' ? seeOther(inLocale(url, '/admin/flow/projects')) : text('GET', { status: 405 }),

  '/admin/flow/issues/{id}/content':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const issueId = String(params.id)
      const issue = await readable(ctx, url, req, issueId)
      if (!issue) return text('forbidden', { status: 403 })
      const scope = await ctx.scopeOf(url, req)
      if (!scope.company) return text('company scope required', { status: 400 })
      if (!(await hydrate(ctx, url, req, scope.company, issueId, issue.contentAttachmentId)))
        return text('stored description could not be read', { status: 503 })
      // Who the caller is, so a client knows which presence frames are its own
      // before it can receive any. Learning that from its first announce
      // instead left a window in which its own second tab read as a stranger.
      const viewer = (await ctx.callUnchecked('flow_backend.sync.viewer', {}, url, req)) as {
        id: string | null
      }
      return json({
        snapshot: Buffer.from(snapshotBytes(scope.company, issueId) ?? new Uint8Array()).toString('base64'),
        topic: topicFor(scope.company, issueId, currentGeneration(scope.company, issueId)),
        viewerId: viewer.id,
      })
    },

  '/admin/flow/issues/{id}/push':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const refused = onlyPost(req)
      if (refused) return refused
      const issueId = String(params.id)
      const issue = await writable(ctx, url, req, issueId)
      if (!issue) return text('forbidden', { status: 403 })
      const scope = await ctx.scopeOf(url, req)
      if (!scope.company) return text('company scope required', { status: 400 })
      let body: Record<string, unknown>
      try {
        body = await readJsonBody(req)
      } catch {
        return text('bad request', { status: 400 })
      }
      const update = typeof body.update === 'string' ? body.update : ''
      if (!update) return text('bad request', { status: 400 })
      // Before the update is merged, not after: an incremental update applied
      // to a blank document keeps only what it carries.
      if (!(await hydrate(ctx, url, req, scope.company, issueId, issue.contentAttachmentId)))
        return text('stored description could not be read', { status: 503 })
      let shouldFlatten: boolean
      try {
        ;({ shouldFlatten } = await publishUpdate(scope.company, issueId, update))
      } catch {
        // A malformed update is the client's problem, not a 500.
        return text('bad request', { status: 400 })
      }
      if (shouldFlatten) await flatten(ctx, url, req, scope.company, issueId)
      return json({ ok: true })
    },

  /**
   * The framework's own `/_ket/stream/:id` (packages/ketjs/src/server/http.ts)
   * has no auth check at all — fine for the short-lived generation logs it
   * was built for, wrong for a live document edit stream. This wraps the
   * same `streams.tail` primitive behind a real permission check instead of
   * reaching that public route directly.
   *
   * There is no server-side disconnect hook here on purpose: a client abort
   * does not reliably reach the route layer (verified against this same
   * `pipeline()`-backed response — even an aborted `fetch()` does not run an
   * async generator's `finally`, in-process or not), which is the same
   * reason real apps send an explicit "I'm leaving" beacon rather than
   * trust transport-level disconnect detection. `/leave` below is that
   * signal; flattening otherwise only happens on the update-count
   * threshold in `/push`.
   */
  '/admin/flow/issues/{id}/live':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const issueId = String(params.id)
      const topic = url.searchParams.get('topic') ?? ''
      const from = Number(url.searchParams.get('from') ?? 0)
      if (!(await readable(ctx, url, req, issueId))) return text('forbidden', { status: 403 })
      const scope = await ctx.scopeOf(url, req)
      // A topic name that doesn't actually belong to this issue's current
      // generation is refused rather than relayed — otherwise a caller
      // authorized for issue A could pass issue B's topic string and
      // eavesdrop on edits it was never granted.
      if (!scope.company || !topicBelongsTo(topic, scope.company, issueId))
        return text('unknown topic', { status: 404 })

      async function* relay(): AsyncGenerator<Uint8Array> {
        for await (const chunk of tailTopic(topic, from, { timeoutMs: 30_000 })) {
          yield encoder.encode(`id: ${chunk.seq}\ndata: ${JSON.stringify(chunk.data)}\n\n`)
        }
        yield encoder.encode('event: done\ndata: {}\n\n')
      }

      return withHeaders(streamed(relay(), { type: 'text/event-stream' }), {
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      })
    },

  /**
   * "I am here, on this block" — relayed to everyone else in the document.
   *
   * Gated on reading the issue, not on writing its description: watching
   * somebody type is looking, and a reviewer with read access showing up in
   * the room is the point. Nothing here touches the document.
   *
   * The name is resolved from the session rather than read out of the body.
   * A client that could name itself could sit in the room as somebody else,
   * and everyone else's screen would agree with it.
   */
  '/admin/flow/issues/{id}/presence':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const refused = onlyPost(req)
      if (refused) return refused
      const issueId = String(params.id)
      if (!(await readable(ctx, url, req, issueId))) return text('forbidden', { status: 403 })
      const scope = await ctx.scopeOf(url, req)
      if (!scope.company) return text('company scope required', { status: 400 })
      let body: Record<string, unknown>
      try {
        body = await readJsonBody(req)
      } catch {
        return text('bad request', { status: 400 })
      }
      const viewer = (await ctx.callUnchecked('flow_backend.sync.viewer', {}, url, req)) as {
        id: string | null
        name: string | null
      }
      if (!viewer.id) return json({ id: null })
      const index = Number(body.index)
      await publishPresence(scope.company, issueId, {
        id: viewer.id,
        name: viewer.name || viewer.id,
        index: Number.isFinite(index) && index >= 0 ? Math.floor(index) : 0,
        gone: body.gone === true,
      })
      return json({ id: viewer.id })
    },

  /**
   * The explicit "I'm done editing" signal — the client calls this
   * (`navigator.sendBeacon`, so it fires reliably on tab close) instead of
   * relying on the SSE connection's own teardown. Flattening is idempotent,
   * so a duplicate or slightly-late beacon just re-persists the same or a
   * slightly newer state.
   *
   * A beacon for a document this process never held is answered without
   * writing anything: it carries no state to save, and the old behaviour —
   * flatten whatever `live` returned — turned every post-restart tab close
   * into a silent wipe of the stored description.
   */
  '/admin/flow/issues/{id}/leave':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const refused = onlyPost(req)
      if (refused) return refused
      const issueId = String(params.id)
      if (!(await writable(ctx, url, req, issueId))) return text('forbidden', { status: 403 })
      const scope = await ctx.scopeOf(url, req)
      if (!scope.company) return text('company scope required', { status: 400 })
      if (!isLive(scope.company, issueId)) return json({ ok: true, flattened: false })
      await flatten(ctx, url, req, scope.company, issueId)
      return json({ ok: true, flattened: true })
    },

  '/admin/flow/issues/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const refused = refusePost(req)
      if (refused) return refused
      const issueId = String(params.id)
      const _ = ctx.translate(ctx.localeOf(url, req))
      // Tagged with the action that produced them, so the screen can put each
      // message under the form it belongs to rather than all of them on top.
      let errors: { action: string; messages: string[] } | undefined
      if (req.method === 'POST') {
        const form = await readForm(req)
        const action = form.action ?? ''
        const idempotencyKey = form.idempotencyKey || randomUUID()
        let result: AnyRow | null = null
        if (action === 'save') {
          const existing = (await readable(ctx, url, req, issueId)) as Row | null
          if (!existing) return text('not found', { status: 404 })
          // Every field this form owns is sent, empty ones as an explicit
          // null so clearing a picker actually clears it. Sprint and parent
          // are deliberately absent: neither is on this form (sprint has its
          // own action below, parent has no screen yet), and `issue.save`
          // keeps what it is not told about.
          result = (await ctx.call(
            'flow.issue.save',
            {
              id: issueId,
              projectId: existing.projectId,
              columnId: existing.columnId,
              title: form.title ?? '',
              priority: form.priority || undefined,
              assigneeUserId: form.assigneeUserId || null,
              epicId: form.epicId || null,
              tagIds: form.tagIds ? form.tagIds.split(',').filter(Boolean) : [],
              dueDate: form.dueDate || null,
              estimate: form.estimate || undefined,
              expectedVersion: Number(form.expectedVersion ?? 0),
              idempotencyKey,
            },
            url,
            req,
          )) as AnyRow
        } else if (action === 'move') {
          result = (await ctx.call(
            'flow.issue.move',
            {
              id: issueId,
              columnId: form.columnId ?? '',
              expectedVersion: Number(form.expectedVersion ?? 0),
              idempotencyKey,
            },
            url,
            req,
          )) as AnyRow
        } else if (action === 'assignSprint') {
          result = (await ctx.call(
            'flow.issue.assignSprint',
            {
              id: issueId,
              sprintId: form.sprintId || undefined,
              expectedVersion: Number(form.expectedVersion ?? 0),
              idempotencyKey,
            },
            url,
            req,
          )) as AnyRow
        } else if (action === 'comment') {
          result = (await ctx.call(
            'flow.issue.comment',
            { id: randomUUID(), issueId, body: form.body ?? '', idempotencyKey },
            url,
            req,
          )) as AnyRow
        } else if (action === 'addDependency') {
          result = (await ctx.call(
            'flow.issue.dependency.add',
            {
              id: randomUUID(),
              issueId,
              dependsOnIssueId: form.dependsOnIssueId ?? '',
              relation: form.relation || 'blocks',
              idempotencyKey,
            },
            url,
            req,
          )) as AnyRow
        } else if (action === 'addSubtask') {
          const parent = (await readable(ctx, url, req, issueId)) as Row | null
          if (!parent) return text('not found', { status: 404 })
          // Born on the parent's board, in the parent's column: a sub-task in
          // another project is what `parentIssueError` refuses, and a column
          // is not something this form asks for.
          result = (await ctx.call(
            'flow.issue.save',
            {
              id: randomUUID(),
              projectId: parent.projectId,
              columnId: parent.columnId,
              parentIssueId: issueId,
              title: form.title ?? '',
              idempotencyKey,
            },
            url,
            req,
          )) as AnyRow
        } else if (action === 'detachSubtask') {
          const child = (await readable(ctx, url, req, form.id ?? '')) as Row | null
          if (!child) return text('not found', { status: 404 })
          // Explicitly null, not omitted: `issue.save` keeps what it is not
          // told about, so omitting the parent would leave it attached.
          result = (await ctx.call(
            'flow.issue.save',
            {
              id: String(child.id),
              projectId: child.projectId,
              columnId: child.columnId,
              title: String(child.title),
              parentIssueId: null,
              expectedVersion: Number(form.childVersion ?? child.version ?? 0),
              idempotencyKey,
            },
            url,
            req,
          )) as AnyRow
        } else if (action === 'removeDependency') {
          result = (await ctx.call('flow.issue.dependency.remove', { id: form.id ?? '' }, url, req)) as AnyRow
        } else {
          return text('unknown action', { status: 400 })
        }
        if (result?.ok) return seeOther(inLocale(url, `/admin/flow/issues/${issueId}`))
        errors = { action, messages: errorsOf(result, _) }
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })

      const issue = (await readable(ctx, url, req, issueId)) as Row | null
      if (!issue) return text('not found', { status: 404 })
      const [columns, sprints] = await Promise.all([
        ctx.call('flow.column.list', { projectId: issue.projectId }, url, req) as Promise<AnyRow[]>,
        ctx.call('flow.sprint.list', { projectId: issue.projectId }, url, req) as Promise<AnyRow[]>,
      ])
      const editor = await ctx.joint(url, req, 'flow_backend:screen.issue', {
        issueId,
        lang: url.searchParams.get('lang') ?? '',
      })
      const controls: IssueDetailControls = {
        assignee: await assigneeControl(ctx, url, req, _, {
          id: 'issue-assignee',
          value: issue.assigneeUserId ? String(issue.assigneeUserId) : null,
          users: issue.assigneeUserId
            ? [
                {
                  value: String(issue.assigneeUserId),
                  label: String(issue.assigneeName ?? issue.assigneeUserId),
                },
              ]
            : [],
        }),
        epic: await epicControl(ctx, url, req, _, {
          id: 'issue-epic',
          value: issue.epicId ? String(issue.epicId) : null,
          projectId: String(issue.projectId),
          epics: issue.epicId
            ? [{ value: String(issue.epicId), label: String(issue.epicTitle ?? issue.epicId) }]
            : [],
        }),
        tags: await tagsControl(ctx, url, req, _, {
          id: 'issue-tags',
          values: ((issue.tags as AnyRow[] | undefined) ?? []).map((tag) => String(tag.id)),
          tags: ((issue.tags as AnyRow[] | undefined) ?? []).map((tag) => ({
            value: String(tag.id),
            label: String(tag.name),
          })),
        }),
        dependencyTarget: await issueControl(ctx, url, req, _, {
          id: 'issue-dependency',
          name: 'dependsOnIssueId',
          projectId: String(issue.projectId),
          excludeId: issueId,
          required: true,
        }),
      }
      return adminPage(ctx, url, req, {
        title: String(issue.title),
        translate: false,
        // The list this detail page belongs to, so the sidebar keeps marking
        // the project the issue is in rather than emptying out — the same
        // reason a quotation points at the quotations list.
        active: `/admin/flow/projects/${String(issue.projectId)}/issues`,
        body: (_, frame) =>
          issueDetailScreen(_, frame, issue, {
            fields: issueFields(_, issue, controls),
            columns,
            sprints,
            controls,
            editor,
            errors,
          }),
      })
    },

  '/admin/flow/projects':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const refused = refusePost(req)
      if (refused) return refused
      const _ = ctx.translate(ctx.localeOf(url, req))
      let errors: string[] = []
      if (req.method === 'POST') {
        const form = await readForm(req)
        const names =
          form.template === 'custom'
            ? (form.customColumns ?? '')
                .split(',')
                .map((name) => name.trim())
                .filter(Boolean)
            : (COLUMN_TEMPLATES[form.template ?? 'simple'] ?? COLUMN_TEMPLATES.simple)
        // Refused before the project row exists, not after: a board with no
        // column cannot hold an issue, so "Custom" with an empty list used to
        // build a project whose Issues screen rejected every create with an
        // error the screen had nowhere to show.
        if (!names.length) {
          errors = [_('flow_backend.error.customColumnsRequired')]
        } else {
          const id = randomUUID()
          const result = (await ctx.call(
            'flow.project.save',
            {
              values: {
                id,
                key: form.key ?? '',
                name: form.name ?? '',
                description: form.description || null,
              },
              idempotencyKey: randomUUID(),
            },
            url,
            req,
          )) as AnyRow
          if (result.ok) {
            for (const [index, name] of names.entries()) {
              const column = (await ctx.call(
                'flow.column.save',
                {
                  values: {
                    id: randomUUID(),
                    projectId: id,
                    code: slugify(name),
                    name,
                    sequence: (index + 1) * 10,
                    terminalState: index === names.length - 1,
                  },
                  idempotencyKey: randomUUID(),
                },
                url,
                req,
              )) as AnyRow
              // A column that will not save leaves a half-built board, and
              // the settings screen is the only place to repair one — so say
              // so here rather than landing on a board missing a column.
              if (!column.ok) return seeOther(inLocale(url, `/admin/flow/projects/${id}/settings`))
            }
            return seeOther(inLocale(url, `/admin/flow/projects/${id}/board`))
          }
          errors = errorsOf(result, _)
        }
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows = (await ctx.call('flow.project.list', { limit: 200 }, url, req)) as AnyRow[]
      return adminPage(ctx, url, req, {
        title: 'flow_backend.projects.title',
        body: (_, frame) =>
          projectsScreen(
            _,
            frame,
            rows,
            [
              { name: 'key', label: _('flow_backend.field.key'), required: true },
              { name: 'name', label: _('flow_backend.field.name'), required: true },
              {
                name: 'description',
                label: _('flow_backend.field.description'),
                type: 'textarea',
                span: 'full',
              },
              {
                name: 'template',
                label: _('flow_backend.field.template'),
                type: 'select',
                value: 'simple',
                options: TEMPLATE_OPTIONS(_),
              },
              {
                name: 'customColumns',
                label: _('flow_backend.field.customColumns'),
                help: _('flow_backend.field.customColumnsHint'),
                span: 'full',
              },
            ],
            errors,
          ),
      })
    },

  '/admin/flow/projects/{id}/board':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const projectId = String(params.id)
      const project = await projectOf(ctx, url, req, projectId)
      if (!project) return text('not found', { status: 404 })
      const columns = (await ctx.call('flow.column.list', { projectId }, url, req)) as AnyRow[]
      const BOARD_COLUMN = 40
      const pages = await Promise.all(
        columns.map(async (column) => {
          const result = (await ctx.call(
            'flow.issue.list',
            { columnId: column.id, limit: BOARD_COLUMN },
            url,
            req,
          )) as AnyRow
          const total = Number(result.total ?? 0)
          const rows = (result.rows as AnyRow[]) ?? []
          return {
            column: {
              ...column,
              total,
              loadMoreHref:
                rows.length < total ? issuesFilteredBy(projectId, 'columnId', String(column.id)) : null,
            },
            rows,
          }
        }),
      )
      const _ = ctx.translate(ctx.localeOf(url, req))
      const board = await ctx.joint(url, req, 'flow_backend:screen.board', {
        lang: ctx.localeOf(url, req),
        data: JSON.stringify({
          rows: pages.flatMap((item) => item.rows.map((row) => ({ ...row, projectId }))),
          columns: pages.map((item) => item.column),
          labels: {
            empty: _('flow_backend.board.empty'),
            move: _('flow_backend.action.move'),
            moving: _('flow_backend.board.moving'),
            conflict: _('flow.error.conflict'),
            unassigned: _('flow_backend.board.unassigned'),
            loadMore: _('flow_backend.board.loadMore'),
            moveShort: _('flow_backend.action.moveShort'),
            // Every refusal `issue.move` can answer with, translated here
            // where the catalogue is, so a drag that is genuinely not allowed
            // says why instead of claiming someone else edited the issue.
            errors: {
              'flow.error.blocked': _('flow.error.blocked'),
              'flow.error.invalidColumn': _('flow.error.invalidColumn'),
              'flow.error.notFound': _('flow.error.notFound'),
            },
          },
        }),
      })
      return adminPage(ctx, url, req, {
        title: String(project.name),
        translate: false,
        body: (_, frame) => boardScreen(_, frame, String(project.name), board),
      })
    },

  '/admin/flow/projects/{id}/board/move':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const refused = onlyPost(req)
      if (refused) return refused
      const projectId = String(params.id)
      const form = await readForm(req)
      const result = (await ctx.call(
        'flow.issue.move',
        {
          id: form.id ?? '',
          columnId: form.columnId ?? '',
          expectedVersion: Number(form.expectedVersion ?? 0),
          idempotencyKey: form.idempotencyKey || randomUUID(),
        },
        url,
        req,
      )) as AnyRow
      return result.ok
        ? seeOther(inLocale(url, `/admin/flow/projects/${projectId}/board`))
        : text(errorsOf(result, ctx.translate(ctx.localeOf(url, req))).join('\n'), { status: 409 })
    },

  /**
   * Every issue assigned to whoever is reading, across every project.
   *
   * It reuses the backlog's whole list apparatus — search, filters, grouping,
   * pager — by passing `mine` down instead of a project id, so the two screens
   * cannot drift. Who "mine" is gets settled in the domain (`issueQuery`), the
   * way `activity.listMy` settles it: a screen has no cheap way to learn who
   * is signed in.
   */
  '/admin/flow/mine':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const spec = issueListSearch(table(ctx.manifest, 'flow.Issue'))
      const state = parseListState(spec, url).state
      const timezone = 'UTC'
      const grouped = state.groupBy.length > 0
      const cursor = (state.page - 1) * LIST_PAGE_SIZE
      const result = (await ctx.call(
        'flow.issue.list',
        {
          mine: true,
          listState: state,
          timezone,
          cursor: String(cursor),
          limit: grouped ? 1 : LIST_PAGE_SIZE,
        },
        url,
        req,
      )) as AnyRow
      const groups = grouped
        ? await loadListGroups(ctx, url, req, state, timezone, {
            groupFunction: 'flow.issue.group',
            listFunction: 'flow.issue.list',
            listArgs: { mine: true },
            label: (_field, value) => String(value ?? '\u2014'),
          })
        : []
      return adminPage(ctx, url, req, {
        title: 'flow_backend.mine.title',
        body: (_, frame) => {
          frame.chrome = {
            search: {
              name: 'q',
              value: state.q ?? '',
              placeholder: _('flow_backend.search.issues'),
              keep: keepForListSearch(url),
              facets: listFacets(_, url, state, spec),
              menus: listMenus(_, url, state, spec),
            },
            pager: grouped
              ? null
              : pager(url, state, ((result.rows as AnyRow[]) ?? []).length, Number(result.total ?? 0)),
          }
          return myWorkScreen(_, frame, grouped ? [] : ((result.rows as AnyRow[]) ?? []), groups)
        },
      })
    },

  '/admin/flow/projects/{id}/issues':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const refused = refusePost(req)
      if (refused) return refused
      const projectId = String(params.id)
      const project = await projectOf(ctx, url, req, projectId)
      if (!project) return text('not found', { status: 404 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const columns = (await ctx.call('flow.column.list', { projectId }, url, req)) as AnyRow[]
      let errors: string[] = []
      if (req.method === 'POST') {
        const form = await readForm(req)
        const result = (await ctx.call(
          'flow.issue.save',
          {
            id: randomUUID(),
            projectId,
            columnId: form.columnId || String(columns[0]?.id ?? ''),
            title: form.title ?? '',
            priority: form.priority || undefined,
            idempotencyKey: randomUUID(),
          },
          url,
          req,
        )) as AnyRow
        if (result.ok) return seeOther(inLocale(url, `/admin/flow/projects/${projectId}/issues`))
        errors = errorsOf(result, _)
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const spec = issueListSearch(table(ctx.manifest, 'flow.Issue'))
      const parsed = parseListState(spec, url)
      const state = parsed.state
      const timezone = 'UTC'
      const grouped = state.groupBy.length > 0
      const cursor = (state.page - 1) * LIST_PAGE_SIZE
      const result = (await ctx.call(
        'flow.issue.list',
        {
          projectId,
          listState: state,
          timezone,
          cursor: String(cursor),
          limit: grouped ? 1 : LIST_PAGE_SIZE,
        },
        url,
        req,
      )) as AnyRow
      const groups = grouped
        ? await loadListGroups(ctx, url, req, state, timezone, {
            groupFunction: 'flow.issue.group',
            listFunction: 'flow.issue.list',
            listArgs: { projectId },
            label: (_field, value) => String(value ?? '—'),
          })
        : []
      return adminPage(ctx, url, req, {
        title: String(project.name),
        translate: false,
        body: (_, frame) => {
          frame.chrome = {
            search: {
              name: 'q',
              value: state.q ?? '',
              placeholder: _('flow_backend.search.issues'),
              keep: keepForListSearch(url),
              facets: listFacets(_, url, state, spec),
              menus: listMenus(_, url, state, spec),
            },
            pager: grouped
              ? null
              : pager(url, state, ((result.rows as AnyRow[]) ?? []).length, Number(result.total ?? 0)),
          }
          return issuesScreen(
            _,
            frame,
            String(project.name),
            `/admin/flow/projects/${projectId}/issues`,
            [
              { name: 'title', label: _('flow_backend.field.title'), required: true },
              {
                name: 'columnId',
                label: _('flow_backend.field.column'),
                type: 'select',
                options: columns.map((column) => ({ value: String(column.id), label: String(column.name) })),
              },
              {
                name: 'priority',
                label: _('flow_backend.field.priority'),
                type: 'select',
                value: 'normal',
                options: ISSUE_PRIORITIES.map((value) => ({
                  value,
                  label: _.resolves(`flow.priority.${value}`) ? _(`flow.priority.${value}`) : value,
                })),
              },
            ],
            grouped ? [] : ((result.rows as AnyRow[]) ?? []),
            groups,
            errors,
          )
        },
      })
    },

  '/admin/flow/projects/{id}/epics':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const refused = refusePost(req)
      if (refused) return refused
      const projectId = String(params.id)
      const project = await projectOf(ctx, url, req, projectId)
      if (!project) return text('not found', { status: 404 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      let errors: string[] = []
      const endpoint = `/admin/flow/projects/${projectId}/epics`
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.action === 'archive') {
          const archived = (await ctx.call('flow.epic.archive', { id: form.id ?? '' }, url, req)) as AnyRow
          if (archived.ok) return seeOther(inLocale(url, endpoint))
          errors = errorsOf(archived, _)
        } else {
          const result = (await ctx.call(
            'flow.epic.save',
            {
              values: { id: randomUUID(), projectId, title: form.title ?? '', color: form.color || null },
              idempotencyKey: randomUUID(),
            },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, endpoint))
          errors = errorsOf(result, _)
        }
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const epics = (await ctx.call('flow.epic.list', { projectId }, url, req)) as AnyRow[]
      const withCounts = await Promise.all(
        epics.map(async (epic) => {
          // Scoped to the project as well as the epic: `epicId` is a plain
          // reference, so counting by it alone would fold in any issue that
          // named this epic from another project.
          const found = (await ctx.call(
            'flow.issue.list',
            { projectId, epicId: epic.id, limit: 1 },
            url,
            req,
          )) as AnyRow
          return {
            ...epic,
            totalCount: Number(found.total ?? 0),
            issuesHref: issuesFilteredBy(projectId, 'epicId', String(epic.id)),
          }
        }),
      )
      return adminPage(ctx, url, req, {
        title: String(project.name),
        translate: false,
        body: (_, frame) =>
          epicsScreen(
            _,
            frame,
            String(project.name),
            endpoint,
            withCounts,
            [
              { name: 'title', label: _('flow_backend.field.title'), required: true },
              { name: 'color', label: _('flow_backend.field.color'), type: 'color' },
            ],
            errors,
          ),
      })
    },

  /**
   * The dependency map, one epic at a time — ported from PhaseAtlas's
   * TaskMap.svelte (its "workspace" is this app's "epic"). Nodes are this
   * epic's issues; edges are `blocks` dependencies whose two ends are both
   * inside the epic — a dependency reaching outside it is out of scope for a
   * single-epic map, same as the plan's own "only tasks of one epic" call.
   */
  '/admin/flow/projects/{id}/epics/{epicId}/map':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const projectId = String(params.id)
      const epicId = String(params.epicId)
      const project = await projectOf(ctx, url, req, projectId)
      if (!project) return text('not found', { status: 404 })
      const [epics, columns, found] = await Promise.all([
        ctx.call('flow.epic.list', { projectId, includeArchived: true }, url, req) as Promise<AnyRow[]>,
        ctx.call('flow.column.list', { projectId }, url, req) as Promise<AnyRow[]>,
        ctx.call('flow.issue.list', { projectId, epicId, limit: 200 }, url, req) as Promise<AnyRow>,
      ])
      const epic = epics.find((row) => String(row.id) === epicId)
      if (!epic) return text('not found', { status: 404 })
      const terminalColumnIds = new Set(
        columns.filter((column) => column.terminalState).map((column) => String(column.id)),
      )
      const issues = (found.rows as AnyRow[]) ?? []
      const issueIds = issues.map((row) => String(row.id))
      const deps = (await ctx.call('flow.issue.dependencies', { issueIds }, url, req)) as AnyRow[]
      const issueIdSet = new Set(issueIds)
      const _ = ctx.translate(ctx.localeOf(url, req))
      const map = await ctx.joint(url, req, 'flow_backend:screen.map', {
        lang: ctx.localeOf(url, req),
        data: JSON.stringify({
          epicTitle: String(epic.title),
          nodes: issues.map((row) => ({
            id: row.id,
            title: row.title,
            columnName: row.columnName ?? null,
            assigneeName: row.assigneeName ?? null,
            done: terminalColumnIds.has(String(row.columnId)),
          })),
          edges: deps
            .filter(
              (dep) => issueIdSet.has(String(dep.issueId)) && issueIdSet.has(String(dep.dependsOnIssueId)),
            )
            .map((dep) => ({ source: dep.dependsOnIssueId, target: dep.issueId })),
          // The board route beside this one has always passed its wording
          // through the catalogue; the map did not, which left eleven strings
          // reachable only by the island's own vi/en fallback — the second,
          // untranslatable vocabulary the island pattern exists to avoid.
          labels: {
            eyebrow: _('flow_backend.map.eyebrow'),
            title: _('flow_backend.map.title'),
            hint: _('flow_backend.map.hint'),
            empty: _('flow_backend.map.empty'),
            done: _('flow_backend.map.done'),
            active: _('flow_backend.map.active'),
            ready: _('flow_backend.map.ready'),
            blocked: _('flow_backend.map.blocked'),
            unassigned: _('flow_backend.map.unassigned'),
            waitingFor: _('flow_backend.map.waitingFor'),
          },
        }),
      })
      return adminPage(ctx, url, req, {
        title: String(epic.title),
        translate: false,
        body: (_, frame) => mapScreen(_, frame, String(epic.title), map),
      })
    },

  '/admin/flow/projects/{id}/sprints':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const refused = refusePost(req)
      if (refused) return refused
      const projectId = String(params.id)
      const project = await projectOf(ctx, url, req, projectId)
      if (!project) return text('not found', { status: 404 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      let errors: string[] = []
      const endpoint = `/admin/flow/projects/${projectId}/sprints`
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.action === 'start' || form.action === 'close') {
          // `startSprint` refuses a second active sprint and `closeSprint` a
          // sprint that is not running — both answer with a translated code,
          // and dropping the result reported those refusals as a success.
          const changed = (await ctx.call(
            form.action === 'start' ? 'flow.sprint.start' : 'flow.sprint.close',
            { id: form.id ?? '', idempotencyKey: randomUUID() },
            url,
            req,
          )) as AnyRow
          if (changed.ok) return seeOther(inLocale(url, endpoint))
          errors = errorsOf(changed, _)
        } else {
          const result = (await ctx.call(
            'flow.sprint.save',
            {
              id: randomUUID(),
              projectId,
              name: form.name ?? '',
              startDate: form.startDate || undefined,
              endDate: form.endDate || undefined,
              idempotencyKey: randomUUID(),
            },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, endpoint))
          errors = errorsOf(result, _)
        }
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const sprints = (await ctx.call('flow.sprint.list', { projectId }, url, req)) as AnyRow[]
      return adminPage(ctx, url, req, {
        title: String(project.name),
        translate: false,
        body: (_, frame) =>
          sprintsScreen(
            _,
            frame,
            String(project.name),
            endpoint,
            sprints,
            [
              { name: 'name', label: _('flow_backend.field.name'), required: true },
              { name: 'startDate', label: _('flow_backend.field.startDate'), type: 'date' },
              { name: 'endDate', label: _('flow_backend.field.endDate'), type: 'date' },
            ],
            errors,
          ),
      })
    },

  '/admin/flow/projects/{id}/settings':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const refused = refusePost(req)
      if (refused) return refused
      const projectId = String(params.id)
      const project = await projectOf(ctx, url, req, projectId)
      if (!project) return text('not found', { status: 404 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      // Two independent halves on one screen, so two error sinks: a duplicate
      // tag name reported above the columns form reads as a broken column.
      let columnErrors: string[] = []
      let tagErrors: string[] = []
      const endpoint = `/admin/flow/projects/${projectId}/settings`
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.action === 'archiveColumn') {
          // `column.archive` refuses a column that still holds active issues,
          // which is the whole point of the check — reporting that refusal as
          // a success left the column on screen with no explanation.
          const archived = (await ctx.call('flow.column.archive', { id: form.id ?? '' }, url, req)) as AnyRow
          if (archived.ok) return seeOther(inLocale(url, endpoint))
          columnErrors = errorsOf(archived, _)
        } else if (form.action === 'archiveTag') {
          const archived = (await ctx.call('flow.tag.archive', { id: form.id ?? '' }, url, req)) as AnyRow
          if (archived.ok) return seeOther(inLocale(url, endpoint))
          tagErrors = errorsOf(archived, _)
        } else if (form.action === 'saveColumn') {
          const result = (await ctx.call(
            'flow.column.save',
            {
              values: {
                id: form.id || randomUUID(),
                projectId,
                code: form.code || slugify(form.name ?? ''),
                name: form.name ?? '',
                sequence: Number(form.sequence ?? 10),
                terminalState: form.terminalState === '1',
              },
              idempotencyKey: randomUUID(),
            },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, endpoint))
          columnErrors = errorsOf(result, _)
        } else if (form.action === 'saveTag') {
          const result = (await ctx.call(
            'flow.tag.save',
            { id: form.id || randomUUID(), name: form.name ?? '', color: form.color || undefined },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, endpoint))
          tagErrors = errorsOf(result, _)
        } else return text('unknown action', { status: 400 })
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [columns, tags] = await Promise.all([
        ctx.call('flow.column.list', { projectId }, url, req) as Promise<AnyRow[]>,
        ctx.call('flow.tag.list', {}, url, req) as Promise<AnyRow[]>,
      ])
      const editColumn = url.searchParams.get('editColumnId')
      const editTag = url.searchParams.get('editTagId')
      const editingColumn = editColumn ? columns.find((row) => String(row.id) === editColumn) : undefined
      const editingTag = editTag ? tags.find((row) => String(row.id) === editTag) : undefined
      return adminPage(ctx, url, req, {
        title: String(project.name),
        translate: false,
        body: (_, frame) =>
          settingsScreen(_, frame, String(project.name), endpoint, {
            columns,
            columnFields: [
              {
                name: 'name',
                label: _('flow_backend.field.name'),
                required: true,
                value: String(editingColumn?.name ?? ''),
              },
              { name: 'code', label: _('flow_backend.field.code'), value: String(editingColumn?.code ?? '') },
              {
                name: 'sequence',
                label: _('flow_backend.field.sequence'),
                type: 'number',
                value: String(editingColumn?.sequence ?? 10),
              },
              {
                name: 'terminalState',
                label: _('flow_backend.field.terminalState'),
                type: 'checkbox',
                value: editingColumn?.terminalState === true,
              },
            ],
            editingColumnId: editingColumn ? String(editingColumn.id) : undefined,
            tags,
            tagFields: [
              {
                name: 'name',
                label: _('flow_backend.field.name'),
                required: true,
                value: String(editingTag?.name ?? ''),
              },
              {
                name: 'color',
                label: _('flow_backend.field.color'),
                type: 'color',
                value: String(editingTag?.color ?? ''),
              },
            ],
            editingTagId: editingTag ? String(editingTag.id) : undefined,
            columnErrors,
            tagErrors,
          }),
      })
    },
}
