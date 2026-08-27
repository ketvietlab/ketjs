import type { Ctx, Row } from '@ketvietlab/ketjs'
import type { EligibilityResult, OrderLineSnapshot, OrderSnapshot, RewardQuote } from './types.ts'
import {
  DISCOUNT_APPLICABILITY,
  DISCOUNT_MODES,
  LOYALTY_CHANNELS,
  POINT_MODES,
  PROGRAM_TYPES,
  REWARD_TYPES,
  TAX_MODES,
} from './types.ts'

export type Issue = { field: string; code: string; params?: Record<string, unknown> }
export const issue = (field: string, code: string, params?: Record<string, unknown>): Issue => ({
  field,
  code,
  ...(params ? { params } : {}),
})
export const invalid = (...errors: Issue[]) => ({ ok: false, errors })
export const n = (value: unknown): number => Number(value ?? 0)
export const round = (value: number, digits = 2): number => {
  const factor = 10 ** digits
  return Math.floor((value + Number.EPSILON) * factor) / factor
}
export const decimal = (value: number): string => String(round(value, 6))
export const normalizeCode = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLocaleUpperCase('en-US')
export const now = (): string => new Date().toISOString()

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null

export const snapshotOf = (value: unknown): OrderSnapshot | null => {
  const held = record(value)
  if (!held || !LOYALTY_CHANNELS.includes(String(held.orderType) as never)) return null
  if (!String(held.orderId ?? '').trim() || !String(held.currency ?? '').trim()) return null
  if (!held.date || Number.isNaN(new Date(String(held.date)).getTime()) || !Array.isArray(held.lines))
    return null
  const lines: OrderLineSnapshot[] = []
  for (const raw of held.lines) {
    const line = record(raw)
    if (!line || !String(line.id ?? '') || !String(line.productId ?? '')) return null
    const quantity = n(line.quantity),
      untaxed = n(line.untaxed),
      total = n(line.total),
      lineKind = String(line.lineKind ?? 'product')
    if (![quantity, untaxed, total].every(Number.isFinite)) return null
    if (!['product', 'shipping', 'reward'].includes(lineKind)) return null
    lines.push({
      id: String(line.id),
      productId: String(line.productId),
      quantity,
      untaxed,
      total,
      lineKind: lineKind as OrderLineSnapshot['lineKind'],
    })
  }
  return {
    orderType: String(held.orderType) as OrderSnapshot['orderType'],
    orderId: String(held.orderId),
    partnerId: held.partnerId ? String(held.partnerId) : null,
    currency: String(held.currency),
    pricelistId: held.pricelistId ? String(held.pricelistId) : null,
    date: String(held.date),
    lines,
    codes: Array.isArray(held.codes) ? held.codes.map(normalizeCode).filter(Boolean) : [],
  }
}

type ProductContext = { product: Row; template: Row; categoryIds: Set<string>; tagIds: Set<string> }

const productContext = async (
  ctx: Ctx,
  productId: string,
  cache: Map<string, ProductContext | null>,
): Promise<ProductContext | null> => {
  if (cache.has(productId)) return cache.get(productId) ?? null
  const product = (await ctx.db.select('product.Product', { id: productId }))[0]
  const template = product && (await ctx.db.select('product.Template', { id: product.templateId }))[0]
  if (!product || !template) {
    cache.set(productId, null)
    return null
  }
  const categoryIds = new Set<string>()
  let categoryId = template.categoryId ? String(template.categoryId) : ''
  while (categoryId && !categoryIds.has(categoryId)) {
    categoryIds.add(categoryId)
    const category = (await ctx.db.select('product.Category', { id: categoryId }))[0]
    categoryId = category?.parentId ? String(category.parentId) : ''
  }
  const tagIds = new Set(
    (await ctx.db.select('loyalty.ProductTag', { productId })).map((link) => String(link.tagId)),
  )
  const result = { product, template, categoryIds, tagIds }
  cache.set(productId, result)
  return result
}

