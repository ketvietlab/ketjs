import { newProgramRoute, programWorkspaceRoute } from './program-workspace.tsx'
import { randomUUID } from 'node:crypto'
import { defineModule, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import type { FormField, SearchMenu } from '../../ui/index.ts'
import { formRefusal, readForm, seeOther } from '../backend/forms.ts'
import { PAGE_SIZE, pageOf, pager, searchOf, withParam } from '../backend/paging.ts'
import { LEDGER_OPERATIONS, PROGRAM_TYPES } from '../loyalty/types.ts'
import { membershipPolicyFormSchema, tierFormSchema } from '../loyalty/admin-functions.ts'
import { messages } from './messages.ts'
import {
  dashboardScreen,
  ledgerScreen,
  tiersScreen,
  orderLoyaltyScreen,
  portalScreen,
  programsScreen,
  walletDetailScreen,
  walletsScreen,
} from './screens/index.tsx'
import { adminPage, choices, inLocale, optional } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'

/**
 * One filter dimension, as the chrome's dropdown wants it.
 *
 * Every option toggles: choosing the one already chosen clears it, so a filter
 * can always be undone from the same place it was set. The URL is the state, so
 * the back button and a pasted link both do the obvious thing.
 */
const filterMenu = (
  url: URL,
  id: string,
  label: string,
  param: string,
  current: string | undefined,
  options: Array<{ value: string; label: string }>,
): SearchMenu => ({
  id,
  label,
  items: options.map((option) => ({
    id: `${id}:${option.value}`,
    label: option.label,
    path: withParam(url, param, current === option.value ? null : option.value),
    active: current === option.value,
  })),
})

/** The chips above the table saying which filters are on, each one removable. */
const filterFacets = (
  url: URL,
  active: Array<{ param: string; label: string | null }>,
): Array<{ label: string; without: string }> =>
  active
    .filter((entry): entry is { param: string; label: string } => Boolean(entry.label))
    .map((entry) => ({
      label: entry.label,
      without: withParam(url, entry.param, null),
    }))

/**
 * A window over a ledger, chosen by name rather than by date.
 *
 * A statement is nearly always read by month or by year, and naming the period
 * keeps the link shareable — `?period=month` still means this month next week,
 * which a pair of dates in the URL would not. A free date range would need a
 * control the shared chrome does not have yet.
 */
const PERIODS = ['month', 'quarter', 'year', 'all'] as const

const periodWindow = (period: string): { from?: string; to?: string } => {
  const at = new Date()
  const year = at.getUTCFullYear()
  if (period === 'year')
    return {
      from: new Date(Date.UTC(year, 0, 1)).toISOString(),
      to: at.toISOString(),
    }
  if (period === 'quarter')
    return {
      from: new Date(Date.UTC(year, Math.floor(at.getUTCMonth() / 3) * 3, 1)).toISOString(),
      to: at.toISOString(),
    }
  if (period === 'month')
    return {
      from: new Date(Date.UTC(year, at.getUTCMonth(), 1)).toISOString(),
      to: at.toISOString(),
    }
  return {}
}

const crossSite = (req: Parameters<Route>[1]): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

/**
 * A cross-origin POST carries the signed-in user's session cookie without their
 * intent, and every write behind these routes acts on money, stock or customer
 * records. Refused the way user_backend, company_backend, oauth_backend,
 * product_backend and stock_backend already refuse it.
 */

type Translator = ReturnType<ServeContext['translate']>

const resultErrors = (result: unknown, _: Translator): string[] =>
  (
    (
      result as {
        errors?: Array<{
          code?: string
          message?: string
          params?: Record<string, unknown>
        }>
      } | null
    )?.errors ?? []
  ).map((error) =>
    error.code ? _(error.code, error.params) : String(error.message ?? _('loyalty_backend.error.invalid')),
  )

const options = (_: Translator, values: readonly string[], group: string) =>
  values.map((value) => ({
    value,
    label: _(`loyalty_backend.${group}.${value}`),
  }))

const dataFor = async (ctx: ServeContext, url: URL, req: Req) => {
  const [programs, partners, templates] = await Promise.all([
    ctx.call('loyalty.program.list', { includeArchived: true }, url, req) as Promise<AnyRow[]>,
    ctx.call('partner.listPartners', { includeArchived: false }, url, req) as Promise<AnyRow[]>,
    ctx.call('product.listTemplates', { withVariants: true }, url, req) as Promise<AnyRow[]>,
  ])
  const products = templates.flatMap((template) =>
    ((template.variants as AnyRow[] | undefined) ?? []).map((variant) => ({
      ...variant,
      name: `${String(template.name)}${variant.defaultCode ? ` · ${String(variant.defaultCode)}` : ''}`,
    })),
  )
  return { programs, partners, products }
}

const createProgramFields = (_: Translator): FormField[] => [
  { name: 'name', label: _('loyalty_backend.field.name'), required: true },
  {
    name: 'programType',
    label: _('loyalty_backend.field.programType'),
    type: 'select',
    options: options(_, PROGRAM_TYPES, 'programType'),
    required: true,
  },
]

const routes: NonNullable<Parameters<typeof defineModule>[0]['routes']> = {
  '/admin/loyalty':
    (ctx): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const [programs, wallets, memberships, ledger] = await Promise.all([
        ctx.call('loyalty.program.list', {}, url, req) as Promise<AnyRow[]>,
        ctx.call('loyalty.wallet.list', {}, url, req) as Promise<AnyRow[]>,
        ctx.call('loyalty.membership.list', { limit: 1000 }, url, req) as Promise<AnyRow[]>,
        ctx.call('loyalty.ledger.list', { limit: 1000 }, url, req) as Promise<AnyRow[]>,
      ])
      return adminPage(ctx, url, req, {
        title: 'loyalty_backend.dashboard.title',
        body: (_, frame) =>
          dashboardScreen(_, frame, {
            programs: programs.length,
            wallets: wallets.length,
            members: memberships.length,
            ledger: ledger.length,
          }),
      })
    },

  '/admin/loyalty/programs':
    (ctx): Route =>
    async (url, req) => {
      if (req.method === 'POST') return seeOther(inLocale(url, '/admin/loyalty/programs/new'))
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const page = pageOf(url)
      const search = searchOf(url)
      const state = url.searchParams.get('state') ?? undefined
      const programType = url.searchParams.get('type') ?? undefined
      const [rows, totals] = await Promise.all([
        ctx.call(
          'loyalty.program.list',
          {
            includeArchived: true,
            ...(search ? { search } : {}),
            ...(state ? { state } : {}),
            ...(programType ? { programType } : {}),
            limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE,
          },
          url,
          req,
        ) as Promise<AnyRow[]>,
        ctx.call('loyalty.program.stats', {}, url, req) as Promise<AnyRow>,
      ])
      return adminPage(ctx, url, req, {
        title: 'loyalty_backend.programs.title',
        body: (_, frame) =>
          programsScreen(
            _,
            {
              ...frame,
              chrome: {
                section: _('loyalty_backend.menu.app'),
                search: {
                  name: 'q',
                  value: search ?? '',
                  placeholder: _('loyalty_backend.chrome.searchPrograms'),
                  keep: {
                    ...(state ? { state } : {}),
                    ...(programType ? { type: programType } : {}),
                  },
                  facets: filterFacets(url, [
                    {
                      param: 'state',
                      label: state ? _(`loyalty_backend.state.${state}`) : null,
                    },
                    {
                      param: 'type',
                      label: programType ? _(`loyalty_backend.programType.${programType}`) : null,
                    },
                  ]),
                  menus: [
                    filterMenu(url, 'state', _('loyalty_backend.field.state'), 'state', state, [
                      {
                        value: 'draft',
                        label: _('loyalty_backend.state.draft'),
                      },
                      {
                        value: 'running',
                        label: _('loyalty_backend.state.running'),
                      },
                      {
                        value: 'upcoming',
                        label: _('loyalty_backend.state.upcoming'),
                      },
                      {
                        value: 'archived',
                        label: _('loyalty_backend.state.archived'),
                      },
                      {
                        value: 'ended',
                        label: _('loyalty_backend.state.ended'),
                      },
                    ]),
                    filterMenu(
                      url,
                      'type',
                      _('loyalty_backend.field.programType'),
                      'type',
                      programType,
                      options(_, PROGRAM_TYPES, 'programType'),
                    ),
                  ],
                },
                pager: pager(url, page, rows.length, Number(totals.total ?? 0)),
              },
            },
            rows,
            totals,
            createProgramFields(_),
          ),
      })
    },

  '/admin/loyalty/programs/new': newProgramRoute,
  '/admin/loyalty/programs/{id}': programWorkspaceRoute,

  '/admin/loyalty/wallets':
    (ctx): Route =>
    async (url, req) => {
      const data = await dataFor(ctx, url, req)
      let errors: string[] = []
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const id = randomUUID()
        const result = await ctx.call(
          'loyalty.wallet.create',
          {
            id,
            programId: form.programId ?? '',
            ...optional(form, 'partnerId'),
            ...optional(form, 'code'),
            initialBalance: form.initialBalance || '0',
            ...optional(form, 'expiresAt'),
          },
          url,
          req,
        )
        if ((result as AnyRow).ok) return seeOther(inLocale(url, `/admin/loyalty/wallets/${id}`))
        errors = resultErrors(result, ctx.translate(ctx.localeOf(url, req)))
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const page = pageOf(url)
      const search = searchOf(url)
      const state = url.searchParams.get('state') ?? undefined
      const programId = url.searchParams.get('program') ?? undefined
      const [wallets, totals] = await Promise.all([
        ctx.call(
          'loyalty.wallet.list',
          {
            includeArchived: true,
            ...(search ? { search } : {}),
            ...(state ? { state } : {}),
            ...(programId ? { programId } : {}),
            limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE,
          },
          url,
          req,
        ) as Promise<AnyRow[]>,
        ctx.call(
          'loyalty.wallet.stats',
          { ...(programId ? { programId } : {}) },
          url,
          req,
        ) as Promise<AnyRow>,
      ])
      const names = new Map(data.partners.map((partner) => [String(partner.id), String(partner.name)]))
      const programNames = new Map(data.programs.map((program) => [String(program.id), String(program.name)]))
      return adminPage(ctx, url, req, {
        title: 'loyalty_backend.wallets.title',
        body: (_, frame) =>
          walletsScreen(
            _,
            {
              ...frame,
              chrome: {
                section: _('loyalty_backend.menu.app'),
                search: {
                  name: 'q',
                  value: search ?? '',
                  placeholder: _('loyalty_backend.chrome.searchWallets'),
                  keep: {
                    ...(state ? { state } : {}),
                    ...(programId ? { program: programId } : {}),
                  },
                  facets: filterFacets(url, [
                    {
                      param: 'state',
                      label: state ? _(`loyalty_backend.state.${state}`) : null,
                    },
                    {
                      param: 'program',
                      label: programId ? (programNames.get(programId) ?? null) : null,
                    },
                  ]),
                  menus: [
                    filterMenu(url, 'state', _('loyalty_backend.field.state'), 'state', state, [
                      {
                        value: 'active',
                        label: _('loyalty_backend.state.running'),
                      },
                      {
                        value: 'locked',
                        label: _('loyalty_backend.state.locked'),
                      },
                      {
                        value: 'expired',
                        label: _('loyalty_backend.state.expired'),
                      },
                    ]),
                    filterMenu(
                      url,
                      'program',
                      _('loyalty_backend.field.program'),
                      'program',
                      programId,
                      data.programs.map((program) => ({
                        value: String(program.id),
                        label: String(program.name),
                      })),
                    ),
                  ],
                },
                pager: pager(url, page, wallets.length, Number(totals.total ?? 0)),
              },
            },
            wallets.map((wallet) => ({
              ...wallet,
              partnerName: names.get(String(wallet.partnerId)),
              programName: programNames.get(String(wallet.programId)),
            })),
            totals,
            [
              {
                name: 'programId',
                label: _('loyalty_backend.field.program'),
                type: 'select',
                options: choices(data.programs.filter((program) => program.active)),
                required: true,
              },
              {
                name: 'partnerId',
                label: _('loyalty_backend.field.partner'),
                type: 'select',
                options: choices(data.partners, true),
              },
              { name: 'code', label: _('loyalty_backend.field.code') },
              {
                name: 'initialBalance',
                label: _('loyalty_backend.field.initialBalance'),
                type: 'decimal',
                value: 0,
              },
              {
                name: 'expiresAt',
                label: _('loyalty_backend.field.expiresAt'),
                type: 'datetime-local',
              },
            ],
            errors,
          ),
      })
    },

  '/admin/loyalty/wallets/{id}':
    (ctx): Route =>
    async (url, req, params) => {
      let errors: string[] = []
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const result = await ctx.call(
          'loyalty.wallet.adjust',
          {
            id: params.id,
            amount: form.amount || '0',
            sourceId: form.sourceId || randomUUID(),
            ...optional(form, 'note'),
          },
          url,
          req,
        )
        if ((result as AnyRow).ok) return seeOther(inLocale(url, url.pathname))
        errors = resultErrors(result, ctx.translate(ctx.localeOf(url, req)))
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const held = (await ctx.call('loyalty.wallet.get', { id: params.id }, url, req)) as AnyRow | null
      if (!held)
        return text(ctx.translate(ctx.localeOf(url, req))('loyalty_backend.error.notFound'), { status: 404 })
      // The wallet carries ids; the screen names a guest and a program, so the
      // two are resolved here rather than in a summary every other caller pays
      // for.
      const [holder, program] = await Promise.all([
        held.partnerId
          ? (ctx.call('partner.getPartner', { id: held.partnerId }, url, req) as Promise<AnyRow | null>)
          : Promise.resolve(null),
        ctx.call('loyalty.program.get', { id: held.programId }, url, req) as Promise<AnyRow | null>,
      ])
      const wallet = {
        ...held,
        partnerName: holder?.name ?? null,
        programName: program?.name ?? null,
      }
      return adminPage(ctx, url, req, {
        title: 'loyalty_backend.wallets.title',
        body: (_, frame) =>
          walletDetailScreen(
            _,
            frame,
            wallet,
            [
              {
                name: 'amount',
                label: _('loyalty_backend.field.amount'),
                type: 'decimal',
                required: true,
              },
              {
                name: 'sourceId',
                label: _('loyalty_backend.field.sourceId'),
                value: randomUUID(),
                required: true,
              },
              {
                name: 'note',
                label: _('loyalty_backend.field.note'),
                type: 'textarea',
                span: 'full',
              },
            ],
            url.searchParams.get('tab') ?? 'overview',
            errors,
          ),
      })
    },

  '/admin/loyalty/ledger':
    (ctx): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const page = pageOf(url)
      const period = PERIODS.includes((url.searchParams.get('period') ?? '') as (typeof PERIODS)[number])
        ? (url.searchParams.get('period') as string)
        : 'month'
      const window = periodWindow(period)
      const operation = url.searchParams.get('operation') ?? undefined
      const programId = url.searchParams.get('program') ?? undefined
      const walletId = url.searchParams.get('wallet') ?? undefined
      const filters = {
        ...window,
        ...(operation ? { operation } : {}),
        ...(programId ? { programId } : {}),
        ...(walletId ? { walletId } : {}),
      }
      const [rows, totals, programs, wallets] = await Promise.all([
        ctx.call(
          'loyalty.ledger.list',
          { ...filters, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE },
          url,
          req,
        ) as Promise<AnyRow[]>,
        ctx.call('loyalty.ledger.stats', filters, url, req) as Promise<AnyRow>,
        ctx.call('loyalty.program.list', { includeArchived: true }, url, req) as Promise<AnyRow[]>,
        ctx.call('loyalty.wallet.list', { includeArchived: true, limit: 200 }, url, req) as Promise<AnyRow[]>,
      ])
      const codes = new Map(wallets.map((wallet) => [String(wallet.id), String(wallet.code)]))
      const programNames = new Map(programs.map((program) => [String(program.id), String(program.name)]))
      return adminPage(ctx, url, req, {
        title: 'loyalty_backend.ledger.title',
        body: (_, frame) =>
          ledgerScreen(
            _,
            {
              ...frame,
              chrome: {
                section: _('loyalty_backend.menu.app'),
                search: {
                  name: 'q',
                  value: '',
                  placeholder: _('loyalty_backend.chrome.searchLedger'),
                  keep: {
                    period,
                    ...(operation ? { operation } : {}),
                    ...(programId ? { program: programId } : {}),
                    ...(walletId ? { wallet: walletId } : {}),
                  },
                  facets: filterFacets(url, [
                    {
                      param: 'period',
                      label: _(`loyalty_backend.period.${period}`),
                    },
                    {
                      param: 'operation',
                      label: operation ? _(`loyalty_backend.operation.${operation}`) : null,
                    },
                    {
                      param: 'program',
                      label: programId ? (programNames.get(programId) ?? null) : null,
                    },
                    {
                      param: 'wallet',
                      label: walletId ? (codes.get(walletId) ?? null) : null,
                    },
                  ]),
                  menus: [
                    filterMenu(
                      url,
                      'period',
                      _('loyalty_backend.field.period'),
                      'period',
                      period,
                      PERIODS.map((value) => ({
                        value,
                        label: _(`loyalty_backend.period.${value}`),
                      })),
                    ),
                    filterMenu(
                      url,
                      'operation',
                      _('loyalty_backend.field.operation'),
                      'operation',
                      operation,
                      options(_, LEDGER_OPERATIONS, 'operation'),
                    ),
                    filterMenu(
                      url,
                      'program',
                      _('loyalty_backend.field.program'),
                      'program',
                      programId,
                      programs.map((program) => ({
                        value: String(program.id),
                        label: String(program.name),
                      })),
                    ),
                  ],
                },
                pager: pager(url, page, rows.length, Number(totals.entries ?? 0)),
              },
            },
            rows.map((row) => ({
              ...row,
              walletCode: codes.get(String(row.walletId)),
            })),
            totals,
          ),
      })
    },

  '/admin/loyalty/memberships':
    (_ctx): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      return seeOther(inLocale(url, '/admin/loyalty/tiers'))
    },

  '/admin/loyalty/tiers':
    (ctx): Route =>
    async (url, req) => {
      if (!['GET', 'POST'].includes(req.method ?? '')) return text('GET or POST', { status: 405 })
      if (req.method === 'POST' && crossSite(req)) return text('Forbidden', { status: 403 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const refusal = formRefusal(_)
      let submitted: Record<string, string> = {}
      let submittedAction = ''
      let tiers = (await ctx.call('loyalty.tier.list', { includeArchived: true }, url, req)) as AnyRow[]
      let policy = (await ctx.call('loyalty.membership.policy.get', {}, url, req)) as AnyRow | null

      const baseHref = (): string => {
        const target = new URL(inLocale(url, '/admin/loyalty/tiers'), url.origin)
        return target.pathname + target.search
      }

      if (req.method === 'POST') {
        const form = await readForm(req)
        submitted = form
        submittedAction = form.action ?? ''
        let result: AnyRow = { ok: false }
        if (submittedAction === 'policy') {
          const checked = refusal.check(membershipPolicyFormSchema, form)
          if (checked)
            result = (await ctx.call(
              'loyalty.membership.policy.save',
              { windowMonths: checked.windowMonths },
              url,
              req,
            )) as AnyRow
          if (result.ok) return seeOther(baseHref())
          refusal.add(resultErrors(result, _))
          policy = (await ctx.call('loyalty.membership.policy.get', {}, url, req)) as AnyRow | null
        } else if (submittedAction === 'tier') {
          const checked = refusal.check(tierFormSchema, form)
          if (checked) {
            const existingTier = tiers.find((row) => String(row.id) === form.id)
            result = (await ctx.call(
              'loyalty.tier.save',
              {
                id: form.id || randomUUID(),
                name: checked.name,
                code: checked.code,
                sequence: checked.sequence ?? 10,
                minimumSpend: checked.minimumSpend,
                redeemPercent: String(existingTier?.redeemPercent ?? 100),
                active: true,
              },
              url,
              req,
            )) as AnyRow
          }
          if (result.ok) return seeOther(baseHref())
          refusal.add(resultErrors(result, _))
        } else if (submittedAction === 'toggle') {
          const tier = tiers.find((row) => String(row.id) === form.id)
          if (!tier) return text(_('loyalty_backend.error.notFound'), { status: 404 })
          result = (await ctx.call(
            'loyalty.tier.save',
            {
              id: String(tier.id),
              name: String(tier.name),
              code: String(tier.code),
              sequence: Number(tier.sequence ?? 10),
              minimumSpend: String(tier.minimumSpend),
              redeemPercent: String(tier.redeemPercent),
              active: !tier.active,
            },
            url,
            req,
          )) as AnyRow
          if (result.ok) return seeOther(baseHref())
          refusal.add(resultErrors(result, _))
        } else return text('unknown action', { status: 400 })
        tiers = (await ctx.call('loyalty.tier.list', { includeArchived: true }, url, req)) as AnyRow[]
      }

      const tierId = url.searchParams.get('tier') ?? (submittedAction === 'tier' ? submitted.id : undefined)
      const tier = tierId ? (tiers.find((row) => String(row.id) === tierId) ?? null) : null
      if (tierId && !tier && submittedAction !== 'tier')
        return text(_('loyalty_backend.error.notFound'), { status: 404 })
      const modal = url.searchParams.get('modal') === 'tier' || submittedAction === 'tier'
      const held = (name: string, fallback: unknown, action: string): unknown =>
        submittedAction === action && Object.hasOwn(submitted, name) ? submitted[name] : fallback
      const policyFields: FormField[] = [
        {
          name: 'windowMonths',
          label: _('loyalty_backend.field.windowMonths'),
          type: 'number',
          value: String(held('windowMonths', policy?.windowMonths ?? 12, 'policy')),
          required: true,
          help: _('loyalty_backend.memberships.windowExamples'),
          error: submittedAction === 'policy' ? refusal.error('windowMonths') : null,
        },
      ]
      const tierFields: FormField[] | undefined = modal
        ? [
            {
              name: 'name',
              label: _('loyalty_backend.field.name'),
              value: String(held('name', tier?.name ?? '', 'tier')),
              required: true,
              error: submittedAction === 'tier' ? refusal.error('name') : null,
            },
            {
              name: 'code',
              label: _('loyalty_backend.field.code'),
              value: String(held('code', tier?.code ?? '', 'tier')),
              required: true,
              error: submittedAction === 'tier' ? refusal.error('code') : null,
            },
            {
              name: 'minimumSpend',
              label: _('loyalty_backend.field.minimumSpend'),
              type: 'decimal',
              value: String(held('minimumSpend', tier?.minimumSpend ?? 0, 'tier')),
              required: true,
              error: submittedAction === 'tier' ? refusal.error('minimumSpend') : null,
            },
            {
              name: 'sequence',
              label: _('loyalty_backend.field.sequence'),
              type: 'number',
              value: String(held('sequence', tier?.sequence ?? 10, 'tier')),
              error: submittedAction === 'tier' ? refusal.error('sequence') : null,
            },
          ]
        : undefined
      const create = new URL(baseHref(), url.origin)
      create.searchParams.set('modal', 'tier')
      const closeHref = baseHref()
      return adminPage(ctx, url, req, {
        title: 'loyalty_backend.memberships.title',
        body: (_, frame) =>
          tiersScreen(_, frame, tiers, {
            action: url.pathname + url.search,
            closeHref,
            createHref: create.pathname + create.search,
            tierHref: (row) => {
              const target = new URL(closeHref, url.origin)
              target.searchParams.set('modal', 'tier')
              target.searchParams.set('tier', String(row.id))
              return target.pathname + target.search
            },
            policyFields,
            policyErrors: submittedAction === 'policy' ? refusal.sentences() : [],
            tierFields,
            tierErrors: submittedAction === 'tier' ? refusal.sentences() : [],
            tier,
            modal,
          }),
      })
    },

  '/admin/loyalty/orders/{channel}/{id}':
    (ctx): Route =>
    async (url, req, params) => {
      if (!['sale', 'pos'].includes(params.channel)) return text('not found', { status: 404 })
      const prefix = params.channel === 'sale' ? 'loyalty_sale' : 'loyalty_pos'
      let errors: string[] = []
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        let result: unknown
        if (form.action === 'code')
          result = await ctx.call(
            `${prefix}.applyCode`,
            { orderId: params.id, code: form.code ?? '' },
            url,
            req,
          )
        else if (form.action === 'reward')
          result = await ctx.call(
            `${prefix}.applyReward`,
            {
              orderId: params.id,
              programId: form.programId ?? '',
              rewardId: form.rewardId ?? '',
            },
            url,
            req,
          )
        else if (form.action === 'remove')
          result = await ctx.call(
            `${prefix}.removeReward`,
            { orderId: params.id, programId: form.programId ?? '' },
            url,
            req,
          )
        else return text('unknown action', { status: 400 })
        if ((result as AnyRow).ok) return seeOther(inLocale(url, url.pathname))
        errors = resultErrors(result, ctx.translate(ctx.localeOf(url, req)))
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [evaluated, order] = await Promise.all([
        ctx.call(`${prefix}.evaluateOrder`, { orderId: params.id }, url, req) as Promise<AnyRow>,
        ctx.call(
          params.channel === 'sale' ? 'sale.getOrder' : 'pos.getOrder',
          { id: params.id },
          url,
          req,
        ) as Promise<AnyRow | null>,
      ])
      if (!order)
        return text(ctx.translate(ctx.localeOf(url, req))('loyalty_backend.error.notFound'), { status: 404 })
      const orderName = String(order.name ?? order.posReference ?? order.id)
      return adminPage(ctx, url, req, {
        title: 'loyalty_backend.order.title',
        body: (_, frame) =>
          orderLoyaltyScreen(_, frame, {
            channel: params.channel as 'sale' | 'pos',
            orderId: params.id,
            orderName,
            // A quotation and a confirmed order are two screens, so the branch
            // picks the path rather than a word inside one.
            backHref: inLocale(
              url,
              params.channel !== 'sale'
                ? `/admin/pos/orders/${params.id}`
                : ['draft', 'sent'].includes(String(order.state))
                  ? `/admin/sales/quotations/${params.id}`
                  : `/admin/sales/orders/${params.id}`,
            ),
            result: evaluated,
            errors,
          }),
      })
    },

  '/my/loyalty':
    (ctx): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const sessions = await ctx.sessionsOf(url, req)
      const session = await sessions?.of(req)
      if (!session) return seeOther(`/login?next=${encodeURIComponent(url.pathname)}`)
      const user = (await ctx.call('user.getUser', { id: session.userId }, url, req)) as AnyRow | null
      const _ = ctx.translate(ctx.localeOf(url, req))
      if (!user?.partnerId)
        return text(_('loyalty_backend.error.partnerRequired'), {
          status: 403,
        })
      const summary = (await ctx.call(
        'loyalty.portal.summary',
        { partnerId: user.partnerId },
        url,
        req,
      )) as AnyRow
      if (summary.ok !== true) return text(resultErrors(summary, _).join('\n'), { status: 400 })
      return adminPage(ctx, url, req, {
        title: 'loyalty_backend.portal.title',
        active: '/admin/loyalty',
        body: (_, frame) => portalScreen(_, frame, summary),
      })
    },
}

