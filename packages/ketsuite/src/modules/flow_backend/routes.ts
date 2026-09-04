import { randomUUID } from 'node:crypto'
import { encodeListState, parseListState, table, text } from '@ketvietlab/ketjs'
import type { IncomingMessage } from 'node:http'
import type { ListState, Row, Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { FIELD_KINDS, ISSUE_PRIORITIES } from '../flow/types.ts'
import { emptyIssueListState, issueListSearch } from '../flow/search.ts'
import { adminPage, inLocale, localeQuery, resultErrors } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'
import type { FormField } from '../../ui/index.ts'
import { modalWorkspace } from '../../ui/index.ts'
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
import { pageOf } from '../backend/paging.ts'
import {
  boardScreen,
  epicsScreen,
  epicDetailScreen,
  allEpicsScreen,
  issueDetailScreen,
  issueCreateModal,
  issuesScreen,
  ganttScreen,
  mapScreen,
  crossProjectScreen,
  pagesScreen,
  projectPageCreateFields,
  projectEpicCreateFields,
  pageDetailScreen,
  allPagesScreen,
  projectCreateModal,
  projectsListScreen,
  settingsScreen,
  sprintsScreen,
  TEMPLATE_OPTIONS,
} from './screens/index.ts'
import type { IssueDetailControls, PageDetailAction, SettingsEditorKind } from './screens/index.ts'
import { receiveAttachment } from '../storage/routes.ts'
import { documentRoutes } from '../livedoc/index.ts'
import type { DocumentOwner } from '../livedoc/index.ts'

type Translator = ReturnType<ServeContext['translate']>

/** Domain reads stay bounded; the map assembles complete epics one page at a time. */
const MAP_BATCH_SIZE = 200

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

const allGanttIssues = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  projectId: string,
): Promise<AnyRow[]> => {
  const rows: AnyRow[] = []
  let total = Number.POSITIVE_INFINITY
  while (rows.length < total) {
    const found = (await ctx.call(
      'flow.issue.list',
      { projectId, cursor: String(rows.length), limit: GANTT_ROWS },
      url,
      req,
    )) as AnyRow
    const batch = (found.rows as AnyRow[]) ?? []
    total = Number(found.total ?? rows.length + batch.length)
    rows.push(...batch)
    if (batch.length === 0) break
  }
  return rows
}

