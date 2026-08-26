import { randomUUID } from 'node:crypto'
import { encodeListState, parseListState, table, text } from '@ketvietlab/ketjs'
import type { IncomingMessage } from 'node:http'
import type { ListState, Row, Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { FIELD_KINDS, ISSUE_PRIORITIES } from '../flow/types.ts'
import { emptyIssueListState, issueListSearch } from '../flow/search.ts'
import { adminPage, inLocale, resultErrors } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'
import type { FormField } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import {
  assigneeControl,
  epicControl,
  issueControl,
  mentionControl,
  tagsControl,
} from './relation-control.ts'
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
  epicDetailScreen,
  allEpicsScreen,
  issueDetailScreen,
  issuesScreen,
  ganttScreen,
  mapScreen,
  crossProjectScreen,
  pagesScreen,
  pageDetailScreen,
  allPagesScreen,
  projectsScreen,
  settingsScreen,
  sprintsScreen,
  TEMPLATE_OPTIONS,
} from './screens/index.ts'
import type { IssueDetailControls } from './screens/index.ts'
import { documentRoutes } from '../livedoc/index.ts'
import type { DocumentOwner } from '../livedoc/index.ts'

type Translator = ReturnType<ServeContext['translate']>

/** Column-name presets offered when creating a project — the "Custom" option types its own list. */
const COLUMN_TEMPLATES: Record<string, string[]> = {
  simple: ['To do', 'Done'],
  kanban: ['To do', 'In Progress', 'Done'],
  scrum: ['Backlog', 'To do', 'In Progress', 'Review', 'Done'],
}

/**
 * The kinds of work each preset expects, seeded beside its columns.
 *
 * A process is a pair — how work moves and what work is — and a team that
 * picks "Scrum" means Story and Spike as much as it means a Review column.
 * These are a starting point and nothing more: types are edited in project
 * settings afterwards, exactly like the columns above, and the code never
 * reads one of these names back.
 *
 * "Custom" gets a single Task, because a board with no type at all cannot
 * offer the field, and choosing to name your own columns is not a statement
 * about issue types.
 */
