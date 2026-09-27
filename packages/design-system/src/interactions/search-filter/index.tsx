import { ModalSheet } from '../../patterns/modal-sheet/index.tsx'
import { each, signal } from '@ketvietlab/ketjs-view'
import type { IslandController, IslandElement, IslandProps, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'search-filter',
  'search-filter-bar',
  'search-filter-section-toggle',
  'search-filter-sheet',
  'search-filter-clear',
  'search-filter-icon',
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
  'search-filter-empty',
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
  'favorite-save-toggle',
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

export type CustomFilterField = {
  value: string
  label: string
  type: SearchFilterFieldType
  /** Screen-owned choices, including permission-checked reference lookups. */
  choices?: readonly { value: string; label: string }[]
}

/**
 * The rule a free-text "Search <field> for: …" suggestion stands for, or null
 * when the text cannot be one. Every suggestion must be a filter the server
 * accepts, so a field whose values free text cannot name — a choice, a record,
 * a date — is left to the custom-filter editor instead of being offered here.
 */
const suggestedRule = (field: CustomFilterField, text: string): CustomFilterRule | null => {
  if (field.type === 'text') return { field: field.value, operator: 'contains', value: text }
  // Whole numbers only: `1.000` is a thousand to a Vietnamese reader and one to `Number`.
  if (field.type === 'number' && /^-?\d+$/.test(text))
    return { field: field.value, operator: 'equals', value: text }
  return null
}

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
  /** Accessible name for the combined mobile Filters/Group By/Favorites sheet. */
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
  favoriteCancel?: string
  favoriteError?: string
  favoriteRemove: string
  favoriteSetDefault: string
  noFavorites: string
  clear: string
  applyError: string
  retry: string
  clearFilters?: string
  close?: string
  valueFrom?: string
  valueTo?: string
  operatorLabels?: Partial<Record<SearchFilterOperator, string>>
}