const ganttPageHref = (url: URL, page: number): string => {
  const target = new URL(url)
  if (page <= 1) target.searchParams.delete('page')
  else target.searchParams.set('page', String(page))
  return `${target.pathname}${target.search}`
}

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
    const allCount = options.mine
      ? Number(
          (
            (await ctx.call(
              'flow.issue.buckets',
              { listState: emptyIssueListState(), today },
              url,
              req,
            )) as AnyRow
          ).total ?? 0,
        )
      : Number(buckets.total ?? 0)
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
      overdue: row.terminal !== true && !!row.dueDate && String(row.dueDate) < today,
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
        const at = url.searchParams.get('view') ?? (options.mine ? 'mine' : 'all')
        return crossProjectScreen(_, frame, _(options.title), grouped ? [] : marked, groups, {
          total: Number(buckets.total ?? 0),
          done: Number(buckets.done ?? 0),
          overdue: Number(buckets.overdue ?? 0),
          waiting: Number(buckets.waiting ?? 0),
          working: Number(buckets.working ?? 0),
          mine: mineCount,
          late: ((late.rows as AnyRow[]) ?? []).slice(0, 5),
          tab: at,
          locale: localeQuery(url),
          tabs: [
            {
              id: 'all',
              label: _('flow_backend.issues.tabAll'),
              href: '/admin/flow/issues',
              count: allCount,
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

/** The move form's one control: every page except this one and its descendants. */
const parentField = (_: Translator, pages: readonly AnyRow[], pageId: string, current: string): FormField => {
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
  const options = [
    { value: '', label: _('flow_backend.pages.root') },
    ...pages
      .filter((page) => !banned.has(String(page.id)))
      .map((page) => ({ value: String(page.id), label: String(page.title ?? '') })),
  ]
  if (current && !options.some((option) => option.value === current)) {
    options.unshift({ value: current, label: current })
  }
  return {
    name: 'parentPageId',
    label: _('flow_backend.pages.parent'),
    type: 'select',
    value: current,
    options,
  }
}

const projectCreateFields = (_: Translator, values: Record<string, string> = {}): FormField[] => [
  { name: 'key', label: _('flow_backend.field.key'), value: values.key ?? '', required: true },
  { name: 'name', label: _('flow_backend.field.name'), value: values.name ?? '', required: true },
  {
    name: 'description',
    label: _('flow_backend.field.description'),
    type: 'textarea',
    value: values.description ?? '',
    span: 'full',
  },
  {
    name: 'template',
    label: _('flow_backend.field.template'),
    type: 'select',
    value: values.template ?? 'simple',
    options: TEMPLATE_OPTIONS(_),
  },
  {
    name: 'customColumns',
    label: _('flow_backend.field.customColumns'),
    help: _('flow_backend.field.customColumnsHint'),
    value: values.customColumns ?? '',
    span: 'full',
  },
]

/** Only the project collection is a valid create-form return target. */
const projectReturnTo = (url: URL, requested?: string | null): string => {
  const fallback = inLocale(url, '/admin/flow/projects')
  if (!requested) return fallback
  try {
    const target = new URL(requested, url)
    if (target.origin !== url.origin || target.pathname !== '/admin/flow/projects') return fallback
    return `${target.pathname}${target.search}`
  } catch {
    return fallback
  }
}

const projectCreateHref = (url: URL): string => {
  const target = new URL(url)
  target.pathname = '/admin/flow/projects'
  for (const key of [
    'create',
    'invalid',
    'error',
    'id',
    'idempotencyKey',
    'key',
    'name',
    'description',
    'template',
    'customColumns',
  ])
    target.searchParams.delete(key)
  target.searchParams.set('create', '1')
  return `${target.pathname}${target.search}`
}

const projectCreateFailureHref = (
  url: URL,
  returnTo: string,
  values: Record<string, string>,
  errors: readonly string[],
): string => {
  const target = new URL(returnTo, url)
  target.searchParams.set('create', '1')
  if (errors.length) target.searchParams.set('invalid', '1')
  for (const name of ['id', 'idempotencyKey', 'key', 'name', 'description', 'template', 'customColumns']) {
    const value = values[name]
    if (value) target.searchParams.set(name, value)
  }
  for (const error of errors) target.searchParams.append('error', error)
  return `${target.pathname}${target.search}`
}

type IssueCreateValues = Record<string, string>

const issueCreateValues = (values: IssueCreateValues = {}): IssueCreateValues => ({
  title: values.title ?? '',
  columnId: values.columnId ?? '',
  priority: values.priority || 'normal',
})

const issueCreateFields = (
  _: Translator,
  columns: readonly AnyRow[],
  values: IssueCreateValues = {},
): FormField[] => {
  const held = issueCreateValues(values)
  const columnOptions = columns.map((column) => ({
    value: String(column.id),
    label: String(column.name),
  }))
  if (held.columnId && !columnOptions.some((option) => option.value === held.columnId)) {
    columnOptions.unshift({ value: held.columnId, label: held.columnId })
  }
  return [
    { name: 'title', label: _('flow_backend.field.title'), value: held.title, required: true },
    {
      name: 'columnId',
      label: _('flow_backend.field.column'),
      type: 'select',
      value: held.columnId || String(columns[0]?.id ?? ''),
      options: columnOptions,
    },
    {
      name: 'priority',
      label: _('flow_backend.field.priority'),
      type: 'select',
      value: held.priority,
      options: ISSUE_PRIORITIES.map((value) => ({
        value,
        label: _.resolves(`flow.priority.${value}`) ? _(`flow.priority.${value}`) : value,
      })),
    },
  ]
}

const projectIssuesCollection = (url: URL, projectId: string): string => {
  const target = new URL(url)
  target.pathname = `/admin/flow/projects/${encodeURIComponent(projectId)}/issues`
  for (const key of ['create', 'invalid', 'error', 'title', 'columnId', 'priority', 'returnTo'])
    target.searchParams.delete(key)
  return `${target.pathname}${target.search}`
}

const projectIssuesReturnTo = (url: URL, projectId: string, requested?: string | null): string => {
  const fallback = projectIssuesCollection(url, projectId)
  if (!requested) return fallback
  try {
    const target = new URL(requested, url)
    const expected = `/admin/flow/projects/${encodeURIComponent(projectId)}/issues`
    if (target.origin !== url.origin || target.pathname !== expected) return fallback
    return projectIssuesCollection(target, projectId)
  } catch {
    return fallback
  }
}

const projectIssueCreateHref = (url: URL, projectId: string): string => {
  const target = new URL(projectIssuesCollection(url, projectId), url)
  target.searchParams.set('create', '1')
  return `${target.pathname}${target.search}`
}

const projectIssueCreateFailureHref = (
  url: URL,
  returnTo: string,
  values: IssueCreateValues,
  errors: readonly string[],
): string => {
  const target = new URL(returnTo, url)
  target.searchParams.set('create', '1')
  if (errors.length) target.searchParams.set('invalid', '1')
  for (const name of ['title', 'columnId', 'priority'] as const) {
    const value = values[name]
    if (value) target.searchParams.set(name, value)
  }
  for (const error of errors) target.searchParams.append('error', error)
  return `${target.pathname}${target.search}`
}

const projectPagesCollection = (url: URL, projectId: string): string => {
  const target = new URL(url)
  target.pathname = `/admin/flow/projects/${encodeURIComponent(projectId)}/pages`
  for (const key of ['create', 'invalid', 'error', 'id', 'idempotencyKey', 'title', 'parentPageId'])
    target.searchParams.delete(key)
  return `${target.pathname}${target.search}`
}

const projectPageCreateHref = (url: URL, projectId: string): string => {
  const target = new URL(projectPagesCollection(url, projectId), url)
  target.searchParams.set('create', '1')
  return `${target.pathname}${target.search}`
}

const projectPageCreateFailureHref = (
  url: URL,
  projectId: string,
  values: Record<string, string>,
  errors: readonly string[],
): string => {
  const target = new URL(projectPageCreateHref(url, projectId), url)
  if (errors.length) target.searchParams.set('invalid', '1')
  for (const name of ['id', 'idempotencyKey', 'title', 'parentPageId']) {
    const value = values[name]
    if (value) target.searchParams.set(name, value)
  }
  for (const error of errors) target.searchParams.append('error', error)
  return `${target.pathname}${target.search}`
}

const projectEpicsCollection = (url: URL, projectId: string): string => {
  const target = new URL(url)
  target.pathname = `/admin/flow/projects/${encodeURIComponent(projectId)}/epics`
  for (const key of [
    'create',
    'invalid',
    'createError',
    'archiveError',
    'id',
    'idempotencyKey',
    'title',
    'color',
  ])
    target.searchParams.delete(key)
  return `${target.pathname}${target.search}`
}

const projectEpicCreateHref = (url: URL, projectId: string): string => {
  const target = new URL(projectEpicsCollection(url, projectId), url)
  target.searchParams.set('create', '1')
  return `${target.pathname}${target.search}`
}

const projectEpicCreateFailureHref = (
  url: URL,
  projectId: string,
  values: Record<string, string>,
  errors: readonly string[],
): string => {
  const target = new URL(projectEpicCreateHref(url, projectId), url)
  if (errors.length) target.searchParams.set('invalid', '1')
  for (const name of ['id', 'idempotencyKey', 'title', 'color']) {
    const value = values[name]
    if (value) target.searchParams.set(name, value)
  }
  for (const error of errors) target.searchParams.append('createError', error)
  return `${target.pathname}${target.search}`
}

const projectEpicArchiveFailureHref = (url: URL, projectId: string, errors: readonly string[]): string => {
  const target = new URL(projectEpicsCollection(url, projectId), url)
  for (const error of errors) target.searchParams.append('archiveError', error)
  return `${target.pathname}${target.search}`
}

const projectCreateRoute =
  (actionPath: '/admin/flow/projects' | '/admin/flow/projects/new') =>
  (ctx: ServeContext): Route =>
  async (url, req) => {
    const refused = refusePost(req)
    if (refused) return refused
    const _ = ctx.translate(ctx.localeOf(url, req))
    let errors: string[] = []
    let values: Record<string, string> = Object.fromEntries(
      ['id', 'idempotencyKey', 'key', 'name', 'description', 'template', 'customColumns']
        .map((name) => [name, url.searchParams.get(name) ?? ''])
        .filter(([, value]) => value),
    )
    let submittedReturnTo =
      url.searchParams.get('returnTo') ??
      (actionPath === '/admin/flow/projects' ? `${url.pathname}${url.search}` : null)

    if (req.method === 'POST') {
      const form = await readForm(req)
      values = form
      submittedReturnTo = form.returnTo ?? submittedReturnTo
      const names =
        form.template === 'custom'
          ? (form.customColumns ?? '')
              .split(',')
              .map((name) => name.trim())
              .filter(Boolean)
          : (COLUMN_TEMPLATES[form.template ?? 'simple'] ?? COLUMN_TEMPLATES.simple)
      if (!names.length) {
        errors = [_('flow_backend.error.customColumnsRequired')]
      } else {
        // The id and the key come from the rendered form, not from this request:
        // `project.save` upserts by id, so posting the same form twice lands on
        // the same project rather than creating a second one with its own set of
        // columns and issue types. Falling back to a fresh id keeps an older
        // cached form, or a scripted post, working.
        const id = form.id || randomUUID()
        const result = (await ctx.call(
          'flow.project.save',
          {
            values: {
              id,
              key: form.key ?? '',
              name: form.name ?? '',
              description: form.description || null,
            },
            idempotencyKey: form.idempotencyKey || randomUUID(),
          },
          url,
          req,
        )) as AnyRow
        if (result.ok) {
          for (const [index, name] of names.entries()) {
            // Derived from the project and the column code rather than fresh each
            // time: the whole create flow has to be idempotent, not just its first
            // write. A second post with a fresh id would insert a second column
            // carrying the same code, which the unique index refuses with a 500.
            const code = slugify(name)
            const column = (await ctx.call(
              'flow.column.save',
              {
                values: {
                  id: `${id}:column:${code}`,
                  projectId: id,
                  code,
                  name,
                  sequence: (index + 1) * 10,
                  terminalState: index === names.length - 1,
                },
                idempotencyKey: `${id}:column:${code}`,
              },
              url,
              req,
            )) as AnyRow
            if (!column.ok) return seeOther(inLocale(url, `/admin/flow/projects/${id}/settings`))
          }
          for (const [index, name] of (TYPE_TEMPLATES[form.template ?? 'simple'] ??
            TYPE_TEMPLATES.simple)!.entries()) {
            const code = slugify(name)
            // Same reason as the columns above, and the result is checked rather
            // than dropped: a type that failed to seed left no trace at all.
            const type = (await ctx.call(
              'flow.issueType.save',
              {
                values: {
                  id: `${id}:type:${code}`,
                  projectId: id,
                  code,
                  name,
                  sequence: (index + 1) * 10,
                },
                idempotencyKey: `${id}:type:${code}`,
              },
              url,
              req,
            )) as AnyRow
            if (!type.ok) return seeOther(inLocale(url, `/admin/flow/projects/${id}/settings`))
          }
          return seeOther(inLocale(url, `/admin/flow/projects/${id}/board`))
        }
        errors = errorsOf(result, _)
      }
    } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })

    const returnTo = projectReturnTo(url, submittedReturnTo)
    return seeOther(projectCreateFailureHref(url, returnTo, values, errors))
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

  /**
   * Where a file on an issue is posted.
   *
   * `receiveAttachment` is storage's own reader — it is the one thing on this
   * screen that needs the raw request body, which a `defineFn` handler cannot
   * reach (`Ctx.storage` exists only on a job context). The read check runs
   * first so a caller who cannot see the issue cannot attach to it either.
   */
  '/admin/flow/issues/{id}/attachments':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const refused = onlyPost(req)
      if (refused) return refused
      const issueId = String(params.id)
      if (!(await readable(ctx, url, req, issueId))) return text('forbidden', { status: 403 })
      await receiveAttachment(ctx, url, req, {
        resModel: 'flow.Issue',
        resId: issueId,
        resField: 'attachment',
        public: false,
      })
      return seeOther(inLocale(url, `/admin/flow/issues/${encodeURIComponent(issueId)}`))
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
      let submitted: Record<string, string> = {}
      let renderedIdempotencyKey: string = randomUUID()
      if (req.method === 'POST') {
        const form = await readForm(req)
        submitted = form
        const action = form.action ?? ''
        renderedIdempotencyKey = form.idempotencyKey || renderedIdempotencyKey
        const idempotencyKey = renderedIdempotencyKey
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
      // Files on this issue. `storage.listAttachments` is the same read the CRM
      // case screen makes; nothing about it is Flow's.
      const [attachments, fieldDefs] = await Promise.all([
        // `resField` is not optional here in practice: the same record also
        // carries `content`, which is Live Doc's flattened CRDT snapshot.
        // Listing without it put those blobs in the attachment panel as though
        // somebody had uploaded them, and offered them for download.
        ctx.call(
          'storage.listAttachments',
          { resModel: 'flow.Issue', resId: issueId, resField: 'attachment' },
          url,
          req,
        ) as Promise<AnyRow[]>,
        ctx.call('flow.field.list', { projectId: String(issue.projectId) }, url, req) as Promise<AnyRow[]>,
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
            attachments,
            fieldDefs,
            editor,
            errors,
            submitted,
            locale: localeQuery(url),
            dialog:
              url.searchParams.get('dialog') === 'move' || url.searchParams.get('dialog') === 'assignSprint'
                ? (url.searchParams.get('dialog') as 'move' | 'assignSprint')
                : undefined,
            idempotencyKey: renderedIdempotencyKey,
          }),
      })
    },

  '/admin/flow/projects/new': projectCreateRoute('/admin/flow/projects/new'),

  '/admin/flow/projects':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST') return projectCreateRoute('/admin/flow/projects')(ctx)(url, req, {})
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })

      const _ = ctx.translate(ctx.localeOf(url, req))
      const all = (await ctx.call('flow.project.list', { limit: 200 }, url, req)) as AnyRow[]
      const stats = (await ctx.call(
        'flow.project.stats',
        { projectIds: all.map((project) => String(project.id)) },
        url,
        req,
      )) as AnyRow[]
      const statsBy = new Map(stats.map((row) => [String(row.id), row]))
      const counted = all.map((project) => ({ ...project, ...statsBy.get(String(project.id)) }))

      const tab = url.searchParams.get('tab') === 'mine' ? 'mine' : 'all'
      const mine = (await ctx.call(
        'flow.issue.list',
        { mine: true, listState: emptyIssueListState(), limit: 200 },
        url,
        req,
      )) as AnyRow
      const mineProjects = new Set(((mine.rows as AnyRow[]) ?? []).map((issue) => String(issue.projectId)))
      const rows =
        tab === 'mine' ? counted.filter((project) => mineProjects.has(String(project.id))) : counted

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
        body: (_, frame) => {
          const workspace = projectsListScreen(_, frame, {
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
            createHref: projectCreateHref(url),
            locale: localeQuery(url),
          })
          if (url.searchParams.get('create') !== '1') return workspace
          const returnUrl = new URL(url)
          for (const key of [
            'create',
            'invalid',
            'error',
            'id',
            'idempotencyKey',
            'key',
            'name',
            'description',
            'template',
            'customColumns',
          ])
            returnUrl.searchParams.delete(key)
          const returnTo = `${returnUrl.pathname}${returnUrl.search}`
          const errors = url.searchParams.getAll('error')
          return modalWorkspace(
            workspace,
            projectCreateModal(_, {
              action: projectCreateHref(url),
              cancelHref: returnTo,
              returnTo,
              // Kept across a failed submit so the retry lands on the same project.
              recordId: url.searchParams.get('id') || randomUUID(),
              idempotencyKey: url.searchParams.get('idempotencyKey') || randomUUID(),
              fields: projectCreateFields(
                _,
                Object.fromEntries(
                  ['key', 'name', 'description', 'template', 'customColumns']
                    .map((name) => [name, url.searchParams.get(name) ?? ''])
                    .filter(([, value]) => value),
                ),
              ),
              errors: errors.length
                ? errors
                : url.searchParams.get('invalid') === '1'
                  ? [_('flow_backend.error.invalid')]
                  : undefined,
            }),
          )
        },
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
          locale: localeQuery(url),
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
      let values = issueCreateValues(
        Object.fromEntries(
          ['title', 'columnId', 'priority']
            .map((name) => [name, url.searchParams.get(name) ?? ''])
            .filter(([, value]) => value),
        ),
      )
      if (req.method === 'POST') {
        const form = await readForm(req)
        values = issueCreateValues(form)
        const returnTo = projectIssuesReturnTo(url, projectId, form.returnTo)
        const result = (await ctx.call(
          'flow.issue.save',
          {
            id: randomUUID(),
            projectId,
            columnId: values.columnId || String(columns[0]?.id ?? ''),
            title: values.title,
            priority: values.priority || undefined,
            idempotencyKey: form.idempotencyKey || randomUUID(),
          },
          url,
          req,
        )) as AnyRow
        if (result.ok) return seeOther(returnTo)
        return seeOther(projectIssueCreateFailureHref(url, returnTo, values, errorsOf(result, _)))
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      // The project's own fields have to be in the spec before the URL is
      // parsed: a rule naming a field the spec does not know is dropped as
      // unknown, and the filter would silently do nothing.
      const fieldDefs = (await ctx.call('flow.field.list', { projectId }, url, req)) as AnyRow[]
      const spec = issueListSearch(table(ctx.manifest, 'flow.Issue'), fieldDefs)
      const listUrl = new URL(projectIssuesCollection(url, projectId), url)
      const parsed = parseListState(spec, listUrl)
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
        ? await loadListGroups(ctx, listUrl, req, state, timezone, {
            groupFunction: 'flow.issue.group',
            listFunction: 'flow.issue.list',
            listArgs: { projectId },
            label: (_field, value) => String(value ?? '—'),
          })
        : []
      return adminPage(ctx, url, req, {
        title: String(project.name),
        translate: false,
        active: `/admin/flow/projects/${projectId}/issues`,
        body: (_, frame) => {
          frame.chrome = {
            search: {
              name: 'q',
              value: state.q ?? '',
              placeholder: _('flow_backend.search.issues'),
              keep: keepForListSearch(listUrl),
              facets: listFacets(_, listUrl, state, spec),
              menus: listMenus(_, listUrl, state, spec),
            },
            pager: grouped
              ? null
              : pager(listUrl, state, ((result.rows as AnyRow[]) ?? []).length, Number(result.total ?? 0)),
          }
          const returnTo = projectIssuesCollection(url, projectId)
          const workspace = issuesScreen(_, frame, {
            projectName: String(project.name),
            rows: grouped ? [] : ((result.rows as AnyRow[]) ?? []),
            groups,
            fields: fieldDefs,
            total: Number(result.total ?? 0),
            createHref: projectIssueCreateHref(url, projectId),
            locale: localeQuery(url),
          })
          if (url.searchParams.get('create') !== '1') return workspace
          const errors = url.searchParams.getAll('error')
          return modalWorkspace(
            workspace,
            issueCreateModal(_, {
              projectName: String(project.name),
              fields: issueCreateFields(_, columns, values),
              action: projectIssueCreateHref(url, projectId),
              cancelHref: returnTo,
              idempotencyKey: randomUUID(),
              errors: errors.length
                ? errors
                : url.searchParams.get('invalid') === '1'
                  ? [_('flow_backend.error.invalid')]
                  : undefined,
            }),
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
      if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
      const projectId = String(params.id)
      const _ = ctx.translate(ctx.localeOf(url, req))
      const endpoint = `/admin/flow/projects/${encodeURIComponent(projectId)}/pages`
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
              idempotencyKey: form.idempotencyKey || randomUUID(),
            },
            url,
            req,
          )) as AnyRow
          if (result.ok)
            return seeOther(inLocale(url, `/admin/flow/pages/${encodeURIComponent(String(result.id))}`))
          return seeOther(projectPageCreateFailureHref(url, projectId, form, errorsOf(result, _)))
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
        body: (t, frame) => {
          const errors = url.searchParams.getAll('error')
          return pagesScreen(t, frame, {
            projectName: String(project.name ?? ''),
            pages,
            createHref: projectPageCreateHref(url, projectId),
            createFields: projectPageCreateFields(t, pages, {
              title: url.searchParams.get('title') ?? '',
              parentPageId: url.searchParams.get('parentPageId') ?? '',
            }),
            createAction: projectPageCreateHref(url, projectId),
            closeHref: projectPagesCollection(url, projectId),
            locale: localeQuery(url),
            createOpen: url.searchParams.get('create') === '1',
            errors: errors.length
              ? errors
              : url.searchParams.get('invalid') === '1'
                ? [t('flow_backend.error.invalid')]
                : undefined,
            recordId: url.searchParams.get('id') || randomUUID(),
            idempotencyKey: url.searchParams.get('idempotencyKey') || randomUUID(),
          })
        },
      })
    },

  /**
   * Every epic, across projects. Reached from the menu, and the base the epic
   * document endpoints above hang off.
   */
  '/admin/flow/epics':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const search = url.searchParams.get('q') ?? ''
      const currentPage = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1)
      const cursor = (currentPage - 1) * LIST_PAGE_SIZE
      const result = (await ctx.call(
        'flow.epic.listAll',
        { search, cursor, limit: LIST_PAGE_SIZE },
        url,
        req,
      )) as { rows: AnyRow[]; total: number }
      const pageHref = (page: number): string => {
        const target = new URL(url)
        if (page <= 1) target.searchParams.delete('page')
        else target.searchParams.set('page', String(page))
        return `${target.pathname}${target.search}`
      }
      return adminPage(ctx, url, req, {
        title: 'flow_backend.epics.allTitle',
        body: (t, frame) => {
          frame.chrome = {
            search: {
              name: 'q',
              value: search,
              placeholder: t('flow_backend.epics.search'),
              keep: keepForListSearch(url),
            },
            pager: {
              from: result.rows.length ? cursor + 1 : 0,
              to: Math.min(cursor + result.rows.length, result.total),
              total: result.total,
              prev: currentPage > 1 ? pageHref(currentPage - 1) : null,
              next: cursor + result.rows.length < result.total ? pageHref(currentPage + 1) : null,
            },
          }
          return allEpicsScreen(t, frame, {
            title: t('flow_backend.epics.allTitle'),
            epics: result.rows,
            total: result.total,
            locale: localeQuery(url),
          })
        },
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
      const projectId = String(epic.projectId)
      // Project identity enriches the shell when this reader may see it, but
      // is not a second gate on an epic they may already read.
      const project = await projectOf(ctx, url, req, projectId)
      const issues = (await ctx.call(
        'flow.issue.list',
        {
          listState: emptyIssueListState(),
          projectId,
          epicId,
          limit: LIST_PAGE_SIZE,
        },
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
        active: `/admin/flow/projects/${encodeURIComponent(projectId)}/epics`,
        body: (t, frame) =>
          epicDetailScreen(t, frame, {
            epic,
            document,
            issues: (issues.rows as AnyRow[]) ?? [],
            issueTotal: Number(issues.total ?? 0),
            issuesHref: issuesFilteredBy(projectId, 'epicId', epicId),
            projectName: String(project?.name ?? projectId),
            locale: localeQuery(url),
          }),
      })
    },

  /**
   * Every document, across projects — the counterpart of `/admin/flow/issues`,
   * and the base the document endpoints above hang off.
   */
  '/admin/flow/pages':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const search = url.searchParams.get('q') ?? ''
      const pages = (await ctx.call('flow.page.list', { search, limit: 500 }, url, req)) as AnyRow[]
      // The project each page belongs to, batched — there is no JOIN, so the
      // names come back in one `inArray` read rather than one call per row.
      const projects = (await ctx.call('flow.project.list', { limit: 200 }, url, req)) as AnyRow[]
      const named = new Map(projects.map((project) => [String(project.id), String(project.name ?? '')]))
      const namedPages = pages.map((page) => ({
        ...page,
        projectName: named.get(String(page.projectId)) ?? '',
      }))
      const currentPage = Math.max(1, Number(url.searchParams.get('page') ?? 1) || 1)
      const cursor = (currentPage - 1) * LIST_PAGE_SIZE
      const rows = namedPages.slice(cursor, cursor + LIST_PAGE_SIZE)
      const pageHref = (page: number): string => {
        const target = new URL(url)
        if (page <= 1) target.searchParams.delete('page')
        else target.searchParams.set('page', String(page))
        return `${target.pathname}${target.search}`
      }
      return adminPage(ctx, url, req, {
        title: 'flow_backend.pages.allTitle',
        body: (t, frame) => {
          frame.chrome = {
            search: {
              name: 'q',
              value: search,
              placeholder: t('flow_backend.pages.search'),
              keep: keepForListSearch(url),
            },
            pager: {
              from: rows.length ? cursor + 1 : 0,
              to: Math.min(cursor + rows.length, namedPages.length),
              total: namedPages.length,
              prev: currentPage > 1 ? pageHref(currentPage - 1) : null,
              next: cursor + rows.length < namedPages.length ? pageHref(currentPage + 1) : null,
            },
          }
          return allPagesScreen(t, frame, {
            title: t('flow_backend.pages.allTitle'),
            pages: rows,
            total: namedPages.length,
            locale: localeQuery(url),
          })
        },
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
      const endpoint = `/admin/flow/pages/${encodeURIComponent(pageId)}`
      let errors: { action: PageDetailAction; messages: string[] } | undefined
      let submitted: Record<string, string> = {}
      if (req.method === 'POST') {
        const form = await readForm(req)
        submitted = form
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
              idempotencyKey: form.idempotencyKey || randomUUID(),
            },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, endpoint))
          errors = { action: 'save', messages: errorsOf(result, _) }
        } else if (form.action === 'addChild') {
          const result = (await ctx.call(
            'flow.page.save',
            {
              id: form.childId || randomUUID(),
              projectId: String(current.projectId),
              title: form.title ?? '',
              parentPageId: pageId,
              idempotencyKey: form.idempotencyKey || randomUUID(),
            },
            url,
            req,
          )) as AnyRow
          if (result.ok)
            return seeOther(inLocale(url, `/admin/flow/pages/${encodeURIComponent(String(result.id))}`))
          errors = { action: 'addChild', messages: errorsOf(result, _) }
        } else if (form.action === 'move') {
          const result = (await ctx.call(
            'flow.page.move',
            { id: pageId, parentPageId: form.parentPageId || null },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, endpoint))
          errors = { action: 'move', messages: errorsOf(result, _) }
        } else if (form.action === 'orderUp' || form.action === 'orderDown') {
          const idempotencyKey = form.idempotencyKey || randomUUID()
          const result = (await ctx.call(
            'flow.page.reorder',
            { id: pageId, direction: form.action === 'orderUp' ? 'up' : 'down' },
            url,
            req,
            { idempotencyKey },
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, endpoint))
          errors = { action: form.action, messages: errorsOf(result, _) }
        } else if (form.action === 'archive') {
          const result = (await ctx.call('flow.page.archive', { id: pageId }, url, req)) as AnyRow
          if (result.ok)
            return seeOther(
              inLocale(url, `/admin/flow/projects/${encodeURIComponent(String(current.projectId))}/pages`),
            )
          errors = { action: 'archive', messages: errorsOf(result, _) }
        }
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
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
          pageDetailScreen(t, frame, {
            page,
            editor,
            titleFields: [
              {
                name: 'title',
                label: t('flow_backend.pages.name'),
                value: errors?.action === 'save' ? (submitted.title ?? '') : String(page.title ?? ''),
                required: true,
              },
            ],
            childFields: [
              {
                name: 'title',
                label: t('flow_backend.pages.childName'),
                value: errors?.action === 'addChild' ? (submitted.title ?? '') : '',
                required: true,
              },
            ],
            moveFields: [
              parentField(
                t,
                siblings,
                pageId,
                errors?.action === 'move'
                  ? (submitted.parentPageId ?? '')
                  : page.parentPageId
                    ? String(page.parentPageId)
                    : '',
              ),
            ],
            errors,
            locale: localeQuery(url),
            dialog:
              url.searchParams.get('dialog') === 'addChild' || url.searchParams.get('dialog') === 'move'
                ? (url.searchParams.get('dialog') as 'addChild' | 'move')
                : undefined,
            childId: errors?.action === 'addChild' ? submitted.childId || randomUUID() : randomUUID(),
            idempotencyKey:
              errors?.action === 'save' || errors?.action === 'addChild'
                ? submitted.idempotencyKey || randomUUID()
                : randomUUID(),
            orderUpIdempotencyKey:
              errors?.action === 'orderUp' ? submitted.idempotencyKey || randomUUID() : randomUUID(),
            orderDownIdempotencyKey:
              errors?.action === 'orderDown' ? submitted.idempotencyKey || randomUUID() : randomUUID(),
          }),
      })
    },

  '/admin/flow/projects/{id}/epics':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const refused = refusePost(req)
      if (refused) return refused
      if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
      const projectId = String(params.id)
      const project = await projectOf(ctx, url, req, projectId)
      if (!project) return text('not found', { status: 404 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const endpoint = projectEpicsCollection(url, projectId)
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.action === 'archive') {
          const held = form.id
            ? ((await ctx.call('flow.epic.get', { id: form.id }, url, req)) as {
                value: AnyRow | null
              })
            : { value: null }
          const archived =
            held.value && String(held.value.projectId) === projectId
              ? ((await ctx.call('flow.epic.archive', { id: form.id ?? '' }, url, req)) as AnyRow)
              : {
                  ok: false,
                  errors: [{ field: 'id', code: 'flow.error.notFound' }],
                }
          if (archived.ok) return seeOther(inLocale(url, endpoint))
          return seeOther(projectEpicArchiveFailureHref(url, projectId, errorsOf(archived, _)))
        } else if (!form.action || form.action === 'save') {
          const values = {
            id: form.id || randomUUID(),
            idempotencyKey: form.idempotencyKey || randomUUID(),
            title: form.title ?? '',
            color: form.color ?? '',
          }
          const result = (await ctx.call(
            'flow.epic.save',
            {
              values: {
                id: values.id,
                projectId,
                title: values.title,
                color: values.color || null,
              },
              idempotencyKey: values.idempotencyKey,
            },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, endpoint))
          return seeOther(projectEpicCreateFailureHref(url, projectId, values, errorsOf(result, _)))
        } else return text('invalid action', { status: 400 })
      }
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
        active: `/admin/flow/projects/${encodeURIComponent(projectId)}/epics`,
        body: (t, frame) => {
          const createErrors = url.searchParams.getAll('createError')
          return epicsScreen(t, frame, {
            projectName: String(project.name),
            epics: withCounts,
            action: endpoint,
            closeHref: endpoint,
            createAction: projectEpicCreateHref(url, projectId),
            createHref: projectEpicCreateHref(url, projectId),
            createOpen: url.searchParams.get('create') === '1',
            createFields: projectEpicCreateFields(t, {
              title: url.searchParams.get('title') ?? '',
              color: url.searchParams.get('color') ?? '',
            }),
            createErrors: createErrors.length
              ? createErrors
              : url.searchParams.get('invalid') === '1'
                ? [t('flow_backend.error.invalid')]
                : undefined,
            recordId: url.searchParams.get('id') || randomUUID(),
            idempotencyKey: url.searchParams.get('idempotencyKey') || randomUUID(),
            locale: localeQuery(url),
            errors: url.searchParams.getAll('archiveError'),
          })
        },
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
      const [epics, columns, firstPage] = await Promise.all([
        ctx.call(
          'flow.epic.list',
          { projectId, id: epicId, includeArchived: true, limit: 1 },
          url,
          req,
        ) as Promise<AnyRow[]>,
        ctx.call('flow.column.list', { projectId }, url, req) as Promise<AnyRow[]>,
        ctx.call(
          'flow.issue.list',
          { projectId, epicId, cursor: '0', limit: MAP_BATCH_SIZE },
          url,
          req,
        ) as Promise<AnyRow>,
      ])
      const epic = epics[0]
      if (!epic) return text('not found', { status: 404 })
      const terminalColumnIds = new Set(
        columns.filter((column) => column.terminalState).map((column) => String(column.id)),
      )
      const issues = [...((firstPage.rows as AnyRow[]) ?? [])]
      const issueTotal = Number(firstPage.total ?? issues.length)
      while (issues.length < issueTotal) {
        const found = (await ctx.call(
          'flow.issue.list',
          {
            projectId,
            epicId,
            cursor: String(issues.length),
            limit: MAP_BATCH_SIZE,
          },
          url,
          req,
        )) as AnyRow
        const page = (found.rows as AnyRow[]) ?? []
        if (!page.length) break
        issues.push(...page)
      }
      const issueIds = issues.map((row) => String(row.id))
      const dependencyPages = await Promise.all(
        Array.from(
          { length: Math.ceil(issueIds.length / MAP_BATCH_SIZE) },
          (_, index) =>
            ctx.call(
              'flow.issue.dependencies',
              {
                issueIds: issueIds.slice(index * MAP_BATCH_SIZE, (index + 1) * MAP_BATCH_SIZE),
                includeExternalTargets: true,
              },
              url,
              req,
            ) as Promise<AnyRow[]>,
        ),
      )
      const deps = dependencyPages.flat()
      const issueIdSet = new Set(issueIds)
      const _ = ctx.translate(ctx.localeOf(url, req))
      const map = await ctx.joint(url, req, 'flow_backend:screen.map', {
        lang: ctx.localeOf(url, req),
        data: JSON.stringify({
          epicTitle: String(epic.title),
          nodes: issues.map((row) => ({
            id: row.id,
            title: row.title,
            href: inLocale(url, `/admin/flow/issues/${encodeURIComponent(String(row.id))}`),
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
        active: `/admin/flow/projects/${encodeURIComponent(projectId)}/epics`,
        body: (_, frame) =>
          mapScreen(_, frame, {
            projectName: String(project.name ?? projectId),
            epicTitle: String(epic.title),
            epicHref: inLocale(url, `/admin/flow/epics/${encodeURIComponent(epicId)}`),
            epicsHref: inLocale(url, `/admin/flow/projects/${encodeURIComponent(projectId)}/epics`),
            map,
          }),
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
      const allRows = await allGanttIssues(ctx, url, req, projectId)
      allRows.sort((a, b) => {
        const left = String(a.startsOn ?? '')
        const right = String(b.startsOn ?? '')
        return left.localeCompare(right) || String(a.title).localeCompare(String(b.title))
      })
      const currentPage = pageOf(url)
      const offset = (currentPage - 1) * GANTT_ROWS
      const rows = allRows.slice(offset, offset + GANTT_ROWS).map((row) => ({
        ...row,
        detailHref: inLocale(url, `/admin/flow/issues/${encodeURIComponent(String(row.id))}`),
      }))
      const locale = ctx.localeOf(url, req)
      return adminPage(ctx, url, req, {
        title: String(project.name),
        translate: false,
        // The project group marks whichever row this path names, so it has to be
        // this screen's own. Pointing all three at the backlog left Timeline,
        // Sprints and Settings permanently unmarked, and told the reader they
        // were on a screen they had left.
        active: `/admin/flow/projects/${encodeURIComponent(projectId)}/gantt`,
        body: (_, frame) => {
          const from = rows.length ? offset + 1 : 0
          const to = Math.min(offset + rows.length, allRows.length)
          frame.chrome = {
            pager: {
              from,
              to,
              total: allRows.length,
              prev: currentPage > 1 ? ganttPageHref(url, currentPage - 1) : null,
              next: to < allRows.length ? ganttPageHref(url, currentPage + 1) : null,
            },
          }
          return ganttScreen(
            _,
            frame,
            String(project.name),
            rows,
            new Date().toISOString().slice(0, 10),
            locale.startsWith('en') ? 'en-GB' : 'vi-VN',
          )
        },
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
      let createErrors: string[] = []
      let createValues: Record<string, string> = {}
      let recordId: string = randomUUID()
      let idempotencyKey: string = randomUUID()
      const endpoint = `/admin/flow/projects/${encodeURIComponent(projectId)}/sprints`
      const action = inLocale(url, endpoint)
      const createOpen = url.searchParams.get('dialog') === 'create'
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.action === 'start' || form.action === 'close') {
          // `startSprint` refuses a second active sprint and `closeSprint` a
          // sprint that is not running — both answer with a translated code,
          // and dropping the result reported those refusals as a success.
          const changed = (await ctx.call(
            form.action === 'start' ? 'flow.sprint.start' : 'flow.sprint.close',
            { id: form.id ?? '', idempotencyKey: form.idempotencyKey || randomUUID() },
            url,
            req,
          )) as AnyRow
          if (changed.ok) return seeOther(inLocale(url, endpoint))
          errors = errorsOf(changed, _)
        } else if (form.action === 'save') {
          recordId = form.id || recordId
          idempotencyKey = form.idempotencyKey || idempotencyKey
          createValues = form
          const result = (await ctx.call(
            'flow.sprint.save',
            {
              id: recordId,
              projectId,
              name: form.name ?? '',
              startDate: form.startDate || undefined,
              endDate: form.endDate || undefined,
              idempotencyKey,
            },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, endpoint))
          createErrors = errorsOf(result, _)
        } else return text('invalid action', { status: 400 })
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const sprints = (await ctx.call('flow.sprint.list', { projectId }, url, req)) as AnyRow[]
      return adminPage(ctx, url, req, {
        title: String(project.name),
        translate: false,
        // The project group marks whichever row this path names, so it has to be
        // this screen's own. Pointing all three at the backlog left Timeline,
        // Sprints and Settings permanently unmarked, and told the reader they
        // were on a screen they had left.
        active: `/admin/flow/projects/${encodeURIComponent(projectId)}/sprints`,
        body: (_, frame) =>
          sprintsScreen(_, frame, {
            projectName: String(project.name),
            sprints,
            action,
            createHref: inLocale(url, `${endpoint}?dialog=create`),
            closeHref: inLocale(url, endpoint),
            createOpen: createOpen || createErrors.length > 0,
            createValues,
            createErrors,
            errors,
            recordId,
            idempotencyKey,
            transitionKey: (sprint) => `sprint:${String(sprint.id)}:${String(sprint.state)}`,
          }),
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
      let submitted: Record<string, string> = {}
      let forcedEditor: SettingsEditorKind | undefined
      const endpoint = `/admin/flow/projects/${encodeURIComponent(projectId)}/settings`
      const action = inLocale(url, endpoint)
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.action === 'archiveColumn') {
          // `column.archive` refuses a column that still holds active issues,
          // which is the whole point of the check — reporting that refusal as
          // a success left the column on screen with no explanation.
          const archived = (await ctx.call('flow.column.archive', { id: form.id ?? '' }, url, req)) as AnyRow
          if (archived.ok) return seeOther(inLocale(url, endpoint))
          columnErrors = errorsOf(archived, _)
          submitted = form
          forcedEditor = 'column'
        } else if (form.action === 'archiveType') {
          const archived = (await ctx.call(
            'flow.issueType.archive',
            { id: form.id ?? '' },
            url,
            req,
          )) as AnyRow
          if (archived.ok) return seeOther(inLocale(url, endpoint))
          typeErrors = errorsOf(archived, _)
          submitted = form
          forcedEditor = 'type'
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
              idempotencyKey: form.idempotencyKey || randomUUID(),
            },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, endpoint))
          typeErrors = errorsOf(result, _)
          submitted = form
          forcedEditor = 'type'
        } else if (form.action === 'archiveField') {
          const archived = (await ctx.call('flow.field.archive', { id: form.id ?? '' }, url, req)) as AnyRow
          if (archived.ok) return seeOther(inLocale(url, endpoint))
          fieldErrors = errorsOf(archived, _)
          submitted = form
          forcedEditor = 'field'
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
              idempotencyKey: form.idempotencyKey || randomUUID(),
            },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, endpoint))
          fieldErrors = errorsOf(result, _)
          submitted = form
          forcedEditor = 'field'
        } else if (form.action === 'archiveTag') {
          const archived = (await ctx.call('flow.tag.archive', { id: form.id ?? '' }, url, req)) as AnyRow
          if (archived.ok) return seeOther(inLocale(url, endpoint))
          tagErrors = errorsOf(archived, _)
          submitted = form
          forcedEditor = 'tag'
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
              idempotencyKey: form.idempotencyKey || randomUUID(),
            },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, endpoint))
          columnErrors = errorsOf(result, _)
          submitted = form
          forcedEditor = 'column'
        } else if (form.action === 'saveTag') {
          const result = (await ctx.call(
            'flow.tag.save',
            { id: form.id || randomUUID(), name: form.name ?? '', color: form.color || undefined },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(inLocale(url, endpoint))
          tagErrors = errorsOf(result, _)
          submitted = form
          forcedEditor = 'tag'
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
      const requestedEditor = url.searchParams.get('dialog')
      const editorKind: SettingsEditorKind | undefined =
        forcedEditor ??
        (editingColumn
          ? 'column'
          : editingType
            ? 'type'
            : editingField
              ? 'field'
              : editingTag
                ? 'tag'
                : requestedEditor === 'column' ||
                    requestedEditor === 'type' ||
                    requestedEditor === 'field' ||
                    requestedEditor === 'tag'
                  ? requestedEditor
                  : undefined)
      const settingsHref = (name: string, value: string) => {
        const target = new URL(action, 'http://ket.local')
        target.searchParams.set(name, value)
        return `${target.pathname}${target.search}`
      }
      const value = (name: string, fallback: unknown = ''): string =>
        submitted[name] ?? String(fallback ?? '')
      const selected =
        editorKind === 'column'
          ? (editingColumn ?? columns.find((row) => String(row.id) === submitted.id))
          : editorKind === 'type'
            ? (editingType ?? types.find((row) => String(row.id) === submitted.id))
            : editorKind === 'field'
              ? (editingField ?? fields.find((row) => String(row.id) === submitted.id))
              : (editingTag ?? tags.find((row) => String(row.id) === submitted.id))
      const editorFields: FormField[] =
        editorKind === 'column'
          ? [
              {
                name: 'name',
                label: _('flow_backend.field.name'),
                required: true,
                value: value('name', selected?.name),
              },
              { name: 'code', label: _('flow_backend.field.code'), value: value('code', selected?.code) },
              {
                name: 'sequence',
                label: _('flow_backend.field.sequence'),
                type: 'number',
                value: value('sequence', selected?.sequence ?? 10),
              },
              {
                name: 'terminalState',
                label: _('flow_backend.field.terminalState'),
                type: 'checkbox',
                value: submitted.terminalState
                  ? submitted.terminalState === '1'
                  : selected?.terminalState === true,
              },
            ]
          : editorKind === 'type'
            ? [
                {
                  name: 'name',
                  label: _('flow_backend.field.name'),
                  required: true,
                  value: value('name', selected?.name),
                },
                { name: 'code', label: _('flow_backend.field.code'), value: value('code', selected?.code) },
                {
                  name: 'sequence',
                  label: _('flow_backend.field.sequence'),
                  type: 'number',
                  value: value('sequence', selected?.sequence ?? 10),
                },
              ]
            : editorKind === 'field'
              ? [
                  {
                    name: 'name',
                    label: _('flow_backend.field.name'),
                    required: true,
                    value: value('name', selected?.name),
                  },
                  { name: 'code', label: _('flow_backend.field.code'), value: value('code', selected?.code) },
                  {
                    name: 'kind',
                    label: _('flow_backend.field.kind'),
                    type: 'select',
                    value: value('kind', selected?.kind ?? 'text'),
                    options: FIELD_KINDS.map((kind) => ({
                      value: kind,
                      label: _(`flow_backend.kind.${kind}`),
                    })),
                  },
                  {
                    name: 'options',
                    label: _('flow_backend.field.options'),
                    help: _('flow_backend.field.optionsHint'),
                    value: value(
                      'options',
                      (((selected?.config as AnyRow | null)?.options as AnyRow[] | undefined) ?? [])
                        .map((option) => String(option.label ?? option.code))
                        .join(', '),
                    ),
                  },
                  {
                    name: 'sequence',
                    label: _('flow_backend.field.sequence'),
                    type: 'number',
                    value: value('sequence', selected?.sequence ?? 10),
                  },
                ]
              : editorKind === 'tag'
                ? [
                    {
                      name: 'name',
                      label: _('flow_backend.field.name'),
                      required: true,
                      value: value('name', selected?.name),
                    },
                    {
                      name: 'color',
                      label: _('flow_backend.field.color'),
                      type: 'color',
                      value: value('color', selected?.color),
                    },
                  ]
                : []
      const editorErrors =
        editorKind === 'column'
          ? columnErrors
          : editorKind === 'type'
            ? typeErrors
            : editorKind === 'field'
              ? fieldErrors
              : tagErrors
      const brief = await ctx.joint(url, req, 'flow_backend:screen.project', {
        docId: projectId,
        base: '/admin/flow/projects',
        lang: url.searchParams.get('lang') ?? '',
      })
      return adminPage(ctx, url, req, {
        title: String(project.name),
        translate: false,
        // The project group marks whichever row this path names, so it has to be
        // this screen's own. Pointing all three at the backlog left Timeline,
        // Sprints and Settings permanently unmarked, and told the reader they
        // were on a screen they had left.
        active: `/admin/flow/projects/${encodeURIComponent(projectId)}/settings`,
        body: (_, frame) =>
          settingsScreen(_, frame, String(project.name), {
            brief,
            endpoint: action,
            columns,
            tags,
            types,
            fields,
            createHref: {
              column: settingsHref('dialog', 'column'),
              type: settingsHref('dialog', 'type'),
              field: settingsHref('dialog', 'field'),
              tag: settingsHref('dialog', 'tag'),
            },
            editColumnHref: (row) => settingsHref('editColumnId', String(row.id)),
            editTypeHref: (row) => settingsHref('editTypeId', String(row.id)),
            editFieldHref: (row) => settingsHref('editFieldId', String(row.id)),
            editTagHref: (row) => settingsHref('editTagId', String(row.id)),
            editor: editorKind
              ? {
                  kind: editorKind,
                  title: _(`flow_backend.settings.${editorKind === 'type' ? 'types' : `${editorKind}s`}`),
                  action,
                  closeHref: action,
                  fields: editorFields,
                  errors: editorErrors,
                  recordId: submitted.id || String(selected?.id ?? randomUUID()),
                  idempotencyKey: submitted.idempotencyKey || randomUUID(),
                }
              : undefined,
          }),
      })
    },
}
