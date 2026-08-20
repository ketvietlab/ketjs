import { KetError } from '../kernel/errors.ts'
import {
  and,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  not,
  numericCompare,
  or,
} from './expr.ts'
import type { Col, Expr } from './expr.ts'
import type { GroupInterval } from './time.ts'
import { localDateTimeToUtc, localDayRange } from './time.ts'

export type ListFieldType = 'text' | 'number' | 'boolean' | 'selection' | 'reference' | 'date' | 'datetime'
export type FilterOperator =
  | 'contains'
  | 'notContains'
  | 'equals'
  | 'notEquals'
  | 'startsWith'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'between'
  | 'anyOf'
  | 'isTrue'
  | 'isFalse'
  | 'isSet'
  | 'isNotSet'

export type FilterRule = { kind: 'rule'; field: string; operator: FilterOperator; value?: unknown }
export type FilterGroup = { kind: 'group'; op: 'and' | 'or'; children: FilterNode[] }
export type FilterNode = FilterRule | FilterGroup

export type SearchFieldSpec = { key: string; col: Col }
export type FilterFieldSpec = {
  key: string
  label: string
  col: Col
  type: ListFieldType
  operators?: readonly FilterOperator[]
  choices?: readonly string[]
}
export type GroupFieldSpec = {
  key: string
  label: string
  col: Col
  intervals?: readonly GroupInterval[]
}
export type SortFieldSpec = { key: string; label: string; col: Col }
export type PresetFilterSpec = { key: string; label: string; group: string; expr: Expr }

export type ListSearchSpec = {
  key: string
  searchable?: readonly SearchFieldSpec[]
  filterable?: readonly FilterFieldSpec[]
  groupable?: readonly GroupFieldSpec[]
  sortable?: readonly SortFieldSpec[]
  presets?: readonly PresetFilterSpec[]
  defaultSort?: readonly ListSort[]
  limits?: Partial<ListSearchLimits>
}

export type ListGroup = { key: string; interval?: GroupInterval }
export type ListSort = { key: string; dir: 'asc' | 'desc' }
export type ListState = {
  q?: string
  presets: string[]
  filters: FilterNode[]
  groupBy: ListGroup[]
  sort: ListSort[]
  openGroups: unknown[][]
  groupPages: Record<string, number>
  page: number
  includeArchived: boolean
  favoriteId?: string
}
export type ParsedListState = { state: ListState; warnings: string[] }
export type ListSearchLimits = {
  maxDepth: number
  maxRules: number
  maxGroups: number
  maxOpenGroups: number
}

const DEFAULT_LIMITS: ListSearchLimits = { maxDepth: 4, maxRules: 25, maxGroups: 3, maxOpenGroups: 10 }
const token = (value: unknown): string => Buffer.from(JSON.stringify(value)).toString('base64url')
const untoken = (value: string): unknown => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))

export const defineListSearch = <T extends ListSearchSpec>(spec: T): T => {
  if (!/^[a-z][a-z0-9_.-]*$/.test(spec.key))
    throw new KetError({ code: 'E_LIST_SPEC', message: `invalid list key "${spec.key}"` })
  for (const collection of [spec.searchable, spec.filterable, spec.groupable, spec.sortable]) {
    const keys = (collection ?? []).map((field) => field.key)
    if (new Set(keys).size !== keys.length)
      throw new KetError({ code: 'E_LIST_SPEC', message: `duplicate field key in ${spec.key}` })
  }
  return Object.freeze(spec)
}

const positiveInt = (value: string | null, fallback = 1): number => {
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback
}

