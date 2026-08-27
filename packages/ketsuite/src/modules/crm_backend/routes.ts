import { randomUUID } from 'node:crypto'
import { encodeListState, parseListState, table, text } from '@ketvietlab/ketjs'
import type { ListState, Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import { formatMoney } from '../../ui/index.ts'
import type { FormField } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { choices, adminPage, inLocale, localeQuery, optional, timezoneOf } from '../backend/screen.ts'
import { withParam } from '../backend/paging.ts'
import type { AnyRow, Req } from '../backend/screen.ts'
import type { RelationOption } from '../backend/relation-select.ts'
import { receiveAttachment } from '../storage/routes.ts'
import { caseListSearch } from '../crm/search.ts'
import {
  assigneeControl,
  caseControl,
  partnerControl,
  productControl,
  stageControl,
  tagsControl,
  teamControl,
} from './relation-control.ts'
import {
  CONFIGURATION_TABS,
  caseCreateScreen,
  caseDetailScreen,
  casesListScreen,
  configurationScreen,
  leaderboardScreen,
  plannerScreen,
  permissionScreen,
  pipelineScreen,
} from './screens/index.ts'
import type { CaseDetailControls, ConfigurationTab, PipelineFigure } from './screens/index.ts'
import {
  keepForListSearch,
  LIST_PAGE_SIZE,
  listFacets,
  listMenus,
  loadListGroups,
} from '../backend/list-search.ts'

type Translator = ReturnType<ServeContext['translate']>
const bool = (value: string | undefined) => ['1', 'true', 'on'].includes(value ?? '')
const errorsOf = (result: unknown, _: Translator) =>
  (((result as AnyRow | null)?.errors as AnyRow[] | undefined) ?? []).map((error) => {
    const code = String(error.code ?? '')
    return code && _.resolves(code)
      ? _(code, error.params as Record<string, unknown>)
      : String(error.message ?? code)
  })

/**
 * The two things every mutating route here has to establish before it reads a form.
 *
 * The admin authenticates with a session cookie, so a POST arriving from another
 * origin carries the signed-in user's credentials without their intent. Every
 * write in this module refuses one, the same way product_backend, user_backend
 * and company_backend do — the CRM was the module that never got the guard.
 */
const crossSite = (req: Req): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}
const refusePost = (req: Req) =>
  req.method === 'POST' && crossSite(req) ? text('Forbidden', { status: 403 }) : null
const onlyPost = (req: Req) =>
  req.method !== 'POST'
    ? text('POST', { status: 405 })
    : crossSite(req)
      ? text('Forbidden', { status: 403 })
      : null

const configuration = (ctx: ServeContext, url: URL, req: Req) =>
  ctx.call('crm.configuration.get', {}, url, req) as Promise<Record<string, AnyRow[]>>

/**
 * The rows a form needs to render its relational fields before the picker has
 * loaded anything.
 *
 * Deliberately small: the picker searches server-side from the first keystroke,
 * so the page only has to carry enough to label what is already chosen and to
 * fill the menu that opens before the dialog does.
 */
const PRELOAD = 40
const references = async (ctx: ServeContext, url: URL, req: Req) => {
  const [config, partners, users, tags] = await Promise.all([
    configuration(ctx, url, req),
    ctx.call('partner.listPartners', { includeArchived: false, limit: PRELOAD }, url, req) as Promise<
      AnyRow[]
    >,
    ctx.call('user.listUsers', { includeArchived: false, limit: PRELOAD }, url, req) as Promise<AnyRow[]>,
    ctx.call('crm.tag.list', { limit: PRELOAD }, url, req) as Promise<AnyRow[]>,
  ])
  return { config, partners, users, tags }
}

type References = Awaited<ReturnType<typeof references>>
const options = (rows: readonly AnyRow[]): RelationOption[] =>
  rows.map((row) => ({ value: String(row.id), label: String(row.name ?? row.code ?? row.id) }))

const caseFields = (
  _: Translator,
  row: AnyRow = {},
  controls: {
    partner?: JSXChild
    team?: JSXChild
    assignee?: JSXChild
    tags?: JSXChild
    stage?: JSXChild
  } = {},
): FormField[] => [
  {
    name: 'name',
    label: _('crm_backend.field.name'),
    value: String(row.name ?? ''),
    required: true,
    span: 'full',
  },
  {
    name: 'kind',
    label: _('crm_backend.field.kind'),
    type: 'select',
    value: String(row.kind ?? 'lead'),
    disabled: Boolean(row.id),
    required: true,
    options: ['lead', 'opportunity'].map((value) => ({ value, label: _(`crm.kind.${value}`) })),
  },
  /*
   * Only where creating one. On a record that already exists the stage is moved
   * by the action beside the form, which records the move on the timeline and
   * refuses a stale version; a second field quietly writing the same column would
   * be a change nobody could later account for.
   */
  ...(controls.stage
    ? [{ name: 'stageId', label: _('crm_backend.field.stage'), control: controls.stage }]
    : []),
  { name: 'partnerId', label: _('crm_backend.field.partner'), control: controls.partner },
  { name: 'contactName', label: _('crm_backend.field.contactName'), value: String(row.contactName ?? '') },
  { name: 'email', label: _('crm_backend.field.email'), type: 'email', value: String(row.email ?? '') },
  { name: 'phone', label: _('crm_backend.field.phone'), type: 'tel', value: String(row.phone ?? '') },
  { name: 'teamId', label: _('crm_backend.field.team'), control: controls.team },
  { name: 'assigneeUserId', label: _('crm_backend.field.assignee'), control: controls.assignee },
  {
    name: 'priority',
    label: _('crm_backend.field.priority'),
    type: 'select',
    value: String(row.priority ?? '1'),
    options: ['0', '1', '2', '3'].map((value) => ({ value, label: _(`crm_backend.priority.${value}`) })),
  },
  { name: 'tagIds', label: _('crm_backend.field.tags'), control: controls.tags, span: 'full' },
  {
    name: 'expectedRevenue',
    label: _('crm_backend.field.expectedRevenue'),
    type: 'decimal',
    value: String((row.salesDetail as AnyRow | undefined)?.expectedRevenue ?? 0),
  },
  {
    name: 'probability',
    label: _('crm_backend.field.probability'),
    type: 'decimal',
    value: String((row.salesDetail as AnyRow | undefined)?.probability ?? 0),
  },
  {
    name: 'expectedClosing',
    label: _('crm_backend.field.expectedClosing'),
    type: 'date',
    value: String((row.salesDetail as AnyRow | undefined)?.expectedClosing ?? ''),
  },
  {
    name: 'description',
    label: _('crm_backend.field.description'),
    type: 'textarea',
    value: String(row.description ?? ''),
    span: 'full',
  },
]

