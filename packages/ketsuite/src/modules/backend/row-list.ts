// The search-filter bar over a collection that is already in memory.
//
// Most backend lists read a complete, authorised collection from a bounded API
// and narrow it locally (see `loadCollectionRows`). Those lists have no column
// to compile a filter against, so `compileListFilter` cannot serve them — but
// everything above the filter is identical: the same URL state, the same bar,
// the same grouped table. This is that filter, evaluated over rows.
//
// A preset therefore carries a predicate where a query-backed preset carries an
// expression. Everything else is `ListSearchShape`, which is what the bar and
// `parseListState` read, so one screen is not told to describe its list twice.
import type {
  FilterNode,
  FilterOperator,
  GroupInterval,
  ListSearchShape,
  ListSort,
  ListState,
  Route,
  ServeContext,
} from '@ketvietlab/ketjs'
import { encodeListState, parseListState } from '@ketvietlab/ketjs'
import type { Frame, TableGroup } from '../../ui/index.ts'
import { listSearchFilterConfig, loadListFavorites, searchFilterBar } from './search-filter.ts'
import type { ListSearchFilterOptions } from './search-filter.ts'

export type AnyRow = Record<string, unknown>

export type RowPreset = { key: string; label: string; group: string; match: (row: AnyRow) => boolean }

export type RowListSpec = Omit<ListSearchShape, 'presets'> & {
  presets?: readonly RowPreset[]
  /**
   * How a field key reads off a row, when the row does not simply carry it —
   * a list of joined rows often shows `warehouseName` where the spec says
   * `warehouseId`.
   */
  value?: (row: AnyRow, key: string) => unknown
}

/** Names the list, and refuses a spec that names a field twice. */
export const defineRowList = <T extends RowListSpec>(spec: T): T => {
  if (!/^[a-z][a-z0-9_.-]*$/.test(spec.key)) throw new Error(`invalid list key "${spec.key}"`)
  for (const collection of [spec.searchable, spec.filterable, spec.groupable, spec.sortable]) {
    const keys = (collection ?? []).map((field) => field.key)
    if (new Set(keys).size !== keys.length) throw new Error(`duplicate field key in ${spec.key}`)
  }
  return Object.freeze(spec)
}

const fieldValue = (spec: RowListSpec, row: AnyRow, key: string): unknown =>
  spec.value ? spec.value(row, key) : row[key]

const text = (value: unknown): string =>
  value == null ? '' : typeof value === 'string' ? value : String(value)

const numeric = (value: unknown): number => Number(text(value))

const matchesRule = (
  spec: RowListSpec,
  row: AnyRow,
  field: string,
  operator: FilterOperator,
  raw: unknown,
): boolean => {
  const value = fieldValue(spec, row, field)
  const type = spec.filterable?.find((candidate) => candidate.key === field)?.type
  const lower = text(value).toLocaleLowerCase()
  const asked = Array.isArray(raw) ? raw.map(text) : text(raw)
  const one = Array.isArray(asked) ? (asked[0] ?? '') : asked
  switch (operator) {
    case 'contains':
      return lower.includes(one.toLocaleLowerCase())
    case 'notContains':
      return !lower.includes(one.toLocaleLowerCase())
    case 'startsWith':
      return lower.startsWith(one.toLocaleLowerCase())
    case 'equals':
      return type === 'number' ? numeric(value) === Number(one) : text(value) === one
    case 'notEquals':
      return type === 'number' ? numeric(value) !== Number(one) : text(value) !== one
    case 'gt':
      return type === 'number' ? numeric(value) > Number(one) : text(value) > one
    case 'gte':
      return type === 'number' ? numeric(value) >= Number(one) : text(value) >= one
    case 'lt':
      return type === 'number' ? numeric(value) < Number(one) : text(value) < one
    case 'lte':
      return type === 'number' ? numeric(value) <= Number(one) : text(value) <= one
    case 'between': {
      const [from, to] = Array.isArray(asked) ? asked : [asked, asked]
      return type === 'number'
        ? numeric(value) >= Number(from) && numeric(value) < Number(to)
        : text(value) >= text(from) && text(value) < text(to)
    }
    case 'anyOf':
      return (Array.isArray(asked) ? asked : [asked]).includes(text(value))
    case 'isTrue':
      return value === true || text(value) === 'true'
    case 'isFalse':
      return value === false || text(value) === 'false'
    case 'isSet':
      return value != null && text(value) !== ''
    case 'isNotSet':
      return value == null || text(value) === ''
    default:
      return true
  }
}

