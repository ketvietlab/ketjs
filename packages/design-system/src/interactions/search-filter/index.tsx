import { each, signal } from '@ketvietlab/ketjs-view'
import type { IslandController, IslandProps, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'search-filter',
  'search-filter-bar',
  'search-filter-field',
  'search-filter-input',
  'search-filter-facets',
  'search-filter-facet',
  'search-filter-facet-remove',
  'search-filter-suggestions',
  'search-filter-suggestion',
  'search-filter-toggle',
  'search-filter-columns',
  'search-filter-column',
  'search-filter-column-title',
  'search-filter-grouping',
  'search-filter-grouping-head',
  'search-filter-grouping-list',
  'search-filter-grouping-item',
  'search-filter-grouping-order',
  'search-filter-grouping-label',
  'search-filter-grouping-actions',
  'search-filter-grouping-action',
  'search-filter-grouping-clear',
  'search-filter-grouping-add-label',
  'custom-filter',
  'custom-filter-row',
  'custom-filter-add',
  'custom-group-by',
  'favorite-list',
  'favorite-item',
  'favorite-item-default',
  'favorite-item-remove',
  'favorite-save',
  'favorite-save-row',
] as const

/**
 * The same 7 field types and their operator vocabulary as
 * `packages/ketjs/src/data/list-search.ts`'s `ListFieldType`/`defaultOperators` —
 * redeclared here because design-system cannot depend on `@ketvietlab/ketjs`.
 */
export type SearchFilterFieldType =
  | 'text'
  | 'number'
  | 'boolean'
  | 'selection'
  | 'reference'
  | 'date'
  | 'datetime'
export type SearchFilterOperator =
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

/** The density of the search bar; `compact` uses the small control-height token. */
export type SearchFilterSize = 'default' | 'compact'

const defaultOperators: Record<SearchFilterFieldType, readonly SearchFilterOperator[]> = {
  text: ['contains', 'notContains', 'equals', 'notEquals', 'startsWith', 'isSet', 'isNotSet'],
  number: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between', 'isSet', 'isNotSet'],
  boolean: ['isTrue', 'isFalse'],
  selection: ['equals', 'notEquals', 'anyOf', 'isSet', 'isNotSet'],
  reference: ['equals', 'notEquals', 'anyOf', 'isSet', 'isNotSet'],
  date: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between', 'isSet', 'isNotSet'],
  datetime: ['equals', 'notEquals', 'gt', 'gte', 'lt', 'lte', 'between', 'isSet', 'isNotSet'],
}

const operatorLabels: Record<SearchFilterOperator, string> = {
  contains: 'contains',
  notContains: 'does not contain',
  equals: 'is',
  notEquals: 'is not',
  startsWith: 'starts with',
  gt: 'is greater than',
  gte: 'is greater than or equal to',
  lt: 'is less than',
  lte: 'is less than or equal to',
  between: 'is between',
  anyOf: 'is any of',
  isTrue: 'is true',
  isFalse: 'is false',
  isSet: 'is set',
  isNotSet: 'is not set',
}

/** An operator that stands on its own and takes no value ("is set", "is true", …). */
const isValuelessOperator = (operator: SearchFilterOperator): boolean =>
  operator === 'isTrue' || operator === 'isFalse' || operator === 'isSet' || operator === 'isNotSet'

/** The operator a free-text "Search <field> for: …" suggestion applies for that field's type. */
const defaultSearchOperator = (type: SearchFilterFieldType): SearchFilterOperator =>
  type === 'number' || type === 'date' || type === 'datetime' ? 'equals' : 'contains'

export type CustomFilterField = { value: string; label: string; type: SearchFilterFieldType }

/** A removable chip in the search field. `type` only drives its colour token. */
export type SearchFacet = { id: string; type: 'field' | 'filter' | 'groupBy' | 'favorite'; label: string }

export type SearchFilterOption = {
  id: string
  label: string
  active: boolean
  /** Options sharing a `group` are OR'd together, set off from the next group by a divider. */
  group?: string
  options?: SearchFilterOption[]
}

export type SearchGroupByOption = {
  id: string
  label: string
  active: boolean
  group?: string
  options?: SearchGroupByOption[]
}