const TYPE_TEMPLATES: Record<string, string[]> = {
  simple: ['Task'],
  kanban: ['Task', 'Bug'],
  scrum: ['Story', 'Task', 'Bug', 'Spike'],
  custom: ['Task'],
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

/** A control shaped by what the field says it holds. */
const customFieldControl = (field: AnyRow): FormField => {
  const name = `field:${String(field.code)}`
  const label = String(field.name)
  const value = field.value == null ? '' : String(field.value)
  const kind = String(field.kind)
  if (kind === 'select') {
    const options = ((field.config as { options?: AnyRow[] } | null)?.options ?? []).map((option) => ({
      value: String(option.code),
      label: String(option.label ?? option.code),
    }))
    // A blank first entry, because a field somebody has not answered is not the
    // same as one answered with whatever happened to be first.
    return { name, label, type: 'select', value, options: [{ value: '', label: '\u2014' }, ...options] }
  }
  if (kind === 'bool') return { name, label, type: 'checkbox', value: value === 'true' }
  if (kind === 'number') return { name, label, type: 'number', value }
  if (kind === 'date') return { name, label, type: 'date', value }
  if (kind === 'url') return { name, label, type: 'text', value, placeholder: 'https://' }
  return { name, label, value }
}

const issueFields = (
  _: Translator,
  row: AnyRow,
  controls: IssueDetailControls,
  types: AnyRow[] = [],
): FormField[] => [
  { name: 'title', label: _('flow_backend.field.title'), value: String(row.title ?? ''), required: true },
  // A native select, like the column and priority beside it: the vocabulary is
  // small, it is the project's own, and a dialog to choose between four values
  // is worse than the four values. A project with no types offers no field at
  // all rather than an empty one.
  ...(types.length
    ? [
        {
          name: 'typeId',
          label: _('flow_backend.field.type'),
          type: 'select' as const,
          value: String(row.typeId ?? ''),
          options: [
            { value: '', label: '\u2014' },
            ...types.map((type) => ({ value: String(type.id), label: String(type.name) })),
          ],
        },
      ]
    : []),
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
  {
    name: 'startDate',
    label: _('flow_backend.field.startDate'),
    type: 'date',
    value: String(row.startDate ?? ''),
  },
  { name: 'dueDate', label: _('flow_backend.field.dueDate'), type: 'date', value: String(row.dueDate ?? '') },
  {
    name: 'estimate',
    label: _('flow_backend.field.estimate'),
    type: 'decimal',
    value: row.estimate != null ? String(row.estimate) : '',
  },
  // Whatever this project added to its own issues, after everything Flow
  // itself asks about.
  ...((row.fields as AnyRow[] | undefined) ?? []).map(customFieldControl),
]

/**
 * How many issues one chart draws.
 *
 * Every row is a line on screen, so this is a readability limit before it is a
 * query one — past a few hundred bars nobody is reading a chart, they are
 * scrolling past one. Ordered by start date, so what it does show is the
 * beginning of the project rather than an arbitrary page of it.
 */
const GANTT_ROWS = 200

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
 * What Live Doc needs to know to hold an issue's description.
 *
 * Everything here is Flow's own: which functions grant reading and rewriting
 * a description, where the row keeps its snapshot, and the one function
 * allowed to write `flow.Issue` back. The CRDT, the relay, the presence and
 * the blob writing are livedoc's — see modules/livedoc/documents.ts.
 */
const issueDocument: DocumentOwner = {
  kind: 'flow.Issue',
  readFn: 'flow.issue.get',
  writeFn: 'flow.issue.editDescription',
  attachmentOf: (row) => row.contentAttachmentId,
  commitFn: 'flow_backend.sync.commitContent',
}

/**
 * The same, for a page — where the document is not a field on the record but
 * the record's whole reason to exist.
 *
 * `page.get` answers `{ value }`, so the attachment is read one level in. That
 * is the only difference between the two owners, which is the point of the
 * seam: a second kind of document cost five lines.
 */
/**
 * The project brief. `description` stays the one-line summary a list row shows;
 * this is the long form nobody wants to write into a single-line input.
 */
const projectDocument: DocumentOwner = {
  kind: 'flow.Project',
  readFn: 'flow.project.get',
  writeFn: 'flow.project.editContent',
  attachmentOf: (row) => (row.value as AnyRow | null)?.contentAttachmentId ?? row.contentAttachmentId,
  commitFn: 'flow_backend.sync.commitProjectContent',
}

/** An epic's own document — what it is for, beside the issues under it. */
const epicDocument: DocumentOwner = {
  kind: 'flow.Epic',
  readFn: 'flow.epic.get',
  writeFn: 'flow.epic.editContent',
  attachmentOf: (row) => (row.value as AnyRow | null)?.contentAttachmentId ?? row.contentAttachmentId,
  commitFn: 'flow_backend.sync.commitEpicContent',
}

const pageDocument: DocumentOwner = {
  kind: 'flow.Page',
  readFn: 'flow.page.get',
  writeFn: 'flow.page.editContent',
  attachmentOf: (row) => (row.value as AnyRow | null)?.contentAttachmentId ?? row.contentAttachmentId,
  commitFn: 'flow_backend.sync.commitPageContent',
}

/**
 * A list of issues that is not on a board.
 *
 * `mine` is the only thing that differs between the two, so it is the only
 * thing this takes: a second copy of the search/filter/group/pager wiring is a
 * second place for them to drift apart.
 */
const crossProjectIssues =
  (options: { mine: boolean; title: string }) =>
  (ctx: ServeContext): Route =>
  async (url, req) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const spec = issueListSearch(table(ctx.manifest, 'flow.Issue'))
    const state = parseListState(spec, url).state
    const timezone = 'UTC'
    const grouped = state.groupBy.length > 0
    const cursor = (state.page - 1) * LIST_PAGE_SIZE
    const scoped = options.mine ? { mine: true } : {}
    const result = (await ctx.call(
      'flow.issue.list',
      {
        ...scoped,
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
          listArgs: scoped,
          label: (_field, value) => String(value ?? '\u2014'),
        })
      : []
    // The figures beside the list, over the same filter the list is showing —
    // counted, not listed, so a thousand issues cost four counts.
    const today = new Date().toISOString().slice(0, 10)
    const buckets = (await ctx.call(
      'flow.issue.buckets',
      { ...scoped, listState: state, today },
      url,
      req,
    )) as AnyRow
    const mineCount = options.mine
      ? Number(buckets.total ?? 0)
      : Number(
          (
            (await ctx.call(
              'flow.issue.buckets',
              { mine: true, listState: emptyIssueListState(), today },
              url,
              req,
            )) as AnyRow
          ).total ?? 0,
        )
    const late = (await ctx.call(
      'flow.issue.list',
      {
        ...scoped,
        listState: { ...emptyIssueListState(), sort: [{ key: 'dueDate', dir: 'asc' }] },
        overdueOn: today,
        limit: 5,
      },
      url,
      req,
    )) as AnyRow
    // Which rows the due-date column should mark. Done is not late, however
    // long ago the date was.
    const marked = ((result.rows as AnyRow[]) ?? []).map((row) => ({
      ...row,
      overdue:
        row.terminal !== true && !!row.dueDate && String(row.dueDate) < today,
    }))
    return adminPage(ctx, url, req, {
      title: options.title,
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
        const at = url.searchParams.get('view') ?? 'all'
        return crossProjectScreen(_, frame, _(options.title), grouped ? [] : marked, groups, {
          total: Number(buckets.total ?? 0),
          done: Number(buckets.done ?? 0),
          overdue: Number(buckets.overdue ?? 0),
          waiting: Number(buckets.waiting ?? 0),
          working: Number(buckets.working ?? 0),
          mine: mineCount,
          late: ((late.rows as AnyRow[]) ?? []).slice(0, 5),
          tab: at,
          tabs: [
            {
              id: 'all',
              label: _('flow_backend.issues.tabAll'),
              href: '/admin/flow/issues',
              count: Number(buckets.total ?? 0),
            },
            {
              id: 'mine',
              label: _('flow_backend.issues.tabMine'),
              href: '/admin/flow/mine',
              count: mineCount,
            },
          ],
        })
      },
    })
  }