export type SearchFilterConfig = {
  name: string
  /** Disable unsupported editors while retaining the same search and preset-facet interaction. */
  capabilities?: { groupBy?: boolean; favorites?: boolean; customFilters?: boolean }
  /** Keeps the standard interaction while reducing the search bar's visual density. */
  size?: SearchFilterSize
  query?: string
  /** Native link to a screen-owned favorite form, when one exists. */
  favoriteHref?: string
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

/** Shared by SSR and interactive chips; values remain data and choices supply display labels. */
export const searchFilterRuleLabel = (options: {
  fieldLabel: string
  operator: SearchFilterOperator
  value?: unknown
  choices?: CustomFilterField['choices']
  operatorLabels?: SearchFilterLabels['operatorLabels']
}): string => {
  const operator = options.operatorLabels?.[options.operator] ?? operatorLabels[options.operator]
  const prefix = `${options.fieldLabel} ${operator}`
  if (isValuelessOperator(options.operator) || options.value == null || options.value === '') return prefix
  const values = Array.isArray(options.value)
    ? options.value
    : options.operator === 'anyOf' || options.operator === 'between'
      ? String(options.value)
          .split(',')
          .map((part) => part.trim())
      : [options.value]
  const value = values
    .map((part) => options.choices?.find((choice) => choice.value === String(part))?.label ?? String(part))
    .join(', ')
  return `${prefix}: ${value}`
}

type SearchFilterIslandProps = IslandProps & { id: string; config: SearchFilterConfig }
type ApiPayload = { ok?: boolean; value?: unknown; message?: unknown; errors?: Array<{ message?: unknown }> }
type CustomFilterRule = { field: string; operator: SearchFilterOperator; value: string }
type Draft = { facets: SearchFacet[]; rules: Record<string, CustomFilterRule> }
type RetryDraft = Draft & { consumed: string }

const string = (value: unknown): string => (value == null ? '' : String(value))

/**
 * A function call that failed. `retryable` when it never reached a verdict — the
 * network dropped or the server faulted — so the same request may yet succeed;
 * a refusal (4xx) would only be refused again.
 */
class ApiError extends Error {
  readonly retryable: boolean
  constructor(message: string, retryable: boolean) {
    super(message)
    this.retryable = retryable
  }
}

const callApi = async (name: string, input: unknown): Promise<unknown> => {
  let response: Response
  try {
    response = await fetch(`/_ket/fn/${encodeURIComponent(name)}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    })
  } catch (caught) {
    throw new ApiError(caught instanceof Error ? caught.message : 'network error', true)
  }
  // A proxy in front of a faulting server answers with HTML, not the JSON envelope.
  const payload = (await response.json().catch(() => ({}))) as ApiPayload
  if (!response.ok || payload.ok === false) {
    const domainError = payload.errors?.[0]
    throw new ApiError(
      string(domainError?.message ?? payload.message ?? `HTTP ${response.status}`),
      response.status >= 500,
    )
  }
  return payload.value
}

const flatten = <Option extends { id: string; label: string; options?: Option[] }>(
  options: readonly Option[],
): Option[] => options.flatMap((option) => (option.options?.length ? flatten(option.options) : [option]))

export function createSearchFilterView(props: SearchFilterIslandProps): IslandController {
  const { config } = props
  const labels = {
    clearFilters: 'Clear filters',
    close: 'Close',
    favoriteCancel: 'Cancel',
    favoriteError: 'Could not save changes to saved searches',
    valueFrom: 'From',
    valueTo: 'To',
    groupByApplied: config.labels.groupBy,
    groupByAdd: config.labels.customGroupByPlaceholder,
    groupByClear: config.labels.clear,
    groupByMoveEarlier: 'Move earlier',
    groupByMoveLater: 'Move later',
    ...config.labels,
  }
  const operatorLabel = (operator: SearchFilterOperator): string =>
    labels.operatorLabels?.[operator] ?? operatorLabels[operator]
  const capabilities = config.capabilities ?? {}
  const manager = config.manager
  const hasGrouping = capabilities.groupBy !== false && config.groupBy.length > 0
  const groupByOptions = flatten(config.groupBy)
  const fieldSuggestions = (text: string): CustomFilterField[] =>
    config.customFilterFields.filter((field) => suggestedRule(field, text))

  const facets = signal<SearchFacet[]>(config.facets)
  const favorites = signal<SearchFavorite[]>(config.favorites)
  const hasFavorites = (): boolean =>
    capabilities.favorites !== false &&
    Boolean(favorites().length || manager?.saveFavoriteFunction || config.favoriteHref)
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
  const panel = signal<'filter' | 'groupBy' | 'favorite'>('filter')
  const sheetOpen = signal(false)
  const savingFavorite = signal(false)
  const customFilterEnd = signal('')
  let sheetOpener: HTMLElement | null = null
  let menuOpener: HTMLElement | null = null
  const focusControl = (selector: string): void => {
    const control = [...(mountedRoot?.querySelectorAll(selector) ?? [])][0]
    if (typeof HTMLElement !== 'undefined' && control instanceof HTMLElement) control.focus()
  }
  const closeFavoriteForm = (): void => {
    savingFavorite.set(false)
    queueMicrotask(() => {
      if (menuOpen() || sheetOpen()) focusControl('[data-ui="favorite-save-toggle"]')
      else menuOpener?.focus()
    })
  }
  const closeMenu = (): void => {
    savingFavorite.set(false)
    menuOpen.set(false)
  }
  const dismissDisclosure = (event: KeyboardEvent): boolean => {
    const disclosure =
      event.target instanceof Element ? event.target.closest('details[data-ui="disclosure"][open]') : null
    if (!(disclosure instanceof HTMLDetailsElement)) return false
    disclosure.open = false
    const summary = disclosure.querySelector('summary')
    if (summary instanceof HTMLElement) summary.focus()
    event.preventDefault()
    event.stopPropagation()
    return true
  }
  const dialogElement = (): HTMLDialogElement | null => {
    const candidate = [...(mountedRoot?.querySelectorAll('[data-ui="search-filter-sheet"]') ?? [])][0]
    return typeof HTMLDialogElement !== 'undefined' && candidate instanceof HTMLDialogElement
      ? candidate
      : null
  }
  const closeSheet = (): void => {
    closeMenu()
    dialogElement()?.close()
    sheetOpen.set(false)
    sheetOpener?.focus()
  }
  const openPanel = (kind: 'filter' | 'groupBy' | 'favorite'): void => {
    if (panel() !== kind) savingFavorite.set(false)
    panel.set(kind)
    menuOpen.set(true)
    suggestionsOpen.set(false)
  }
  const togglePanel = (event: Event): void => {
    menuOpener = event.currentTarget as HTMLElement
    const switching = menuOpen() && panel() !== 'filter'
    if (switching) savingFavorite.set(false)
    panel.set('filter')
    suggestionsOpen.set(false)
    if (!window.matchMedia('(max-width: 640px)').matches) {
      if (switching) event.preventDefault()
      return
    }
    event.preventDefault()
    sheetOpener = event.currentTarget as HTMLElement
    closeMenu()
    sheetOpen.set(true)
    queueMicrotask(() => {
      const dialog = dialogElement()
      if (dialog && !dialog.open) {
        dialog.showModal()
        focusControl('[data-ui="search-filter-sheet"] [data-ui="modal-close"]')
      }
    })
  }
  const saveFavoriteName = signal('')
  const saveFavoriteDefault = signal(false)
  const pending = signal(false)
  const error = signal('')
  // What the rendered list actually shows. Chips change before the request goes
  // out, so a request that fails must put them back here rather than leave a
  // filter on screen that never applied.
  let settled: Draft = { facets: facets(), rules: customFilterRules() }
  const retryDraft = signal<RetryDraft | null>(null)
  let mountedRoot: IslandElement | null = null

  // `value={query()}` only writes the attribute, which a field the reader has
  // typed into no longer displays — the live property is what they see.
  const setQuery = (value: string): void => {
    query.set(value)
    if (!mountedRoot) return
    for (const input of mountedRoot.querySelectorAll('[data-ui="search-filter-input"]'))
      if (input instanceof HTMLInputElement && input.value !== value) input.value = value
  }

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
  /**
   * Sends the current facets. `consumed` is text the triggering action moved
   * out of the search field into a chip; a failed request hands it back.
   */
  const apply = async (consumed = ''): Promise<void> => {
    closeMenu()
    if (!manager?.applyFunction) return
    const version = ++applyVersion
    const attempted: Draft = { facets: facets(), rules: customFilterRules() }
    pending.set(true)
    error.set('')
    retryDraft.set(null)
    try {
      const value = (await callApi(manager.applyFunction, applyPayload())) as
        | { html?: unknown; href?: unknown }
        | undefined
      if (version !== applyVersion) return
      settled = attempted
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
      facets.set(settled.facets)
      customFilterRules.set(settled.rules)
      if (consumed && !query()) setQuery(consumed)
      if (caught instanceof ApiError && caught.retryable) retryDraft.set({ ...attempted, consumed })
      // The server's message is an English diagnostic, not copy for the reader.
      error.set(labels.applyError)
    } finally {
      if (version === applyVersion) pending.set(false)
    }
  }

  /** Sends the failed request again, chips and all, as the reader last asked for it. */
  const retry = (): void => {
    const draft = retryDraft()
    if (!draft) return
    facets.set(draft.facets)
    customFilterRules.set(draft.rules)
    if (draft.consumed && query() === draft.consumed) setQuery('')
    void apply(draft.consumed)
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

  const clearFilters = (): void => {
    facets.set(facets().filter((facet) => facet.type === 'field' || facet.type === 'groupBy'))
    customFilterRules.set({})
    void apply()
  }
  const selectedField = (): CustomFilterField | undefined =>
    config.customFilterFields.find((entry) => entry.value === customFilterField())
  const canAddRule = (): boolean => {
    const field = selectedField()
    const operator = customFilterOperator() as SearchFilterOperator
    if (!field || !operatorsFor(field.value).includes(operator)) return false
    if (isValuelessOperator(operator)) return true
    if (!customFilterValue().trim()) return false
    if (operator === 'between' && !customFilterEnd().trim()) return false
    const values =
      operator === 'between'
        ? [customFilterValue(), customFilterEnd()]
        : operator === 'anyOf'
          ? customFilterValue().split(',')
          : [customFilterValue()]
    if (field.type === 'number' && values.some((value) => !Number.isFinite(Number(value)))) return false
    if (field.choices && values.some((value) => !field.choices!.some((choice) => choice.value === value)))
      return false
    return true
  }
  const addCustomFilter = (): void => {
    const field = config.customFilterFields.find((entry) => entry.value === customFilterField())
    const operator = customFilterOperator() as SearchFilterOperator
    if (!field || !canAddRule()) return
    const value = isValuelessOperator(operator)
      ? ''
      : operator === 'between'
        ? `${customFilterValue().trim()},${customFilterEnd().trim()}`
        : customFilterValue().trim()
    const label = searchFilterRuleLabel({
      fieldLabel: field.label,
      operator,
      value,
      choices: field.choices,
      operatorLabels: labels.operatorLabels,
    })
    clearFavorite()
    const id = `custom-filter:${crypto.randomUUID()}`
    customFilterRules.set({ ...customFilterRules(), [id]: { field: field.value, operator, value } })
    facets.set([...facets(), { id, type: 'filter', label }])
    customFilterField.set('')
    customFilterOperator.set('')
    customFilterValue.set('')
    customFilterEnd.set('')
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
    setQuery('')
    suggestionsOpen.set(false)
    void apply(value)
  }

  const selectFieldSuggestion = (field: CustomFilterField): void => {
    const value = query().trim()
    const rule = value ? suggestedRule(field, value) : null
    if (!rule) return
    clearFavorite()
    const id = `custom-filter:${crypto.randomUUID()}`
    customFilterRules.set({ ...customFilterRules(), [id]: rule })
    facets.set([
      ...facets(),
      {
        id,
        type: 'filter',
        label: searchFilterRuleLabel({
          fieldLabel: field.label,
          operator: rule.operator,
          value: rule.value,
          choices: field.choices,
          operatorLabels: labels.operatorLabels,
        }),
      },
    ])
    setQuery('')
    suggestionsOpen.set(false)
    void apply(value)
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
    retryDraft.set(null)
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
      closeFavoriteForm()
    } catch {
      error.set(labels.favoriteError)
    } finally {
      pending.set(false)
    }
  }

  const removeFavorite = async (favorite: SearchFavorite): Promise<void> => {
    if (!manager?.deleteFavoriteFunction) return
    pending.set(true)
    error.set('')
    retryDraft.set(null)
    try {
      await callApi(manager.deleteFavoriteFunction, { ...(manager.applyInput ?? {}), id: favorite.id })
      favorites.set(favorites().filter((entry) => entry.id !== favorite.id))
      if (activeFavoriteId() === favorite.id)
        removeFacet({ id: favorite.id, type: 'favorite', label: favorite.label })
    } catch {
      error.set(labels.favoriteError)
    } finally {
      pending.set(false)
    }
  }

  const setDefaultFavorite = async (favorite: SearchFavorite): Promise<void> => {
    if (!manager?.setDefaultFavoriteFunction) return
    pending.set(true)
    error.set('')
    retryDraft.set(null)
    try {
      await callApi(manager.setDefaultFavoriteFunction, { ...(manager.applyInput ?? {}), id: favorite.id })
      favorites.set(favorites().map((entry) => ({ ...entry, isDefault: entry.id === favorite.id })))
    } catch {
      error.set(labels.favoriteError)
    } finally {
      pending.set(false)
    }
  }

  const facetChip = (facet: SearchFacet): TemplateResult => (
    <li data-ui="search-filter-facet" data-type={facet.type}>
      <span>
        {facet.type === 'field'
          ? `${labels.searchGenericLabel}: `
          : facet.type === 'groupBy'
            ? `${labels.groupBy}: `
            : ''}
        {facet.label}
      </span>
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

  const valueEditor = (): TemplateResult | null => {
    const field = selectedField()
    const operator = customFilterOperator() as SearchFilterOperator
    if (!field || !operator || isValuelessOperator(operator)) return null
    if (field.choices)
      return (
        <select
          aria-label={labels.customFilterValue}
          multiple={operator === 'anyOf'}
          onChange={(event) => {
            if (event.currentTarget instanceof HTMLSelectElement)
              customFilterValue.set(
                Array.from(event.currentTarget.selectedOptions)
                  .map((option) => option.value)
                  .filter(Boolean)
                  .join(','),
              )
          }}
        >
          <option value="" disabled selected={!customFilterValue()}>
            {labels.customFilterValue}
          </option>
          {each(
            field.choices,
            (choice) => choice.value,
            (choice) => (
              <option value={choice.value} selected={customFilterValue().split(',').includes(choice.value)}>
                {choice.label}
              </option>
            ),
          )}
        </select>
      )
    const type =
      field.type === 'number'
        ? 'number'
        : field.type === 'date'
          ? 'date'
          : field.type === 'datetime'
            ? 'datetime-local'
            : 'text'
    return (
      <>
        <input
          type={type}
          step={field.type === 'number' ? 'any' : undefined}
          autocomplete="off"
          aria-label={operator === 'between' ? labels.valueFrom : labels.customFilterValue}
          placeholder={labels.customFilterValue}
          value={customFilterValue()}
          onInput={(event) => {
            if (event.currentTarget instanceof HTMLInputElement)
              customFilterValue.set(event.currentTarget.value)
          }}
        />
        {operator === 'between' ? (
          <input
            type={type}
            step={field.type === 'number' ? 'any' : undefined}
            aria-label={labels.valueTo}
            value={customFilterEnd()}
            onInput={(event) => {
              if (event.currentTarget instanceof HTMLInputElement)
                customFilterEnd.set(event.currentTarget.value)
            }}
          />
        ) : null}
      </>
    )
  }
  const icon = (kind: 'filter' | 'groupBy' | 'favorite' | 'search'): TemplateResult => (
    <svg
      data-ui="search-filter-icon"
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path
        d={
          kind === 'filter'
            ? 'M4 5h16M7 12h10M10 19h4'
            : kind === 'groupBy'
              ? 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'
              : kind === 'favorite'
                ? 'M6 3h12v18l-6-4-6 4z'
                : 'M21 21l-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0'
        }
      />
    </svg>
  )
  const sectionTrigger = (kind: 'groupBy' | 'favorite', label: string): TemplateResult => (
    <button
      data-ui="search-filter-section-toggle"
      data-section={kind}
      type="button"
      aria-expanded={String(menuOpen() && panel() === kind)}
      aria-controls={`${props.id}-panel`}
      onClick={(event) => {
        event.stopPropagation()
        menuOpener = event.currentTarget as HTMLElement
        if (menuOpen() && panel() === kind) closeMenu()
        else openPanel(kind)
      }}
    >
      {icon(kind)}
      <span>{label}</span>
      {countOf(kind) ? <span data-ui="menu-trigger-count">{String(countOf(kind))}</span> : null}
    </button>
  )
  const panelContent = (): TemplateResult => (
    <div
      data-ui="search-filter-columns"
      data-columns={1 + Number(hasGrouping) + Number(hasFavorites())}
      data-panel={sheetOpen() ? 'all' : panel()}
    >
      <div data-ui="search-filter-column" data-facet-type="filter">
        {columnTitle(labels.filters, countOf('filter'))}
        {each(
          config.filters,
          (option) => option.id,
          (option, index) => filterMenuItem(option, index === 0 ? null : config.filters[index - 1]),
        )}
        {capabilities.customFilters !== false && config.customFilterFields.length > 0 && (
          <>
            <hr data-ui="menu-separator" />
            <div data-ui="custom-filter">
              <div data-ui="custom-filter-row">
                <select
                  aria-label={labels.customFilterField}
                  onChange={(event) => {
                    if (event.currentTarget instanceof HTMLSelectElement) {
                      customFilterField.set(event.currentTarget.value)
                      customFilterOperator.set('')
                      customFilterValue.set('')
                      customFilterEnd.set('')
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
                    if (event.currentTarget instanceof HTMLSelectElement) {
                      customFilterOperator.set(event.currentTarget.value)
                      customFilterValue.set('')
                      customFilterEnd.set('')
                    }
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
                        {operatorLabel(operator)}
                      </option>
                    ),
                  )}
                </select>
                {valueEditor()}
              </div>
              <button
                data-ui="custom-filter-add"
                type="button"
                disabled={!canAddRule()}
                onClick={addCustomFilter}
              >
                {labels.customFilterAdd}
              </button>
            </div>
          </>
        )}
      </div>
      {hasGrouping && (
        <div data-ui="search-filter-column" data-facet-type="groupBy">
          {columnTitle(labels.groupBy, countOf('groupBy'))}
          {groupByPipeline()}
          {config.groupBy.length ? (
            <p data-ui="search-filter-grouping-add-label">{labels.groupByAdd}</p>
          ) : null}
          {each(
            config.groupBy,
            (option) => option.id,
            (option, index) => groupByMenuItem(option, index === 0 ? null : config.groupBy[index - 1]),
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
      )}
      {hasFavorites() && (
        <div data-ui="search-filter-column" data-facet-type="favorite">
          {columnTitle(labels.favorites, activeFavoriteId() ? 1 : 0)}
          {config.favoriteHref ? (
            <a data-ui="menu-item" href={config.favoriteHref}>
              {labels.saveSearch}
            </a>
          ) : manager?.saveFavoriteFunction ? (
            <button
              data-ui="favorite-save-toggle"
              type="button"
              aria-expanded={String(savingFavorite())}
              aria-controls={`${props.id}-favorite-form`}
              onClick={() => {
                if (savingFavorite()) closeFavoriteForm()
                else {
                  savingFavorite.set(true)
                  queueMicrotask(() => focusControl('[data-ui="favorite-save"] input[type="text"]'))
                }
              }}
            >
              {labels.saveSearch}
            </button>
          ) : null}
          {manager?.saveFavoriteFunction && savingFavorite() && !config.favoriteHref ? (
            <form
              id={`${props.id}-favorite-form`}
              data-ui="favorite-save"
              aria-label={labels.saveSearch}
              onSubmit={saveFavorite}
            >
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
              <button
                data-ui="action"
                data-variant="secondary"
                type="button"
                onClick={(event) => {
                  // Removing the form also detaches this target before the shared
                  // outside-click dismissor runs. Keep cancellation inside the panel.
                  event.stopPropagation()
                  closeFavoriteForm()
                }}
              >
                {labels.favoriteCancel}
              </button>
            </form>
          ) : null}
          {favorites().length ? (
            <ul data-ui="favorite-list">{each(favorites(), (favorite) => favorite.id, favoriteRow)}</ul>
          ) : (
            <p data-ui="search-filter-empty">{labels.noFavorites}</p>
          )}
        </div>
      )}
    </div>
  )

  const notice = (): TemplateResult | null =>
    error() ? (
      <aside data-ui="notice" data-pattern="notice" data-tone="danger" role="alert">
        <div data-ui="notice-copy">
          <p data-ui="notice-message">{error()}</p>
        </div>
        {retryDraft() ? (
          <div data-ui="notice-actions">
            <button data-ui="action" data-variant="secondary" type="button" onClick={retry}>
              {labels.retry}
            </button>
          </div>
        ) : null}
      </aside>
    ) : null
  return {
    view: () => (
      <div
        data-ui="search-filter"
        role="search"
        aria-label={labels.searchLabel}
        data-name={config.name}
        data-size={config.size ?? 'default'}
        data-busy={pending() ? 'true' : null}
        onKeydown={(event: KeyboardEvent) => {
          if (event.key !== 'Escape' || sheetOpen() || !menuOpen()) return
          if (dismissDisclosure(event)) return
          event.preventDefault()
          event.stopPropagation()
          if (savingFavorite()) {
            closeFavoriteForm()
            return
          }
          closeMenu()
          queueMicrotask(() => menuOpener?.focus())
        }}
      >
        <div data-ui="search-filter-bar">
          <div data-ui="search-filter-field">
            {icon('search')}
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
                  fieldSuggestions(query().trim()),
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
            data-active={countOf('filter') ? 'true' : null}
            open={menuOpen() === true ? true : undefined}
            onToggle={(event: Event) => {
              if (!(event.currentTarget instanceof HTMLDetailsElement)) return
              if (event.currentTarget.open) menuOpen.set(true)
              else closeMenu()
            }}
          >
            <summary
              data-ui="search-filter-toggle"
              role="button"
              aria-expanded={String(sheetOpen() || (menuOpen() && panel() === 'filter'))}
              aria-label={labels.filters}
              title={labels.filters}
              onClick={togglePanel}
              aria-controls={`${props.id}-panel`}
            >
              {icon('filter')}
              <span>{labels.filters}</span>
              {countOf('filter') ? (
                <span data-ui="menu-trigger-count">{String(countOf('filter'))}</span>
              ) : null}
            </summary>
            <div
              id={`${props.id}-panel`}
              data-ui="menu-panel"
              role="group"
              aria-label={
                panel() === 'filter'
                  ? labels.filters
                  : panel() === 'groupBy'
                    ? labels.groupBy
                    : labels.favorites
              }
            >
              {!sheetOpen() ? panelContent() : null}
            </div>
          </details>
          {hasGrouping ? sectionTrigger('groupBy', labels.groupBy) : null}
          {hasFavorites() ? sectionTrigger('favorite', labels.favorites) : null}
        </div>
        {facets().length ? (
          <ul data-ui="search-filter-facets">
            {each(facets(), (facet) => facet.id, facetChip)}
            {facets().some((facet) => facet.type === 'filter' || facet.type === 'favorite') ? (
              <li>
                <button data-ui="search-filter-clear" type="button" onClick={clearFilters}>
                  {labels.clearFilters}
                </button>
              </li>
            ) : null}
          </ul>
        ) : null}
        {/* biome-ignore lint/a11y/useKeyWithClickEvents: Delegates native button clicks; onKeydown and onCancel handle Escape in the KetJS runtime. */}
        <dialog
          data-ui="search-filter-sheet"
          aria-label={labels.toggleLabel}
          onKeydown={(event: KeyboardEvent) => {
            if (event.key === 'Escape') {
              if (dismissDisclosure(event)) return
              event.preventDefault()
              event.stopPropagation()
              if (savingFavorite()) {
                closeFavoriteForm()
                return
              }
              closeSheet()
            }
          }}
          onCancel={(event: Event) => {
            event.preventDefault()
            closeSheet()
          }}
          onClick={(event) => {
            if (
              event.target instanceof Element &&
              event.target.closest('[data-ui="modal-close"], [data-ui="modal-backdrop"]')
            )
              closeSheet()
          }}
        >
          {sheetOpen() ? (
            <ModalSheet
              id={`${props.id}-sheet`}
              mode="client"
              dialogSemantics="parent"
              title={labels.toggleLabel}
              closeLabel={labels.close}
              body={
                <>
                  {notice()}
                  {panelContent()}
                </>
              }
            />
          ) : null}
        </dialog>
        {/* Below the bar, so the control the reader just used does not move under the pointer. */}
        {!sheetOpen() ? notice() : null}
      </div>
    ),
    mount: ({ root, lifetime }) => {
      mountedRoot = root
      // Autocomplete is an island-owned popup rather than a native <details>
      // disclosure, so the shared details-menu dismissor cannot see it. Keep
      // the boundary local to the component: an outside click abandons the
      // suggestions without changing the query the reader has entered.
      document.addEventListener(
        'click',
        (event) => {
          if (!suggestionsOpen() && !menuOpen()) return
          const target = event.target
          if (target instanceof Node && (root as unknown as Node).contains(target)) return
          suggestionsOpen.set(false)
          closeMenu()
        },
        { signal: lifetime },
      )
    },
    dispose: () => {
      applyVersion++
      pending.set(false)
      dialogElement()?.close()
      mountedRoot = null
    },
  }
}

export const searchFilter = (props: IslandProps): IslandController =>
  createSearchFilterView(props as SearchFilterIslandProps)