const matchesNode = (spec: RowListSpec, row: AnyRow, node: FilterNode): boolean =>
  node.kind === 'group'
    ? node.op === 'and'
      ? node.children.every((child) => matchesNode(spec, row, child))
      : node.children.some((child) => matchesNode(spec, row, child))
    : matchesRule(spec, row, node.field, node.operator, node.value)

const compare = (spec: RowListSpec, left: AnyRow, right: AnyRow, sort: ListSort): number => {
  const a = fieldValue(spec, left, sort.key)
  const b = fieldValue(spec, right, sort.key)
  const numbers = typeof a === 'number' && typeof b === 'number'
  const result = numbers
    ? (a as number) - (b as number)
    : text(a).localeCompare(text(b), undefined, { numeric: true })
  return sort.dir === 'desc' ? -result : result
}

/**
 * The rows the viewer asked for: searched, narrowed by presets and rules,
 * archived rows dropped unless asked for, and sorted.
 *
 * Presets in one group are alternatives and different groups accumulate, which
 * is how a query-backed list compiles them too.
 */
export const applyRowListState = <R extends AnyRow>(
  spec: RowListSpec,
  state: ListState,
  rows: readonly R[],
): R[] => {
  const query = (state.q ?? '').trim().toLocaleLowerCase()
  const searchKeys = (spec.searchable ?? []).map((field) => field.key)
  const presetGroups = new Map<string, RowPreset[]>()
  for (const key of state.presets) {
    const preset = spec.presets?.find((candidate) => candidate.key === key)
    if (!preset) continue
    presetGroups.set(preset.group, [...(presetGroups.get(preset.group) ?? []), preset])
  }
  const archivable = spec.filterable?.some((field) => field.key === 'active')
  const kept = rows.filter((row) => {
    if (
      query &&
      !searchKeys.some((key) =>
        text(fieldValue(spec, row, key))
          .toLocaleLowerCase()
          .includes(query),
      )
    )
      return false
    for (const group of presetGroups.values()) if (!group.some((preset) => preset.match(row))) return false
    if (archivable && !state.includeArchived && fieldValue(spec, row, 'active') === false) return false
    return state.filters.every((node) => matchesNode(spec, row, node))
  })
  const sort = state.sort.length ? state.sort : (spec.defaultSort ?? [])
  if (!sort.length) return [...kept]
  return [...kept].sort((left, right) => {
    for (const entry of sort) {
      const result = compare(spec, left, right, entry)
      if (result !== 0) return result
    }
    return 0
  })
}

const INTERVAL_LENGTH: Record<GroupInterval, number> = {
  day: 10,
  week: 10,
  month: 7,
  quarter: 7,
  year: 4,
}

/** The bucket a row falls in, which for a date is the interval it starts. */
export const rowGroupKey = (
  spec: RowListSpec,
  row: AnyRow,
  key: string,
  interval?: GroupInterval,
): unknown => {
  const value = fieldValue(spec, row, key)
  if (!interval) return value ?? null
  const iso = value instanceof Date ? value.toISOString() : text(value)
  if (!iso) return null
  if (interval === 'quarter') {
    const month = Number(iso.slice(5, 7))
    return `${iso.slice(0, 4)}-Q${Math.floor((month - 1) / 3) + 1}`
  }
  if (interval === 'week') {
    const date = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return null
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7))
    return date.toISOString().slice(0, 10)
  }
  return iso.slice(0, INTERVAL_LENGTH[interval])
}

export const ROW_LIST_PAGE_SIZE = 50

/**
 * The grouped table the viewer's group-by asks for, nested as deeply as they
 * grouped, with each open leaf carrying its own page of rows.
 */
