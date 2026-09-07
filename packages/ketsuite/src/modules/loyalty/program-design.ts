import { defineFn, isDateText } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { civilDateAt, DEFAULT_ACCOUNTING_TIMEZONE } from '../account/date.ts'
import { adminFunctions } from './admin-functions.ts'
import { evaluate, invalid, issue, n, now, snapshotOf } from './engine.ts'
import { orderFunctions } from './order-functions.ts'

/** Additive contract: old integrations keep their stored semantics until edited in this workspace. */
export const managedProgram = (program: Row): boolean => program.designVersion === 1
export const moneyProgram = (program: Row): boolean =>
  ['gift_card', 'ewallet'].includes(String(program.programType))
export const programDay = async (ctx: Ctx, at: string): Promise<string> => {
  const company = (await ctx.db.select('company.Company', { id: ctx.scope.company }))[0]
  return civilDateAt(at, company?.accountingTimezone ?? DEFAULT_ACCOUNTING_TIMEZONE)
}
export const calendarState = (program: Row, day: string): string => {
  if (program.phase === 'draft') return 'draft'
  if (!program.active) return 'archived'
  if (program.startDate && String(program.startDate) > day) return 'upcoming'
  if (program.endDate && String(program.endDate) < day) return 'ended'
  if (!managedProgram(program)) {
    if (program.dateFrom && String(program.dateFrom).slice(0, 10) > day) return 'upcoming'
    if (program.dateTo && String(program.dateTo).slice(0, 10) < day) return 'ended'
  }
  return 'running'
}
export const readiness = async (ctx: Ctx, program: Row) => {
  const errors = []
  if (!String(program.name ?? '').trim()) errors.push(issue('name', 'loyalty.error.required'))
  if (!program.availableSale && !program.availablePos)
    errors.push(issue('availableSale', 'loyalty.error.channel'))
  if (program.endDate && String(program.endDate) < (await programDay(ctx, now())))
    errors.push(issue('endDate', 'loyalty.error.scheduleEnded'))
  if (!moneyProgram(program)) {
    const rules = await ctx.db.select('loyalty.Rule', { programId: program.id, active: true })
    const config = (await ctx.db.select('loyalty.MembershipConfig', { programId: program.id }))[0]
    const groups = await ctx.db.select('loyalty.EarnGroup', { programId: program.id, active: true })
    if (!rules.length && !(config && (groups.length || config.fallbackEnabled)))
      errors.push(issue('rules', 'loyalty.error.conditionsRequired'))
    if (!(await ctx.db.select('loyalty.Reward', { programId: program.id, active: true })).length)
      errors.push(issue('rewards', 'loyalty.error.rewardsRequired'))
  }
  return errors
}
class Rejected extends Error {
  readonly result: Row
  constructor(result: Row) {
    super('configuration rejected')
    this.result = result
  }
}
const checked = (result: unknown): Row => {
  const row = result as Row
  if (row?.ok !== true) throw new Rejected(row)
  return row
}
const invoke = async (ctx: Ctx, name: string, args: Row) => {
  const spec = adminFunctions[name]!
  for (const [key, type] of Object.entries(spec.input ?? {})) {
    const v = args[key]
    if (v == null) {
      if (!type.endsWith('?')) throw new Rejected(invalid(issue(key, 'loyalty.error.required')))
      continue
    }
    if (
      type.startsWith('decimal') &&
      (!Number.isFinite(Number(v)) || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(v)))
    )
      throw new Rejected(invalid(issue(key, 'loyalty.error.invalid')))
    if (type.startsWith('int') && !Number.isInteger(v))
      throw new Rejected(invalid(issue(key, 'loyalty.error.invalid')))
  }
  return checked(
    await spec.handler!(
      ctx,
      Object.fromEntries(Object.entries(args).filter(([key]) => key in (spec.input ?? {}))),
    ),
  )
}
const effects = [
  ...new Set([
    ...[
      'program.save',
      'program.setPricelists',
      'rule.save',
      'rule.setProducts',
      'rule.archive',
      'reward.save',
      'reward.setProducts',
      'reward.archive',
    ].flatMap((key) => adminFunctions[key]!.effects ?? []),
    'read:loyalty.MembershipConfig',
    'read:loyalty.EarnGroup',
  ]),
]
const caught = (error: unknown) => {
  if (error instanceof Rejected) return error.result
  throw error
}

