// The server half of the search-filter bar.
//
// The bar talks to four functions: one that turns the viewer's facets into a
// href, and three that manage saved searches. None of that reads a domain — it
// is `ListSearchShape` in, `ListState` out — yet `product_backend` carried 290
// lines of it for one list. A second list would have copied them, and a third
// would have copied the copy, so the logic lives here and a module declares
// only which lists it owns.
//
// The functions stay in the owning module rather than in `backend`: a filter on
// the product catalogue is product's `view` permission, not an internal
// backend one, and `backend` is a headless module with no bundles to grant.
import { randomUUID } from 'node:crypto'
import { defineFn, encodeListState, eq, from, parseListState, validateListState } from '@ketvietlab/ketjs'
import type { Ctx, FilterOperator, FnSpec, ListSearchShape, ListState } from '@ketvietlab/ketjs'

/** One list the search-filter bar can drive: its key, its page, and its spec. */
export type ListSearchBinding = {
  /** The spec key, which is also the saved-search `listKey`. */
  key: string
  /** The list's own path. A payload may only ever return the viewer here. */
  path: string
  /** Built per request, because a spec's columns come from the live manifest. */
  spec: (ctx: Ctx) => ListSearchShape
}

type Facet = { id: string; type: string; label: string }
type CustomRule = { id: string; field: string; operator: FilterOperator; value?: unknown }
export type SearchPayload = {
  listKey?: unknown
  query?: unknown
  returnTo?: unknown
  facets?: unknown
  groupBy?: unknown
  favoriteId?: unknown
  customFilters?: unknown
}

/** The state a list starts from: nothing selected, sorted the way the spec says. */
export const emptyListState = (spec: ListSearchShape): ListState => ({
  presets: [],
  filters: [],
  groupBy: [],
  sort: [...(spec.defaultSort ?? [])],
  openGroups: [],
  groupPages: {},
  page: 1,
  includeArchived: false,
})

const bindingOf = (bindings: readonly ListSearchBinding[], listKey: unknown): ListSearchBinding => {
  const key = typeof listKey === 'string' ? listKey : ''
  const binding = bindings.find((candidate) => candidate.key === key) ?? (key ? undefined : bindings[0])
  if (!binding) throw new Error(`unknown list "${key}"`)
  return binding
}