export function parseListState(spec: ListSearchSpec, url: URL): ParsedListState {
  const warnings: string[] = []
  const limits = { ...DEFAULT_LIMITS, ...spec.limits }
  const presetKeys = new Set((spec.presets ?? []).map((item) => item.key))
  const groupFields = new Map((spec.groupable ?? []).map((field) => [field.key, field]))
  const sortKeys = new Set((spec.sortable ?? []).map((field) => field.key))
  const presets = url.searchParams.getAll('preset').filter((key) => {
    if (presetKeys.has(key)) return true
    warnings.push(`unknown preset: ${key}`)
    return false
  })
  const filterCandidates: FilterNode[] = []
  for (const raw of url.searchParams.getAll('filter')) {
    try {
      filterCandidates.push(untoken(raw) as FilterNode)
    } catch {
      warnings.push('invalid filter token')
    }
  }
  const groupBy: ListGroup[] = []
  for (const raw of url.searchParams.getAll('group').slice(0, limits.maxGroups)) {
    const [key, interval] = raw.split(':')
    const field = groupFields.get(key ?? '')
    if (!field || (interval && !field.intervals?.includes(interval as GroupInterval))) {
      warnings.push(`invalid group: ${raw}`)
      continue
    }
    groupBy.push({ key: key!, ...(interval ? { interval: interval as GroupInterval } : {}) })
  }
  const sort: ListSort[] = []
  for (const raw of url.searchParams.getAll('sort')) {
    const [key, dir = 'asc'] = raw.split(':')
    if (!sortKeys.has(key ?? '') || (dir !== 'asc' && dir !== 'desc')) {
      warnings.push(`invalid sort: ${raw}`)
      continue
    }
    sort.push({ key: key!, dir })
  }
  const openGroups: unknown[][] = []
  for (const raw of url.searchParams.getAll('open').slice(0, limits.maxOpenGroups)) {
    try {
      const path = untoken(raw)
      if (Array.isArray(path)) openGroups.push(path)
      else warnings.push('invalid open group')
    } catch {
      warnings.push('invalid open group token')
    }
  }
  const groupPages: Record<string, number> = {}
  for (const raw of url.searchParams.getAll('groupPage')) {
    const split = raw.lastIndexOf(':')
    if (split > 0) groupPages[raw.slice(0, split)] = positiveInt(raw.slice(split + 1))
  }
  const state: ListState = {
    ...(url.searchParams.get('q')?.trim() ? { q: url.searchParams.get('q')!.trim() } : {}),
    presets: [...new Set(presets)],
    filters: [],
    groupBy,
    sort: sort.length ? sort : [...(spec.defaultSort ?? [])],
    openGroups,
    groupPages,
    page: positiveInt(url.searchParams.get('page')),
    includeArchived: url.searchParams.get('archived') === '1',
    ...(url.searchParams.get('favorite') ? { favoriteId: url.searchParams.get('favorite')! } : {}),
  }
  for (const filter of filterCandidates) {
    try {
      validateListState(spec, { ...state, filters: [filter] })
      state.filters.push(filter)
    } catch {
      warnings.push('invalid filter')
    }
  }
  validateListState(spec, state)
  return { state, warnings }
}

export function encodeListState(state: ListState, base: URL | string): string {
  const url = new URL(typeof base === 'string' ? base : base.href, 'http://ket.local')
  for (const key of [
    'q',
    'preset',
    'filter',
    'group',
    'sort',
    'open',
    'groupPage',
    'page',
    'archived',
    'favorite',
  ])
    url.searchParams.delete(key)
  if (state.q) url.searchParams.set('q', state.q)
  for (const preset of state.presets) url.searchParams.append('preset', preset)
  for (const filter of state.filters) url.searchParams.append('filter', token(filter))
  for (const group of state.groupBy)
    url.searchParams.append('group', `${group.key}${group.interval ? `:${group.interval}` : ''}`)
  for (const sort of state.sort) url.searchParams.append('sort', `${sort.key}:${sort.dir}`)
  for (const path of state.openGroups) url.searchParams.append('open', token(path))
  for (const [path, page] of Object.entries(state.groupPages))
    url.searchParams.append('groupPage', `${path}:${page}`)
  if (state.page > 1) url.searchParams.set('page', String(state.page))
  if (state.includeArchived) url.searchParams.set('archived', '1')
  if (state.favoriteId) url.searchParams.set('favorite', state.favoriteId)
  return `${url.pathname}${url.search}`
}