/**
 * The "new page" form: a title, and optionally somewhere to put it.
 *
 * The parent choices are a plain select over the pages already in the project
 * rather than a relation picker — a wiki is small enough to read in a list,
 * and the picker would be a second island for no gain.
 */
const pageFields = (_: Translator, pages: readonly AnyRow[]): FormField[] => [
  { name: 'title', label: _('flow_backend.pages.name'), value: '', required: true },
  {
    name: 'parentPageId',
    label: _('flow_backend.pages.parent'),
    type: 'select',
    value: '',
    options: [
      { value: '', label: _('flow_backend.pages.root') },
      ...pages.map((page) => ({ value: String(page.id), label: String(page.title ?? '') })),
    ],
  },
]

/** The move form's one control: every page except this one and its descendants. */
const parentField = (
  _: Translator,
  pages: readonly AnyRow[],
  pageId: string,
  current: string,
): FormField => {
  // A page cannot move under itself or under anything below it. The server
  // refuses that anyway (`movePage`), but offering the choice and then
  // rejecting it is a worse screen than not offering it.
  const banned = new Set([pageId])
  let grew = true
  while (grew) {
    grew = false
    for (const page of pages) {
      const parent = page.parentPageId ? String(page.parentPageId) : ''
      if (parent && banned.has(parent) && !banned.has(String(page.id))) {
        banned.add(String(page.id))
        grew = true
      }
    }
  }
  return {
    name: 'parentPageId',
    label: _('flow_backend.pages.parent'),
    type: 'select',
    value: current,
    options: [
      { value: '', label: _('flow_backend.pages.root') },
      ...pages
        .filter((page) => !banned.has(String(page.id)))
        .map((page) => ({ value: String(page.id), label: String(page.title ?? '') })),
    ],
  }
}

