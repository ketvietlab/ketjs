import { randomUUID } from 'node:crypto'
import { encodeListState, page, parseListState, table, text } from 'ketjs'
import type { ListState, Route, RouteEntry, ServeContext } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import type { FormField, Frame } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { timezoneOf, viewerOf } from '../backend/routes.ts'
import { receiveAttachment } from '../storage/routes.ts'
import { caseListSearch } from '../crm/search.ts'
import {
  caseDetailScreen,
  casesScreen,
  configurationScreen,
  permissionScreen,
  pipelineScreen,
  plannerScreen,
} from './screens.ts'
import { CRM_PAGE_SIZE, keepForListSearch, listFacets, listMenus, loadListGroups } from './list-search.ts'

type AnyRow = Record<string, unknown>
type Req = Parameters<Route>[1]
type Translator = ReturnType<ServeContext['translate']>
const bool = (value: string | undefined) => ['1', 'true', 'on'].includes(value ?? '')
const optional = (form: Record<string, string>, key: string) => (form[key] ? { [key]: form[key] } : {})
const suffix = (url: URL) =>
  url.searchParams.get('lang') ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}` : ''
const errorsOf = (result: unknown, _: Translator) =>
  (((result as AnyRow | null)?.errors as AnyRow[] | undefined) ?? []).map((error) => {
    const code = String(error.code ?? '')
    return code && _.resolves(code)
      ? _(code, error.params as Record<string, unknown>)
      : String(error.message ?? code)
  })

const frameFor = async (ctx: ServeContext, url: URL, req: Req, active = url.pathname): Promise<Frame> => ({
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(Object.assign(new URL(url), { pathname: active }), req),
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
  },
})
const document = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  title: string,
  body: (_: Translator, frame: Frame) => TemplateResult | Promise<TemplateResult>,
  active?: string,
  status = 200,
) => {
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  return page({
    body: ctx.document({
      lang,
      title: _(title),
      head: await ctx.styles(req),
      body: await body(_, await frameFor(ctx, url, req, active)),
    }),
    status,
  })
}
const choices = (rows: AnyRow[], empty = true) => [
  ...(empty ? [{ value: '', label: '—' }] : []),
  ...rows.map((row) => ({ value: String(row.id), label: String(row.name ?? row.code ?? row.id) })),
]
const configuration = (ctx: ServeContext, url: URL, req: Req) =>
  ctx.call('crm.configuration.get', {}, url, req) as Promise<Record<string, AnyRow[]>>
const references = async (ctx: ServeContext, url: URL, req: Req) => {
  const [config, partners, users] = await Promise.all([
    configuration(ctx, url, req),
    ctx.call('partner.listPartners', { includeArchived: false, limit: 1000 }, url, req) as Promise<AnyRow[]>,
    ctx.call('user.listUsers', { includeArchived: false }, url, req) as Promise<AnyRow[]>,
  ])
  return { config, partners, users }
}
const caseFields = (
  _: Translator,
  data: Awaited<ReturnType<typeof references>>,
  row: AnyRow = {},
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
  {
    name: 'partnerId',
    label: _('crm_backend.field.partner'),
    type: 'select',
    value: String(row.partnerId ?? ''),
    options: choices(data.partners),
  },
  { name: 'contactName', label: _('crm_backend.field.contactName'), value: String(row.contactName ?? '') },
  { name: 'email', label: _('crm_backend.field.email'), value: String(row.email ?? '') },
  { name: 'phone', label: _('crm_backend.field.phone'), value: String(row.phone ?? '') },
  {
    name: 'teamId',
    label: _('crm_backend.field.team'),
    type: 'select',
    value: String(row.teamId ?? ''),
    options: choices(data.config.teams),
  },
  {
    name: 'assigneeUserId',
    label: _('crm_backend.field.assignee'),
    type: 'select',
    value: String(row.assigneeUserId ?? ''),
    options: choices(data.users),
  },
  {
    name: 'priority',
    label: _('crm_backend.field.priority'),
    type: 'select',
    value: String(row.priority ?? '1'),
    options: ['0', '1', '2', '3'].map((value) => ({ value, label: _(`crm_backend.priority.${value}`) })),
  },
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
    name: 'description',
    label: _('crm_backend.field.description'),
    type: 'textarea',
    value: String(row.description ?? ''),
    span: 'full',
  },
]
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
  ...optional(form, 'description'),
  priority: form.priority ?? '1',
  expectedRevenue: form.expectedRevenue || '0',
  probability: form.probability || '0',
  ...(form.expectedVersion ? { expectedVersion: Number(form.expectedVersion) } : {}),
  idempotencyKey: form.idempotencyKey || randomUUID(),
})
const pager = (url: URL, state: ListState, rows: number, total: number) => {
  const link = (target: number) => encodeListState({ ...state, page: target }, url)
  const from = rows ? (state.page - 1) * CRM_PAGE_SIZE + 1 : 0
  const to = Math.min(state.page * CRM_PAGE_SIZE, total)
  return {
    from,
    to,
    total,
    prev: state.page > 1 ? link(state.page - 1) : null,
    next: to < total ? link(state.page + 1) : null,
  }
}

export const routes: Record<string, RouteEntry> = {
  '/admin/crm': () => async (url, req) =>
    req.method === 'GET' ? seeOther(`/admin/crm/pipeline${suffix(url)}`) : text('GET', { status: 405 }),

  '/admin/crm/pipeline':
    (ctx): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const config = await configuration(ctx, url, req)
      const stages = config.stages.filter(
        (item) =>
          Array.isArray(item.allowedKinds) &&
          (item.allowedKinds as unknown[]).some((kind) => kind === 'lead' || kind === 'opportunity'),
      )
      const pages = await Promise.all(
        stages.map(async (stage) => {
          const result = (await ctx.call(
            'crm.case.list',
            {
              stageId: stage.id,
              search: url.searchParams.get('q') ?? undefined,
              teamId: url.searchParams.get('teamId') ?? undefined,
              limit: 100,
            },
            url,
            req,
          )) as AnyRow
          return {
            stage: { ...stage, total: Number(result.total ?? 0) },
            rows: (result.rows as AnyRow[]) ?? [],
          }
        }),
      )
      const board = await ctx.joint(url, req, 'crm_backend:screen.pipeline', {
        lang: ctx.localeOf(url, req),
        data: JSON.stringify({
          rows: pages.flatMap((item) => item.rows),
          stages: pages.map((item) => item.stage),
        }),
      })
      return document(ctx, url, req, 'crm_backend.pipeline.title', (_, frame) =>
        pipelineScreen(_, frame, board),
      )
    },

  '/admin/crm/pipeline/move':
    (ctx): Route =>
    async (url, req) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
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
        ? seeOther(`/admin/crm/pipeline${suffix(url)}`)
        : text(errorsOf(result, ctx.translate(ctx.localeOf(url, req))).join('\n'), { status: 409 })
    },

  '/admin/crm/cases':
    (ctx): Route =>
    async (url, req) => {
      const data = await references(ctx, url, req)
      let errors: string[] = []
      if (req.method === 'POST') {
        const form = await readForm(req)
        const id = randomUUID()
        const result = (await ctx.call('crm.case.save', saveInput(id, form), url, req)) as AnyRow
        if (result.ok) return seeOther(`/admin/crm/cases/${id}${suffix(url)}`)
        errors = errorsOf(result, ctx.translate(ctx.localeOf(url, req)))
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const spec = caseListSearch(table(ctx.manifest, 'crm.Case'))
      const parsed = parseListState(spec, url)
      const state = parsed.state
      const timezone = await timezoneOf(ctx, url, req)
      const grouped = state.groupBy.length > 0
      const cursor = (state.page - 1) * CRM_PAGE_SIZE
      const result = (await ctx.call(
        'crm.case.list',
        { listState: state, timezone, cursor: String(cursor), limit: grouped ? 1 : CRM_PAGE_SIZE },
        url,
        req,
      )) as AnyRow
      const groups = grouped
        ? await loadListGroups(ctx, url, req, state, timezone, {
            groupFunction: 'crm.case.group',
            listFunction: 'crm.case.list',
            listArgs: {},
            label: (_field, value) => String(value ?? '—'),
          })
        : []
      return document(ctx, url, req, 'crm_backend.cases.title', (_, frame) => {
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
        return casesScreen(
          _,
          frame,
          grouped ? [] : ((result.rows as AnyRow[]) ?? []),
          caseFields(_, data),
          errors,
          groups,
        )
      })
    },

  '/admin/crm/cases/{id}':
    (ctx): Route =>
    async (url, req, params) => {
      let errors: string[] = []
      if (req.method === 'POST') {
        const form = await readForm(req)
        const held = (await ctx.call('crm.case.get', { id: params.id }, url, req)) as AnyRow | null
        if (!held) return text('not found', { status: 404 })
        const base = {
          id: params.id,
          expectedVersion: Number(form.expectedVersion ?? held.version ?? 0),
          idempotencyKey: randomUUID(),
        }
        let result: AnyRow
        if (form.action === 'save')
          result = (await ctx.call(
            'crm.case.save',
            saveInput(params.id, form, String(held.kind)),
            url,
            req,
          )) as AnyRow
        else if (form.action === 'move')
          result = (await ctx.call(
            'crm.case.move',
            { ...base, stageId: form.stageId ?? '' },
            url,
            req,
          )) as AnyRow
        else if (form.action === 'convert')
          result = (await ctx.call('crm.case.convertLead', base, url, req)) as AnyRow
        else if (form.action === 'won')
          result = (await ctx.call('crm.case.markWon', base, url, req)) as AnyRow
        else if (form.action === 'lost')
          result = (await ctx.call(
            'crm.case.markLost',
            { ...base, lostReason: form.lostReason ?? 'not_specified' },
            url,
            req,
          )) as AnyRow
        else if (form.action === 'assign')
          result = (await ctx.call(
            'crm.case.assign',
            { ...base, ...optional(form, 'teamId'), ...optional(form, 'assigneeUserId'), force: true },
            url,
            req,
          )) as AnyRow
        else if (form.action === 'merge')
          result = (await ctx.call(
            'crm.case.merge',
            {
              targetId: params.id,
              sourceId: form.sourceId ?? '',
              expectedTargetVersion: base.expectedVersion,
              idempotencyKey: randomUUID(),
            },
            url,
            req,
          )) as AnyRow
        else if (form.action === 'message')
          result = (await ctx.call(
            'crm.case.addMessage',
            {
              id: randomUUID(),
              caseId: params.id,
              body: form.body ?? '',
              visibility: 'internal',
              idempotencyKey: randomUUID(),
            },
            url,
            req,
          )) as AnyRow
        else if (form.action === 'quotation')
          result = (await ctx.call(
            'crm_sale.sale.createQuotation',
            {
              id: randomUUID(),
              caseId: params.id,
              warehouseId: form.warehouseId ?? '',
              notes: form.notes ?? '',
              idempotencyKey: randomUUID(),
            },
            url,
            req,
          )) as AnyRow
        else if (form.action === 'scheduleActivity')
          result = (await ctx.call(
            'crm.activity.schedule',
            {
              id: randomUUID(),
              caseId: params.id,
              ...optional(form, 'typeId'),
              ...optional(form, 'assigneeUserId'),
              summary: form.summary ?? '',
              note: form.note ?? '',
              dueDate: form.dueDate ?? '',
              idempotencyKey: randomUUID(),
            },
            url,
            req,
          )) as AnyRow
        else if (form.action === 'applyPlan')
          result = (await ctx.call(
            'crm.plan.apply',
            {
              caseId: params.id,
              planId: form.planId ?? '',
              anchorDate: form.anchorDate ?? '',
              idempotencyKey: randomUUID(),
            },
            url,
            req,
          )) as AnyRow
        else if (form.action === 'refreshScore')
          result = (await ctx.call(
            'crm.case.refreshScore',
            { id: params.id, idempotencyKey: randomUUID() },
            url,
            req,
          )) as AnyRow
        else return text('unknown action', { status: 400 })
        if (result.ok || result.activity || Array.isArray(result.activities))
          return seeOther(`${url.pathname}${suffix(url)}`)
        errors = errorsOf(result, ctx.translate(ctx.localeOf(url, req)))
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [row, data] = await Promise.all([
        ctx.call('crm.case.get', { id: params.id }, url, req) as Promise<AnyRow | null>,
        references(ctx, url, req),
      ])
      if (!row)
        return document(
          ctx,
          url,
          req,
          'crm_backend.permission.title',
          (_, frame) => permissionScreen(_, frame),
          '/admin/crm/cases',
          404,
        )
      const [warehouses, plans, activityTypes, duplicateResult] = await Promise.all([
        ctx.call('stock.listWarehouses', {}, url, req) as Promise<AnyRow[]>,
        ctx.call('activity.listPlans', {}, url, req) as Promise<AnyRow>,
        ctx.call('activity.listTypes', {}, url, req) as Promise<AnyRow[]>,
        ctx.call(
          'crm.case.detectDuplicates',
          { id: row.id, email: row.email, phone: row.phone, name: row.name },
          url,
          req,
        ) as Promise<AnyRow>,
      ])
      return document(ctx, url, req, 'crm_backend.case.detail', (_, frame) =>
        caseDetailScreen(_, frame, row, {
          fields: caseFields(_, data, row),
          stages: data.config.stages.filter(
            (item) => Array.isArray(item.allowedKinds) && (item.allowedKinds as unknown[]).includes(row.kind),
          ),
          users: data.users,
          teams: data.config.teams,
          warehouses,
          plans: (plans.plans as AnyRow[]) ?? [],
          activityTypes,
          duplicates: (duplicateResult.rows as AnyRow[]) ?? [],
          errors,
          tab: ['overview', 'sales', 'activities', 'timeline'].includes(url.searchParams.get('tab') ?? '')
            ? String(url.searchParams.get('tab'))
            : 'overview',
        }),
      )
    },

  '/admin/crm/cases/{id}/attachments':
    (ctx): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST multipart/form-data', { status: 405 })
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
      let errors: string[] = []
      if (req.method === 'POST') {
        const form = await readForm(req)
        let result: AnyRow
        if (form.action === 'schedule')
          result = (await ctx.call(
            'crm.activity.schedule',
            {
              id: randomUUID(),
              caseId: form.caseId ?? '',
              ...optional(form, 'typeId'),
              ...optional(form, 'assigneeUserId'),
              summary: form.summary ?? '',
              dueDate: form.dueDate ?? '',
              idempotencyKey: randomUUID(),
            },
            url,
            req,
          )) as AnyRow
        else if (form.action === 'complete')
          result = (await ctx.call(
            'crm.activity.complete',
            {
              id: form.id ?? '',
              feedback: form.feedback ?? '',
              completedDate: new Date().toISOString().slice(0, 10),
              idempotencyKey: randomUUID(),
            },
            url,
            req,
          )) as AnyRow
        else if (form.action === 'cancel')
          result = (await ctx.call(
            'crm.activity.cancel',
            { id: form.id ?? '', feedback: form.feedback ?? '', idempotencyKey: randomUUID() },
            url,
            req,
          )) as AnyRow
        else if (form.action === 'applyPlan')
          result = (await ctx.call(
            'crm.plan.apply',
            {
              caseId: form.caseId ?? '',
              planId: form.planId ?? '',
              anchorDate: form.anchorDate ?? '',
              idempotencyKey: randomUUID(),
            },
            url,
            req,
          )) as AnyRow
        else return text('unknown action', { status: 400 })
        if (result.ok || result.activity || Array.isArray(result.activities))
          return seeOther(`${url.pathname}${suffix(url)}`)
        errors = errorsOf(result, ctx.translate(ctx.localeOf(url, req)))
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [activities, plans, calendar, cases, activityTypes, users] = await Promise.all([
        ctx.call(
          'activity.listMy',
          { today: new Date().toISOString().slice(0, 10), includeDone: false },
          url,
          req,
        ) as Promise<AnyRow>,
        ctx.call('activity.listPlans', {}, url, req) as Promise<AnyRow>,
        ctx.call('crm.calendar.list', { cursor: '0', limit: 100 }, url, req) as Promise<AnyRow>,
        ctx.call('crm.case.list', { includeArchived: false, limit: 1000 }, url, req) as Promise<AnyRow>,
        ctx.call('activity.listTypes', {}, url, req) as Promise<AnyRow[]>,
        ctx.call('user.listUsers', { includeArchived: false }, url, req) as Promise<AnyRow[]>,
      ])
      const tab = ['mine', 'plans', 'calendar'].includes(url.searchParams.get('tab') ?? '')
        ? String(url.searchParams.get('tab'))
        : 'mine'
      return document(ctx, url, req, 'crm_backend.planner.title', (_, frame) =>
        plannerScreen(_, frame, {
          tab,
          activities: (activities.activities as AnyRow[]) ?? [],
          plans: (plans.plans as AnyRow[]) ?? [],
          events: (calendar.events as AnyRow[]) ?? [],
          cases: (cases.rows as AnyRow[]) ?? [],
          activityTypes,
          users,
          errors,
        }),
      )
    },

  '/admin/crm/configuration':
    (ctx): Route =>
    async (url, req) => {
      const allowed = ['teams', 'stages', 'assignmentRules', 'scoreRules']
      const tab = allowed.includes(url.searchParams.get('tab') ?? '')
        ? String(url.searchParams.get('tab'))
        : 'teams'
      let errors: string[] = []
      if (req.method === 'POST') {
        const form = await readForm(req)
        const values: AnyRow = {
          ...form,
          id: form.id || randomUUID(),
          active: bool(form.active),
          allowedKinds: (form.allowedKinds ?? '')
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean),
          sequence: Number(form.sequence ?? 10),
          priority: Number(form.priority ?? 10),
        }
        const fn = {
          teams: 'crm.team.save',
          stages: 'crm.stage.save',
          assignmentRules: 'crm.assignmentRule.save',
          scoreRules: 'crm.scoreRule.save',
        }[tab]!
        const result = (await ctx.call(fn, { values, idempotencyKey: randomUUID() }, url, req)) as AnyRow
        if (result.ok) return seeOther(`/admin/crm/configuration?tab=${tab}`)
        errors = errorsOf(result, ctx.translate(ctx.localeOf(url, req)))
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const config = await configuration(ctx, url, req)
      const common: FormField[] = [
        {
          name: 'name',
          label: ctx.translate(ctx.localeOf(url, req))('crm_backend.field.name'),
          required: true,
        },
        {
          name: 'active',
          label: ctx.translate(ctx.localeOf(url, req))('crm_backend.field.active'),
          type: 'checkbox',
          value: true,
        },
      ]
      const extras: Record<string, FormField[]> = {
        teams: [
          { name: 'code', label: 'Code', required: true },
          {
            name: 'assignmentMode',
            label: ctx.translate(ctx.localeOf(url, req))('crm_backend.field.assignmentMode'),
            type: 'select',
            options: ['manual', 'round_robin', 'capacity'].map((value) => ({ value, label: value })),
          },
        ],
        stages: [
          { name: 'code', label: 'Code', required: true },
          {
            name: 'allowedKinds',
            label: ctx.translate(ctx.localeOf(url, req))('crm_backend.field.allowedKinds'),
            value: 'lead,opportunity',
          },
          {
            name: 'terminalState',
            label: ctx.translate(ctx.localeOf(url, req))('crm_backend.field.state'),
            type: 'select',
            options: ['open', 'won', 'lost'].map((value) => ({ value, label: value })),
          },
        ],
        assignmentRules: [
          {
            name: 'priority',
            label: ctx.translate(ctx.localeOf(url, req))('crm_backend.field.priority'),
            type: 'number',
            value: '10',
          },
          {
            name: 'allowedKinds',
            label: ctx.translate(ctx.localeOf(url, req))('crm_backend.field.allowedKinds'),
            value: 'lead,opportunity',
          },
        ],
        scoreRules: [
          {
            name: 'field',
            label: ctx.translate(ctx.localeOf(url, req))('crm_backend.field.ruleField'),
            required: true,
          },
          {
            name: 'operator',
            label: ctx.translate(ctx.localeOf(url, req))('crm_backend.field.operator'),
            value: 'eq',
          },
          { name: 'value', label: ctx.translate(ctx.localeOf(url, req))('crm_backend.field.ruleValue') },
          {
            name: 'points',
            label: ctx.translate(ctx.localeOf(url, req))('crm_backend.field.points'),
            type: 'number',
            value: '0',
          },
        ],
      }
      return document(ctx, url, req, 'crm_backend.configuration.title', (_, frame) =>
        configurationScreen(_, frame, tab, config[tab] ?? [], [...common, ...(extras[tab] ?? [])], errors),
      )
    },
}
