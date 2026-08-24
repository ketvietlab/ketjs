import { randomUUID } from 'node:crypto'
import { defineModule, text } from '@ketvietlab/ketjs'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import type { FormField } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import {
  DISCOUNT_APPLICABILITY,
  DISCOUNT_MODES,
  POINT_MODES,
  PROGRAM_APPLIES_ON,
  PROGRAM_TRIGGERS,
  PROGRAM_TYPES,
  REWARD_TYPES,
  TAX_MODES,
} from '../loyalty/types.ts'
import { messages } from './messages.ts'
import {
  dashboardScreen,
  ledgerScreen,
  membershipsScreen,
  orderLoyaltyScreen,
  portalScreen,
  programDetailScreen,
  programsScreen,
  walletDetailScreen,
  walletsScreen,
} from './screens.tsx'
import { adminPage, choices, inLocale, optional } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'

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

const bool = (value: string | undefined) => value === '1' || value === 'true' || value === 'on'
const resultErrors = (result: unknown, _: Translator): string[] =>
  (
    (
      result as {
        errors?: Array<{ code?: string; message?: string; params?: Record<string, unknown> }>
      } | null
    )?.errors ?? []
  ).map((error) =>
    error.code ? _(error.code, error.params) : String(error.message ?? _('loyalty_backend.error.invalid')),
  )

const options = (_: Translator, values: readonly string[], group: string) =>
  values.map((value) => ({ value, label: _(`loyalty_backend.${group}.${value}`) }))

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

const programFields = (_: Translator, row: AnyRow): FormField[] => [
  { name: 'name', label: _('loyalty_backend.field.name'), value: String(row.name ?? ''), required: true },
  {
    name: 'programType',
    label: _('loyalty_backend.field.programType'),
    type: 'select',
    value: String(row.programType ?? ''),
    options: options(_, PROGRAM_TYPES, 'programType'),
    required: true,
  },
  {
    name: 'sequence',
    label: _('loyalty_backend.field.sequence'),
    type: 'number',
    value: Number(row.sequence ?? 10),
  },
  {
    name: 'currency',
    label: _('loyalty_backend.field.currency'),
    value: String(row.currency ?? ''),
    required: true,
  },
  {
    name: 'dateFrom',
    label: _('loyalty_backend.field.dateFrom'),
    type: 'datetime-local',
    value: row.dateFrom ? String(row.dateFrom).slice(0, 16) : '',
  },
  {
    name: 'dateTo',
    label: _('loyalty_backend.field.dateTo'),
    type: 'datetime-local',
    value: row.dateTo ? String(row.dateTo).slice(0, 16) : '',
  },
  {
    name: 'limitUsage',
    label: _('loyalty_backend.field.limitUsage'),
    type: 'checkbox',
    value: Boolean(row.limitUsage),
  },
  {
    name: 'maxUsage',
    label: _('loyalty_backend.field.maxUsage'),
    type: 'number',
    value: row.maxUsage == null ? '' : Number(row.maxUsage),
  },
  {
    name: 'appliesOn',
    label: _('loyalty_backend.field.appliesOn'),
    type: 'select',
    value: String(row.appliesOn ?? ''),
    options: options(_, PROGRAM_APPLIES_ON, 'appliesOn'),
  },
  {
    name: 'trigger',
    label: _('loyalty_backend.field.trigger'),
    type: 'select',
    value: String(row.trigger ?? ''),
    options: options(_, PROGRAM_TRIGGERS, 'trigger'),
  },
  { name: 'pointName', label: _('loyalty_backend.field.pointName'), value: String(row.pointName ?? '') },
  {
    name: 'portalVisible',
    label: _('loyalty_backend.field.portalVisible'),
    type: 'checkbox',
    value: Boolean(row.portalVisible),
  },
  {
    name: 'availableSale',
    label: _('loyalty_backend.field.availableSale'),
    type: 'checkbox',
    value: Boolean(row.availableSale),
  },
  {
    name: 'availablePos',
    label: _('loyalty_backend.field.availablePos'),
    type: 'checkbox',
    value: Boolean(row.availablePos),
  },
]

const programInput = (id: string, form: Record<string, string>) => ({
  id,
  name: form.name ?? '',
  programType: form.programType ?? '',
  sequence: Number(form.sequence || 10),
  ...optional(form, 'currency'),
  ...optional(form, 'dateFrom'),
  ...optional(form, 'dateTo'),
  limitUsage: bool(form.limitUsage),
  ...(form.maxUsage ? { maxUsage: Number(form.maxUsage) } : {}),
  ...optional(form, 'appliesOn'),
  ...optional(form, 'trigger'),
  ...optional(form, 'pointName'),
  portalVisible: bool(form.portalVisible),
  availableSale: bool(form.availableSale),
  availablePos: bool(form.availablePos),
})