export const routes: Record<string, RouteEntry> = {
  // The document endpoints under `/admin/flow/issues/{id}` — content, push,
  // live, presence, leave. Mounted rather than written out: they are the same
  // five for every record that holds a document.
  ...documentRoutes(issueDocument, '/admin/flow/issues'),
  ...documentRoutes(pageDocument, '/admin/flow/pages'),
  // A project's own five endpoints sit beside its screens rather than under a
  // separate base — `/admin/flow/projects/{id}` is already this record's home.
  ...documentRoutes(projectDocument, '/admin/flow/projects'),
  ...documentRoutes(epicDocument, '/admin/flow/epics'),

  '/admin/flow': () => async (url, req) =>
    req.method === 'GET' ? seeOther(inLocale(url, '/admin/flow/projects')) : text('GET', { status: 405 }),

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
              typeId: form.typeId || null,
              // The form names a custom field `field:<code>`, so the posted
              // keys say which definition each answer belongs to without the
              // route having to load them first.
              fields: Object.fromEntries(
                Object.entries(form)
                  .filter(([key]) => key.startsWith('field:'))
                  .map(([key, value]) => [key.slice('field:'.length), value]),
              ),
              tagIds: form.tagIds ? form.tagIds.split(',').filter(Boolean) : [],
              startDate: form.startDate || null,
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
            {
              id: randomUUID(),
              issueId,
              body: form.body ?? '',
              mentionUserIds: form.mentionUserIds ? form.mentionUserIds.split(',').filter(Boolean) : [],
              idempotencyKey,
            },
            url,
            req,
          )) as AnyRow
        } else if (action === 'unfollow') {
          if (!(await readable(ctx, url, req, issueId))) return text('not found', { status: 404 })
          result = (await ctx.call('flow.issue.unfollow', { issueId, idempotencyKey }, url, req)) as AnyRow
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
      const [columns, sprints, types] = await Promise.all([
        ctx.call('flow.column.list', { projectId: issue.projectId }, url, req) as Promise<AnyRow[]>,
        ctx.call('flow.sprint.list', { projectId: issue.projectId }, url, req) as Promise<AnyRow[]>,
        ctx.call('flow.issueType.list', { projectId: issue.projectId }, url, req) as Promise<AnyRow[]>,
      ])
      const editor = await ctx.joint(url, req, 'flow_backend:screen.issue', {
        docId: issueId,
        base: '/admin/flow/issues',
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
        mentions: await mentionControl(ctx, url, req, _, { id: 'issue-mentions' }),
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
            fields: issueFields(_, issue, controls, types),
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
            for (const [index, name] of (TYPE_TEMPLATES[form.template ?? 'simple'] ??
              TYPE_TEMPLATES.simple)!.entries()) {
              // Unlike a column, a project with no type is still a working
              // board — the field is simply not offered — so a type that will
              // not save is not worth diverting the whole creation for.
              await ctx.call(
                'flow.issueType.save',
                {
                  values: {
                    id: randomUUID(),
                    projectId: id,
                    code: slugify(name),
                    name,
                    sequence: (index + 1) * 10,
                  },
                  idempotencyKey: randomUUID(),
                },
                url,
                req,
              )
            }
            return seeOther(inLocale(url, `/admin/flow/projects/${id}/board`))
          }
          errors = errorsOf(result, _)
        }
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const all = (await ctx.call('flow.project.list', { limit: 200 }, url, req)) as AnyRow[]
      // Counts for every project the reader can see, in two reads rather than
      // one per row — see `projectStats`. Taken over the whole set, not the
      // tab, so the cards keep describing the same thing when a tab narrows
      // the table.
      const stats = (await ctx.call(
        'flow.project.stats',
        { projectIds: all.map((project) => String(project.id)) },
        url,
        req,
      )) as AnyRow[]
      const statsBy = new Map(stats.map((row) => [String(row.id), row]))
      const counted = all.map((project) => ({ ...project, ...statsBy.get(String(project.id)) }))

      // "Mine" is the projects holding an issue assigned to me. A project has
      // no membership to read instead, so this answers the question the tab
      // actually asks rather than inventing a list nobody maintains.
      const tab = url.searchParams.get('tab') === 'mine' ? 'mine' : 'all'
      const mine = (await ctx.call(
        'flow.issue.list',
        { mine: true, listState: emptyIssueListState(), limit: 200 },
        url,
        req,
      )) as AnyRow
      const mineProjects = new Set(
        ((mine.rows as AnyRow[]) ?? []).map((issue) => String(issue.projectId)),
      )
      const rows = tab === 'mine' ? counted.filter((p) => mineProjects.has(String(p.id))) : counted

      // The one rail the design asks for: what changed most recently, across
      // every project, newest first.
      const recent = (await ctx.call(
        'flow.issue.list',
        {
          listState: { ...emptyIssueListState(), sort: [{ key: 'updatedAt', dir: 'desc' }] },
          limit: 6,
        },
        url,
        req,
      )) as AnyRow
      return adminPage(ctx, url, req, {
        title: 'flow_backend.projects.title',
        body: (_, frame) =>
          projectsScreen(
            _,
            frame,
            {
              rows,
              projectCount: all.length,
              issueCount: stats.reduce((sum, row) => sum + Number(row.total ?? 0), 0),
              issuesDone: stats.reduce((sum, row) => sum + Number(row.done ?? 0), 0),
              activeCount: stats.filter((row) => String(row.state) === 'active').length,
              activity: ((recent.rows as AnyRow[]) ?? []).slice(0, 6),
              tab,
              tabs: [
                {
                  id: 'all',
                  label: _('flow_backend.projects.tabAll'),
                  href: '/admin/flow/projects',
                },
                {
                  id: 'mine',
                  label: _('flow_backend.projects.tabMine'),
                  href: '/admin/flow/projects?tab=mine',
                },
              ],
            },
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

  /**
   * The board, without saying which project in the path.
   *
   * A board is one project's — `flow.Column` belongs to a project, so there is
   * nothing for a board spanning them to group by. This resolves the reader's
   * own last board and sends them there; the first time, when there is nothing
   * remembered and nothing to guess from, it sends them to the project list to
   * choose rather than picking one for them.
   */
  '/admin/flow/board':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const scope = (await ctx.call('flow.board.scope', {}, url, req)) as { projectId?: string | null }
      if (scope.projectId)
        return seeOther(inLocale(url, `/admin/flow/projects/${String(scope.projectId)}/board`))
      const projects = (await ctx.call('flow.project.list', { limit: 2 }, url, req)) as AnyRow[]
      // One project is not a choice, so it is not worth making somebody make it.
      if (projects.length === 1)
        return seeOther(inLocale(url, `/admin/flow/projects/${String(projects[0]!.id)}/board`))
      return seeOther(inLocale(url, '/admin/flow/projects'))
    },

  '/admin/flow/projects/{id}/board':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const projectId = String(params.id)
      const project = await projectOf(ctx, url, req, projectId)
      if (!project) return text('not found', { status: 404 })
      // Opening a board is what says which one you meant. `/admin/flow/board`
      // reads this back, so the global entry lands where you last were rather
      // than asking again every time.
      await ctx.call('flow.board.remember', { projectId }, url, req).catch(() => null)
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
  '/admin/flow/mine': crossProjectIssues({ mine: true, title: 'flow_backend.mine.title' }),

  /**
   * Every issue, whoever it belongs to.
   *
   * The same route body as `/admin/flow/mine` with one argument dropped —
   * search, filters, grouping and the pager all come from the same apparatus,
   * so the two cannot answer differently about the same question.
   */
  '/admin/flow/issues': crossProjectIssues({ mine: false, title: 'flow_backend.issues.allTitle' }),

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
      // The project's own fields have to be in the spec before the URL is
      // parsed: a rule naming a field the spec does not know is dropped as
      // unknown, and the filter would silently do nothing.
      const fieldDefs = (await ctx.call('flow.field.list', { projectId }, url, req)) as AnyRow[]
      const spec = issueListSearch(table(ctx.manifest, 'flow.Issue'), fieldDefs)
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
            fieldDefs,
          )
        },
      })
    },


  /**
   * A project's documents, and the form that starts a new one.
   *
   * The whole tree comes back in one call and nests on the screen — see
   * `listPages` for why that is the right shape for a wiki and the wrong one
   * for the backlog.
   */
  '/admin/flow/projects/{id}/pages':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const refused = refusePost(req)
      if (refused) return refused
      const projectId = String(params.id)
      const _ = ctx.translate(ctx.localeOf(url, req))
      const endpoint = `/admin/flow/projects/${projectId}/pages`
      let errors: string[] = []
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.action === 'save') {
          const result = (await ctx.call(
            'flow.page.save',
            {
              id: form.id || randomUUID(),
              projectId,
              title: form.title ?? '',
              parentPageId: form.parentPageId || null,
              idempotencyKey: randomUUID(),
            },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, `/admin/flow/pages/${String(result.id)}`))
          errors = errorsOf(result, _)
        }
      }
      const project = (await ctx.call('flow.project.get', { id: projectId }, url, req)) as AnyRow | null
      if (!project) return text('not found', { status: 404 })
      const pages = (await ctx.call(
        'flow.page.list',
        { projectId, search: url.searchParams.get('q') ?? '' },
        url,
        req,
      )) as AnyRow[]
      return adminPage(ctx, url, req, {
        title: String(project.name ?? ''),
        translate: false,
        active: endpoint,
        body: (t, frame) =>
          pagesScreen(t, frame, String(project.name ?? ''), endpoint, pages, pageFields(t, pages), errors),
      })
    },

  /**
   * Every epic, across projects. Reached from the menu, and the base the epic
   * document endpoints above hang off.
   */
  '/admin/flow/epics': (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const projects = (await ctx.call('flow.project.list', { limit: 200 }, url, req)) as AnyRow[]
      // `epic.list` is scoped to a project — there is no JOIN to fold the two
      // reads into one, so the epics come back per project and are stitched
      // here, capped by the project list's own limit.
      const perProject = await Promise.all(
        projects.map(
          (project) =>
            ctx.call('flow.epic.list', { projectId: String(project.id) }, url, req) as Promise<AnyRow[]>,
        ),
      )
      const named = new Map(projects.map((project) => [String(project.id), String(project.name ?? '')]))
      const epics = perProject
        .flat()
        .map((epic) => ({ ...epic, projectName: named.get(String(epic.projectId)) ?? '' }))
      return adminPage(ctx, url, req, {
        title: 'flow_backend.epics.allTitle',
        body: (t, frame) => allEpicsScreen(t, frame, t('flow_backend.epics.allTitle'), epics),
      })
    },

  /**
   * One epic: what it is for, and the issues under it.
   *
   * Epics had a card on a grid and a map, but nowhere to say what the epic
   * actually means — which is the gap a Live Doc fills, and the reason this
   * screen exists at all.
   */
  '/admin/flow/epics/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const epicId = String(params.id)
      const held = (await ctx.call('flow.epic.get', { id: epicId }, url, req)) as { value: AnyRow | null }
      const epic = held.value
      if (!epic) return text('not found', { status: 404 })
      const issues = (await ctx.call(
        'flow.issue.list',
        { listState: emptyIssueListState(), epicId, limit: 100 },
        url,
        req,
      )) as AnyRow
      const document = await ctx.joint(url, req, 'flow_backend:screen.epic', {
        docId: epicId,
        base: '/admin/flow/epics',
        lang: url.searchParams.get('lang') ?? '',
      })
      return adminPage(ctx, url, req, {
        title: String(epic.title ?? ''),
        translate: false,
        active: `/admin/flow/projects/${String(epic.projectId)}/epics`,
        body: (t, frame) =>
          epicDetailScreen(t, frame, epic, document, ((issues.rows as AnyRow[]) ?? [])),
      })
    },

  /**
   * Every document, across projects — the counterpart of `/admin/flow/issues`,
   * and the base the document endpoints above hang off.
   */
  '/admin/flow/pages': (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const pages = (await ctx.call(
        'flow.page.list',
        { search: url.searchParams.get('q') ?? '' },
        url,
        req,
      )) as AnyRow[]
      // The project each page belongs to, batched — there is no JOIN, so the
      // names come back in one `inArray` read rather than one call per row.
      const projects = (await ctx.call('flow.project.list', { limit: 200 }, url, req)) as AnyRow[]
      const named = new Map(projects.map((project) => [String(project.id), String(project.name ?? '')]))
      const rows = pages.map((page) => ({
        ...page,
        projectName: named.get(String(page.projectId)) ?? '',
      }))
      return adminPage(ctx, url, req, {
        title: 'flow_backend.pages.allTitle',
        body: (t, frame) => allPagesScreen(t, frame, t('flow_backend.pages.allTitle'), rows),
      })
    },

  /**
   * One document: its place in the tree, its title, its Live Doc, its children.
   */
  '/admin/flow/pages/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const refused = refusePost(req)
      if (refused) return refused
      const pageId = String(params.id)
      const _ = ctx.translate(ctx.localeOf(url, req))
      const endpoint = `/admin/flow/pages/${pageId}`
      let errors: string[] = []
      if (req.method === 'POST') {
        const form = await readForm(req)
        const held = (await ctx.call('flow.page.get', { id: pageId }, url, req)) as { value: AnyRow | null }
        const current = held.value
        if (!current) return text('not found', { status: 404 })
        if (form.action === 'save') {
          const result = (await ctx.call(
            'flow.page.save',
            {
              id: pageId,
              projectId: String(current.projectId),
              title: form.title ?? '',
              expectedVersion: Number(form.expectedVersion ?? current.version ?? 0),
              idempotencyKey: randomUUID(),
            },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, endpoint))
          errors = errorsOf(result, _)
        } else if (form.action === 'addChild') {
          const result = (await ctx.call(
            'flow.page.save',
            {
              id: randomUUID(),
              projectId: String(current.projectId),
              title: form.title ?? '',
              parentPageId: pageId,
              idempotencyKey: randomUUID(),
            },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, `/admin/flow/pages/${String(result.id)}`))
          errors = errorsOf(result, _)
        } else if (form.action === 'move') {
          const result = (await ctx.call(
            'flow.page.move',
            { id: pageId, parentPageId: form.parentPageId || null },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, endpoint))
          errors = errorsOf(result, _)
        } else if (form.action === 'orderUp' || form.action === 'orderDown') {
          const result = (await ctx.call(
            'flow.page.reorder',
            { id: pageId, direction: form.action === 'orderUp' ? 'up' : 'down' },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, endpoint))
          errors = errorsOf(result, _)
        } else if (form.action === 'archive') {
          const result = (await ctx.call('flow.page.archive', { id: pageId }, url, req)) as AnyRow
          if (result.ok)
            return seeOther(inLocale(url, `/admin/flow/projects/${String(current.projectId)}/pages`))
          errors = errorsOf(result, _)
        }
      }
      const held = (await ctx.call('flow.page.get', { id: pageId }, url, req)) as { value: AnyRow | null }
      const page = held.value
      if (!page) return text('not found', { status: 404 })
      const siblings = (await ctx.call(
        'flow.page.list',
        { projectId: String(page.projectId) },
        url,
        req,
      )) as AnyRow[]
      const editor = await ctx.joint(url, req, 'flow_backend:screen.page', {
        docId: pageId,
        base: '/admin/flow/pages',
        lang: url.searchParams.get('lang') ?? '',
      })
      return adminPage(ctx, url, req, {
        title: String(page.title ?? ''),
        translate: false,
        // The list this page belongs to, so the sidebar keeps marking the
        // project rather than emptying out — same reason the issue detail does.
        active: `/admin/flow/projects/${String(page.projectId)}/pages`,
        body: (t, frame) =>
          pageDetailScreen(
            t,
            frame,
            page,
            endpoint,
            editor,
            [
              {
                name: 'title',
                label: t('flow_backend.pages.name'),
                value: String(page.title ?? ''),
                required: true,
              },
            ],
            [{ name: 'title', label: t('flow_backend.pages.childName'), value: '', required: true }],
            [parentField(t, siblings, pageId, page.parentPageId ? String(page.parentPageId) : '')],
            errors,
          ),
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

  /**
   * The project on a day axis.
   *
   * A flat list rather than a tree of dependencies — that is what the epic map
   * next door draws, and drawing it twice in two shapes would be two answers
   * to one question. This one answers when, and the map answers in what order.
   */
  '/admin/flow/projects/{id}/gantt':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const projectId = String(params.id)
      const project = await projectOf(ctx, url, req, projectId)
      if (!project) return text('not found', { status: 404 })
      const found = (await ctx.call('flow.issue.list', { projectId, limit: GANTT_ROWS }, url, req)) as AnyRow
      const rows = ((found.rows as AnyRow[]) ?? []).slice().sort((a, b) => {
        const left = String(a.startsOn ?? '')
        const right = String(b.startsOn ?? '')
        return left.localeCompare(right) || String(a.title).localeCompare(String(b.title))
      })
      const locale = ctx.localeOf(url, req)
      return adminPage(ctx, url, req, {
        title: String(project.name),
        translate: false,
        active: `/admin/flow/projects/${projectId}/issues`,
        body: (_, frame) =>
          ganttScreen(
            _,
            frame,
            String(project.name),
            rows,
            new Date().toISOString().slice(0, 10),
            locale.startsWith('en') ? 'en-GB' : 'vi-VN',
          ),
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
      let typeErrors: string[] = []
      let fieldErrors: string[] = []
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
        } else if (form.action === 'archiveType') {
          const archived = (await ctx.call(
            'flow.issueType.archive',
            { id: form.id ?? '' },
            url,
            req,
          )) as AnyRow
          if (archived.ok) return seeOther(inLocale(url, endpoint))
          typeErrors = errorsOf(archived, _)
        } else if (form.action === 'saveType') {
          const result = (await ctx.call(
            'flow.issueType.save',
            {
              values: {
                id: form.id || randomUUID(),
                projectId,
                code: form.code || slugify(form.name ?? ''),
                name: form.name ?? '',
                sequence: Number(form.sequence ?? 10),
              },
              idempotencyKey: randomUUID(),
            },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, endpoint))
          typeErrors = errorsOf(result, _)
        } else if (form.action === 'archiveField') {
          const archived = (await ctx.call('flow.field.archive', { id: form.id ?? '' }, url, req)) as AnyRow
          if (archived.ok) return seeOther(inLocale(url, endpoint))
          fieldErrors = errorsOf(archived, _)
        } else if (form.action === 'saveField') {
          // Options arrive as one line of text, the same way the project
          // wizard takes custom column names: a list edited as a unit.
          const labels = (form.options ?? '')
            .split(',')
            .map((label) => label.trim())
            .filter(Boolean)
          const result = (await ctx.call(
            'flow.field.save',
            {
              id: form.id || randomUUID(),
              projectId,
              code: form.code || slugify(form.name ?? ''),
              name: form.name ?? '',
              kind: form.kind || 'text',
              config: labels.length
                ? { options: labels.map((label) => ({ code: slugify(label), label })) }
                : null,
              sequence: Number(form.sequence ?? 10),
              idempotencyKey: randomUUID(),
            },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, endpoint))
          fieldErrors = errorsOf(result, _)
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
      const [columns, types, fields, tags] = await Promise.all([
        ctx.call('flow.column.list', { projectId }, url, req) as Promise<AnyRow[]>,
        ctx.call('flow.issueType.list', { projectId }, url, req) as Promise<AnyRow[]>,
        ctx.call('flow.field.list', { projectId }, url, req) as Promise<AnyRow[]>,
        ctx.call('flow.tag.list', {}, url, req) as Promise<AnyRow[]>,
      ])
      const editColumn = url.searchParams.get('editColumnId')
      const editType = url.searchParams.get('editTypeId')
      const editField = url.searchParams.get('editFieldId')
      const editTag = url.searchParams.get('editTagId')
      const editingColumn = editColumn ? columns.find((row) => String(row.id) === editColumn) : undefined
      const editingType = editType ? types.find((row) => String(row.id) === editType) : undefined
      const editingField = editField ? fields.find((row) => String(row.id) === editField) : undefined
      const editingTag = editTag ? tags.find((row) => String(row.id) === editTag) : undefined
      const brief = await ctx.joint(url, req, 'flow_backend:screen.project', {
        docId: projectId,
        base: '/admin/flow/projects',
        lang: url.searchParams.get('lang') ?? '',
      })
      return adminPage(ctx, url, req, {
        title: String(project.name),
        translate: false,
        body: (_, frame) =>
          settingsScreen(_, frame, String(project.name), endpoint, {
            brief,
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
            types,
            editingTypeId: editingType ? String(editingType.id) : undefined,
            typeFields: [
              {
                name: 'name',
                label: _('flow_backend.field.name'),
                required: true,
                value: String(editingType?.name ?? ''),
              },
              { name: 'code', label: _('flow_backend.field.code'), value: String(editingType?.code ?? '') },
              {
                name: 'sequence',
                label: _('flow_backend.field.sequence'),
                type: 'number',
                value: String(editingType?.sequence ?? 10),
              },
            ],
            typeErrors,
            fields,
            editingFieldId: editingField ? String(editingField.id) : undefined,
            fieldFields: [
              {
                name: 'name',
                label: _('flow_backend.field.name'),
                required: true,
                value: String(editingField?.name ?? ''),
              },
              { name: 'code', label: _('flow_backend.field.code'), value: String(editingField?.code ?? '') },
              {
                name: 'kind',
                label: _('flow_backend.field.kind'),
                type: 'select',
                value: String(editingField?.kind ?? 'text'),
                options: FIELD_KINDS.map((kind) => ({
                  value: kind,
                  label: _(`flow_backend.kind.${kind}`),
                })),
              },
              {
                name: 'options',
                label: _('flow_backend.field.options'),
                help: _('flow_backend.field.optionsHint'),
                value: (((editingField?.config as AnyRow | null)?.options as AnyRow[] | undefined) ?? [])
                  .map((option) => String(option.label ?? option.code))
                  .join(', '),
              },
              {
                name: 'sequence',
                label: _('flow_backend.field.sequence'),
                type: 'number',
                value: String(editingField?.sequence ?? 10),
              },
            ],
            fieldErrors,
            tagErrors,
          }),
      })
    },
}
