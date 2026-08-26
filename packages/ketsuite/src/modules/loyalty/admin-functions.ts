import {
  and,
  asc,
  defineFn,
  deleteFrom,
  eq,
  from,
  gt,
  gte,
  ilike,
  isNull,
  lt,
  lte,
  or,
} from '@ketvietlab/ketjs'
import type { Ctx, Expr, FnSpec } from '@ketvietlab/ketjs'
import {
  invalid,
  issue,
  n,
  normalizeCode,
  now,
  validateProgramEnums,
  validateRewardEnums,
  validateRuleEnums,
} from './engine.ts'

const asIds = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((item) => typeof item === 'string')
    ? [...new Set(value.map((item) => item.trim()).filter(Boolean))]
    : null

const codeAvailable = async (
  ctx: Ctx,
  code: string,
  except: { ruleId?: string; walletId?: string } = {},
): Promise<boolean> => {
  if (!code) return true
  const rule = (await ctx.db.select('loyalty.Rule', { normalizedCode: code })).find(
    (row) => row.active && row.id !== except.ruleId,
  )
  const wallet = (await ctx.db.select('loyalty.Wallet', { normalizedCode: code })).find(
    (row) => row.active && row.id !== except.walletId,
  )
  return !rule && !wallet
}

const programDefaults = (type: string) => {
  const base = { appliesOn: 'current', trigger: 'auto', portalVisible: false, pointName: 'Points' }
  if (type === 'coupons') return { ...base, trigger: 'with_code', pointName: 'Coupon points' }
  if (type === 'gift_card')
    return { ...base, appliesOn: 'future', portalVisible: true, pointName: 'Currency' }
  if (type === 'loyalty')
    return { ...base, appliesOn: 'both', portalVisible: true, pointName: 'Loyalty points' }
  if (type === 'ewallet') return { ...base, appliesOn: 'future', portalVisible: true, pointName: 'Currency' }
  if (type === 'promo_code') return { ...base, trigger: 'with_code', pointName: 'Promotion points' }
  if (type === 'next_order_coupons') return { ...base, appliesOn: 'future', pointName: 'Coupon points' }
  return { ...base, pointName: 'Promotion points' }
}

const programEffects = ['read:loyalty.Program', 'write:loyalty.Program', 'read:company.Company'] as const