const ruleFields = (_: Translator, products: AnyRow[]): FormField[] => [
  { name: 'priority', label: _('loyalty_backend.field.priority'), type: 'number', value: 10 },
  {
    name: 'productId',
    label: _('loyalty_backend.field.rewardProduct'),
    type: 'select',
    options: choices(products, true),
  },
  {
    name: 'pointAmount',
    label: _('loyalty_backend.field.pointAmount'),
    type: 'decimal',
    value: 1,
    required: true,
  },
  {
    name: 'pointMode',
    label: _('loyalty_backend.field.pointMode'),
    type: 'select',
    options: options(_, POINT_MODES, 'pointMode'),
    required: true,
  },
  { name: 'pointSplit', label: _('loyalty_backend.field.pointSplit'), type: 'checkbox' },
  { name: 'minimumQuantity', label: _('loyalty_backend.field.minimumQuantity'), type: 'decimal', value: 1 },
  { name: 'minimumAmount', label: _('loyalty_backend.field.minimumAmount'), type: 'decimal', value: 0 },
  {
    name: 'taxMode',
    label: _('loyalty_backend.field.taxMode'),
    type: 'select',
    options: options(_, TAX_MODES, 'taxMode'),
    required: true,
  },
  {
    name: 'mode',
    label: _('loyalty_backend.field.mode'),
    type: 'select',
    options: options(_, PROGRAM_TRIGGERS, 'trigger'),
    required: true,
  },
  { name: 'code', label: _('loyalty_backend.field.code') },
]