export const programDesignFunctions: Record<string, FnSpec> = {
  'program.configure': defineFn({
    input: { id: 'id', expectedVersion: 'int', entity: 'text', entityId: 'id?', values: 'json' },
    effects,
    agent: true,
    handler: async (ctx, args) => {
      try {
        return await ctx.tx(async (tx) => {
          const existing = (await tx.db.select('loyalty.Program', { id: args.id }))[0]
          if (n(existing?.configVersion) !== args.expectedVersion)
            throw new Rejected(invalid(issue('version', 'loyalty.error.concurrent')))
          if (!args.values || typeof args.values !== 'object' || Array.isArray(args.values))
            throw new Rejected(invalid(issue('values', 'loyalty.error.invalid')))
          const values = { ...(args.values as Row) }
          const entity = String(args.entity)
          if (!['program', 'rule', 'reward'].includes(entity) || (!existing && entity !== 'program'))
            throw new Rejected(invalid(issue('id', 'loyalty.error.programMissing')))
          if (existing) {
            const changed = await tx.db.compareAndSet(
              'loyalty.Program',
              { id: args.id },
              { configVersion: existing.configVersion ?? null },
              { configVersion: n(existing.configVersion) + 1 },
            )
            if (!changed) throw new Rejected(invalid(issue('version', 'loyalty.error.concurrent')))
          }
          if (entity === 'program') {
            if (
              existing &&
              (values.programType !== existing.programType ||
                (values.currency && values.currency !== existing.currency))
            )
              throw new Rejected(invalid(issue('programType', 'loyalty.error.typeImmutable')))
            for (const key of ['startDate', 'endDate'])
              if (values[key] && !isDateText(values[key]))
                throw new Rejected(invalid(issue(key, 'loyalty.error.dateRange')))
            if (values.startDate && values.endDate && String(values.startDate) > String(values.endDate))
              throw new Rejected(invalid(issue('endDate', 'loyalty.error.dateRange')))
            if (
              values.programType === 'next_order_coupons' &&
              (!Number.isInteger(values.voucherValidityDays) || n(values.voucherValidityDays) < 1)
            )
              throw new Rejected(invalid(issue('voucherValidityDays', 'loyalty.error.validityDays')))
            const defaults: Row = { ...values, id: args.id, dateFrom: null, dateTo: null }
            if (values.programType !== 'loyalty') delete defaults.appliesOn
            if (values.programType === 'loyalty' && !['both', 'future'].includes(String(values.appliesOn)))
              throw new Rejected(invalid(issue('appliesOn', 'loyalty.error.appliesOn')))
            await invoke(tx, 'program.save', defaults)
            await tx.db.update(
              'loyalty.Program',
              { id: args.id },
              {
                designVersion: 1,
                configVersion: n(existing?.configVersion) + 1,
                phase: existing?.phase ?? (existing?.active ? 'active' : 'draft'),
                active: existing ? Boolean(existing.active) : false,
                startDate: values.startDate || null,
                endDate: values.endDate || null,
                voucherValidityDays:
                  values.programType === 'next_order_coupons' ? values.voucherValidityDays : null,
              },
            )
            await invoke(tx, 'program.setPricelists', {
              id: args.id,
              pricelistIds: values.pricelistIds ?? [],
            })
          } else {
            if (!args.entityId) throw new Rejected(invalid(issue('entityId', 'loyalty.error.required')))
            const program = existing!
            if (moneyProgram(program)) throw new Rejected(invalid(issue('entity', 'loyalty.error.state')))
            const model = entity === 'rule' ? 'loyalty.Rule' : 'loyalty.Reward'
            const held = (await tx.db.select(model, { id: args.entityId }))[0]
            if (held && held.programId !== args.id)
              throw new Rejected(invalid(issue('id', 'loyalty.error.invalid')))
            if (typeof values.active === 'boolean') {
              if (!held) throw new Rejected(invalid(issue('id', 'loyalty.error.invalid')))
              await invoke(tx, `${entity}.archive`, { id: args.entityId, active: values.active })
            } else {
              const products = values.productIds ?? []
              if (!Array.isArray(products) || products.some((id) => typeof id !== 'string'))
                throw new Rejected(invalid(issue('productIds', 'loyalty.error.invalid')))
              if (values.scope === 'specific' && !products.length)
                throw new Rejected(invalid(issue('productIds', 'loyalty.error.productsRequired')))
              if (entity === 'rule') {
                if (program.programType !== 'loyalty')
                  Object.assign(values, { pointAmount: '1', pointMode: 'order', pointSplit: false })
                Object.assign(values, {
                  mode: program.programType === 'promo_code' ? 'with_code' : 'auto',
                  pointSplit: false,
                })
              } else {
                if (program.programType !== 'loyalty') values.requiredPoints = '1'
                values.clearWallet = false
                if (program.programType === 'buy_x_get_y' && values.rewardType !== 'product')
                  throw new Rejected(invalid(issue('rewardType', 'loyalty.error.rewardProduct')))
                if (values.discountApplicability === 'cheapest')
                  throw new Rejected(invalid(issue('discountApplicability', 'loyalty.error.invalid')))
                if (
                  values.discountMode === 'percent' &&
                  values.rewardType === 'discount' &&
                  n(values.discount) > 100
                )
                  throw new Rejected(invalid(issue('discount', 'loyalty.error.discount')))
                if (values.discountMaximum != null && !(n(values.discountMaximum) > 0))
                  throw new Rejected(invalid(issue('discountMaximum', 'loyalty.error.discount')))
                if (values.rewardType === 'shipping')
                  Object.assign(values, {
                    discountMode: 'per_order',
                    discountApplicability: 'order',
                    discount: '0',
                  })
              }
              for (const key of [
                'productId',
                'categoryId',
                'tagId',
                'discountProductId',
                'discountCategoryId',
                'discountTagId',
              ])
                delete values[key]
              await invoke(tx, `${entity}.save`, { ...values, id: args.entityId, programId: args.id })
              await invoke(tx, `${entity}.setProducts`, {
                id: args.entityId,
                productIds: values.scope === 'specific' ? products : [],
              })
            }
          }
          const program = (await tx.db.select('loyalty.Program', { id: args.id }))[0]!
          return { ok: true, id: args.id, version: n(program.configVersion) }
        })
      } catch (error) {
        return caught(error)
      }
    },
  }),
  'program.transition': defineFn({
    input: { id: 'id', expectedVersion: 'int', action: 'text' },
    effects,
    agent: true,
    handler: async (ctx, args) => {
      try {
        return await ctx.tx(async (tx) => {
          const program = (await tx.db.select('loyalty.Program', { id: args.id }))[0]
          if (!program) return invalid(issue('id', 'loyalty.error.programMissing'))
          if (n(program.configVersion) !== args.expectedVersion)
            return invalid(issue('version', 'loyalty.error.concurrent'))
          if (!['activate', 'archive', 'restore'].includes(String(args.action)))
            return invalid(issue('action', 'loyalty.error.state'))
          if (args.action === 'activate') {
            if (program.phase !== 'draft') return invalid(issue('action', 'loyalty.error.state'))
            const errors = await readiness(tx, program)
            if (errors.length) return { ok: false, errors }
          }
          if (args.action === 'restore' && (program.active || program.phase === 'draft'))
            return invalid(issue('action', 'loyalty.error.state'))
          const changed = await tx.db.compareAndSet(
            'loyalty.Program',
            { id: args.id },
            { configVersion: program.configVersion ?? null },
            {
              configVersion: n(program.configVersion) + 1,
              phase: args.action === 'activate' ? 'active' : args.action === 'restore' ? 'draft' : 'archived',
              active: args.action === 'activate',
              updatedAt: now(),
            },
          )
          return changed ? { ok: true, id: args.id } : invalid(issue('version', 'loyalty.error.concurrent'))
        })
      } catch (error) {
        return caught(error)
      }
    },
  }),
  'program.inspect': defineFn({
    input: { id: 'id' },
    effects: [...effects.filter((effect) => effect.startsWith('read:'))],
    agent: true,
    handler: async (ctx, args) => {
      const program = (await adminFunctions['program.get']!.handler!(ctx, args)) as Row | null
      if (!program) return null
      const config = (await ctx.db.select('loyalty.MembershipConfig', { programId: args.id }))[0]
      return {
        ...program,
        state: calendarState(program, await programDay(ctx, now())),
        readiness: await readiness(ctx, program),
        earnSource: config ? 'groups' : 'rules',
      }
    },
  }),
  'program.preview': defineFn({
    input: { id: 'id', expectedVersion: 'int', order: 'json', availablePoints: 'decimal?' },
    effects: [
      ...new Set([
        ...(orderFunctions.evaluateOrder?.effects ?? []),
        ...effects.filter((effect) => effect.startsWith('read:')),
      ]),
    ],
    agent: true,
    handler: async (ctx, args) => {
      const program = (await ctx.db.select('loyalty.Program', { id: args.id }))[0]
      if (!program) return invalid(issue('id', 'loyalty.error.programMissing'))
      if (n(program.configVersion) !== args.expectedVersion)
        return invalid(issue('version', 'loyalty.error.concurrent'))
      const order = snapshotOf(args.order)
      if (
        (args.availablePoints !== undefined && n(args.availablePoints) < 0) ||
        !order ||
        order.lines.some((line) => line.quantity < 0 || n(line.total) < 0 || n(line.untaxed) < 0)
      )
        return invalid(issue('order', 'loyalty.error.order'))
      const trace: Row[] = []
      const result = await evaluate(ctx, order, {
        onlyProgramId: String(args.id),
        preview: true,
        availablePoints: args.availablePoints === undefined ? undefined : n(args.availablePoints),
        trace,
      })
      if (
        (await ctx.db.select('loyalty.Program', { id: args.id }))[0]?.configVersion !== program.configVersion
      )
        return invalid(issue('version', 'loyalty.error.concurrent'))
      return { ok: true, version: args.expectedVersion, result: result[0] ?? null, trace }
    },
  }),
}

