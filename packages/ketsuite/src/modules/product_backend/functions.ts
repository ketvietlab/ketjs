import { randomUUID } from 'node:crypto'
import { defineFn, encodeListState, eq, from, parseListState, validateListState } from '@ketvietlab/ketjs'
import type { Ctx, FilterOperator, FnSpec, ListState } from '@ketvietlab/ketjs'
import { emptyProductListState, productListSearch } from '../product/search.ts'
import { attributeSearchHref } from './attribute-search-state.ts'

type Facet = { id: string; type: string; label: string }
type CustomRule = { id: string; field: string; operator: FilterOperator; value?: unknown }
type SearchPayload = {
  query?: unknown
  returnTo?: unknown
  facets?: unknown
  groupBy?: unknown
  favoriteId?: unknown
  customFilters?: unknown
}

const LIST_PATH = '/admin/product/templates'
const LIST_KEY = 'product.templates'

const safeUrl = (value: unknown): URL => {
  const url = new URL(typeof value === 'string' ? value : LIST_PATH, 'http://ket.local')
  return url.pathname === LIST_PATH ? url : new URL(LIST_PATH, 'http://ket.local')
}

const facetsOf = (value: unknown): Facet[] =>
  Array.isArray(value)
    ? value.flatMap((facet) => {
        if (!facet || typeof facet !== 'object') return []
        const candidate = facet as Partial<Facet>
        return typeof candidate.id === 'string' &&
          typeof candidate.type === 'string' &&
          typeof candidate.label === 'string'
          ? [{ id: candidate.id, type: candidate.type, label: candidate.label }]
          : []
      })
    : []

const stringRules = (value: unknown): CustomRule[] =>
  Array.isArray(value)
    ? value.flatMap((rule) => {
        if (!rule || typeof rule !== 'object') return []
        const candidate = rule as Partial<CustomRule>
        return typeof candidate.id === 'string' &&
          typeof candidate.field === 'string' &&
          typeof candidate.operator === 'string'
          ? [
              {
                id: candidate.id,
                field: candidate.field,
                operator: candidate.operator as FilterOperator,
                value: candidate.value,
              },
            ]
          : []
      })
    : []

const ruleValue = (raw: unknown, type: string, operator: FilterOperator): unknown => {
  if (['isTrue', 'isFalse', 'isSet', 'isNotSet'].includes(operator)) return undefined
  const value = String(raw ?? '').trim()
  if (operator === 'anyOf')
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  if (operator === 'between')
    return value.split(',').map((part) => (type === 'number' ? Number(part.trim()) : part.trim()))
  return type === 'number' ? Number(value) : value
}

const stateFromPayload = (ctx: Ctx, payload: SearchPayload): ListState => {
  const T = ctx.table('product.Template')
  const spec = productListSearch(T)
  const prior = parseListState(spec, safeUrl(payload.returnTo)).state
  const facets = facetsOf(payload.facets)
  const latestQuery =
    (typeof payload.query === 'string' ? payload.query.trim() : '') ||
    [...facets].reverse().find((facet) => facet.type === 'field')?.label
  const presets = new Set((spec.presets ?? []).map((preset) => preset.key))
  const selectedPresets = facets
    .filter((facet) => facet.type === 'filter' && facet.id.startsWith('preset:'))
    .map((facet) => facet.id.slice('preset:'.length))
    .filter((key) => presets.has(key))
  const fieldByKey = new Map((spec.filterable ?? []).map((field) => [field.key, field]))
  const filters = stringRules(payload.customFilters).flatMap((rule) => {
    const field = fieldByKey.get(rule.field)
    if (!field) return []
    return [
      {
        kind: 'rule' as const,
        field: rule.field,
        operator: rule.operator,
        ...(ruleValue(rule.value, field.type, rule.operator) === undefined
          ? {}
          : { value: ruleValue(rule.value, field.type, rule.operator) }),
      },
    ]
  })
  const groupFields = new Map((spec.groupable ?? []).map((field) => [field.key, field]))
  const selectedGroups = (Array.isArray(payload.groupBy) ? payload.groupBy : []).flatMap((entry) => {
    if (typeof entry !== 'string') return []
    const [key, interval] = entry.split(':')
    const field = groupFields.get(key ?? '')
    if (!field || (interval && !field.intervals?.includes(interval as never))) return []
    return [{ key: key!, ...(interval ? { interval: interval as never } : {}) }]
  })
  const uniqueGroups = selectedGroups.filter(
    (group, index) => selectedGroups.findIndex((candidate) => candidate.key === group.key) === index,
  )
  const state: ListState = {
    ...emptyProductListState(),
    ...(latestQuery?.trim() ? { q: latestQuery.trim() } : {}),
    presets: selectedPresets,
    filters,
    groupBy: uniqueGroups,
    sort: prior.sort,
    includeArchived: facets.some((facet) => facet.type === 'filter' && facet.id === 'archived'),
    favoriteId: typeof payload.favoriteId === 'string' && payload.favoriteId ? payload.favoriteId : undefined,
  }
  validateListState(spec, state)
  return state
}