const ruleMatches = async (
  ctx: Ctx,
  rule: Row,
  line: OrderLineSnapshot,
  cache: Map<string, ProductContext | null>,
  linkedProductIds: ReadonlySet<string>,
): Promise<boolean> => {
  const hasFilter = Boolean(rule.productId || rule.categoryId || rule.tagId || linkedProductIds.size)
  if (!hasFilter) return true
  if (rule.productId === line.productId || linkedProductIds.has(line.productId)) return true
  if (!rule.categoryId && !rule.tagId) return false
  const product = await productContext(ctx, line.productId, cache)
  if (!product) return false
  if (rule.categoryId && product.categoryIds.has(String(rule.categoryId))) return true
  return Boolean(rule.tagId && product.tagIds.has(String(rule.tagId)))
}

const earnGroupMatches = async (
  ctx: Ctx,
  group: Row,
  line: OrderLineSnapshot,
  cache: Map<string, ProductContext | null>,
): Promise<boolean> => {
  const hasFilter = Boolean(group.productId || group.categoryId || group.tagId)
  if (!hasFilter) return true
  if (group.productId === line.productId) return true
  if (!group.categoryId && !group.tagId) return false
  const product = await productContext(ctx, line.productId, cache)
  if (!product) return false
  if (group.categoryId && product.categoryIds.has(String(group.categoryId))) return true
  return Boolean(group.tagId && product.tagIds.has(String(group.tagId)))
}

const rewardMatches = async (
  ctx: Ctx,
  reward: Row,
  line: OrderLineSnapshot,
  cache: Map<string, ProductContext | null>,
  linkedProductIds: ReadonlySet<string>,
): Promise<boolean> => {
  const hasFilter = Boolean(
    reward.discountProductId || reward.discountCategoryId || reward.discountTagId || linkedProductIds.size,
  )
  if (!hasFilter) return true
  if (reward.discountProductId === line.productId || linkedProductIds.has(line.productId)) return true
  if (!reward.discountCategoryId && !reward.discountTagId) return false
  const product = await productContext(ctx, line.productId, cache)
  if (!product) return false
  if (reward.discountCategoryId && product.categoryIds.has(String(reward.discountCategoryId))) return true
  return Boolean(reward.discountTagId && product.tagIds.has(String(reward.discountTagId)))
}

const activeAt = (program: Row, date: string): boolean => {
  const current = new Date(date).getTime()
  return !(
    (program.dateFrom && current < new Date(String(program.dateFrom)).getTime()) ||
    (program.dateTo && current > new Date(String(program.dateTo)).getTime())
  )
}

const rewardQuote = async (
  ctx: Ctx,
  program: Row,
  reward: Row,
  snapshot: OrderSnapshot,
  availablePoints: number,
  cache: Map<string, ProductContext | null>,
  linkedProductIds: ReadonlySet<string>,
  requestedPoints?: number,
): Promise<RewardQuote | null> => {
  const required = n(reward.requiredPoints)
  const spend = reward.clearWallet ? availablePoints : (requestedPoints ?? required)
  if (!(required > 0) || spend + 0.000001 < required || availablePoints + 0.000001 < spend) return null
  const rewardType = String(reward.rewardType)
  if (!REWARD_TYPES.includes(rewardType as never)) return null
  if (rewardType === 'product') {
    if (!reward.rewardProductId || !(n(reward.rewardProductQuantity) > 0)) return null
    return {
      rewardId: String(reward.id),
      programId: String(program.id),
      description: String(reward.description),
      rewardType: 'product',
      requiredPoints: round(spend, 6),
      discountAmount: 0,
      productId: String(reward.rewardProductId),
      productQuantity: n(reward.rewardProductQuantity),
      lineKind: 'reward',
    }
  }
  const candidates = snapshot.lines.filter((line) => line.lineKind !== 'reward')
  let base = 0
  if (rewardType === 'shipping')
    base = candidates.filter((line) => line.lineKind === 'shipping').reduce((s, l) => s + l.total, 0)
  else {
    const products = candidates.filter((line) => line.lineKind === 'product')
    const applicability = String(reward.discountApplicability)
    if (applicability === 'cheapest') {
      const eligibleTotals = products.map((line) => line.total).filter((value) => value > 0)
      base = eligibleTotals.length ? Math.min(...eligibleTotals) : 0
    } else if (applicability === 'specific') {
      for (const line of products)
        if (await rewardMatches(ctx, reward, line, cache, linkedProductIds)) base += line.total
    } else base = products.reduce((sum, line) => sum + line.total, 0)
  }
  if (!(base > 0)) return null
  let discountAmount = base
  if (rewardType === 'discount') {
    const mode = String(reward.discountMode)
    if (mode === 'percent') discountAmount = base * (n(reward.discount) / 100)
    else if (mode === 'per_point') discountAmount = n(reward.discount) * spend
    else discountAmount = n(reward.discount)
    if (reward.discountMaximum) discountAmount = Math.min(discountAmount, n(reward.discountMaximum))
    discountAmount = Math.min(base, discountAmount)
  }
  return {
    rewardId: String(reward.id),
    programId: String(program.id),
    description: String(reward.description),
    rewardType: rewardType as RewardQuote['rewardType'],
    requiredPoints: round(spend, 6),
    discountAmount: round(discountAmount),
    lineKind: 'reward',
  }
}