export const rowListGroups = <R extends AnyRow>(
  spec: RowListSpec,
  state: ListState,
  rows: readonly R[],
  url: URL,
  label: (key: string, value: unknown) => string,
  path: unknown[] = [],
): TableGroup<R>[] => {
  const level = state.groupBy[path.length]
  if (!level) return []
  const buckets = new Map<string, { value: unknown; rows: R[] }>()
  for (const row of rows) {
    const value = rowGroupKey(spec, row, level.key, level.interval)
    const id = JSON.stringify(value ?? null)
    const bucket = buckets.get(id) ?? { value, rows: [] }
    bucket.rows.push(row)
    buckets.set(id, bucket)
  }
  const startsWith = (candidate: unknown[], prefix: unknown[]): boolean =>
    prefix.every((value, index) => JSON.stringify(candidate[index]) === JSON.stringify(value))
  const nextState = (change: (next: ListState) => void): ListState => {
    const next: ListState = {
      ...state,
      presets: [...state.presets],
      filters: [...state.filters],
      groupBy: [...state.groupBy],
      sort: [...state.sort],
      openGroups: state.openGroups.map((entry) => [...entry]),
      groupPages: { ...state.groupPages },
    }
    change(next)
    return next
  }
  return [...buckets.values()]
    .sort((left, right) => text(left.value).localeCompare(text(right.value), undefined, { numeric: true }))
    .map((bucket) => {
      const nextPath = [...path, bucket.value ?? null]
      const open = state.openGroups.some(
        (candidate) => candidate.length === nextPath.length && startsWith(candidate, nextPath),
      )
      const toggled = nextState((next) => {
        next.openGroups = open
          ? next.openGroups.filter((candidate) => !startsWith(candidate, nextPath))
          : [...next.openGroups, nextPath]
      })
      const leaf = path.length + 1 === state.groupBy.length
      const pageKey = JSON.stringify(nextPath)
      const page = state.groupPages[pageKey] ?? 1
      const offset = (page - 1) * ROW_LIST_PAGE_SIZE
      const pagerHref = (target: number): string =>
        encodeListState(
          nextState((next) => {
            if (target <= 1) delete next.groupPages[pageKey]
            else next.groupPages[pageKey] = target
          }),
          url,
        )
      const to = Math.min(offset + ROW_LIST_PAGE_SIZE, bucket.rows.length)
      return {
        id: pageKey,
        label: label(level.key, bucket.value),
        count: bucket.rows.length,
        depth: path.length,
        open,
        href: encodeListState(toggled, url),
        children: open && !leaf ? rowListGroups(spec, state, bucket.rows, url, label, nextPath) : undefined,
        rows: open && leaf ? bucket.rows.slice(offset, to) : undefined,
        pager:
          open && leaf && bucket.rows.length > ROW_LIST_PAGE_SIZE
            ? {
                label: `${offset + 1}-${to} / ${bucket.rows.length}`,
                prev: page > 1 ? pagerHref(page - 1) : undefined,
                next: to < bucket.rows.length ? pagerHref(page + 1) : undefined,
              }
            : undefined,
      }
    })
}

/**
 * Everything a route needs to put the search-filter bar over an in-memory
 * collection: the frame carrying the bar, the rows the viewer asked for, and
 * the grouped table when they grouped.
 *
 * A screen keeps rendering `rows` when nothing is grouped, because a grouped
 * table carries its own rows inside each open group.
 */
export const rowListSearch = async <R extends AnyRow>(
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  options: {
    spec: RowListSpec
    rows: readonly R[]
    frame: Frame
    /** The bar's name, and the id of the list body it replaces on apply. */
    name: string
    bodyId: string
    functions: ListSearchFilterOptions['functions']
    labels?: ListSearchFilterOptions['labels']
    /** How a group's value reads in the reader's language. */
    groupLabel?: (key: string, value: unknown) => string
  },
): Promise<{
  frame: Frame
  rows: R[]
  state: ListState
  groups?: TableGroup<R>[]
}> => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const { spec } = options
  const { state } = parseListState(spec, url)
  const favorites = await loadListFavorites(ctx, url, req, spec, state)
  const rows = applyRowListState(spec, state, options.rows)
  const label =
    options.groupLabel ??
    ((key: string, value: unknown) => {
      const message = `${spec.key}.group.${key}.${text(value)}`
      return _.resolves(message) ? _(message) : text(value) || _('backend.chrome.groupEmpty')
    })
  const groups = state.groupBy.length ? rowListGroups(spec, state, rows, url, label) : undefined
  const bar = await searchFilterBar(
    ctx,
    url,
    req,
    options.name,
    listSearchFilterConfig(_, {
      name: options.name,
      bodyId: options.bodyId,
      spec,
      state,
      favorites,
      labels: options.labels,
      applyInput: { listKey: spec.key, returnTo: `${url.pathname}${url.search}` },
      functions: options.functions,
    }),
  )
  return {
    frame: {
      ...options.frame,
      collectionUrl: `${url.pathname}${url.search}`,
      chrome: { ...options.frame.chrome, search: null, searchContent: bar },
    },
    rows: groups ? [] : rows,
    state,
    ...(groups ? { groups } : {}),
  }
}