/** Old low-level endpoints cannot silently overwrite a versioned workspace edit. */
export const guardedAdminFunctions: Record<string, FnSpec> = Object.fromEntries(
  Object.entries(adminFunctions).map(([name, spec]) => {
    if (!/^(program|rule|reward)\.(save|archive|setProducts|setPricelists)$/.test(name)) return [name, spec]
    return [
      name,
      {
        ...spec,
        effects: [
          ...new Set([
            ...(spec.effects ?? []),
            'read:loyalty.Program',
            'read:loyalty.Rule',
            'read:loyalty.Reward',
          ]),
        ],
        handler: async (ctx: Ctx, args: Row) => {
          let id = args.programId ?? args.id
          if (!name.startsWith('program.') && !args.programId) {
            const row = (
              await ctx.db.select(name.startsWith('rule.') ? 'loyalty.Rule' : 'loyalty.Reward', {
                id: args.id,
              })
            )[0]
            id = row?.programId
          }
          if (!name.startsWith('program.') && args.programId) {
            const held = (
              await ctx.db.select(name.startsWith('rule.') ? 'loyalty.Rule' : 'loyalty.Reward', {
                id: args.id,
              })
            )[0]
            if (held && held.programId !== args.programId)
              return invalid(issue('programId', 'loyalty.error.invalid'))
          }
          const program = id ? (await ctx.db.select('loyalty.Program', { id }))[0] : null
          if (program && managedProgram(program))
            return invalid(issue('version', 'loyalty.error.useConfiguration'))
          return spec.handler!(ctx, args)
        },
      },
    ]
  }),
)