const caseControls = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  _: Translator,
  data: References,
  prefix: string,
  row: AnyRow = {},
  /** The stage picker belongs to the create form only — see the note in `caseFields`. */
  wants: { stage?: boolean } = {},
) => {
  const tags = ((row.tags as AnyRow[] | undefined) ?? []).map((tag) => String(tag.id))
  const [partner, team, assignee, tagPicker, stage] = await Promise.all([
    partnerControl(ctx, url, req, _, {
      id: `${prefix}-partner`,
      value: row.partnerId ? String(row.partnerId) : null,
      partners: options(data.partners),
    }),
    teamControl(ctx, url, req, _, {
      id: `${prefix}-team`,
      value: row.teamId ? String(row.teamId) : null,
      teams: options(data.config.teams ?? []),
    }),
    assigneeControl(ctx, url, req, _, {
      id: `${prefix}-assignee`,
      value: row.assigneeUserId ? String(row.assigneeUserId) : null,
      users: options(data.users),
    }),
    tagsControl(ctx, url, req, _, {
      id: `${prefix}-tags`,
      values: tags,
      tags: options(data.tags),
    }),
    // The board's per-column create arrives with a stage in the query, and
    // without this control the form silently dropped it into the first stage —
    // an affordance that pointed at a column and then ignored which one.
    wants.stage === false
      ? Promise.resolve(undefined)
      : stageControl(ctx, url, req, _, {
          id: `${prefix}-stage`,
          value: row.stageId ? String(row.stageId) : null,
          stages: options(data.config.stages ?? []),
          kind: row.kind ? String(row.kind) : null,
        }),
  ])
  return { partner, team, assignee, tags: tagPicker, stage }
}

const saveInput = (id: string, form: Record<string, string>, kind = form.kind ?? 'lead') => ({
  id,
  kind,
  name: form.name ?? '',
  ...optional(form, 'partnerId'),
  ...optional(form, 'contactName'),
  ...optional(form, 'email'),
  ...optional(form, 'phone'),
  ...optional(form, 'teamId'),
  ...optional(form, 'assigneeUserId'),
  ...optional(form, 'stageId'),
  ...optional(form, 'description'),
  ...optional(form, 'expectedClosing'),
  priority: form.priority ?? '1',
  expectedRevenue: form.expectedRevenue || '0',
  probability: form.probability || '0',
  // The multi-valued picker posts one comma-separated field, which is what
  // survives `readForm`; an absent key means "the form had no tag control",
  // while an empty string means "the user cleared it".
  ...(form.tagIds === undefined
    ? {}
    : {
        tagIds: form.tagIds
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
      }),
  ...(form.expectedVersion ? { expectedVersion: Number(form.expectedVersion) } : {}),
  idempotencyKey: form.idempotencyKey || randomUUID(),
})

/** A dedicated create URL that still knows which list or board the reader came from. */
const caseCreateHref = (
  url: URL,
  preset: { stageId?: string; kind?: 'lead' | 'opportunity' } = {},
): string => {
  const target = new URL('/admin/crm/cases/new', 'http://ket.local')
  if (preset.stageId) target.searchParams.set('stageId', preset.stageId)
  if (preset.kind) target.searchParams.set('kind', preset.kind)
  const lang = url.searchParams.get('lang')
  if (lang) target.searchParams.set('lang', lang)
  target.searchParams.set('returnTo', `${url.pathname}${url.search}`)
  return `${target.pathname}${target.search}`
}

/** Only the CRM board and case list are valid destinations carried through the create form. */
const caseReturnTo = (url: URL, raw?: string | null): string => {
  const fallback = inLocale(url, '/admin/crm/cases')
  if (!raw) return fallback
  const target = new URL(raw, 'http://ket.local')
  return ['/admin/crm/cases', '/admin/crm/pipeline'].includes(target.pathname)
    ? `${target.pathname}${target.search}`
    : fallback
}

const caseCreatePage = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  options: {
    actionPath: '/admin/crm/cases' | '/admin/crm/cases/new'
    errors?: readonly string[]
    form?: Record<string, string>
  },
) => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const askedStage = url.searchParams.get('stageId')
  const askedKind = url.searchParams.get('kind')
  const submitted = options.form ?? {}
  const preset: AnyRow = {
    ...(askedStage ? { stageId: askedStage } : {}),
    ...(askedKind === 'lead' || askedKind === 'opportunity' ? { kind: askedKind } : {}),
    ...submitted,
    ...(options.form
      ? {
          salesDetail: {
            expectedRevenue: submitted.expectedRevenue ?? '0',
            probability: submitted.probability ?? '0',
            expectedClosing: submitted.expectedClosing ?? '',
          },
        }
      : {}),
  }
  const data = await references(ctx, url, req)
  const controls = await caseControls(ctx, url, req, _, data, 'crm-create', preset)
  const returnTo = caseReturnTo(url, submitted.returnTo ?? url.searchParams.get('returnTo'))
  return adminPage(ctx, url, req, {
    title: 'crm_backend.cases.title',
    active: '/admin/crm/cases',
    body: (_, frame) =>
      caseCreateScreen(_, frame, {
        fields: caseFields(_, preset, controls),
        action: inLocale(url, options.actionPath),
        cancelHref: returnTo,
        returnTo,
        errors: options.errors,
      }),
  })
}

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

/** How many cards one pipeline column shows before it offers the rest. */
const PIPELINE_COLUMN = 40

/**
 * The board's own filters, carried through the search form so typing a query
 * does not silently drop the team or the "mine" toggle the reader had set.
 */
const PIPELINE_PARAMS = ['teamId', 'mine', 'lang'] as const

