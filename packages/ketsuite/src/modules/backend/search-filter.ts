import { validateListState } from '@ketvietlab/ketjs'
import type { ListSearchShape, ListState, Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import type { JSXChild } from '@ketvietlab/ketjs-view'
import type {
  SearchFacet,
  SearchFilterConfig,
  SearchFilterCustomRule,
  SearchFilterLabels,
} from '@ketvietlab/design-system'

export type {
  CustomFilterField,
  SearchFacet,
  SearchFavorite,
  SearchFilterCustomRule,
  SearchFilterConfig,
  SearchFilterLabels,
  SearchFilterManager,
  SearchFilterSize,
  SearchFilterOption,
  SearchGroupByOption,
} from '@ketvietlab/design-system'

type Req = Parameters<Route>[1]

export const searchFilterBar = (
  ctx: ServeContext,
  url: URL,
  req: Req,
  id: string,
  config: SearchFilterConfig,
): Promise<JSXChild> => ctx.joint(url, req, 'backend:search.filter', { id, config })

/**
 * The search-filter bar's own vocabulary, which is the same wherever the bar
 * appears. A module overrides only what names its own collection: the bar's
 * label and its search placeholder.
 */
export const searchFilterLabels = (
  _: Translator,
  overrides: Partial<SearchFilterLabels> = {},
): SearchFilterLabels => ({
  searchLabel: _('backend.search.label'),
  searchPlaceholder: _('backend.search.placeholder'),
  toggleLabel: _('backend.search.toggle'),
  filters: _('backend.search.filters'),
  groupBy: _('backend.search.groupBy'),
  groupByApplied: _('backend.search.groupByApplied'),
  groupByAdd: _('backend.search.groupByAdd'),
  groupByClear: _('backend.search.groupByClear'),
  groupByMoveEarlier: _('backend.search.groupByMoveEarlier'),
  groupByMoveLater: _('backend.search.groupByMoveLater'),
  favorites: _('backend.search.favorites'),
  searchGenericLabel: _('backend.search.genericLabel'),
  searchFieldPrefix: _('backend.search.fieldPrefix'),
  searchFieldPreposition: _('backend.search.fieldPreposition'),
  customFilterField: _('backend.search.customFilterField'),
  customFilterOperator: _('backend.search.customFilterOperator'),
  customFilterValue: _('backend.search.customFilterValue'),
  customFilterAdd: _('backend.search.customFilterAdd'),
  customGroupByPlaceholder: _('backend.search.customGroupByPlaceholder'),
  saveSearch: _('backend.search.saveSearch'),
  favoriteName: _('backend.search.favoriteName'),
  favoriteDefault: _('backend.search.favoriteDefault'),
  favoriteSaveAction: _('backend.search.favoriteSaveAction'),
  favoriteRemove: _('backend.search.favoriteRemove'),
  favoriteSetDefault: _('backend.search.favoriteSetDefault'),
  noFavorites: _('backend.search.noFavorites'),
  clear: _('backend.search.clear'),
  applyError: _('backend.search.applyError'),
  retry: _('backend.search.retry'),
  ...overrides,
})

/** A saved search as the list route reads it back. */
export type ListFavorite = { id: string; name: string; state: Partial<ListState>; defaultKey?: string | null }

export type ListSearchFilterOptions = {
  /** The bar's own name, and the id of the body its apply replaces. */
  name: string
  bodyId: string
  spec: ListSearchShape
  state: ListState
  favorites: readonly ListFavorite[]
  /** The module's word for a spec field, given the spec's English fallback. */
  fieldLabel?: (key: string, fallback: string) => string
  /** The module's word for a preset, when it differs from the field's. */
  presetLabel?: (key: string, fallback: string) => string
  labels?: Partial<SearchFilterLabels>
  /** Carried into every call the bar makes, and so how `listKey` travels. */
  applyInput?: Record<string, string | undefined>
  functions: {
    apply: string
    saveFavorite?: string
    deleteFavorite?: string
    setDefaultFavorite?: string
  }
}

/**
 * The bar a `ListSearchShape` describes.
 *
 * Every list's bar is the same shape — presets as filters, groupable fields as
 * group-by options, filterable fields as custom-rule fields, the state's own
 * selections as facets — so the spec is the only thing a screen writes.
 */
export const listSearchFilterConfig = (
  _: Translator,
  options: ListSearchFilterOptions,
): SearchFilterConfig => {
  const { spec, state, favorites } = options
  const fieldLabel = (key: string, fallback: string): string =>
    options.fieldLabel?.(key, fallback) ?? (_.resolves(fallback) ? _(fallback) : fallback)
  const presetLabel = (key: string): string => {
    const fallback = spec.presets?.find((preset) => preset.key === key)?.label ?? key
    return options.presetLabel?.(key, fallback) ?? fieldLabel(key, fallback)
  }
  const ruleLabel = (field: string, operator: string, value: unknown): string => {
    const label = fieldLabel(
      field,
      spec.filterable?.find((candidate) => candidate.key === field)?.label ?? field,
    )
    const suffix =
      value == null || value === '' ? '' : `: ${Array.isArray(value) ? value.join(', ') : String(value)}`
    return `${label} ${operator}${suffix}`
  }
  const customFilters: SearchFilterCustomRule[] = state.filters.flatMap((filter, index) =>
    filter.kind === 'rule'
      ? [
          {
            id: `rule:${index}`,
            field: filter.field,
            operator: filter.operator,
            value: Array.isArray(filter.value) ? filter.value.join(',') : String(filter.value ?? ''),
            label: ruleLabel(filter.field, filter.operator, filter.value),
          },
        ]
      : [],
  )
  const groupLabel = (key: string): string =>
    fieldLabel(key, spec.groupable?.find((candidate) => candidate.key === key)?.label ?? key)
  const facets: SearchFacet[] = [
    ...(state.q ? [{ id: 'query:current', type: 'field' as const, label: state.q }] : []),
    ...state.presets.map((key) => ({
      id: `preset:${key}`,
      type: 'filter' as const,
      label: presetLabel(key),
    })),
    ...(state.includeArchived
      ? [{ id: 'archived', type: 'filter' as const, label: _('backend.chrome.includeArchived') }]
      : []),
    ...customFilters.map(({ id, label }) => ({ id, type: 'filter' as const, label })),
    ...state.groupBy.map((group) => ({
      id: `${group.key}${group.interval ? `:${group.interval}` : ''}`,
      type: 'groupBy' as const,
      label: `${groupLabel(group.key)}${group.interval ? ` / ${group.interval}` : ''}`,
    })),
    ...(state.favoriteId
      ? [
          {
            id: state.favoriteId,
            type: 'favorite' as const,
            label: favorites.find((favorite) => favorite.id === state.favoriteId)?.name ?? state.favoriteId,
          },
        ]
      : []),
  ]
  return {
    name: options.name,
    size: 'compact',
    ...(spec.limits?.maxGroups ? { maxGroupBy: spec.limits.maxGroups } : {}),
    facets,
    filters: [
      ...(spec.presets ?? []).map((preset) => ({
        id: `preset:${preset.key}`,
        label: presetLabel(preset.key),
        active: state.presets.includes(preset.key),
        group: preset.group,
      })),
      // Archiving is a state every list shares, so the bar offers it wherever
      // the spec can filter on the flag that records it.
      ...(spec.filterable?.some((field) => field.key === 'active')
        ? [
            {
              id: 'archived',
              label: _('backend.chrome.includeArchived'),
              active: state.includeArchived,
              group: 'state',
            },
          ]
        : []),
    ],
    groupBy: (spec.groupable ?? []).map((field) => {
      const label = fieldLabel(field.key, field.label)
      return field.intervals?.length
        ? {
            id: field.key,
            label,
            active: false,
            options: field.intervals.map((interval) => ({
              id: `${field.key}:${interval}`,
              label: `${label} / ${interval}`,
              active: state.groupBy.some((group) => group.key === field.key && group.interval === interval),
            })),
          }
        : {
            id: field.key,
            label,
            active: state.groupBy.some((group) => group.key === field.key),
          }
    }),
    favorites: favorites.map((favorite) => ({
      id: favorite.id,
      label: favorite.name,
      isDefault: Boolean(favorite.defaultKey),
      active: state.favoriteId === favorite.id,
    })),
    customFilterFields: (spec.filterable ?? []).map((field) => ({
      value: field.key,
      label: fieldLabel(field.key, field.label),
      type: field.type,
    })),
    customFilters,
    labels: searchFilterLabels(_, options.labels ?? {}),
    manager: {
      applyFunction: options.functions.apply,
      bodyId: options.bodyId,
      applyInput: options.applyInput,
      ...(options.functions.saveFavorite ? { saveFavoriteFunction: options.functions.saveFavorite } : {}),
      ...(options.functions.deleteFavorite
        ? { deleteFavoriteFunction: options.functions.deleteFavorite }
        : {}),
      ...(options.functions.setDefaultFavorite
        ? { setDefaultFavoriteFunction: options.functions.setDefaultFavorite }
        : {}),
    },
  }
}

/**
 * The viewer's saved searches for a list, minus any that no longer fit the spec
 * — a column a favourite grouped by can be removed from the list it belongs to.
 */
export const loadListFavorites = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  spec: ListSearchShape,
  state: ListState,
): Promise<ListFavorite[]> => {
  const loaded = (await ctx.callUnchecked(
    'backend.listSavedSearches',
    { listKey: spec.key },
    url,
    req,
  )) as ListFavorite[]
  return loaded.filter((favorite) => {
    try {
      validateListState(spec, {
        ...state,
        ...favorite.state,
        presets: [...(favorite.state.presets ?? [])],
        filters: [...(favorite.state.filters ?? [])],
        groupBy: [...(favorite.state.groupBy ?? [])],
        sort: [...(favorite.state.sort ?? spec.defaultSort ?? [])],
      })
      return true
    } catch {
      return false
    }
  })
}