/** A payload names where to go back to, so it may only name this list's page. */
const safeUrl = (binding: ListSearchBinding, value: unknown): URL => {
  const url = new URL(typeof value === 'string' ? value : binding.path, 'http://ket.local')
  return url.pathname === binding.path ? url : new URL(binding.path, 'http://ket.local')
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

/** The viewer's facets, read back as the list state they stand for. */
export const stateFromPayload = (ctx: Ctx, binding: ListSearchBinding, payload: SearchPayload): ListState => {
  const spec = binding.spec(ctx)
  const prior = parseListState(spec, safeUrl(binding, payload.returnTo)).state
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
    const value = ruleValue(rule.value, field.type, rule.operator)
    return [
      {
        kind: 'rule' as const,
        field: rule.field,
        operator: rule.operator,
        ...(value === undefined ? {} : { value }),
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
    ...emptyListState(spec),
    ...(latestQuery?.trim() ? { q: latestQuery.trim() } : {}),
    presets: selectedPresets,
    filters,
    groupBy: uniqueGroups,
    sort: prior.sort.length ? prior.sort : [...(spec.defaultSort ?? [])],
    includeArchived: facets.some((facet) => facet.type === 'filter' && facet.id === 'archived'),
    favoriteId: typeof payload.favoriteId === 'string' && payload.favoriteId ? payload.favoriteId : undefined,
  }
  validateListState(spec, state)
  return state
}

const savedState = async (ctx: Ctx, binding: ListSearchBinding, id: string): Promise<ListState | null> => {
  if (!ctx.actor) return null
  const S = ctx.table('backend.SavedSearch')
  const saved = await ctx.db.one(
    from(S).where(eq(S.id, id), eq(S.ownerId, ctx.actor), eq(S.listKey, binding.key), eq(S.active, true)),
  )
  if (!saved?.state || typeof saved.state !== 'object' || Array.isArray(saved.state)) return null
  const spec = binding.spec(ctx)
  const fallback = emptyListState(spec)
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

/** Where the viewer's current facets lead. */
export const searchFilterHref = (
  ctx: Ctx,
  binding: ListSearchBinding,
  payload: SearchPayload,
): Promise<string> | string => {
  const target = safeUrl(binding, payload.returnTo)
  const favoriteId = typeof payload.favoriteId === 'string' ? payload.favoriteId : ''
  if (!favoriteId) {
    const href = new URL(encodeListState(stateFromPayload(ctx, binding, payload), target), target)
    // An explicit clear must not immediately reapply the viewer's default search.
    href.searchParams.set('favorite', '')
    return `${href.pathname}${href.search}`
  }
  return savedState(ctx, binding, favoriteId).then((state) =>
    encodeListState(state ?? stateFromPayload(ctx, binding, { ...payload, favoriteId: undefined }), target),
  )
}

/**
 * The four functions the bar calls, for every list a module owns.
 *
 * The bar sends `listKey` from its manager's `applyInput`, which arrives at the
 * top level for apply, delete and set-default, and nested inside `state` when a
 * favourite is saved — so a module needs one set of these, not one per list.
 */
export const listSearchFilterFunctions = (
  bindings: readonly ListSearchBinding[],
  reads: readonly string[] = [],
): Record<string, FnSpec> => {
  const read = [...new Set(reads.map((model) => `read:${model}` as const))]
  const payloadInput = {
    listKey: 'text?',
    query: 'text?',
    returnTo: 'text?',
    facets: 'json?',
    filters: 'json?',
    groupBy: 'json?',
    favoriteId: 'text?',
    customFilters: 'json?',
  } as const
  const defaultKeyOf = (actor: string, listKey: string): string => `${actor}:${listKey}`
  /** At most one saved search per viewer and list may be the default one. */
  const clearCurrentDefault = async (
    tx: Pick<Ctx, 'table' | 'db'>,
    actor: string,
    listKey: string,
    keep?: string,
  ): Promise<void> => {
    const S = tx.table('backend.SavedSearch')
    const current = await tx.db.one(
      from(S).where(
        eq(S.ownerId, actor),
        eq(S.listKey, listKey),
        eq(S.defaultKey, defaultKeyOf(actor, listKey)),
      ),
    )
    if (current && current.id !== keep)
      await tx.db.update('backend.SavedSearch', { id: current.id, ownerId: actor }, { defaultKey: null })
  }
  return {
    applySearchFilter: defineFn({
      input: payloadInput,
      output: { href: 'text' },
      effects: [...read, 'read:backend.SavedSearch'],
      handler: async (ctx, args) => {
        const payload = args as SearchPayload
        return { href: await searchFilterHref(ctx, bindingOf(bindings, payload.listKey), payload) }
      },
    }),

    saveSearchFavorite: defineFn({
      input: { name: 'text', isDefault: 'bool?', state: 'json' },
      output: { id: 'id' },
      effects: [...read, 'read:backend.SavedSearch', 'write:backend.SavedSearch'],
      handler: async (ctx, args) => {
        if (!ctx.actor) throw new Error('authentication required')
        const name = String(args.name).trim()
        if (!name) throw new Error('name is required')
        const payload = (args.state ?? {}) as SearchPayload
        const binding = bindingOf(bindings, payload.listKey)
        const state = stateFromPayload(ctx, binding, payload)
        const id = randomUUID()
        await ctx.tx(async (tx) => {
          if (args.isDefault === true) await clearCurrentDefault(tx, ctx.actor!, binding.key)
          await tx.db.insert('backend.SavedSearch', {
            id,
            ownerId: ctx.actor!,
            listKey: binding.key,
            name,
            state,
            defaultKey: args.isDefault === true ? defaultKeyOf(ctx.actor!, binding.key) : null,
            active: true,
          })
        })
        return { id }
      },
    }),

    deleteSearchFavorite: defineFn({
      input: { id: 'id', listKey: 'text?' },
      output: { ok: 'bool' },
      effects: ['read:backend.SavedSearch', 'write:backend.SavedSearch'],
      handler: async (ctx, args) => {
        if (!ctx.actor) throw new Error('authentication required')
        const binding = bindingOf(bindings, args.listKey)
        await ctx.db.update(
          'backend.SavedSearch',
          { id: args.id, ownerId: ctx.actor, listKey: binding.key },
          { active: false, defaultKey: null },
        )
        return { ok: true }
      },
    }),

    setDefaultSearchFavorite: defineFn({
      input: { id: 'id', listKey: 'text?' },
      output: { ok: 'bool' },
      effects: ['read:backend.SavedSearch', 'write:backend.SavedSearch'],
      handler: async (ctx, args) => {
        if (!ctx.actor) throw new Error('authentication required')
        const binding = bindingOf(bindings, args.listKey)
        await ctx.tx(async (tx) => {
          const S = tx.table('backend.SavedSearch')
          const target = await tx.db.one(
            from(S).where(
              eq(S.id, args.id),
              eq(S.ownerId, ctx.actor!),
              eq(S.listKey, binding.key),
              eq(S.active, true),
            ),
          )
          if (!target) throw new Error('saved search not found')
          await clearCurrentDefault(tx, ctx.actor!, binding.key, String(args.id))
          await tx.db.update(
            'backend.SavedSearch',
            { id: args.id, ownerId: ctx.actor! },
            { defaultKey: defaultKeyOf(ctx.actor!, binding.key) },
          )
        })
        return { ok: true }
      },
    }),
  }
}