const keepForPipeline = (url: URL): Record<string, string> =>
  Object.fromEntries(
    PIPELINE_PARAMS.map((key) => [key, url.searchParams.get(key) ?? '']).filter(([, value]) => value),
  )

/**
 * Day and month first, which is how a due date is read here.
 *
 * A card carries a date to answer "is this late", and an ISO string answers it
 * a beat slower than a formatted one does. The board never parses this back —
 * `overdue` is decided on the server, where the company's today is known.
 */
const dayLabel = (locale: string, value: unknown): string => {
  const raw = String(value ?? '')
  if (!raw) return ''
  const at = new Date(`${raw.slice(0, 10)}T00:00:00.000Z`)
  if (Number.isNaN(at.getTime())) return raw
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(at)
}

/**
 * The header figures, or nothing at all.
 *
 * `crm.pipeline.summary` is a second function, so a role granted the board's
 * `crm.case.list` before this screen existed has not been granted it. Rather
 * than turn that into a 500 on the only screen the CRM menu opens with, the
 * board renders and the header simply has nothing to state. Any other failure is
 * still a failure.
 */
const pipelineSummaryOf = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  filters: Record<string, unknown>,
): Promise<AnyRow | null> => {
  try {
    return (await ctx.call('crm.pipeline.summary', filters, url, req)) as AnyRow
  } catch (error) {
    if ((error as { code?: string })?.code === 'E_FN_NOT_PERMITTED') return null
    throw error
  }
}

/**
 * Six stage colours, assigned by position rather than stored.
 *
 * A dot at the head of a column says "this is a different column" at a glance,
 * which is the whole job; it is not a status, so it is not worth a field on the
 * stage that somebody then has to keep meaningful. A stage that ends the case
 * takes the colour its outcome already has everywhere else in the product.
 */
/** The record kind a column can actually hold, and therefore the one it offers to create. */
const kindFor = (stage: AnyRow): 'lead' | 'opportunity' =>
  Array.isArray(stage.allowedKinds) && (stage.allowedKinds as unknown[]).includes('lead')
    ? 'lead'
    : 'opportunity'

const stageTone = (stage: AnyRow, index: number): string =>
  stage.terminalState === 'won' ? 'won' : stage.terminalState === 'lost' ? 'lost' : String((index % 6) + 1)

/**
 * The four figures above the board.
 *
 * Every one of them is counted over the same filter the columns are counted
 * over, so switching to "mine" moves the header and the cards together. Empty
 * when the caller may not read the summary; the two amounts are dropped when the
 * board is larger than one summary pass, because a total that is quietly the
 * total of the first five thousand cases is worse than no total.
 */
const pipelineFigures = (
  _: Translator,
  summary: AnyRow | null,
  money: (value: unknown) => string,
): PipelineFigure[] => {
  if (!summary) return []
  const partial = summary.partial === true
  return [
    {
      id: 'open',
      label: _('crm_backend.metric.open'),
      value: String(summary.openCount ?? 0),
      icon: 'users',
    },
    ...(partial
      ? []
      : [
          {
            id: 'revenue',
            label: _('crm_backend.metric.revenue'),
            value: money(summary.expectedRevenue),
            icon: 'banknote',
          },
          {
            id: 'weighted',
            label: _('crm_backend.metric.weighted'),
            value: money(summary.weightedRevenue),
            detail: _('crm_backend.metric.weightedHint'),
            icon: 'wallet',
          },
        ]),
    {
      id: 'overdue',
      label: _('crm_backend.metric.overdue'),
      value: String(summary.overdueActivityCount ?? 0),
      icon: 'alert-triangle',
    },
  ]
}

const configurationTabOf = (url: URL): ConfigurationTab => {
  const asked = url.searchParams.get('tab') ?? ''
  return (CONFIGURATION_TABS as readonly string[]).includes(asked) ? (asked as ConfigurationTab) : 'teams'
}