const defaultOperators: Record<ListFieldType, readonly FilterOperator[]> = {
  text: ['contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'isSet', 'isNotSet'],
  number: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between', 'isSet', 'isNotSet'],
  boolean: ['isTrue', 'isFalse'],
  selection: ['equals', 'notEquals', 'anyOf', 'isSet', 'isNotSet'],
  reference: ['equals', 'notEquals', 'anyOf', 'isSet', 'isNotSet'],
  date: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between', 'isSet', 'isNotSet'],
  datetime: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between', 'isSet', 'isNotSet'],
}

const countTree = (node: FilterNode, depth = 1): { depth: number; rules: number } => {
  if (node.kind === 'rule') return { depth, rules: 1 }
  return node.children.reduce(
    (total, child) => {
      const next = countTree(child, depth + 1)
      return { depth: Math.max(total.depth, next.depth), rules: total.rules + next.rules }
    },
    { depth, rules: 0 },
  )
}

export function validateListState(spec: ListSearchSpec, state: ListState): void {
  const limits = { ...DEFAULT_LIMITS, ...spec.limits }
  const fields = new Map((spec.filterable ?? []).map((field) => [field.key, field]))
  let totalRules = 0
  for (const node of state.filters) {
    const size = countTree(node)
    totalRules += size.rules
    if (size.depth > limits.maxDepth)
      throw new KetError({ code: 'E_LIST_FILTER', message: `filter exceeds depth ${limits.maxDepth}` })
    const visit = (part: FilterNode): void => {
      if (part.kind === 'group') {
        for (const child of part.children) visit(child)
        return
      }
      const field = fields.get(part.field)
      if (!field || !(field.operators ?? defaultOperators[field.type]).includes(part.operator))
        throw new KetError({
          code: 'E_LIST_FILTER',
          message: `invalid filter ${part.field}.${part.operator}`,
        })
      if (field.choices && part.value != null) {
        const values = Array.isArray(part.value) ? part.value : [part.value]
        if (values.some((value) => !field.choices!.includes(String(value))))
          throw new KetError({ code: 'E_LIST_FILTER', message: `invalid value for ${part.field}` })
      }
    }
    visit(node)
  }
  if (totalRules > limits.maxRules)
    throw new KetError({ code: 'E_LIST_FILTER', message: `filter exceeds ${limits.maxRules} rules` })
  if (state.groupBy.length > limits.maxGroups || state.openGroups.length > limits.maxOpenGroups)
    throw new KetError({ code: 'E_LIST_FILTER', message: 'group state exceeds its limit' })
}

const wildcard = (value: unknown): string => String(value ?? '').replace(/[\\%_]/g, '\\$&')
const ruleExpr = (field: FilterFieldSpec, rule: FilterRule, timezone: string): Expr => {
  const value = rule.value
  if (rule.operator === 'contains') return ilike(field.col, `%${wildcard(value)}%`, true)
  if (rule.operator === 'notContains') return not(ilike(field.col, `%${wildcard(value)}%`, true))
  if (rule.operator === 'startsWith') return ilike(field.col, `${wildcard(value)}%`, true)
  if (field.type === 'number' && ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte'].includes(rule.operator)) {
    const comparison = { equals: '=', notEquals: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' } as const
    return numericCompare(field.col, comparison[rule.operator as keyof typeof comparison], value)
  }
  if (field.type === 'datetime' && rule.operator === 'equals' && typeof value === 'string') {
    const [start, end] = /^\d{4}-\d{2}-\d{2}$/.test(value)
      ? localDayRange(value, timezone)
      : [localDateTimeToUtc(value, timezone), localDateTimeToUtc(value, timezone)]
    return end === start ? eq(field.col, start) : and(gte(field.col, start), lt(field.col, end))
  }
  if (rule.operator === 'equals') return eq(field.col, value)
  if (rule.operator === 'notEquals') return ne(field.col, value)
  if (rule.operator === 'gt') return gt(field.col, value)
  if (rule.operator === 'gte') return gte(field.col, value)
  if (rule.operator === 'lt') return lt(field.col, value)
  if (rule.operator === 'lte') return lte(field.col, value)
  if (rule.operator === 'anyOf') return inArray(field.col, Array.isArray(value) ? value : [value])
  if (rule.operator === 'isTrue') return eq(field.col, true)
  if (rule.operator === 'isFalse') return eq(field.col, false)
  if (rule.operator === 'isSet') return isNotNull(field.col)
  if (rule.operator === 'isNotSet') return isNull(field.col)
  if (rule.operator === 'between' && Array.isArray(value) && value.length === 2) {
    if (field.type === 'datetime' && value.every((part) => typeof part === 'string'))
      return and(
        gte(field.col, localDateTimeToUtc(String(value[0]), timezone)),
        lt(field.col, localDateTimeToUtc(String(value[1]), timezone)),
      )
    return field.type === 'number'
      ? and(numericCompare(field.col, '>=', value[0]), numericCompare(field.col, '<', value[1]))
      : and(gte(field.col, value[0]), lt(field.col, value[1]))
  }
  throw new KetError({ code: 'E_LIST_FILTER', message: `invalid value for ${field.key}.${rule.operator}` })
}

export function compileListFilter(
  spec: ListSearchSpec,
  state: ListState,
  options: { timezone?: string } = {},
): Expr | null {
  validateListState(spec, state)
  const fields = new Map((spec.filterable ?? []).map((field) => [field.key, field]))
  const compileNode = (node: FilterNode): Expr =>
    node.kind === 'rule'
      ? ruleExpr(fields.get(node.field)!, node, options.timezone ?? 'UTC')
      : node.op === 'and'
        ? and(...node.children.map(compileNode))
        : or(...node.children.map(compileNode))
  const parts: Expr[] = []
  if (state.q && spec.searchable?.length)
    parts.push(or(...spec.searchable.map((field) => ilike(field.col, `%${wildcard(state.q)}%`, true))))
  const presets = new Map((spec.presets ?? []).map((preset) => [preset.key, preset]))
  const grouped = new Map<string, Expr[]>()
  for (const key of state.presets) {
    const preset = presets.get(key)
    if (!preset) continue
    const list = grouped.get(preset.group) ?? []
    list.push(preset.expr)
    grouped.set(preset.group, list)
  }
  for (const expressions of grouped.values()) parts.push(or(...expressions))
  parts.push(...state.filters.map(compileNode))
  return parts.length ? and(...parts) : null
}