export default defineModule({
  name: 'loyalty_backend',
  version: '0.1.0',
  depends: ['loyalty', 'loyalty_sale', 'loyalty_pos', 'sale_backend', 'pos_backend', 'backend', 'user'],
  title: 'Khách hàng thân thiết trong quản trị',
  summary: 'Cấu hình, báo cáo, tích hợp đơn hàng và tóm tắt portal Loyalty.',
  category: 'Bán hàng',
  menus: {
    loyalty: { label: 'menu.app', icon: 'wallet', sequence: 19 },
    'loyalty.dashboard': {
      parent: 'loyalty',
      label: 'menu.dashboard',
      path: '/admin/loyalty',
      sequence: 1,
      needs: 'loyalty.program.list',
    },
    'loyalty.programs': {
      parent: 'loyalty',
      label: 'menu.programs',
      path: '/admin/loyalty/programs',
      sequence: 10,
      needs: 'loyalty.program.list',
    },
    'loyalty.wallets': {
      parent: 'loyalty',
      label: 'menu.wallets',
      path: '/admin/loyalty/wallets',
      sequence: 20,
      needs: 'loyalty.wallet.list',
    },
    'loyalty.memberships': {
      parent: 'loyalty',
      label: 'menu.memberships',
      path: '/admin/loyalty/tiers',
      sequence: 30,
      needs: 'loyalty.tier.list',
    },
    'loyalty.ledger': {
      parent: 'loyalty',
      label: 'menu.ledger',
      path: '/admin/loyalty/ledger',
      sequence: 40,
      needs: 'loyalty.ledger.list',
    },
  },
  routes,
  fills: {
    'sale_backend:order.loyalty': `<a data-ui="action" data-variant="secondary" href="/admin/loyalty/orders/sale/{{ orderId }}{{ locale }}"><span data-ui="action-label">{{ 'loyalty_backend.action.openOrderLoyalty' | _ }}</span></a>`,
    'pos_backend:order.loyalty': `<a data-ui="action" data-variant="secondary" href="/admin/loyalty/orders/pos/{{ orderId }}{{ locale }}"><span data-ui="action-label">{{ 'loyalty_backend.action.openOrderLoyalty' | _ }}</span></a>`,
  },
  messages,
})