const walletForProgram = (program: Row, snapshot: OrderSnapshot, wallets: readonly Row[]): Row | null => {
  const codes = new Set(snapshot.codes ?? [])
  if (codes.size) {
    const byCode = wallets.find(
      (wallet) => wallet.programId === program.id && codes.has(String(wallet.normalizedCode)),
    )
    if (byCode) return byCode
  }
  if (!snapshot.partnerId) return null
  return (
    wallets.find(
      (wallet) => wallet.programId === program.id && wallet.partnerId === snapshot.partnerId && wallet.active,
    ) ?? null
  )
}

export type EvaluatedProgram = EligibilityResult & {
  walletId?: string | null
  availablePoints: number
  pointName: string
}

export const evaluate = async (
  ctx: Ctx,
  snapshot: OrderSnapshot,
  options: { onlyProgramId?: string; requestedPoints?: number } = {},
): Promise<EvaluatedProgram[]> => {
  const cache = new Map<string, ProductContext | null>()
  const allPrograms = await ctx.db.select('loyalty.Program', { active: true })
  const programs = allPrograms
    .filter((program) => !options.onlyProgramId || program.id === options.onlyProgramId)
    .sort((a, b) => n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id)))
  const programIds = new Set(programs.map((program) => String(program.id)))
  const programWhere = options.onlyProgramId ? { programId: options.onlyProgramId } : {}
  const [allPricelists, allRules, allRuleProducts, allRewards, allRewardProducts, allConfigs, allGroups] =
    await Promise.all([
      ctx.db.select('loyalty.ProgramPricelist', programWhere),
      ctx.db.select('loyalty.Rule', { ...programWhere, active: true }),
      ctx.db.select('loyalty.RuleProduct'),
      ctx.db.select('loyalty.Reward', { ...programWhere, active: true }),
      ctx.db.select('loyalty.RewardProduct'),
      ctx.db.select('loyalty.MembershipConfig', programWhere),
      ctx.db.select('loyalty.EarnGroup', { ...programWhere, active: true }),
    ])
  const walletRows = snapshot.partnerId
    ? await ctx.db.select('loyalty.Wallet', { partnerId: snapshot.partnerId })
    : []
  const orderReservations = await ctx.db.select('loyalty.Reservation', {
    orderType: snapshot.orderType,
    orderId: snapshot.orderId,
    state: 'reserved',
  })
  for (const code of new Set(snapshot.codes ?? []))
    for (const wallet of await ctx.db.select('loyalty.Wallet', { normalizedCode: code }))
      if (!walletRows.some((held) => held.id === wallet.id)) walletRows.push(wallet)
  const usage = new Map<string, number>()
  if (programs.some((program) => program.limitUsage && n(program.maxUsage) > 0))
    for (const application of await ctx.db.select('loyalty.Application', { state: 'finalized' })) {
      const programId = String(application.programId)
      if (programIds.has(programId)) usage.set(programId, (usage.get(programId) ?? 0) + 1)
    }
  const byProgram = (rows: readonly Row[]) => {
    const output = new Map<string, Row[]>()
    for (const row of rows) {
      const programId = String(row.programId)
      if (programIds.has(programId))
        (output.get(programId) ?? output.set(programId, []).get(programId)!).push(row)
    }
    return output
  }
  const pricelistsByProgram = byProgram(allPricelists)
  const rulesByProgram = byProgram(allRules)
  const rewardsByProgram = byProgram(allRewards)
  const groupsByProgram = byProgram(allGroups)
  for (const rows of rulesByProgram.values())
    rows.sort((a, b) => n(a.priority) - n(b.priority) || String(a.id).localeCompare(String(b.id)))
  for (const rows of groupsByProgram.values())
    rows.sort((a, b) => n(a.priority) - n(b.priority) || String(a.id).localeCompare(String(b.id)))
  const configByProgram = new Map(allConfigs.map((config) => [String(config.programId), config]))
  const ruleProducts = new Map<string, Set<string>>()
  for (const link of allRuleProducts)
    (
      ruleProducts.get(String(link.ruleId)) ??
      ruleProducts.set(String(link.ruleId), new Set()).get(String(link.ruleId))!
    ).add(String(link.productId))
  const rewardProducts = new Map<string, Set<string>>()
  for (const link of allRewardProducts)
    (
      rewardProducts.get(String(link.rewardId)) ??
      rewardProducts.set(String(link.rewardId), new Set()).get(String(link.rewardId))!
    ).add(String(link.productId))
  const output: EvaluatedProgram[] = []
  for (const program of programs) {
    if (!PROGRAM_TYPES.includes(String(program.programType) as never)) continue
    if (program.currency !== snapshot.currency || !activeAt(program, snapshot.date)) continue
    if (snapshot.orderType === 'sale' && !program.availableSale) continue
    if (snapshot.orderType === 'pos' && !program.availablePos) continue
    const mappedPricelists = pricelistsByProgram.get(String(program.id)) ?? []
    if (
      mappedPricelists.length &&
      (!snapshot.pricelistId || !mappedPricelists.some((row) => row.pricelistId === snapshot.pricelistId))
    )
      continue
    if (program.limitUsage && n(program.maxUsage) > 0) {
      const used = usage.get(String(program.id)) ?? 0
      if (used >= n(program.maxUsage)) continue
    }
    const wallet = walletForProgram(program, snapshot, walletRows)
    if (
      wallet &&
      (!wallet.active ||
        (wallet.expiresAt &&
          new Date(String(wallet.expiresAt)).getTime() < new Date(snapshot.date).getTime()))
    )
      continue
    const rules = rulesByProgram.get(String(program.id)) ?? []
    let earned = 0
    const splitPoints: number[] = []
    let codeMatched = program.trigger !== 'with_code'
    for (const rule of rules) {
      if (
        !POINT_MODES.includes(String(rule.pointMode) as never) ||
        !TAX_MODES.includes(String(rule.taxMode) as never)
      )
        continue
      if (rule.mode === 'with_code') {
        if (!(snapshot.codes ?? []).includes(String(rule.normalizedCode))) continue
        codeMatched = true
      }
      const matched: OrderLineSnapshot[] = []
      for (const line of snapshot.lines.filter((candidate) => candidate.lineKind === 'product'))
        if (await ruleMatches(ctx, rule, line, cache, ruleProducts.get(String(rule.id)) ?? new Set()))
          matched.push(line)
      const quantity = matched.reduce((sum, line) => sum + line.quantity, 0)
      const amount = matched.reduce(
        (sum, line) => sum + (rule.taxMode === 'incl' ? line.total : line.untaxed),
        0,
      )
      if (quantity + 0.000001 < n(rule.minimumQuantity) || amount + 0.000001 < n(rule.minimumAmount)) continue
      const pointAmount = n(rule.pointAmount)
      if (!(pointAmount > 0)) continue
      if (program.appliesOn === 'future' && rule.pointSplit && rule.pointMode !== 'order') {
        if (rule.pointMode === 'unit') {
          for (let index = 0; index < Math.floor(quantity); index += 1)
            splitPoints.push(round(pointAmount, 2))
        } else {
          for (const line of matched) {
            if (!(line.quantity > 0)) continue
            const perUnit = round((pointAmount * line.total) / line.quantity, 2)
            for (let index = 0; index < Math.floor(line.quantity); index += 1)
              if (perUnit) splitPoints.push(perUnit)
          }
        }
      } else if (rule.pointMode === 'order') earned += pointAmount
      else if (rule.pointMode === 'money') earned += round(pointAmount * amount, 2)
      else earned += pointAmount * quantity
    }
    const membershipConfig = configByProgram.get(String(program.id))
    const earnGroups = membershipConfig ? (groupsByProgram.get(String(program.id)) ?? []) : []
    if (membershipConfig && earnGroups.length) {
      earned = 0
      splitPoints.length = 0
      for (const line of snapshot.lines.filter((candidate) => candidate.lineKind === 'product')) {
        let matched: Row | null = null
        for (const group of earnGroups)
          if (await earnGroupMatches(ctx, group, line, cache)) {
            matched = group
            break
          }
        if (matched) {
          if (matched.earnsPoints && n(matched.currencyPerPoint) > 0)
            earned += round(line.total / n(matched.currencyPerPoint), 2)
        } else if (membershipConfig.fallbackEnabled && n(membershipConfig.fallbackCurrencyPerPoint) > 0)
          earned += round(line.total / n(membershipConfig.fallbackCurrencyPerPoint), 2)
      }
    }
    if (!codeMatched && !wallet) continue
    const ownReservation = wallet
      ? orderReservations
          .filter((reservation) => reservation.walletId === wallet.id)
          .reduce((sum, reservation) => sum + n(reservation.amount), 0)
      : 0
    const available =
      n(wallet?.balance) -
      n(wallet?.reserved) +
      ownReservation +
      (program.appliesOn === 'future' ? 0 : earned)
    const rewards: RewardQuote[] = []
    for (const reward of rewardsByProgram.get(String(program.id)) ?? []) {
      const quote = await rewardQuote(
        ctx,
        program,
        reward,
        snapshot,
        available,
        cache,
        rewardProducts.get(String(reward.id)) ?? new Set(),
        options.requestedPoints,
      )
      if (quote) rewards.push(quote)
    }
    if (!earned && !splitPoints.length && !rewards.length && !wallet) continue
    output.push({
      programId: String(program.id),
      programName: String(program.name),
      programType: String(program.programType) as EvaluatedProgram['programType'],
      points: round(earned, 2),
      splitPoints,
      rewards,
      walletId: wallet ? String(wallet.id) : null,
      availablePoints: round(available, 6),
      pointName: String(program.pointName),
    })
  }
  return output
}