export const adminFunctions: Record<string, FnSpec> = {
  /**
   * Programs, in the order they were told to appear in.
   *
   * `state` answers where a program stands in its own calendar rather than
   * whether a flag is on: one that starts next month and one that finished last
   * week are both not running today, and a list that lumps them together makes
   * the operator open each to find out which is which.
   */
  'program.list': defineFn({
    input: {
      programType: 'text?',
      includeArchived: 'bool?',
      state: 'text?',
      search: 'text?',
      limit: 'int?',
      offset: 'int?',
    },
    effects: ['read:loyalty.Program'],
    agent: true,
    handler: async (ctx, args) => {
      const P = ctx.table('loyalty.Program')
      const at = now()
      const parts: Expr[] = []
      if (args.programType) parts.push(eq(P.programType, args.programType))
      if (args.search) parts.push(ilike(P.name, `%${String(args.search)}%`))
      if (args.state === 'running')
        parts.push(
          and(
            eq(P.active, true),
            or(lte(P.dateFrom, at), isNull(P.dateFrom)),
            or(gte(P.dateTo, at), isNull(P.dateTo)),
          ),
        )
      else if (args.state === 'upcoming') parts.push(and(eq(P.active, true), gt(P.dateFrom, at)))
      else if (args.state === 'ended') parts.push(and(eq(P.active, true), lt(P.dateTo, at)))
      else if (args.state === 'archived') parts.push(eq(P.active, false))
      else if (!args.includeArchived) parts.push(eq(P.active, true))

      let query = from(P).orderBy(asc(P.sequence), asc(P.id))
      if (parts.length) query = query.where(and(...parts))
      const size = Math.min(1000, Math.max(1, n(args.limit ?? 100)))
      const skip = Math.max(0, n(args.offset ?? 0))
      return ctx.db.all(skip ? query.limit(size).offset(skip) : query.limit(size))
    },
  }),

  'program.get': defineFn({
    input: { id: 'id' },
    effects: [
      'read:loyalty.Program',
      'read:loyalty.ProgramPricelist',
      'read:loyalty.Rule',
      'read:loyalty.RuleProduct',
      'read:loyalty.Reward',
      'read:loyalty.RewardProduct',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const program = (await ctx.db.select('loyalty.Program', { id: args.id }))[0]
      if (!program) return null
      const rules = await ctx.db.select('loyalty.Rule', { programId: args.id })
      const rewards = await ctx.db.select('loyalty.Reward', { programId: args.id })
      return {
        ...program,
        pricelistIds: (await ctx.db.select('loyalty.ProgramPricelist', { programId: args.id })).map(
          (row) => row.pricelistId,
        ),
        rules: await Promise.all(
          rules.map(async (rule) => ({
            ...rule,
            productIds: (await ctx.db.select('loyalty.RuleProduct', { ruleId: rule.id })).map(
              (row) => row.productId,
            ),
          })),
        ),
        rewards: await Promise.all(
          rewards.map(async (reward) => ({
            ...reward,
            productIds: (await ctx.db.select('loyalty.RewardProduct', { rewardId: reward.id })).map(
              (row) => row.productId,
            ),
          })),
        ),
      }
    },
  }),

  'program.save': defineFn({
    input: {
      id: 'id',
      name: 'text',
      programType: 'text',
      sequence: 'int?',
      currency: 'text?',
      dateFrom: 'datetime?',
      dateTo: 'datetime?',
      limitUsage: 'bool?',
      maxUsage: 'int?',
      appliesOn: 'text?',
      trigger: 'text?',
      portalVisible: 'bool?',
      pointName: 'text?',
      availableSale: 'bool?',
      availablePos: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [...programEffects],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const companyId = ctx.scope.company
      if (!companyId) return invalid(issue('company', 'loyalty.error.companyRequired'))
      const company = (await ctx.db.select('company.Company', { id: companyId }))[0]
      if (!company) return invalid(issue('company', 'loyalty.error.companyRequired'))
      const defaults = programDefaults(String(args.programType))
      const values = {
        ...args,
        name: String(args.name).trim(),
        currency: String(args.currency ?? company.currency),
        appliesOn: String(args.appliesOn ?? defaults.appliesOn),
        trigger: String(args.trigger ?? defaults.trigger),
      }
      const errors = validateProgramEnums(values)
      if (!values.name) errors.push(issue('name', 'loyalty.error.required'))
      if (
        args.dateFrom &&
        args.dateTo &&
        new Date(String(args.dateFrom)).getTime() > new Date(String(args.dateTo)).getTime()
      )
        errors.push(issue('dateTo', 'loyalty.error.dateRange'))
      if (args.limitUsage && !(n(args.maxUsage) > 0))
        errors.push(issue('maxUsage', 'loyalty.error.usageLimit'))
      if (errors.length) return { ok: false, errors }
      const existing = (await ctx.db.select('loyalty.Program', { id: args.id }))[0]
      const patch = {
        name: values.name,
        programType: args.programType,
        active: existing ? Boolean(existing.active) : true,
        sequence: args.sequence ?? 10,
        currency: values.currency,
        dateFrom: args.dateFrom ?? null,
        dateTo: args.dateTo ?? null,
        limitUsage: Boolean(args.limitUsage),
        maxUsage: args.limitUsage ? (args.maxUsage ?? null) : null,
        appliesOn: values.appliesOn,
        trigger: values.trigger,
        portalVisible: args.portalVisible ?? defaults.portalVisible,
        pointName: String(args.pointName ?? defaults.pointName),
        availableSale: args.availableSale ?? true,
        availablePos: args.availablePos ?? true,
        updatedAt: now(),
      }
      if (existing) await ctx.db.update('loyalty.Program', { id: args.id }, patch)
      else await ctx.db.insert('loyalty.Program', { id: args.id, ...patch, createdAt: now() })
      return { ok: true, id: args.id }
    },
  }),

  'program.archive': defineFn({
    input: { id: 'id', active: 'bool' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:loyalty.Program', 'write:loyalty.Program'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('loyalty.Program', { id: args.id }))[0])
        return invalid(issue('id', 'loyalty.error.programMissing'))
      await ctx.db.update('loyalty.Program', { id: args.id }, { active: args.active, updatedAt: now() })
      return { ok: true, id: args.id }
    },
  }),

  'program.setPricelists': defineFn({
    input: { id: 'id', pricelistIds: 'json' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:loyalty.Program',
      'read:loyalty.ProgramPricelist',
      'write:loyalty.ProgramPricelist',
      'read:pricing.Pricelist',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const program = (await ctx.db.select('loyalty.Program', { id: args.id }))[0]
      if (!program) return invalid(issue('id', 'loyalty.error.programMissing'))
      const ids = asIds(args.pricelistIds)
      if (!ids) return invalid(issue('pricelistIds', 'loyalty.error.invalid'))
      for (const id of ids) {
        const pricelist = (await ctx.db.select('pricing.Pricelist', { id }))[0]
        if (!pricelist) return invalid(issue('pricelistIds', 'loyalty.error.pricelistMissing'))
        if (pricelist.currency !== program.currency)
          return invalid(issue('pricelistIds', 'loyalty.error.currency'))
      }
      const P = ctx.table('loyalty.ProgramPricelist')
      await ctx.db.del(deleteFrom(P).where(eq(P.programId, args.id)))
      for (const id of ids)
        await ctx.db.insert('loyalty.ProgramPricelist', {
          id: `${String(args.id)}:${id}`,
          programId: args.id,
          pricelistId: id,
        })
      return { ok: true, id: args.id }
    },
  }),

  'rule.save': defineFn({
    input: {
      id: 'id',
      programId: 'id',
      priority: 'int?',
      productId: 'id?',
      categoryId: 'id?',
      tagId: 'id?',
      pointAmount: 'decimal',
      pointMode: 'text',
      pointSplit: 'bool?',
      minimumQuantity: 'decimal?',
      minimumAmount: 'decimal?',
      taxMode: 'text',
      mode: 'text',
      code: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:loyalty.Program',
      'read:loyalty.Rule',
      'write:loyalty.Rule',
      'read:loyalty.Wallet',
      'read:loyalty.Tag',
      'read:product.Product',
      'read:product.Category',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const program = (await ctx.db.select('loyalty.Program', { id: args.programId }))[0]
      if (!program) return invalid(issue('programId', 'loyalty.error.programMissing'))
      const errors = validateRuleEnums(args)
      if (!(n(args.pointAmount) > 0)) errors.push(issue('pointAmount', 'loyalty.error.pointsPositive'))
      if (n(args.minimumQuantity) < 0 || n(args.minimumAmount) < 0)
        errors.push(issue('minimumAmount', 'loyalty.error.invalid'))
      if (args.pointSplit && (program.appliesOn === 'both' || program.programType === 'ewallet'))
        errors.push(issue('pointSplit', 'loyalty.error.invalid'))
      if (args.productId && !(await ctx.db.select('product.Product', { id: args.productId }))[0])
        errors.push(issue('productId', 'loyalty.error.productMissing'))
      if (args.categoryId && !(await ctx.db.select('product.Category', { id: args.categoryId }))[0])
        errors.push(issue('categoryId', 'loyalty.error.invalid'))
      if (args.tagId && !(await ctx.db.select('loyalty.Tag', { id: args.tagId }))[0])
        errors.push(issue('tagId', 'loyalty.error.invalid'))
      const normalizedCode = args.mode === 'with_code' ? normalizeCode(args.code) : ''
      if (args.mode === 'with_code' && !normalizedCode)
        errors.push(issue('code', 'loyalty.error.codeRequired'))
      if (normalizedCode && !(await codeAvailable(ctx, normalizedCode, { ruleId: String(args.id) })))
        errors.push(issue('code', 'loyalty.error.codeDuplicate'))
      if (errors.length) return { ok: false, errors }
      const existing = (await ctx.db.select('loyalty.Rule', { id: args.id }))[0]
      const patch = {
        programId: args.programId,
        active: existing ? Boolean(existing.active) : true,
        priority: args.priority ?? 10,
        productId: args.productId ?? null,
        categoryId: args.categoryId ?? null,
        tagId: args.tagId ?? null,
        pointAmount: args.pointAmount,
        pointMode: args.pointMode,
        pointSplit: Boolean(args.pointSplit),
        minimumQuantity: args.minimumQuantity ?? '1',
        minimumAmount: args.minimumAmount ?? '0',
        taxMode: args.taxMode,
        mode: args.mode,
        code: normalizedCode ? String(args.code).trim() : null,
        normalizedCode: normalizedCode || null,
      }
      if (existing) await ctx.db.update('loyalty.Rule', { id: args.id }, patch)
      else await ctx.db.insert('loyalty.Rule', { id: args.id, ...patch })
      return { ok: true, id: args.id }
    },
  }),

  'rule.archive': defineFn({
    input: { id: 'id', active: 'bool' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:loyalty.Rule', 'write:loyalty.Rule'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('loyalty.Rule', { id: args.id }))[0])
        return invalid(issue('id', 'loyalty.error.ruleMissing'))
      await ctx.db.update('loyalty.Rule', { id: args.id }, { active: args.active })
      return { ok: true, id: args.id }
    },
  }),

  'rule.setProducts': defineFn({
    input: { id: 'id', productIds: 'json' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:loyalty.Rule',
      'read:loyalty.RuleProduct',
      'write:loyalty.RuleProduct',
      'read:product.Product',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('loyalty.Rule', { id: args.id }))[0])
        return invalid(issue('id', 'loyalty.error.ruleMissing'))
      const ids = asIds(args.productIds)
      if (!ids) return invalid(issue('productIds', 'loyalty.error.invalid'))
      for (const id of ids)
        if (!(await ctx.db.select('product.Product', { id }))[0])
          return invalid(issue('productIds', 'loyalty.error.productMissing'))
      const R = ctx.table('loyalty.RuleProduct')
      await ctx.db.del(deleteFrom(R).where(eq(R.ruleId, args.id)))
      for (const id of ids)
        await ctx.db.insert('loyalty.RuleProduct', {
          id: `${String(args.id)}:${id}`,
          ruleId: args.id,
          productId: id,
        })
      return { ok: true, id: args.id }
    },
  }),

  'reward.save': defineFn({
    input: {
      id: 'id',
      programId: 'id',
      description: 'text',
      rewardType: 'text',
      discount: 'decimal?',
      discountMode: 'text?',
      discountApplicability: 'text?',
      discountMaximum: 'decimal?',
      discountProductId: 'id?',
      discountCategoryId: 'id?',
      discountTagId: 'id?',
      rewardProductId: 'id?',
      rewardProductQuantity: 'decimal?',
      requiredPoints: 'decimal',
      clearWallet: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:loyalty.Program',
      'read:loyalty.Reward',
      'write:loyalty.Reward',
      'read:loyalty.Tag',
      'read:product.Product',
      'write:product.Product',
      'read:product.Template',
      'write:product.Template',
      'read:product.Category',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('loyalty.Program', { id: args.programId }))[0])
        return invalid(issue('programId', 'loyalty.error.programMissing'))
      const values = {
        ...args,
        discountMode: args.discountMode ?? 'percent',
        discountApplicability: args.discountApplicability ?? 'order',
      }
      const errors = validateRewardEnums(values)
      if (!(n(args.requiredPoints) > 0)) errors.push(issue('requiredPoints', 'loyalty.error.pointsPositive'))
      if (args.rewardType === 'discount' && !(n(args.discount) > 0))
        errors.push(issue('discount', 'loyalty.error.discount'))
      if (
        args.rewardType === 'product' &&
        (!args.rewardProductId ||
          !(await ctx.db.select('product.Product', { id: args.rewardProductId }))[0] ||
          !(n(args.rewardProductQuantity ?? 1) > 0))
      )
        errors.push(issue('rewardProductId', 'loyalty.error.rewardProduct'))
      if (
        args.discountProductId &&
        !(await ctx.db.select('product.Product', { id: args.discountProductId }))[0]
      )
        errors.push(issue('discountProductId', 'loyalty.error.productMissing'))
      if (
        args.discountCategoryId &&
        !(await ctx.db.select('product.Category', { id: args.discountCategoryId }))[0]
      )
        errors.push(issue('discountCategoryId', 'loyalty.error.invalid'))
      if (args.discountTagId && !(await ctx.db.select('loyalty.Tag', { id: args.discountTagId }))[0])
        errors.push(issue('discountTagId', 'loyalty.error.invalid'))
      if (errors.length) return { ok: false, errors }
      let lineProductId = args.rewardProductId ? String(args.rewardProductId) : ''
      if (!lineProductId) {
        const templateId = `loyalty-reward-template:${String(args.id)}`
        lineProductId = `loyalty-reward-product:${String(args.id)}`
        if (!(await ctx.db.select('product.Template', { id: templateId }))[0])
          await ctx.db.insert('product.Template', {
            id: templateId,
            name: String(args.description).trim() || String(args.rewardType),
            type: 'service',
            categoryId: null,
            uomId: null,
            description: null,
            listPrice: '0',
            saleOk: false,
            purchaseOk: false,
            active: true,
          })
        if (!(await ctx.db.select('product.Product', { id: lineProductId }))[0])
          await ctx.db.insert('product.Product', {
            id: lineProductId,
            templateId,
            defaultCode: null,
            barcode: null,
            weight: '0',
            volume: '0',
            combinationKey: '',
            active: true,
          })
      }
      const existing = (await ctx.db.select('loyalty.Reward', { id: args.id }))[0]
      const patch = {
        programId: args.programId,
        active: existing ? Boolean(existing.active) : true,
        description: String(args.description).trim() || String(args.rewardType),
        rewardType: args.rewardType,
        discount: args.discount ?? '0',
        discountMode: values.discountMode,
        discountApplicability: values.discountApplicability,
        discountMaximum: args.discountMaximum ?? null,
        discountProductId: args.discountProductId ?? null,
        discountCategoryId: args.discountCategoryId ?? null,
        discountTagId: args.discountTagId ?? null,
        rewardProductId: args.rewardProductId ?? null,
        lineProductId,
        rewardProductQuantity: args.rewardProductQuantity ?? '1',
        requiredPoints: args.requiredPoints,
        clearWallet: Boolean(args.clearWallet),
      }
      if (existing) await ctx.db.update('loyalty.Reward', { id: args.id }, patch)
      else await ctx.db.insert('loyalty.Reward', { id: args.id, ...patch })
      return { ok: true, id: args.id }
    },
  }),

  'reward.archive': defineFn({
    input: { id: 'id', active: 'bool' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:loyalty.Reward', 'write:loyalty.Reward'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('loyalty.Reward', { id: args.id }))[0])
        return invalid(issue('id', 'loyalty.error.rewardMissing'))
      await ctx.db.update('loyalty.Reward', { id: args.id }, { active: args.active })
      return { ok: true, id: args.id }
    },
  }),

  'reward.setProducts': defineFn({
    input: { id: 'id', productIds: 'json' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:loyalty.Reward',
      'read:loyalty.RewardProduct',
      'write:loyalty.RewardProduct',
      'read:product.Product',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('loyalty.Reward', { id: args.id }))[0])
        return invalid(issue('id', 'loyalty.error.rewardMissing'))
      const ids = asIds(args.productIds)
      if (!ids) return invalid(issue('productIds', 'loyalty.error.invalid'))
      for (const id of ids)
        if (!(await ctx.db.select('product.Product', { id }))[0])
          return invalid(issue('productIds', 'loyalty.error.productMissing'))
      const R = ctx.table('loyalty.RewardProduct')
      await ctx.db.del(deleteFrom(R).where(eq(R.rewardId, args.id)))
      for (const id of ids)
        await ctx.db.insert('loyalty.RewardProduct', {
          id: `${String(args.id)}:${id}`,
          rewardId: args.id,
          productId: id,
        })
      return { ok: true, id: args.id }
    },
  }),

  'tag.save': defineFn({
    input: { id: 'id', code: 'text', name: 'text', active: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:loyalty.Tag', 'write:loyalty.Tag'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const code = String(args.code).trim().toLowerCase(),
        name = String(args.name).trim()
      if (!code || !name) return invalid(issue(!code ? 'code' : 'name', 'loyalty.error.required'))
      const existingCode = (await ctx.db.select('loyalty.Tag', { code }))[0]
      if (existingCode && existingCode.id !== args.id)
        return invalid(issue('code', 'loyalty.error.codeDuplicate'))
      const existing = (await ctx.db.select('loyalty.Tag', { id: args.id }))[0]
      const values = { code, name, active: args.active ?? true }
      if (existing) await ctx.db.update('loyalty.Tag', { id: args.id }, values)
      else await ctx.db.insert('loyalty.Tag', { id: args.id, ...values })
      return { ok: true, id: args.id }
    },
  }),

  'tag.assignProduct': defineFn({
    input: { id: 'id', productId: 'id', tagId: 'id', assigned: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:loyalty.Tag',
      'read:loyalty.ProductTag',
      'write:loyalty.ProductTag',
      'read:product.Product',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('product.Product', { id: args.productId }))[0])
        return invalid(issue('productId', 'loyalty.error.productMissing'))
      if (!(await ctx.db.select('loyalty.Tag', { id: args.tagId }))[0])
        return invalid(issue('tagId', 'loyalty.error.invalid'))
      const T = ctx.table('loyalty.ProductTag')
      if (args.assigned === false)
        await ctx.db.del(deleteFrom(T).where(eq(T.productId, args.productId), eq(T.tagId, args.tagId)))
      else
        await ctx.db.insertIfAbsent('loyalty.ProductTag', {
          id: args.id,
          productId: args.productId,
          tagId: args.tagId,
        })
      return { ok: true, id: args.id }
    },
  }),

  'tier.list': defineFn({
    input: { includeArchived: 'bool?' },
    effects: ['read:loyalty.Tier'],
    agent: true,
    handler: async (ctx, args) =>
      (await ctx.db.select('loyalty.Tier'))
        .filter((row) => args.includeArchived || row.active)
        .sort((a, b) => n(a.minimumSpend) - n(b.minimumSpend) || n(a.sequence) - n(b.sequence)),
  }),

  'tier.save': defineFn({
    input: {
      id: 'id',
      name: 'text',
      code: 'text',
      sequence: 'int?',
      minimumSpend: 'decimal',
      redeemPercent: 'decimal',
      active: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:loyalty.Tier', 'write:loyalty.Tier'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const name = String(args.name).trim(),
        code = String(args.code).trim().toLowerCase()
      if (!name || !code) return invalid(issue(!name ? 'name' : 'code', 'loyalty.error.required'))
      if (n(args.minimumSpend) < 0 || n(args.redeemPercent) < 0 || n(args.redeemPercent) > 100)
        return invalid(issue('redeemPercent', 'loyalty.error.invalid'))
      const duplicate = (await ctx.db.select('loyalty.Tier', { code }))[0]
      if (duplicate && duplicate.id !== args.id) return invalid(issue('code', 'loyalty.error.tierOverlap'))
      const existing = (await ctx.db.select('loyalty.Tier', { id: args.id }))[0]
      const values = {
        name,
        code,
        sequence: args.sequence ?? 10,
        minimumSpend: args.minimumSpend,
        redeemPercent: args.redeemPercent,
        active: args.active ?? true,
      }
      if (existing) await ctx.db.update('loyalty.Tier', { id: args.id }, values)
      else await ctx.db.insert('loyalty.Tier', { id: args.id, ...values })
      return { ok: true, id: args.id }
    },
  }),

  'membership.config.save': defineFn({
    input: {
      id: 'id',
      programId: 'id',
      windowMonths: 'int?',
      pointValue: 'decimal',
      minimumRedeemStep: 'decimal',
      fallbackCurrencyPerPoint: 'decimal',
      fallbackEnabled: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:loyalty.Program', 'read:loyalty.MembershipConfig', 'write:loyalty.MembershipConfig'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('loyalty.Program', { id: args.programId }))[0])
        return invalid(issue('programId', 'loyalty.error.programMissing'))
      if (
        !(n(args.windowMonths ?? 12) > 0) ||
        !(n(args.pointValue) > 0) ||
        !(n(args.minimumRedeemStep) > 0) ||
        (args.fallbackEnabled && !(n(args.fallbackCurrencyPerPoint) > 0))
      )
        return invalid(issue('config', 'loyalty.error.membershipConfig'))
      const duplicate = (await ctx.db.select('loyalty.MembershipConfig', { programId: args.programId }))[0]
      const existing = (await ctx.db.select('loyalty.MembershipConfig', { id: args.id }))[0]
      const target = existing ?? duplicate
      const values = {
        programId: args.programId,
        windowMonths: args.windowMonths ?? 12,
        pointValue: args.pointValue,
        minimumRedeemStep: args.minimumRedeemStep,
        fallbackCurrencyPerPoint: args.fallbackCurrencyPerPoint,
        fallbackEnabled: Boolean(args.fallbackEnabled),
        updatedAt: now(),
      }
      if (target) await ctx.db.update('loyalty.MembershipConfig', { id: target.id }, values)
      else await ctx.db.insert('loyalty.MembershipConfig', { id: args.id, ...values })
      return { ok: true, id: String(target?.id ?? args.id) }
    },
  }),

  'membership.config.get': defineFn({
    input: { programId: 'id?' },
    effects: ['read:loyalty.MembershipConfig'],
    agent: true,
    handler: async (ctx, args) =>
      args.programId
        ? ((await ctx.db.select('loyalty.MembershipConfig', { programId: args.programId }))[0] ?? null)
        : ((await ctx.db.select('loyalty.MembershipConfig'))[0] ?? null),
  }),

  'earnGroup.list': defineFn({
    input: { programId: 'id?', includeArchived: 'bool?' },
    effects: ['read:loyalty.EarnGroup'],
    agent: true,
    handler: async (ctx, args) =>
      (await ctx.db.select('loyalty.EarnGroup'))
        .filter(
          (row) =>
            (args.includeArchived || row.active) && (!args.programId || row.programId === args.programId),
        )
        .sort((a, b) => n(a.priority) - n(b.priority) || String(a.id).localeCompare(String(b.id))),
  }),

  'earnGroup.save': defineFn({
    input: {
      id: 'id',
      programId: 'id',
      name: 'text',
      code: 'text',
      priority: 'int?',
      earnsPoints: 'bool?',
      currencyPerPoint: 'decimal',
      productId: 'id?',
      categoryId: 'id?',
      tagId: 'id?',
      active: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:loyalty.Program',
      'read:loyalty.EarnGroup',
      'write:loyalty.EarnGroup',
      'read:loyalty.Tag',
      'read:product.Product',
      'read:product.Category',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('loyalty.Program', { id: args.programId }))[0])
        return invalid(issue('programId', 'loyalty.error.programMissing'))
      const code = String(args.code).trim().toLowerCase(),
        name = String(args.name).trim()
      if (!code || !name) return invalid(issue(!code ? 'code' : 'name', 'loyalty.error.required'))
      if (args.earnsPoints !== false && !(n(args.currencyPerPoint) > 0))
        return invalid(issue('currencyPerPoint', 'loyalty.error.pointsPositive'))
      if (args.productId && !(await ctx.db.select('product.Product', { id: args.productId }))[0])
        return invalid(issue('productId', 'loyalty.error.productMissing'))
      if (args.categoryId && !(await ctx.db.select('product.Category', { id: args.categoryId }))[0])
        return invalid(issue('categoryId', 'loyalty.error.invalid'))
      if (args.tagId && !(await ctx.db.select('loyalty.Tag', { id: args.tagId }))[0])
        return invalid(issue('tagId', 'loyalty.error.invalid'))
      const duplicate = (await ctx.db.select('loyalty.EarnGroup', { code }))[0]
      if (duplicate && duplicate.id !== args.id) return invalid(issue('code', 'loyalty.error.codeDuplicate'))
      const existing = (await ctx.db.select('loyalty.EarnGroup', { id: args.id }))[0]
      const values = {
        programId: args.programId,
        name,
        code,
        priority: args.priority ?? 10,
        earnsPoints: args.earnsPoints ?? true,
        currencyPerPoint: args.currencyPerPoint,
        productId: args.productId ?? null,
        categoryId: args.categoryId ?? null,
        tagId: args.tagId ?? null,
        active: args.active ?? true,
      }
      if (existing) await ctx.db.update('loyalty.EarnGroup', { id: args.id }, values)
      else await ctx.db.insert('loyalty.EarnGroup', { id: args.id, ...values })
      return { ok: true, id: args.id }
    },
  }),
}