export type SearchFavorite = { id: string; label: string; isDefault: boolean; active: boolean }
export type SearchFilterCustomRule = {
  id: string
  field: string
  operator: SearchFilterOperator
  value: string
  label: string
}

export type SearchFilterManager = {
  applyFunction: string
  bodyId: string
  /** Static, screen-owned input kept with every apply request (for example the active locale). */
  applyInput?: Record<string, unknown>
  saveFavoriteFunction?: string
  deleteFavoriteFunction?: string
  setDefaultFavoriteFunction?: string
}

export type SearchFilterLabels = {
  searchLabel: string
  searchPlaceholder: string
  /** Accessible name/title for the single caret trigger that opens the Filters/Group By/Favorites panel. */
  toggleLabel: string
  filters: string
  groupBy: string
  groupByApplied?: string
  groupByAdd?: string
  groupByClear?: string
  groupByMoveEarlier?: string
  groupByMoveLater?: string
  favorites: string
  /** The field-less suggestion: `${searchGenericLabel}: "query"`. */
  searchGenericLabel: string
  /** The per-field suggestion: `${searchFieldPrefix} <field> ${searchFieldPreposition}: "query"`. */
  searchFieldPrefix: string
  searchFieldPreposition: string
  customFilterField: string
  customFilterOperator: string
  customFilterValue: string
  customFilterAdd: string
  customGroupByPlaceholder: string
  saveSearch: string
  favoriteName: string
  favoriteDefault: string
  favoriteSaveAction: string
  favoriteRemove: string
  favoriteSetDefault: string
  noFavorites: string
  clear: string
  applyError: string
  retry: string
}

export type SearchFilterConfig = {
  name: string
  /** Keeps the standard interaction while reducing the search bar's visual density. */
  size?: SearchFilterSize
  query?: string
  facets: SearchFacet[]
  filters: SearchFilterOption[]
  groupBy: SearchGroupByOption[]
  /** Maximum simultaneous grouping levels supported by the consumer. */
  maxGroupBy?: number
  favorites: SearchFavorite[]
  customFilterFields: CustomFilterField[]
  /** Rules already encoded in the server-rendered list state. */
  customFilters?: SearchFilterCustomRule[]
  labels: SearchFilterLabels
  manager?: SearchFilterManager
}

type SearchFilterIslandProps = IslandProps & { id: string; config: SearchFilterConfig }
type ApiPayload = { ok?: boolean; value?: unknown; message?: unknown; errors?: Array<{ message?: unknown }> }
type CustomFilterRule = { field: string; operator: SearchFilterOperator; value: string }

const string = (value: unknown): string => (value == null ? '' : String(value))