export const validateProgramEnums = (args: Record<string, unknown>): Issue[] => {
  const errors: Issue[] = []
  if (!PROGRAM_TYPES.includes(String(args.programType) as never))
    errors.push(issue('programType', 'loyalty.error.programType'))
  if (!['current', 'future', 'both'].includes(String(args.appliesOn)))
    errors.push(issue('appliesOn', 'loyalty.error.appliesOn'))
  if (!['auto', 'with_code'].includes(String(args.trigger)))
    errors.push(issue('trigger', 'loyalty.error.trigger'))
  return errors
}

export const validateRuleEnums = (args: Record<string, unknown>): Issue[] => {
  const errors: Issue[] = []
  if (!POINT_MODES.includes(String(args.pointMode) as never))
    errors.push(issue('pointMode', 'loyalty.error.invalid'))
  if (!TAX_MODES.includes(String(args.taxMode) as never))
    errors.push(issue('taxMode', 'loyalty.error.invalid'))
  if (!['auto', 'with_code'].includes(String(args.mode))) errors.push(issue('mode', 'loyalty.error.invalid'))
  return errors
}

export const validateRewardEnums = (args: Record<string, unknown>): Issue[] => {
  const errors: Issue[] = []
  if (!REWARD_TYPES.includes(String(args.rewardType) as never))
    errors.push(issue('rewardType', 'loyalty.error.invalid'))
  if (!DISCOUNT_MODES.includes(String(args.discountMode) as never))
    errors.push(issue('discountMode', 'loyalty.error.invalid'))
  if (!DISCOUNT_APPLICABILITY.includes(String(args.discountApplicability) as never))
    errors.push(issue('discountApplicability', 'loyalty.error.invalid'))
  return errors
}