const rewardFields = (_: Translator, products: AnyRow[]): FormField[] => [
  { name: 'description', label: _('loyalty_backend.field.description'), required: true },
  {
    name: 'rewardType',
    label: _('loyalty_backend.field.rewardType'),
    type: 'select',
    options: options(_, REWARD_TYPES, 'rewardType'),
    required: true,
  },
  { name: 'discount', label: _('loyalty_backend.field.discount'), type: 'decimal', value: 10 },
  {
    name: 'discountMode',
    label: _('loyalty_backend.field.discountMode'),
    type: 'select',
    options: options(_, DISCOUNT_MODES, 'discountMode'),
  },
  {
    name: 'discountApplicability',
    label: _('loyalty_backend.field.discountApplicability'),
    type: 'select',
    options: options(_, DISCOUNT_APPLICABILITY, 'discountApplicability'),
  },
  { name: 'discountMaximum', label: _('loyalty_backend.field.discountMaximum'), type: 'decimal' },
  {
    name: 'rewardProductId',
    label: _('loyalty_backend.field.rewardProduct'),
    type: 'select',
    options: choices(products, true),
  },
  {
    name: 'rewardProductQuantity',
    label: _('loyalty_backend.field.rewardProductQuantity'),
    type: 'decimal',
    value: 1,
  },
  {
    name: 'requiredPoints',
    label: _('loyalty_backend.field.requiredPoints'),
    type: 'decimal',
    value: 1,
    required: true,
  },
  { name: 'clearWallet', label: _('loyalty_backend.field.clearWallet'), type: 'checkbox' },
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
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const result = await ctx.call(
          'loyalty.program.save',
          { ...programInput(randomUUID(), form), availableSale: true, availablePos: true },
          url,
          req,
        )
        if ((result as AnyRow).ok)
          return seeOther(inLocale(url, `/admin/loyalty/programs/${String((result as AnyRow).id)}`))
        const _ = ctx.translate(ctx.localeOf(url, req))
        const rows = (await ctx.call('loyalty.program.list', { includeArchived: true }, url, req)) as AnyRow[]
        return adminPage(ctx, url, req, {
          title: 'loyalty_backend.programs.title',
          body: (_, frame) => programsScreen(_, frame, rows, createProgramFields(_), resultErrors(result, _)),
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows = (await ctx.call('loyalty.program.list', { includeArchived: true }, url, req)) as AnyRow[]
      return adminPage(ctx, url, req, {
        title: 'loyalty_backend.programs.title',
        body: (_, frame) => programsScreen(_, frame, rows, createProgramFields(_)),
      })
    },

  '/admin/loyalty/programs/{id}':
    (ctx): Route =>
    async (url, req, params) => {
      let errors: string[] = []
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        let result: unknown
        if (form.action === 'save-program')
          result = await ctx.call('loyalty.program.save', programInput(params.id, form), url, req)
        else if (form.action === 'archive' || form.action === 'restore')
          result = await ctx.call(
            'loyalty.program.archive',
            { id: params.id, active: form.action === 'restore' },
            url,
            req,
          )
        else if (form.action === 'add-rule')
          result = await ctx.call(
            'loyalty.rule.save',
            {
              id: randomUUID(),
              programId: params.id,
              priority: Number(form.priority || 10),
              ...optional(form, 'productId'),
              pointAmount: form.pointAmount || '1',
              pointMode: form.pointMode || 'order',
              pointSplit: bool(form.pointSplit),
              minimumQuantity: form.minimumQuantity || '1',
              minimumAmount: form.minimumAmount || '0',
              taxMode: form.taxMode || 'excl',
              mode: form.mode || 'auto',
              ...optional(form, 'code'),
            },
            url,
            req,
          )
        else if (form.action === 'add-reward')
          result = await ctx.call(
            'loyalty.reward.save',
            {
              id: randomUUID(),
              programId: params.id,
              description: form.description || '',
              rewardType: form.rewardType || 'discount',
              discount: form.discount || '0',
              discountMode: form.discountMode || 'percent',
              discountApplicability: form.discountApplicability || 'order',
              ...optional(form, 'discountMaximum'),
              ...optional(form, 'rewardProductId'),
              rewardProductQuantity: form.rewardProductQuantity || '1',
              requiredPoints: form.requiredPoints || '1',
              clearWallet: bool(form.clearWallet),
            },
            url,
            req,
          )
        else return text('unknown action', { status: 400 })
        if ((result as AnyRow).ok) return seeOther(inLocale(url, url.pathname))
        errors = resultErrors(result, ctx.translate(ctx.localeOf(url, req)))
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [program, data] = await Promise.all([
        ctx.call('loyalty.program.get', { id: params.id }, url, req) as Promise<AnyRow | null>,
        dataFor(ctx, url, req),
      ])
      if (!program)
        return text(ctx.translate(ctx.localeOf(url, req))('loyalty_backend.error.notFound'), { status: 404 })
      return adminPage(ctx, url, req, {
        title: 'loyalty_backend.program.detail',
        body: (_, frame) =>
          programDetailScreen(_, frame, program, {
            programFields: programFields(_, program),
            ruleFields: ruleFields(_, data.products),
            rewardFields: rewardFields(_, data.products),
            errors,
          }),
      })
    },

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
      const wallets = (await ctx.call('loyalty.wallet.list', { includeArchived: true }, url, req)) as AnyRow[]
      const names = new Map(data.partners.map((partner) => [String(partner.id), String(partner.name)]))
      return adminPage(ctx, url, req, {
        title: 'loyalty_backend.wallets.title',
        body: (_, frame) =>
          walletsScreen(
            _,
            frame,
            wallets.map((wallet) => ({ ...wallet, partnerName: names.get(String(wallet.partnerId)) })),
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
              { name: 'expiresAt', label: _('loyalty_backend.field.expiresAt'), type: 'datetime-local' },
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
      const wallet = (await ctx.call('loyalty.wallet.get', { id: params.id }, url, req)) as AnyRow | null
      if (!wallet)
        return text(ctx.translate(ctx.localeOf(url, req))('loyalty_backend.error.notFound'), { status: 404 })
      return adminPage(ctx, url, req, {
        title: 'loyalty_backend.wallets.title',
        body: (_, frame) =>
          walletDetailScreen(
            _,
            frame,
            wallet,
            [
              { name: 'amount', label: _('loyalty_backend.field.amount'), type: 'decimal', required: true },
              {
                name: 'sourceId',
                label: _('loyalty_backend.field.sourceId'),
                value: randomUUID(),
                required: true,
              },
              { name: 'note', label: _('loyalty_backend.field.note'), type: 'textarea', span: 'full' },
            ],
            errors,
          ),
      })
    },

  '/admin/loyalty/ledger':
    (ctx): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const [rows, wallets] = await Promise.all([
        ctx.call('loyalty.ledger.list', { limit: 500 }, url, req) as Promise<AnyRow[]>,
        ctx.call('loyalty.wallet.list', { includeArchived: true }, url, req) as Promise<AnyRow[]>,
      ])
      const codes = new Map(wallets.map((wallet) => [String(wallet.id), String(wallet.code)]))
      return adminPage(ctx, url, req, {
        title: 'loyalty_backend.ledger.title',
        body: (_, frame) =>
          ledgerScreen(
            _,
            frame,
            rows.map((row) => ({ ...row, walletCode: codes.get(String(row.walletId)) })),
          ),
      })
    },

  '/admin/loyalty/memberships':
    (ctx): Route =>
    async (url, req) => {
      const data = await dataFor(ctx, url, req)
      const loyaltyPrograms = data.programs.filter(
        (program) => program.programType === 'loyalty' && program.active,
      )
      let errors: string[] = []
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const result =
          form.action === 'tier'
            ? await ctx.call(
                'loyalty.tier.save',
                {
                  id: randomUUID(),
                  name: form.name ?? '',
                  code: form.code ?? '',
                  sequence: Number(form.sequence || 10),
                  minimumSpend: form.minimumSpend || '0',
                  redeemPercent: form.redeemPercent || '0',
                  active: true,
                },
                url,
                req,
              )
            : await ctx.call(
                'loyalty.membership.config.save',
                {
                  id: form.id || 'membership-config',
                  programId: form.programId ?? '',
                  windowMonths: Number(form.windowMonths || 12),
                  pointValue: form.pointValue || '1',
                  minimumRedeemStep: form.minimumRedeemStep || '1',
                  fallbackCurrencyPerPoint: form.fallbackCurrencyPerPoint || '1',
                  fallbackEnabled: bool(form.fallbackEnabled),
                },
                url,
                req,
              )
        if ((result as AnyRow).ok) return seeOther(inLocale(url, url.pathname))
        errors = resultErrors(result, ctx.translate(ctx.localeOf(url, req)))
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [tiers, memberships, config] = await Promise.all([
        ctx.call('loyalty.tier.list', { includeArchived: true }, url, req) as Promise<AnyRow[]>,
        ctx.call('loyalty.membership.list', { limit: 500 }, url, req) as Promise<AnyRow[]>,
        ctx.call('loyalty.membership.config.get', {}, url, req) as Promise<AnyRow | null>,
      ])
      const names = new Map(data.partners.map((partner) => [String(partner.id), String(partner.name)]))
      return adminPage(ctx, url, req, {
        title: 'loyalty_backend.memberships.title',
        body: (_, frame) =>
          membershipsScreen(
            _,
            frame,
            memberships.map((membership) => ({
              ...membership,
              partnerName: names.get(String(membership.partnerId)),
            })),
            tiers,
            [
              { name: 'name', label: _('loyalty_backend.field.name'), required: true },
              { name: 'code', label: _('loyalty_backend.field.code'), required: true },
              { name: 'sequence', label: _('loyalty_backend.field.sequence'), type: 'number', value: 10 },
              {
                name: 'minimumSpend',
                label: _('loyalty_backend.field.minimumSpend'),
                type: 'decimal',
                value: 0,
                required: true,
              },
              {
                name: 'redeemPercent',
                label: _('loyalty_backend.field.redeemPercent'),
                type: 'decimal',
                value: 100,
                required: true,
              },
            ],
            [
              {
                name: 'programId',
                label: _('loyalty_backend.field.program'),
                type: 'select',
                value: String(config?.programId ?? loyaltyPrograms[0]?.id ?? ''),
                options: choices(loyaltyPrograms),
                required: true,
              },
              {
                name: 'windowMonths',
                label: _('loyalty_backend.field.windowMonths'),
                type: 'number',
                value: Number(config?.windowMonths ?? 12),
                required: true,
              },
              {
                name: 'pointValue',
                label: _('loyalty_backend.field.pointValue'),
                type: 'decimal',
                value: String(config?.pointValue ?? 1),
                required: true,
              },
              {
                name: 'minimumRedeemStep',
                label: _('loyalty_backend.field.minimumRedeemStep'),
                type: 'decimal',
                value: String(config?.minimumRedeemStep ?? 1),
                required: true,
              },
              {
                name: 'fallbackCurrencyPerPoint',
                label: _('loyalty_backend.field.fallbackCurrencyPerPoint'),
                type: 'decimal',
                value: String(config?.fallbackCurrencyPerPoint ?? 1),
                required: true,
              },
              {
                name: 'fallbackEnabled',
                label: _('loyalty_backend.field.fallbackEnabled'),
                type: 'checkbox',
                value: config ? Boolean(config.fallbackEnabled) : true,
              },
            ],
            errors,
          ),
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
            { orderId: params.id, programId: form.programId ?? '', rewardId: form.rewardId ?? '' },
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
      if (!user?.partnerId) return text(_('loyalty_backend.error.partnerRequired'), { status: 403 })
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
  group: 'commerce',
  version: '0.1.0',
  depends: ['loyalty', 'loyalty_sale', 'loyalty_pos', 'sale_backend', 'pos_backend', 'backend', 'user'],
  install: 'auto',
  app: true,
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
      path: '/admin/loyalty/memberships',
      sequence: 30,
      needs: 'loyalty.membership.list',
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