export const routes: Record<string, RouteEntry> = {
  '/admin/crm': () => async (url, req) =>
    req.method === 'GET' ? seeOther(inLocale(url, '/admin/crm/pipeline')) : text('GET', { status: 405 }),

  '/admin/crm/pipeline':
    (ctx): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const config = await configuration(ctx, url, req)
      const stages = (config.stages ?? []).filter(
        (item) =>
          Array.isArray(item.allowedKinds) &&
          (item.allowedKinds as unknown[]).some((kind) => kind === 'lead' || kind === 'opportunity'),
      )
      const teams = config.teams ?? []
      const search = url.searchParams.get('q')?.trim() || undefined
      const teamId = url.searchParams.get('teamId') || undefined
      const mine = bool(url.searchParams.get('mine') ?? undefined)
      const filters = {
        ...(search ? { search } : {}),
        ...(teamId ? { teamId } : {}),
        ...(mine ? { mine: true } : {}),
      }
      const [summary, pages] = await Promise.all([
        pipelineSummaryOf(ctx, url, req, filters),
        Promise.all(
          stages.map(async (stage) => {
            const result = (await ctx.call(
              'crm.case.list',
              { stageId: stage.id, ...filters, limit: PIPELINE_COLUMN },
              url,
              req,
            )) as AnyRow
            return { stage, total: Number(result.total ?? 0), rows: (result.rows as AnyRow[]) ?? [] }
          }),
        ),
      ])
      const figures = new Map(
        (((summary?.stages as AnyRow[]) ?? []) as AnyRow[]).map((row) => [String(row.id), row]),
      )
      const money = (value: unknown) => formatMoney(_, value)
      const board = await ctx.joint(url, req, 'crm_backend:screen.pipeline', {
        lang,
        data: JSON.stringify({
          // The amount is formatted here, where the translator and the company
          // currency both are; the board only prints what it is handed.
          rows: pages.flatMap((item) =>
            item.rows.map((row) => {
              const activity = row.nextActivity as AnyRow | null
              return {
                id: row.id,
                name: row.name,
                kind: row.kind,
                stageId: row.stageId,
                priority: String(row.priority ?? '1'),
                version: row.version,
                party: row.partnerName ?? row.contactName ?? row.email ?? row.phone ?? null,
                contactName:
                  row.partnerName && row.contactName && row.partnerName !== row.contactName
                    ? row.contactName
                    : null,
                revenue: Number(row.expectedRevenue ?? 0) ? money(row.expectedRevenue) : null,
                probability: Number(row.probability ?? 0) ? `${Math.round(Number(row.probability))}%` : null,
                assigneeName: row.assigneeName ?? null,
                tags: ((row.tags as AnyRow[]) ?? []).map((tag) => String(tag.name)),
                activity: activity
                  ? {
                      summary: String(activity.summary ?? ''),
                      due: dayLabel(lang, activity.dueDate),
                      overdue: activity.overdue === true,
                    }
                  : null,
              }
            }),
          ),
          stages: stages.map((stage, index) => {
            const figure = figures.get(String(stage.id))
            const expected = Number(figure?.expectedRevenue ?? 0)
            const weighted = Number(figure?.weightedRevenue ?? 0)
            const shown = pages.find((item) => item.stage.id === stage.id)
            const more = new URLSearchParams({ 'f.stageId': String(stage.id) })
            if (search) more.set('q', search)
            return {
              id: stage.id,
              name: stage.name,
              tone: stageTone(stage, index),
              total: figure ? Number(figure.count ?? 0) : (shown?.total ?? 0),
              // Withheld rather than reported short: `partial` means the board is
              // larger than the summary reads in one pass, so the amounts it did
              // add up are the amounts of a subset.
              value: figure && summary?.partial !== true && expected ? money(expected) : null,
              // The share of the column's money the forecast actually counts.
              // It is an aggregate of the cases standing there, not a property of
              // the stage — which is why it disappears when there is no money in it.
              weight:
                figure && summary?.partial !== true && expected
                  ? `${Math.round((weighted / expected) * 100)}%`
                  : null,
              // The board has always rendered "shown / total" and a "load more"
              // control the server never gave a target, so a column past its page
              // size simply hid the rest. The link opens the same stage in the list.
              loadMoreHref: `/admin/crm/cases?${more.toString()}`,
              // A stage that only accepts opportunities gets an opportunity: the
              // column offered "new lead" on every stage and the save was then
              // refused for the kind, which is an affordance that points at a
              // column and then argues with it.
              createHref: caseCreateHref(url, {
                stageId: String(stage.id),
                kind: kindFor(stage),
              }),
              createLabel: _(`crm_backend.kanban.create.${kindFor(stage)}`),
            }
          }),
          // The board carries its own wording so the client file stops holding a
          // second vocabulary the translation catalogue never sees.
          labels: {
            empty: _('crm_backend.kanban.empty'),
            move: _('crm_backend.action.move'),
            moving: _('crm_backend.kanban.moving'),
            conflict: _('crm.error.stageConflict'),
            open: _('crm_backend.kanban.open'),
            unassigned: _('crm_backend.kanban.unassigned'),
            loadMore: _('crm_backend.kanban.loadMore'),
            moveShort: _('crm_backend.kanban.moveShort'),

            weight: _('crm_backend.kanban.weight'),
            columnMenu: _('crm_backend.kanban.columnMenu'),
            overdue: _('crm_backend.activity.overdue'),
          },
        }),
      })
      return adminPage(ctx, url, req, {
        title: 'crm_backend.pipeline.title',
        body: (_, frame) => {
          frame.chrome = {
            create: { label: _('crm_backend.action.createLead'), path: caseCreateHref(url) },
            search: {
              name: 'q',
              value: search ?? '',
              placeholder: _('crm_backend.search.pipeline'),
              keep: keepForPipeline(url),
              facets: [
                ...(teamId
                  ? [
                      {
                        label: String(teams.find((team) => String(team.id) === teamId)?.name ?? teamId),
                        without: withParam(url, 'teamId', null),
                      },
                    ]
                  : []),
                ...(mine
                  ? [{ label: _('crm_backend.filter.mine'), without: withParam(url, 'mine', null) }]
                  : []),
              ],
              menus: [
                {
                  id: 'team',
                  label: teamId
                    ? String(teams.find((team) => String(team.id) === teamId)?.name ?? teamId)
                    : _('crm_backend.filter.allTeams'),
                  items: [
                    {
                      id: 'all',
                      label: _('crm_backend.filter.allTeams'),
                      path: withParam(url, 'teamId', null),
                      active: !teamId,
                    },
                    ...teams.map((team) => ({
                      id: String(team.id),
                      label: String(team.name ?? team.id),
                      path: withParam(url, 'teamId', String(team.id)),
                      active: teamId === String(team.id),
                    })),
                  ],
                },
                {
                  id: 'scope',
                  label: _('crm_backend.action.filter'),
                  items: [
                    {
                      id: 'everyone',
                      label: _('crm_backend.filter.everyone'),
                      path: withParam(url, 'mine', null),
                      active: !mine,
                    },
                    {
                      id: 'mine',
                      label: _('crm_backend.filter.mine'),
                      path: withParam(url, 'mine', '1'),
                      active: mine,
                    },
                  ],
                },
              ],
            },
            views: [
              {
                id: 'kanban',
                label: _('backend.chrome.view.kanban'),
                icon: 'layout-grid',
                path: inLocale(url, '/admin/crm/pipeline'),
                active: true,
              },
              {
                id: 'list',
                label: _('backend.chrome.view.list'),
                icon: 'list',
                path: inLocale(url, '/admin/crm/cases'),
                active: false,
              },
            ],
          }
          return pipelineScreen(_, frame, board, pipelineFigures(_, summary, money))
        },
      })
    },

  '/admin/crm/pipeline/move':
    (ctx): Route =>
    async (url, req) => {
      const refused = onlyPost(req)
      if (refused) return refused
      const form = await readForm(req)
      const result = (await ctx.call(
        'crm.case.move',
        {
          id: form.id ?? '',
          stageId: form.stageId ?? '',
          expectedVersion: Number(form.expectedVersion ?? 0),
          idempotencyKey: form.idempotencyKey || randomUUID(),
        },
        url,
        req,
      )) as AnyRow
      return result.ok
        ? seeOther(inLocale(url, '/admin/crm/pipeline'))
        : text(errorsOf(result, ctx.translate(ctx.localeOf(url, req))).join('\n'), { status: 409 })
    },

  '/admin/crm/cases':
    (ctx): Route =>
    async (url, req) => {
      const refused = refusePost(req)
      if (refused) return refused
      if (req.method === 'POST') {
        const form = await readForm(req)
        const id = randomUUID()
        const result = (await ctx.call('crm.case.save', saveInput(id, form), url, req)) as AnyRow
        if (result.ok) return seeOther(inLocale(url, `/admin/crm/cases/${id}`))
        return caseCreatePage(ctx, url, req, {
          actionPath: '/admin/crm/cases',
          errors: errorsOf(result, ctx.translate(ctx.localeOf(url, req))),
          form,
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const spec = caseListSearch(table(ctx.manifest, 'crm.Case'))
      const parsed = parseListState(spec, url)
      const state = parsed.state
      const timezone = await timezoneOf(ctx, url, req)
      const grouped = state.groupBy.length > 0
      const cursor = (state.page - 1) * LIST_PAGE_SIZE
      const [result, live] = await Promise.all([
        ctx.call(
          'crm.case.list',
          { listState: state, timezone, cursor: String(cursor), limit: grouped ? 1 : LIST_PAGE_SIZE },
          url,
          req,
        ) as Promise<AnyRow>,
        ctx.live(req),
      ])
      const groups = grouped
        ? await loadListGroups(ctx, url, req, state, timezone, {
            groupFunction: 'crm.case.group',
            listFunction: 'crm.case.list',
            listArgs: {},
            label: (_field, value) => String(value ?? '—'),
          })
        : []
      return adminPage(ctx, url, req, {
        title: 'crm_backend.cases.title',
        body: (_, frame) => {
          frame.chrome = {
            search: {
              name: 'q',
              value: state.q ?? '',
              placeholder: _('crm_backend.search.cases'),
              keep: keepForListSearch(url),
              facets: listFacets(_, url, state, spec),
              menus: listMenus(_, url, state, spec),
            },
            pager: grouped
              ? null
              : pager(url, state, ((result.rows as AnyRow[]) ?? []).length, Number(result.total ?? 0)),
          }
          return casesListScreen(_, frame, {
            rows: grouped ? [] : ((result.rows as AnyRow[]) ?? []),
            groups,
            total: Number(result.total ?? 0),
            createHref: live.functions['crm.case.save'] ? caseCreateHref(url) : undefined,
            locale: localeQuery(url),
          })
        },
      })
    },

  '/admin/crm/cases/new':
    (ctx): Route =>
    async (url, req) => {
      const refused = refusePost(req)
      if (refused) return refused
      if (req.method === 'POST') {
        const form = await readForm(req)
        const id = randomUUID()
        const result = (await ctx.call('crm.case.save', saveInput(id, form), url, req)) as AnyRow
        if (result.ok) return seeOther(inLocale(url, `/admin/crm/cases/${id}`))
        return caseCreatePage(ctx, url, req, {
          actionPath: '/admin/crm/cases/new',
          errors: errorsOf(result, ctx.translate(ctx.localeOf(url, req))),
          form,
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return caseCreatePage(ctx, url, req, { actionPath: '/admin/crm/cases/new' })
    },

  '/admin/crm/cases/{id}':
    (ctx): Route =>
    async (url, req, params) => {
      const refused = refusePost(req)
      if (refused) return refused
      const _ = ctx.translate(ctx.localeOf(url, req))
      let errors: string[] = []
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const held = (await ctx.call('crm.case.get', { id: params.id }, url, req)) as AnyRow | null
        if (!held) return text('not found', { status: 404 })
        const base = {
          id: params.id,
          expectedVersion: Number(form.expectedVersion ?? held.version ?? 0),
          idempotencyKey: randomUUID(),
        }
        const call = (name: string, input: Record<string, unknown>) =>
          ctx.call(name, input, url, req) as Promise<AnyRow>
        let result: AnyRow
        if (form.action === 'save')
          result = await call('crm.case.save', saveInput(params.id, form, String(held.kind)))
        else if (form.action === 'move')
          result = await call('crm.case.move', { ...base, stageId: form.stageId ?? '' })
        else if (form.action === 'convert') result = await call('crm.case.convertLead', base)
        else if (form.action === 'won') result = await call('crm.case.markWon', base)
        else if (form.action === 'lost')
          result = await call('crm.case.markLost', { ...base, lostReason: form.lostReason ?? '' })
        else if (form.action === 'assign')
          result = await call('crm.case.assign', {
            ...base,
            ...optional(form, 'teamId'),
            ...optional(form, 'assigneeUserId'),
            force: true,
          })
        else if (form.action === 'merge')
          result = await call('crm.case.merge', {
            targetId: params.id,
            sourceId: form.sourceId ?? '',
            expectedTargetVersion: base.expectedVersion,
            idempotencyKey: randomUUID(),
          })
        else if (form.action === 'message')
          result = await call('crm.case.addMessage', {
            id: randomUUID(),
            caseId: params.id,
            body: form.body ?? '',
            visibility: 'internal',
            idempotencyKey: randomUUID(),
          })
        else if (form.action === 'quotation')
          result = await call('crm_sale.sale.createQuotation', {
            id: randomUUID(),
            caseId: params.id,
            warehouseId: form.warehouseId ?? '',
            notes: form.notes ?? '',
            // One line is enough to make the quotation real; the rest is edited
            // on the order itself, which is where line editing belongs.
            products: form.productId
              ? [
                  {
                    productId: form.productId,
                    productUomId: form.productUomId || '',
                    quantity: form.quantity || '1',
                    ...(form.priceUnit ? { priceUnit: form.priceUnit } : {}),
                  },
                ]
              : [],
            idempotencyKey: randomUUID(),
          })
        else if (form.action === 'scheduleActivity')
          result = await call('crm.activity.schedule', {
            id: randomUUID(),
            caseId: params.id,
            ...optional(form, 'typeId'),
            ...optional(form, 'assigneeUserId'),
            summary: form.summary ?? '',
            note: form.note ?? '',
            dueDate: form.dueDate ?? '',
            idempotencyKey: randomUUID(),
          })
        else if (form.action === 'completeActivity')
          result = await call('crm.activity.complete', {
            id: form.activityId ?? '',
            feedback: form.feedback ?? '',
            completedDate: new Date().toISOString().slice(0, 10),
            idempotencyKey: randomUUID(),
          })
        else if (form.action === 'cancelActivity')
          result = await call('crm.activity.cancel', {
            id: form.activityId ?? '',
            feedback: form.feedback ?? '',
            idempotencyKey: randomUUID(),
          })
        else if (form.action === 'applyPlan')
          result = await call('crm.plan.apply', {
            caseId: params.id,
            planId: form.planId ?? '',
            anchorDate: form.anchorDate ?? '',
            idempotencyKey: randomUUID(),
          })
        else if (form.action === 'refreshScore')
          result = await call('crm.case.refreshScore', { id: params.id, idempotencyKey: randomUUID() })
        else return text('unknown action', { status: 400 })
        if (result.ok || result.activity || Array.isArray(result.activities))
          return seeOther(inLocale(url, `${url.pathname}${url.search}`))
        errors = errorsOf(result, _)
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [row, data] = await Promise.all([
        ctx.call('crm.case.get', { id: params.id }, url, req) as Promise<AnyRow | null>,
        references(ctx, url, req),
      ])
      if (!row)
        return adminPage(ctx, url, req, {
          title: 'crm_backend.permission.title',
          active: '/admin/crm/cases',
          status: 404,
          body: (_, frame) => permissionScreen(_, frame),
        })
      const stages = (data.config.stages ?? []).filter(
        (item) => Array.isArray(item.allowedKinds) && (item.allowedKinds as unknown[]).includes(row.kind),
      )
      const [warehouses, plans, activityTypes, duplicateResult, quotations, products] = await Promise.all([
        ctx.call('stock.listWarehouses', {}, url, req) as Promise<AnyRow[]>,
        ctx.call('activity.listPlans', {}, url, req) as Promise<AnyRow>,
        ctx.call('activity.listTypes', {}, url, req) as Promise<AnyRow[]>,
        ctx.call(
          'crm.case.detectDuplicates',
          { id: row.id, email: row.email, phone: row.phone, name: row.name },
          url,
          req,
        ) as Promise<AnyRow>,
        ctx.call('crm_sale.sale.listQuotations', { caseId: params.id }, url, req) as Promise<AnyRow[]>,
        row.kind === 'opportunity'
          ? (ctx.call('crm_sale.sale.listQuotableProducts', { limit: PRELOAD }, url, req) as Promise<
              AnyRow[]
            >)
          : Promise.resolve([] as AnyRow[]),
      ])
      const fieldControls = await caseControls(ctx, url, req, _, data, 'crm-case', row, {
        stage: false,
      })
      const controls: CaseDetailControls = {
        stage: await stageControl(ctx, url, req, _, {
          id: 'crm-case-move-stage',
          value: String(row.stageId),
          stages: options(stages),
          kind: String(row.kind),
          required: true,
        }),
        mergeSource: await caseControl(ctx, url, req, _, {
          id: 'crm-case-merge',
          name: 'sourceId',
          kind: String(row.kind),
          excludeId: String(row.id),
          required: true,
        }),
        assignTeam: await teamControl(ctx, url, req, _, {
          id: 'crm-case-assign-team',
          value: row.teamId ? String(row.teamId) : null,
          teams: options(data.config.teams ?? []),
        }),
        assignUser: await assigneeControl(ctx, url, req, _, {
          id: 'crm-case-assign-user',
          value: row.assigneeUserId ? String(row.assigneeUserId) : null,
          users: options(data.users),
        }),
        activityAssignee: await assigneeControl(ctx, url, req, _, {
          id: 'crm-case-activity-assignee',
          value: row.assigneeUserId ? String(row.assigneeUserId) : null,
          users: options(data.users),
        }),
        ...(row.kind === 'opportunity'
          ? {
              quotationProduct: await productControl(ctx, url, req, _, {
                id: 'crm-case-quotation-product',
                products: options(products),
                required: true,
              }),
            }
          : {}),
      }
      return adminPage(ctx, url, req, {
        title: 'crm_backend.case.detail',
        body: (_, frame) =>
          caseDetailScreen(_, frame, row, {
            fields: caseFields(_, row, fieldControls),
            stages,
            users: data.users,
            teams: data.config.teams ?? [],
            warehouses,
            plans: (plans.plans as AnyRow[]) ?? [],
            activityTypes,
            duplicates: (duplicateResult.rows as AnyRow[]) ?? [],
            quotations,
            controls,
            errors,
            locale: localeQuery(url),
            tab: ['overview', 'sales', 'activities', 'timeline'].includes(url.searchParams.get('tab') ?? '')
              ? String(url.searchParams.get('tab'))
              : 'overview',
          }),
      })
    },

  '/admin/crm/cases/{id}/attachments':
    (ctx): Route =>
    async (url, req, params) => {
      const refused = onlyPost(req)
      if (refused) return refused
      if (!(await ctx.call('crm.case.get', { id: params.id }, url, req)))
        return text('not found', { status: 404 })
      await receiveAttachment(ctx, url, req, {
        resModel: 'crm.Case',
        resId: params.id,
        resField: 'internal',
        public: false,
      })
      return seeOther(`/admin/crm/cases/${encodeURIComponent(params.id)}?tab=timeline`)
    },

  '/admin/crm/activities':
    (ctx): Route =>
    async (url, req) => {
      const refused = refusePost(req)
      if (refused) return refused
      const _ = ctx.translate(ctx.localeOf(url, req))
      let errors: string[] = []
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const call = (name: string, input: Record<string, unknown>) =>
          ctx.call(name, input, url, req) as Promise<AnyRow>
        let result: AnyRow
        if (form.action === 'schedule')
          result = await call('crm.activity.schedule', {
            id: randomUUID(),
            caseId: form.caseId ?? '',
            ...optional(form, 'typeId'),
            ...optional(form, 'assigneeUserId'),
            summary: form.summary ?? '',
            dueDate: form.dueDate ?? '',
            idempotencyKey: randomUUID(),
          })
        else if (form.action === 'complete')
          result = await call('crm.activity.complete', {
            id: form.id ?? '',
            feedback: form.feedback ?? '',
            completedDate: new Date().toISOString().slice(0, 10),
            idempotencyKey: randomUUID(),
          })
        else if (form.action === 'cancel')
          result = await call('crm.activity.cancel', {
            id: form.id ?? '',
            feedback: form.feedback ?? '',
            idempotencyKey: randomUUID(),
          })
        else if (form.action === 'applyPlan')
          result = await call('crm.plan.apply', {
            caseId: form.caseId ?? '',
            planId: form.planId ?? '',
            anchorDate: form.anchorDate ?? '',
            idempotencyKey: randomUUID(),
          })
        else return text('unknown action', { status: 400 })
        if (result.ok || result.activity || Array.isArray(result.activities))
          return seeOther(inLocale(url, `${url.pathname}${url.search}`))
        errors = errorsOf(result, _)
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const tab = ['mine', 'plans', 'calendar'].includes(url.searchParams.get('tab') ?? '')
        ? String(url.searchParams.get('tab'))
        : 'mine'
      const [activities, plans, calendar, activityTypes, users] = await Promise.all([
        ctx.call(
          'crm.activity.listMine',
          { today: new Date().toISOString().slice(0, 10), includeDone: false },
          url,
          req,
        ) as Promise<AnyRow[]>,
        ctx.call('activity.listPlans', {}, url, req) as Promise<AnyRow>,
        ctx.call('crm.calendar.list', { cursor: '0', limit: 100 }, url, req) as Promise<AnyRow>,
        ctx.call('activity.listTypes', {}, url, req) as Promise<AnyRow[]>,
        ctx.call('user.listUsers', { includeArchived: false, limit: PRELOAD }, url, req) as Promise<AnyRow[]>,
      ])
      // The target used to be a select over a thousand cases, capped at two
      // hundred by the list function without saying so. A picker searches the
      // whole pipeline instead of shipping a slice of it.
      const controls = {
        caseId: await caseControl(ctx, url, req, _, {
          id: 'crm-planner-case',
          name: 'caseId',
          required: true,
        }),
        assignee: await assigneeControl(ctx, url, req, _, {
          id: 'crm-planner-assignee',
          users: options(users),
        }),
      }
      return adminPage(ctx, url, req, {
        title: 'crm_backend.planner.title',
        body: (_, frame) =>
          plannerScreen(_, frame, {
            tab,
            activities: activities ?? [],
            plans: (plans.plans as AnyRow[]) ?? [],
            events: (calendar.events as AnyRow[]) ?? [],
            activityTypes,
            controls,
            errors,
            locale: localeQuery(url),
          }),
      })
    },

  '/admin/crm/leaderboard':
    (ctx): Route =>
    async (url, req) => {
      const refused = refusePost(req)
      if (refused) return refused
      let errors: string[] = []
      if (req.method === 'POST') {
        const result = (await ctx.call(
          'crm.gamification.refresh',
          { idempotencyKey: randomUUID() },
          url,
          req,
        )) as AnyRow
        if (result.ok) return seeOther(inLocale(url, '/admin/crm/leaderboard'))
        errors = errorsOf(result, ctx.translate(ctx.localeOf(url, req)))
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const listed = (await ctx.call('crm.gamification.list', { limit: 50 }, url, req)) as AnyRow
      return adminPage(ctx, url, req, {
        title: 'crm_backend.leaderboard.title',
        body: (_, frame) =>
          leaderboardScreen(_, frame, {
            profiles: (listed.profiles as AnyRow[]) ?? [],
            errors,
            locale: localeQuery(url),
          }),
      })
    },

  '/admin/crm/configuration':
    (ctx): Route =>
    async (url, req) => {
      const refused = refusePost(req)
      if (refused) return refused
      const _ = ctx.translate(ctx.localeOf(url, req))
      const tab = configurationTabOf(url)
      const back = inLocale(url, `/admin/crm/configuration?tab=${tab}`)
      let errors: string[] = []
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const call = (name: string, input: Record<string, unknown>) =>
          ctx.call(name, input, url, req) as Promise<AnyRow>
        const id = form.id || randomUUID()
        const result = await configurationWrite(call, tab, form, id)
        if (result.ok) return seeOther(back)
        errors = errorsOf(result, _)
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [config, tags, members, users] = await Promise.all([
        configuration(ctx, url, req),
        ctx.call('crm.tag.list', { includeArchived: true, limit: 200 }, url, req) as Promise<AnyRow[]>,
        tab === 'members'
          ? (ctx.call('crm.team.member.list', { limit: 200 }, url, req) as Promise<AnyRow[]>)
          : Promise.resolve([] as AnyRow[]),
        tab === 'members'
          ? (ctx.call('user.listUsers', { includeArchived: false, limit: 200 }, url, req) as Promise<
              AnyRow[]
            >)
          : Promise.resolve([] as AnyRow[]),
      ])
      const rows = tab === 'tags' ? tags : tab === 'members' ? members : ((config[tab] as AnyRow[]) ?? [])
      const asked = url.searchParams.get('edit')
      const editing = asked ? (rows.find((row) => String(row.id) === asked) ?? null) : null
      const teams = config.teams ?? []
      return adminPage(ctx, url, req, {
        title: 'crm_backend.configuration.title',
        body: (_, frame) =>
          configurationScreen(_, frame, {
            tab,
            rows,
            editing,
            creating: url.searchParams.get('create') === '1' || (req.method === 'POST' && !editing),
            errors,
            locale: localeQuery(url),
            fields: configurationFields(_, tab, editing, teams, users),
            ...(tab === 'members'
              ? {
                  label: (row: AnyRow) => String(row.userName ?? row.userId),
                  detail: (row: AnyRow) =>
                    _('crm_backend.configuration.member.detail', {
                      capacity: String(row.capacity ?? 1),
                      assigned: String(row.assignedCount ?? 0),
                    }),
                }
              : {}),
            ...(tab === 'stages' ? { detail: (row: AnyRow) => String(row.terminalState ?? 'open') } : {}),
          }),
      })
    },
}

/**
 * One write per configuration tab.
 *
 * The tabs do not share a function signature — a tag saves by name, a team saves
 * a values bag with an idempotency key, a member is a join row — so the mapping
 * is spelled out rather than guessed from the tab name.
 */
async function configurationWrite(
  call: (name: string, input: Record<string, unknown>) => Promise<AnyRow>,
  tab: ConfigurationTab,
  form: Record<string, string>,
  id: string,
): Promise<AnyRow> {
  const archiving = form.action === 'archive'
  const restoring = form.action === 'restore'
  const active = archiving ? false : restoring ? true : bool(form.active)
  if (tab === 'tags') {
    if (archiving) return call('crm.tag.archive', { id })
    return call('crm.tag.save', { id, name: form.name ?? '', active })
  }
  if (tab === 'members') {
    if (archiving) return call('crm.team.member.remove', { id })
    return call('crm.team.member.save', {
      id,
      teamId: form.teamId ?? '',
      userId: form.userId ?? '',
      capacity: Number(form.capacity ?? 1),
      sequence: Number(form.sequence ?? 10),
      active,
      idempotencyKey: randomUUID(),
    })
  }
  const fn = {
    teams: 'crm.team.save',
    stages: 'crm.stage.save',
    assignmentRules: 'crm.assignmentRule.save',
    scoreRules: 'crm.scoreRule.save',
  }[tab]
  const values: AnyRow = {
    ...form,
    id,
    active,
    ...(form.expectedVersion ? { expectedVersion: Number(form.expectedVersion) } : {}),
    ...(form.allowedKinds === undefined
      ? {}
      : {
          allowedKinds: form.allowedKinds
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
        }),
    ...(form.sequence === undefined ? {} : { sequence: Number(form.sequence) }),
    ...(form.priority === undefined ? {} : { priority: Number(form.priority) }),
  }
  delete values.action
  return call(fn as string, { values, idempotencyKey: randomUUID() })
}

/** The form for one configuration tab, pre-filled when a row is being edited. */
function configurationFields(
  _: Translator,
  tab: ConfigurationTab,
  editing: AnyRow | null,
  teams: AnyRow[],
  users: AnyRow[],
): FormField[] {
  const value = (name: string, fallback = '') => String(editing?.[name] ?? fallback)
  const common: FormField[] = [
    { name: 'name', label: _('crm_backend.field.name'), value: value('name'), required: true },
    {
      name: 'active',
      label: _('crm_backend.field.active'),
      type: 'checkbox',
      value: editing ? editing.active !== false : true,
    },
  ]
  if (tab === 'members')
    return [
      {
        name: 'teamId',
        label: _('crm_backend.field.team'),
        type: 'select',
        required: true,
        value: value('teamId'),
        options: choices(teams),
      },
      {
        name: 'userId',
        label: _('crm_backend.field.assignee'),
        type: 'select',
        required: true,
        value: value('userId'),
        options: choices(users),
      },
      {
        name: 'capacity',
        label: _('crm_backend.field.capacity'),
        type: 'number',
        value: value('capacity', '1'),
      },
      {
        name: 'sequence',
        label: _('crm_backend.field.sequence'),
        type: 'number',
        value: value('sequence', '10'),
      },
      {
        name: 'active',
        label: _('crm_backend.field.active'),
        type: 'checkbox',
        value: editing ? editing.active !== false : true,
      },
    ]
  if (tab === 'tags') return common
  if (tab === 'teams')
    return [
      ...common,
      { name: 'code', label: _('crm_backend.field.code'), value: value('code'), required: true },
      {
        name: 'assignmentMode',
        label: _('crm_backend.field.assignmentMode'),
        type: 'select',
        value: value('assignmentMode', 'manual'),
        options: ['manual', 'round_robin', 'capacity'].map((item) => ({
          value: item,
          label: _(`crm_backend.assignmentMode.${item}`),
        })),
      },
    ]
  if (tab === 'stages')
    return [
      ...common,
      { name: 'code', label: _('crm_backend.field.code'), value: value('code'), required: true },
      {
        name: 'sequence',
        label: _('crm_backend.field.sequence'),
        type: 'number',
        value: value('sequence', '10'),
      },
      {
        name: 'allowedKinds',
        label: _('crm_backend.field.allowedKinds'),
        value: Array.isArray(editing?.allowedKinds)
          ? (editing.allowedKinds as unknown[]).map(String).join(',')
          : 'lead,opportunity',
      },
      {
        name: 'terminalState',
        label: _('crm_backend.field.state'),
        type: 'select',
        value: value('terminalState', 'open'),
        options: ['open', 'won', 'lost'].map((item) => ({ value: item, label: _(`crm.terminal.${item}`) })),
      },
    ]
  if (tab === 'assignmentRules')
    return [
      ...common,
      {
        name: 'priority',
        label: _('crm_backend.field.priority'),
        type: 'number',
        value: value('priority', '10'),
      },
      {
        name: 'allowedKinds',
        label: _('crm_backend.field.allowedKinds'),
        value: Array.isArray(editing?.allowedKinds)
          ? (editing.allowedKinds as unknown[]).map(String).join(',')
          : 'lead,opportunity',
      },
      {
        name: 'teamId',
        label: _('crm_backend.field.team'),
        type: 'select',
        required: true,
        value: value('teamId'),
        options: choices(teams),
      },
      { name: 'utmSource', label: _('crm_backend.field.utmSource'), value: value('utmSource') },
    ]
  return [
    ...common,
    { name: 'field', label: _('crm_backend.field.ruleField'), value: value('field'), required: true },
    {
      name: 'operator',
      label: _('crm_backend.field.operator'),
      type: 'select',
      value: value('operator', 'eq'),
      options: ['eq', 'contains', 'present', 'gte'].map((item) => ({
        value: item,
        label: _(`crm_backend.operator.${item}`),
      })),
    },
    { name: 'value', label: _('crm_backend.field.ruleValue'), value: value('value') },
    { name: 'points', label: _('crm_backend.field.points'), type: 'number', value: value('points', '0') },
    {
      name: 'sequence',
      label: _('crm_backend.field.sequence'),
      type: 'number',
      value: value('sequence', '10'),
    },
  ]
}