const callApi = async (name: string, input: unknown): Promise<unknown> => {
  const response = await fetch(`/_ket/fn/${encodeURIComponent(name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const payload = (await response.json()) as ApiPayload
  if (!response.ok || payload.ok === false) {
    const domainError = payload.errors?.[0]
    throw new Error(string(domainError?.message ?? payload.message ?? `HTTP ${response.status}`))
  }
  return payload.value
}

const flatten = <Option extends { id: string; label: string; options?: Option[] }>(
  options: readonly Option[],
): Option[] => options.flatMap((option) => (option.options?.length ? flatten(option.options) : [option]))

export function createSearchFilterView(props: SearchFilterIslandProps): IslandController {
  const { config } = props
  const labels = {
    groupByApplied: config.labels.groupBy,
    groupByAdd: config.labels.customGroupByPlaceholder,
    groupByClear: config.labels.clear,
    groupByMoveEarlier: 'Move earlier',
    groupByMoveLater: 'Move later',
    ...config.labels,
  }
  const manager = config.manager
  const groupByOptions = flatten(config.groupBy)
  // A free-text query against a boolean field has no natural meaning, so it is
  // offered as a toggleable filter item, never as a "Search <field> for: …" row.
  const searchableFields = config.customFilterFields.filter((field) => field.type !== 'boolean')

  const facets = signal<SearchFacet[]>(config.facets)
  const favorites = signal<SearchFavorite[]>(config.favorites)
  const customFilterRules = signal<Record<string, CustomFilterRule>>(
    Object.fromEntries(
      (config.customFilters ?? []).map((rule) => [
        rule.id,
        { field: rule.field, operator: rule.operator, value: rule.value },
      ]),
    ),
  )
  const query = signal(config.query ?? '')
  const suggestionsOpen = signal(false)
  const customFilterField = signal('')
  const customFilterOperator = signal('')
  const customFilterValue = signal('')
  const menuOpen = signal(false)
  const saveFavoriteName = signal('')
  const saveFavoriteDefault = signal(false)
  const pending = signal(false)
  const error = signal('')

  const isActive = (kind: SearchFacet['type'], id: string): boolean =>
    facets().some((facet) => facet.type === kind && facet.id === id)
  const countOf = (kind: SearchFacet['type']): number =>
    facets().filter((facet) => facet.type === kind).length
  const activeFavoriteId = (): string => facets().find((facet) => facet.type === 'favorite')?.id ?? ''
  const groupByFacets = (): SearchFacet[] => facets().filter((facet) => facet.type === 'groupBy')
  const operatorsFor = (fieldValue: string): readonly SearchFilterOperator[] => {
    const field = config.customFilterFields.find((entry) => entry.value === fieldValue)
    return field ? defaultOperators[field.type] : []
  }

  const applyPayload = () => ({
    ...(manager?.applyInput ?? {}),
    query: query(),
    facets: facets(),
    filters: facets()
      .filter((facet) => facet.type === 'filter' && !customFilterRules()[facet.id])
      .map((facet) => facet.id),
    groupBy: facets()
      .filter((facet) => facet.type === 'groupBy')
      .map((facet) => facet.id),
    favoriteId: activeFavoriteId() || null,
    customFilters: Object.entries(customFilterRules()).map(([id, rule]) => ({ id, ...rule })),
  })

  let applyVersion = 0
  const apply = async (): Promise<void> => {
    if (!manager?.applyFunction) return
    const version = ++applyVersion
    pending.set(true)
    error.set('')
    try {
      const value = (await callApi(manager.applyFunction, applyPayload())) as
        | { html?: unknown; href?: unknown }
        | undefined
      if (version !== applyVersion) return
      const body = document.getElementById(manager.bodyId)
      if (body && typeof value?.html === 'string') body.innerHTML = value.html
      // A bare `pushState` only edits the address bar — nothing reads the URL back
      // out and re-renders, so a function that answers with an `href` alone (no
      // `html`) would otherwise apply nothing. Real navigation is what a filter
      // whose backend can only recompute an href, not build the body itself
      // (its RPC transport has no page-rendering context — see `applyFunction`'s
      // own contract), needs in order to take effect at all.
      if (typeof value?.href === 'string' && typeof value.html !== 'string') {
        window.location.assign(value.href)
        return
      }
      if (typeof value?.href === 'string') history.pushState(null, '', value.href)
    } catch (caught) {
      if (version !== applyVersion) return
      error.set(caught instanceof Error ? caught.message : labels.applyError)
    } finally {
      if (version === applyVersion) pending.set(false)
    }
  }

  const clearFavorite = (): void => {
    if (activeFavoriteId()) facets.set(facets().filter((facet) => facet.type !== 'favorite'))
  }

  const removeFacet = (facet: SearchFacet): void => {
    if (facet.type !== 'favorite') clearFavorite()
    facets.set(facets().filter((held) => held.id !== facet.id))
    if (customFilterRules()[facet.id]) {
      const next = { ...customFilterRules() }
      delete next[facet.id]
      customFilterRules.set(next)
    }
    void apply()
  }

  const toggleFilter = (option: SearchFilterOption): void => {
    clearFavorite()
    if (isActive('filter', option.id)) {
      removeFacet({ id: option.id, type: 'filter', label: option.label })
      return
    }
    facets.set([...facets(), { id: option.id, type: 'filter', label: option.label }])
    void apply()
  }

  const toggleGroupBy = (option: SearchGroupByOption): void => {
    if (!isActive('groupBy', option.id) && groupByFacets().length >= (config.maxGroupBy ?? Infinity)) return
    clearFavorite()
    if (isActive('groupBy', option.id)) {
      removeFacet({ id: option.id, type: 'groupBy', label: option.label })
      return
    }
    facets.set([...facets(), { id: option.id, type: 'groupBy', label: option.label }])
    void apply()
  }

  const addCustomFilter = (): void => {
    const field = config.customFilterFields.find((entry) => entry.value === customFilterField())
    const operator = customFilterOperator() as SearchFilterOperator
    if (!field || !operator) return
    const value = customFilterValue().trim()
    const label = isValuelessOperator(operator)
      ? `${field.label} ${operatorLabels[operator]}`
      : `${field.label} ${operatorLabels[operator]}${value ? ` "${value}"` : ''}`
    clearFavorite()
    const id = `custom-filter:${crypto.randomUUID()}`
    customFilterRules.set({ ...customFilterRules(), [id]: { field: field.value, operator, value } })
    facets.set([...facets(), { id, type: 'filter', label }])
    customFilterField.set('')
    customFilterOperator.set('')
    customFilterValue.set('')
    void apply()
  }

  const handleSearchInput = (event: Event): void => {
    if (!(event.currentTarget instanceof HTMLInputElement)) return
    query.set(event.currentTarget.value)
    suggestionsOpen.set(event.currentTarget.value.trim() !== '')
  }

  const selectGenericSuggestion = (): void => {
    const value = query().trim()
    if (!value) return
    clearFavorite()
    facets.set([
      ...facets().filter((facet) => facet.type !== 'field'),
      { id: `query:${crypto.randomUUID()}`, type: 'field', label: value },
    ])
    query.set('')
    suggestionsOpen.set(false)
    void apply()
  }

  const selectFieldSuggestion = (field: CustomFilterField): void => {
    const value = query().trim()
    if (!value) return
    const operator = defaultSearchOperator(field.type)
    clearFavorite()
    const id = `custom-filter:${crypto.randomUUID()}`
    customFilterRules.set({ ...customFilterRules(), [id]: { field: field.value, operator, value } })
    facets.set([...facets(), { id, type: 'filter', label: `${field.label}: "${value}"` }])
    query.set('')
    suggestionsOpen.set(false)
    void apply()
  }

  const handleSearchKeydown = (event: Event): void => {
    if (!(event instanceof KeyboardEvent)) return
    if (event.key === 'Enter') {
      event.preventDefault()
      selectGenericSuggestion()
    } else if (event.key === 'Escape') {
      suggestionsOpen.set(false)
    }
  }

  const applyFavorite = (favorite: SearchFavorite): void => {
    facets.set([
      ...facets().filter((held) => held.type !== 'favorite'),
      { id: favorite.id, type: 'favorite', label: favorite.label },
    ])
    void apply()
  }

  const moveGroupBy = (facet: SearchFacet, direction: -1 | 1): void => {
    const grouped = groupByFacets()
    const from = grouped.findIndex((entry) => entry.id === facet.id)
    const to = from + direction
    if (from < 0 || to < 0 || to >= grouped.length) return
    const next = [...grouped]
    ;[next[from], next[to]] = [next[to]!, next[from]!]
    clearFavorite()
    facets.set([...facets().filter((entry) => entry.type !== 'groupBy'), ...next])
    void apply()
  }

  const clearGroupBy = (): void => {
    if (!groupByFacets().length) return
    clearFavorite()
    facets.set(facets().filter((facet) => facet.type !== 'groupBy'))
    void apply()
  }

  const saveFavorite = async (event: Event): Promise<void> => {
    event.preventDefault()
    const name = saveFavoriteName().trim()
    if (!name || !manager?.saveFavoriteFunction) return
    pending.set(true)
    error.set('')
    try {
      const value = (await callApi(manager.saveFavoriteFunction, {
        name,
        isDefault: saveFavoriteDefault(),
        state: applyPayload(),
      })) as { id?: unknown } | undefined
      const isDefault = saveFavoriteDefault()
      const favorite: SearchFavorite = {
        id: string(value?.id) || crypto.randomUUID(),
        label: name,
        isDefault,
        active: true,
      }
      favorites.set([
        ...favorites().map((entry) => (isDefault ? { ...entry, isDefault: false } : entry)),
        favorite,
      ])
      applyFavorite(favorite)
      saveFavoriteName.set('')
      saveFavoriteDefault.set(false)
    } catch (caught) {
      error.set(caught instanceof Error ? caught.message : labels.applyError)
    } finally {
      pending.set(false)
    }
  }

  const removeFavorite = async (favorite: SearchFavorite): Promise<void> => {
    if (!manager?.deleteFavoriteFunction) return
    pending.set(true)
    error.set('')
    try {
      await callApi(manager.deleteFavoriteFunction, { ...(manager.applyInput ?? {}), id: favorite.id })
      favorites.set(favorites().filter((entry) => entry.id !== favorite.id))
      if (activeFavoriteId() === favorite.id)
        removeFacet({ id: favorite.id, type: 'favorite', label: favorite.label })
    } catch (caught) {
      error.set(caught instanceof Error ? caught.message : labels.applyError)
    } finally {
      pending.set(false)
    }
  }

  const setDefaultFavorite = async (favorite: SearchFavorite): Promise<void> => {
    if (!manager?.setDefaultFavoriteFunction) return
    pending.set(true)
    error.set('')
    try {
      await callApi(manager.setDefaultFavoriteFunction, { ...(manager.applyInput ?? {}), id: favorite.id })
      favorites.set(favorites().map((entry) => ({ ...entry, isDefault: entry.id === favorite.id })))
    } catch (caught) {
      error.set(caught instanceof Error ? caught.message : labels.applyError)
    } finally {
      pending.set(false)
    }
  }

  const facetChip = (facet: SearchFacet): TemplateResult => (
    <li data-ui="search-filter-facet" data-type={facet.type}>
      <span>{facet.label}</span>
      <button
        data-ui="search-filter-facet-remove"
        type="button"
        aria-label={`${labels.clear}: ${facet.label}`}
        title={labels.clear}
        onClick={() => removeFacet(facet)}
      >
        ×
      </button>
    </li>
  )

  const filterMenuItem = (
    option: SearchFilterOption,
    previous: SearchFilterOption | null,
  ): TemplateResult => {
    const divider = previous && previous.group !== option.group ? <hr data-ui="menu-separator" /> : null
    if (option.options?.length)
      return (
        <>
          {divider}
          <details data-ui="disclosure">
            <summary data-ui="disclosure-summary">{option.label}</summary>
            <div data-ui="disclosure-body">
              {each(
                option.options,
                (entry) => entry.id,
                (entry, index) =>
                  filterMenuItem(
                    entry,
                    index === 0 ? null : (option.options as SearchFilterOption[])[index - 1],
                  ),
              )}
            </div>
          </details>
        </>
      )
    const active = isActive('filter', option.id)
    return (
      <>
        {divider}
        <button
          data-ui="menu-item"
          type="button"
          aria-pressed={String(active)}
          onClick={() => toggleFilter(option)}
        >
          <span data-ui="menu-item-check" aria-hidden="true">
            {active ? '✓' : ''}
          </span>
          <span data-ui="menu-item-copy">
            <span>{option.label}</span>
          </span>
        </button>
      </>
    )
  }

  const groupByMenuItem = (
    option: SearchGroupByOption,
    previous: SearchGroupByOption | null,
  ): TemplateResult => {
    const divider = previous && previous.group !== option.group ? <hr data-ui="menu-separator" /> : null
    if (option.options?.length)
      return (
        <>
          {divider}
          <details data-ui="disclosure">
            <summary data-ui="disclosure-summary">{option.label}</summary>
            <div data-ui="disclosure-body">
              {each(
                option.options,
                (entry) => entry.id,
                (entry, index) =>
                  groupByMenuItem(
                    entry,
                    index === 0 ? null : (option.options as SearchGroupByOption[])[index - 1],
                  ),
              )}
            </div>
          </details>
        </>
      )
    const active = isActive('groupBy', option.id)
    if (active) return <></>
    return (
      <>
        {divider}
        <button
          data-ui="menu-item"
          type="button"
          disabled={groupByFacets().length >= (config.maxGroupBy ?? Infinity)}
          onClick={() => toggleGroupBy(option)}
        >
          <span data-ui="menu-item-check" aria-hidden="true">
            {active ? '✓' : ''}
          </span>
          <span data-ui="menu-item-copy">
            <span>{option.label}</span>
          </span>
        </button>
      </>
    )
  }

  const favoriteRow = (favorite: SearchFavorite): TemplateResult => (
    <li data-ui="favorite-item" data-active={String(favorite.id === activeFavoriteId())}>
      <button data-ui="menu-item" type="button" onClick={() => applyFavorite(favorite)}>
        <span data-ui="menu-item-copy">
          <span>{favorite.label}</span>
        </span>
      </button>
      <div data-ui="favorite-item-actions">
        {manager?.setDefaultFavoriteFunction && (
          <button
            data-ui="favorite-item-default"
            type="button"
            data-default={String(favorite.isDefault)}
            aria-label={labels.favoriteSetDefault}
            title={labels.favoriteSetDefault}
            onClick={() => setDefaultFavorite(favorite)}
          >
            {favorite.isDefault ? '★' : '☆'}
          </button>
        )}
        {manager?.deleteFavoriteFunction && (
          <button
            data-ui="favorite-item-remove"
            type="button"
            aria-label={`${labels.favoriteRemove}: ${favorite.label}`}
            title={labels.favoriteRemove}
            onClick={() => removeFavorite(favorite)}
          >
            ×
          </button>
        )}
      </div>
    </li>
  )

  const columnTitle = (label: string, count: number): TemplateResult => (
    <h3 data-ui="search-filter-column-title">
      {label}
      {count ? ` (${count})` : ''}
    </h3>
  )

  const groupByPipeline = (): TemplateResult => {
    const grouped = groupByFacets()
    if (!grouped.length) return <></>
    return (
      <section data-ui="search-filter-grouping" aria-label={labels.groupByApplied}>
        <div data-ui="search-filter-grouping-head">
          <span>{labels.groupByApplied}</span>
          <button data-ui="search-filter-grouping-clear" type="button" onClick={clearGroupBy}>
            {labels.groupByClear}
          </button>
        </div>
        <ol data-ui="search-filter-grouping-list">
          {each(
            grouped,
            (facet) => facet.id,
            (facet, index) => (
              <li data-ui="search-filter-grouping-item">
                <span data-ui="search-filter-grouping-order">{String(index + 1)}</span>
                <span data-ui="search-filter-grouping-label">{facet.label}</span>
                <span data-ui="search-filter-grouping-actions">
                  {index > 0 && (
                    <button
                      data-ui="search-filter-grouping-action"
                      type="button"
                      aria-label={`${labels.groupByMoveEarlier}: ${facet.label}`}
                      title={`${labels.groupByMoveEarlier}: ${facet.label}`}
                      onClick={() => moveGroupBy(facet, -1)}
                    >
                      ↑
                    </button>
                  )}
                  {index + 1 < grouped.length && (
                    <button
                      data-ui="search-filter-grouping-action"
                      type="button"
                      aria-label={`${labels.groupByMoveLater}: ${facet.label}`}
                      title={`${labels.groupByMoveLater}: ${facet.label}`}
                      onClick={() => moveGroupBy(facet, 1)}
                    >
                      ↓
                    </button>
                  )}
                  <button
                    data-ui="search-filter-grouping-action"
                    data-action="remove"
                    type="button"
                    aria-label={`${labels.clear}: ${facet.label}`}
                    title={`${labels.clear}: ${facet.label}`}
                    onClick={() => removeFacet(facet)}
                  >
                    ×
                  </button>
                </span>
              </li>
            ),
          )}
        </ol>
      </section>
    )
  }

  return {
    view: () => (
      <div
        data-ui="search-filter"
        role="search"
        aria-label={labels.searchLabel}
        data-name={config.name}
        data-size={config.size ?? 'default'}
        data-busy={pending() ? 'true' : null}
      >
        {error() ? (
          <aside data-ui="notice" data-tone="danger" role="alert">
            <div data-ui="notice-copy">
              <p data-ui="notice-message">{error()}</p>
            </div>
            <button data-ui="action" data-variant="secondary" type="button" onClick={apply}>
              {labels.retry}
            </button>
          </aside>
        ) : null}
        <div data-ui="search-filter-bar">
          <div data-ui="search-filter-field">
            {facets().some((facet) => facet.type !== 'groupBy') ? (
              <ul data-ui="search-filter-facets">
                {each(
                  facets().filter((facet) => facet.type !== 'groupBy'),
                  (facet) => facet.id,
                  facetChip,
                )}
              </ul>
            ) : null}
            <input
              data-ui="search-filter-input"
              type="search"
              value={query()}
              autocomplete="off"
              placeholder={labels.searchPlaceholder}
              aria-label={labels.searchLabel}
              onInput={handleSearchInput}
              onKeydown={handleSearchKeydown}
              onFocus={() => {
                if (query().trim()) suggestionsOpen.set(true)
              }}
            />
            {suggestionsOpen() && query().trim() ? (
              <div data-ui="search-filter-suggestions" role="group" aria-label={labels.searchGenericLabel}>
                <button data-ui="search-filter-suggestion" type="button" onClick={selectGenericSuggestion}>
                  {labels.searchGenericLabel}: <b>"{query().trim()}"</b>
                </button>
                {each(
                  searchableFields,
                  (field) => field.value,
                  (field) => (
                    <button
                      data-ui="search-filter-suggestion"
                      type="button"
                      onClick={() => selectFieldSuggestion(field)}
                    >
                      {labels.searchFieldPrefix} <b>{field.label}</b> {labels.searchFieldPreposition}:{' '}
                      <b>"{query().trim()}"</b>
                    </button>
                  ),
                )}
              </div>
            ) : null}
          </div>
          <details
            data-ui="menu"
            data-variant="search-filter"
            data-align="end"
            data-active={facets().length ? 'true' : null}
            open={menuOpen() === true ? true : undefined}
            onToggle={(event: Event) => {
              if (event.currentTarget instanceof HTMLDetailsElement) menuOpen.set(event.currentTarget.open)
            }}
          >
            <summary
              data-ui="search-filter-toggle"
              aria-label={labels.toggleLabel}
              title={labels.toggleLabel}
            >
              <span aria-hidden="true">▾</span>
              {facets().length ? <span data-ui="menu-trigger-count">{String(facets().length)}</span> : null}
            </summary>
            <div data-ui="menu-panel" role="group" aria-label={labels.toggleLabel}>
              <div data-ui="search-filter-columns">
                <div data-ui="search-filter-column" data-facet-type="filter">
                  {columnTitle(labels.filters, countOf('filter'))}
                  {each(
                    config.filters,
                    (option) => option.id,
                    (option, index) => filterMenuItem(option, index === 0 ? null : config.filters[index - 1]),
                  )}
                  <hr data-ui="menu-separator" />
                  <div data-ui="custom-filter">
                    <div data-ui="custom-filter-row">
                      <select
                        aria-label={labels.customFilterField}
                        onChange={(event) => {
                          if (event.currentTarget instanceof HTMLSelectElement) {
                            customFilterField.set(event.currentTarget.value)
                            customFilterOperator.set('')
                          }
                        }}
                      >
                        <option value="" disabled selected={!customFilterField()}>
                          {labels.customFilterField}
                        </option>
                        {each(
                          config.customFilterFields,
                          (field) => field.value,
                          (field) => (
                            <option value={field.value} selected={field.value === customFilterField()}>
                              {field.label}
                            </option>
                          ),
                        )}
                      </select>
                      <select
                        aria-label={labels.customFilterOperator}
                        disabled={!customFilterField()}
                        onChange={(event) => {
                          if (event.currentTarget instanceof HTMLSelectElement)
                            customFilterOperator.set(event.currentTarget.value)
                        }}
                      >
                        <option value="" disabled selected={!customFilterOperator()}>
                          {labels.customFilterOperator}
                        </option>
                        {each(
                          operatorsFor(customFilterField()),
                          (operator) => operator,
                          (operator) => (
                            <option value={operator} selected={operator === customFilterOperator()}>
                              {operatorLabels[operator]}
                            </option>
                          ),
                        )}
                      </select>
                      {!isValuelessOperator(customFilterOperator() as SearchFilterOperator) && (
                        <input
                          type="text"
                          autocomplete="off"
                          aria-label={labels.customFilterValue}
                          placeholder={labels.customFilterValue}
                          value={customFilterValue()}
                          onInput={(event) => {
                            if (event.currentTarget instanceof HTMLInputElement)
                              customFilterValue.set(event.currentTarget.value)
                          }}
                        />
                      )}
                    </div>
                    <button
                      data-ui="custom-filter-add"
                      type="button"
                      disabled={!customFilterField() || !customFilterOperator()}
                      onClick={addCustomFilter}
                    >
                      {labels.customFilterAdd}
                    </button>
                  </div>
                </div>
                <div data-ui="search-filter-column" data-facet-type="groupBy">
                  {columnTitle(labels.groupBy, countOf('groupBy'))}
                  {groupByPipeline()}
                  {config.groupBy.length ? (
                    <p data-ui="search-filter-grouping-add-label">{labels.groupByAdd}</p>
                  ) : null}
                  {each(
                    config.groupBy,
                    (option) => option.id,
                    (option, index) =>
                      groupByMenuItem(option, index === 0 ? null : config.groupBy[index - 1]),
                  )}
                  {groupByOptions.length ? <hr data-ui="menu-separator" /> : null}
                  {groupByOptions.length ? (
                    <select
                      data-ui="custom-group-by"
                      disabled={groupByFacets().length >= (config.maxGroupBy ?? Infinity)}
                      aria-label={labels.customGroupByPlaceholder}
                      onChange={(event) => {
                        if (!(event.currentTarget instanceof HTMLSelectElement)) return
                        const select = event.currentTarget
                        const option = groupByOptions.find((entry) => entry.id === select.value)
                        select.value = ''
                        if (option && !isActive('groupBy', option.id)) toggleGroupBy(option)
                      }}
                    >
                      <option value="" disabled selected>
                        {labels.customGroupByPlaceholder}
                      </option>
                      {each(
                        groupByOptions,
                        (option) => option.id,
                        (option) => (
                          <option value={option.id}>{option.label}</option>
                        ),
                      )}
                    </select>
                  ) : null}
                </div>
                <div data-ui="search-filter-column" data-facet-type="favorite">
                  {columnTitle(labels.favorites, activeFavoriteId() ? 1 : 0)}
                  {manager?.saveFavoriteFunction ? (
                    <form data-ui="favorite-save" aria-label={labels.saveSearch} onSubmit={saveFavorite}>
                      <div data-ui="favorite-save-row">
                        <input
                          type="text"
                          autocomplete="off"
                          placeholder={labels.favoriteName}
                          aria-label={labels.favoriteName}
                          value={saveFavoriteName()}
                          onInput={(event) => {
                            if (event.currentTarget instanceof HTMLInputElement)
                              saveFavoriteName.set(event.currentTarget.value)
                          }}
                        />
                        <label>
                          <input
                            type="checkbox"
                            checked={saveFavoriteDefault()}
                            onChange={(event) => {
                              if (event.currentTarget instanceof HTMLInputElement)
                                saveFavoriteDefault.set(event.currentTarget.checked)
                            }}
                          />
                          {labels.favoriteDefault}
                        </label>
                      </div>
                      <button
                        data-ui="action"
                        data-variant="primary"
                        data-size="compact"
                        type="submit"
                        disabled={!saveFavoriteName().trim()}
                      >
                        {labels.favoriteSaveAction}
                      </button>
                    </form>
                  ) : null}
                  {favorites().length ? (
                    <ul data-ui="favorite-list">
                      {each(favorites(), (favorite) => favorite.id, favoriteRow)}
                    </ul>
                  ) : (
                    <p data-ui="menu-label">{labels.noFavorites}</p>
                  )}
                </div>
              </div>
            </div>
          </details>
        </div>
      </div>
    ),
    mount: ({ root, lifetime }) => {
      // Autocomplete is an island-owned popup rather than a native <details>
      // disclosure, so the shared details-menu dismissor cannot see it. Keep
      // the boundary local to the component: an outside click abandons the
      // suggestions without changing the query the reader has entered.
      document.addEventListener(
        'click',
        (event) => {
          if (!suggestionsOpen()) return
          const target = event.target
          if (target instanceof Node && (root as unknown as Node).contains(target)) return
          suggestionsOpen.set(false)
        },
        { signal: lifetime },
      )
    },
    dispose: () => {
      applyVersion++
      pending.set(false)
    },
  }
}

export const searchFilter = (props: IslandProps): IslandController =>
  createSearchFilterView(props as SearchFilterIslandProps)