const savedState = async (ctx: Ctx, id: string): Promise<ListState | null> => {
  if (!ctx.actor) return null
  const S = ctx.table('backend.SavedSearch')
  const saved = await ctx.db.one(
    from(S).where(eq(S.id, id), eq(S.ownerId, ctx.actor), eq(S.listKey, LIST_KEY), eq(S.active, true)),
  )
  if (!saved?.state || typeof saved.state !== 'object' || Array.isArray(saved.state)) return null
  const T = ctx.table('product.Template')
  const spec = productListSearch(T)
  const fallback = emptyProductListState()
  const raw = saved.state as Partial<ListState>
  const state: ListState = {
    ...fallback,
    ...(typeof raw.q === 'string' && raw.q.trim() ? { q: raw.q.trim() } : {}),
    presets: Array.isArray(raw.presets) ? raw.presets : [],
    filters: Array.isArray(raw.filters) ? raw.filters : [],
    groupBy: Array.isArray(raw.groupBy) ? raw.groupBy : [],
    sort: Array.isArray(raw.sort) && raw.sort.length ? raw.sort : fallback.sort,
    includeArchived: raw.includeArchived === true,
    favoriteId: id,
  }
  try {
    validateListState(spec, state)
    return state
  } catch {
    return null
  }
}

const hrefFor = (ctx: Ctx, payload: SearchPayload): Promise<string> | string => {
  const target = safeUrl(payload.returnTo)
  const favoriteId = typeof payload.favoriteId === 'string' ? payload.favoriteId : ''
  if (!favoriteId) {
    const href = new URL(encodeListState(stateFromPayload(ctx, payload), target), target)
    // An explicit clear must not immediately reapply the viewer's default search.
    href.searchParams.set('favorite', '')
    return `${href.pathname}${href.search}`
  }
  return savedState(ctx, favoriteId).then((state) =>
    encodeListState(state ?? stateFromPayload(ctx, { ...payload, favoriteId: undefined }), target),
  )
}

export const functions: Record<string, FnSpec> = {
  applyAttributeSearchFilter: defineFn({
    input: {
      query: 'text?',
      returnTo: 'text?',
      facets: 'json?',
      filters: 'json?',
      groupBy: 'json?',
      favoriteId: 'text?',
      customFilters: 'json?',
    },
    output: { href: 'text' },
    effects: ['read:product.Attribute'],
    handler: (_ctx, args) => ({ href: attributeSearchHref(args) }),
  }),
  applySearchFilter: defineFn({
    input: {
      query: 'text?',
      returnTo: 'text?',
      facets: 'json?',
      filters: 'json?',
      groupBy: 'json?',
      favoriteId: 'text?',
      customFilters: 'json?',
    },
    output: { href: 'text' },
    effects: ['read:product.Template', 'read:backend.SavedSearch'],
    handler: async (ctx, args) => ({ href: await hrefFor(ctx, args) }),
  }),

  saveSearchFavorite: defineFn({
    input: { name: 'text', isDefault: 'bool?', state: 'json' },
    output: { id: 'id' },
    effects: ['read:product.Template', 'read:backend.SavedSearch', 'write:backend.SavedSearch'],
    handler: async (ctx, args) => {
      if (!ctx.actor) throw new Error('authentication required')
      const name = String(args.name).trim()
      if (!name) throw new Error('name is required')
      const state = stateFromPayload(ctx, args.state as SearchPayload)
      const id = randomUUID()
      await ctx.tx(async (tx) => {
        const S = tx.table('backend.SavedSearch')
        if (args.isDefault === true) {
          const current = await tx.db.one(
            from(S).where(
              eq(S.ownerId, ctx.actor!),
              eq(S.listKey, LIST_KEY),
              eq(S.defaultKey, `${ctx.actor}:${LIST_KEY}`),
            ),
          )
          if (current)
            await tx.db.update(
              'backend.SavedSearch',
              { id: current.id, ownerId: ctx.actor! },
              { defaultKey: null },
            )
        }
        await tx.db.insert('backend.SavedSearch', {
          id,
          ownerId: ctx.actor!,
          listKey: LIST_KEY,
          name,
          state,
          defaultKey: args.isDefault === true ? `${ctx.actor}:${LIST_KEY}` : null,
          active: true,
        })
      })
      return { id }
    },
  }),

  deleteSearchFavorite: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool' },
    effects: ['read:backend.SavedSearch', 'write:backend.SavedSearch'],
    handler: async (ctx, args) => {
      if (!ctx.actor) throw new Error('authentication required')
      await ctx.db.update(
        'backend.SavedSearch',
        { id: args.id, ownerId: ctx.actor, listKey: LIST_KEY },
        { active: false, defaultKey: null },
      )
      return { ok: true }
    },
  }),

  setDefaultSearchFavorite: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool' },
    effects: ['read:backend.SavedSearch', 'write:backend.SavedSearch'],
    handler: async (ctx, args) => {
      if (!ctx.actor) throw new Error('authentication required')
      await ctx.tx(async (tx) => {
        const S = tx.table('backend.SavedSearch')
        const target = await tx.db.one(
          from(S).where(
            eq(S.id, args.id),
            eq(S.ownerId, ctx.actor!),
            eq(S.listKey, LIST_KEY),
            eq(S.active, true),
          ),
        )
        if (!target) throw new Error('saved search not found')
        const current = await tx.db.one(
          from(S).where(
            eq(S.ownerId, ctx.actor!),
            eq(S.listKey, LIST_KEY),
            eq(S.defaultKey, `${ctx.actor}:${LIST_KEY}`),
          ),
        )
        if (current)
          await tx.db.update(
            'backend.SavedSearch',
            { id: current.id, ownerId: ctx.actor! },
            { defaultKey: null },
          )
        await tx.db.update(
          'backend.SavedSearch',
          { id: args.id, ownerId: ctx.actor!, listKey: LIST_KEY },
          { defaultKey: `${ctx.actor}:${LIST_KEY}` },
        )
      })
      return { ok: true }
    },
  }),
}
