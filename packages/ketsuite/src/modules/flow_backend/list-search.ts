import { encodeListState } from '@ketvietlab/ketjs'
import type {
  FilterOperator,
  FilterRule,
  ListSearchSpec,
  ListState,
  Route,
  ServeContext,
} from '@ketvietlab/ketjs'
import type { SearchMenu, TableGroup } from '../../ui/index.ts'

type Translator = ReturnType<ServeContext['translate']>
type AnyRow = Record<string, unknown>
type SavedGroup = { key: unknown[]; count: number }

/**
 * Direct port of crm_backend/list-search.ts's generic pieces — confirmed
 * by reading that file in full: every helper here reads the domain only
 * through passed-in function-name strings/args, never `crm.*` by name, so
 * it carries over to Flow's `issueListSearch`/`flow.issue.group`/`flow.issue.list`
 * unchanged.
 */

export const FLOW_PAGE_SIZE = 50

export const cloneListState = (state: ListState): ListState => ({
  ...state,
  presets: [...state.presets],
  filters: [...state.filters],
  groupBy: [...state.groupBy],
  sort: [...state.sort],
  openGroups: state.openGroups.map((path) => [...path]),
  groupPages: { ...state.groupPages },
})

const labelOf = (_: Translator, label: string): string => (_.resolves(label) ? _(label) : label)

export const keepForListSearch = (url: URL): Record<string, string | string[]> => {
  const keep: Record<string, string | string[]> = {}
  for (const [key, value] of url.searchParams) {
    if (['q', 'page', 'cursor', 'filterField', 'filterOp', 'filterValue', 'applyFilter'].includes(key))
      continue
    const current = keep[key]
    keep[key] =
      current === undefined ? value : Array.isArray(current) ? [...current, value] : [current, value]
  }
  return keep
}

export const customRuleOf = (url: URL, spec: ListSearchSpec): FilterRule | null => {
  if (url.searchParams.get('applyFilter') !== '1') return null
  const field = spec.filterable?.find((candidate) => candidate.key === url.searchParams.get('filterField'))
  const operator = url.searchParams.get('filterOp') as FilterOperator | null
  if (!field || !operator) return null
  const raw = url.searchParams.get('filterValue') ?? ''
  const noValue = ['isTrue', 'isFalse', 'isSet', 'isNotSet'].includes(operator)
  const value = noValue
    ? undefined
    : operator === 'anyOf'
      ? raw
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : operator === 'between'
        ? raw.split(',').map((item) => (field.type === 'number' ? Number(item.trim()) : item.trim()))
        : field.type === 'number'
          ? Number(raw)
          : raw
  return { kind: 'rule', field: field.key, operator, ...(noValue ? {} : { value }) }
}

export const listMenus = (_: Translator, url: URL, state: ListState, spec: ListSearchSpec): SearchMenu[] => {
  const href = (change: (next: ListState) => void): string => {
    const next = cloneListState(state)
    change(next)
    next.page = 1
    return encodeListState(next, url)
  }
  const presetItems = (spec.presets ?? []).map((preset) => ({
    id: `preset:${preset.key}`,
    label: labelOf(_, preset.label),
    active: state.presets.includes(preset.key),
    path: href((next) => {
      next.presets = next.presets.includes(preset.key)
        ? next.presets.filter((key) => key !== preset.key)
        : [...next.presets, preset.key]
    }),
  }))
  const groupItems = (spec.groupable ?? []).map((field) => {
    const active = state.groupBy.some((group) => group.key === field.key)
    const add = (interval?: NonNullable<ListState['groupBy'][number]['interval']>) =>
      href((next) => {
        next.groupBy = next.groupBy.filter((group) => group.key !== field.key)
        if (!active || interval) next.groupBy.push({ key: field.key, ...(interval ? { interval } : {}) })
        next.openGroups = []
        next.groupPages = {}
      })
    return field.intervals?.length
      ? {
          id: `group:${field.key}`,
          label: labelOf(_, field.label),
          children: field.intervals.map((interval) => ({
            id: `group:${field.key}:${interval}`,
            label: interval,
            active: state.groupBy.some((group) => group.key === field.key && group.interval === interval),
            path: add(interval),
          })),
        }
      : { id: `group:${field.key}`, label: labelOf(_, field.label), active, path: add() }
  })
  return [
    {
      id: 'filters',
      label: _('backend.chrome.filters'),
      items: [
        ...presetItems,
        ...(spec.filterable?.some((field) => field.key === 'active')
          ? [
              {
                id: 'archived',
                label: _('backend.chrome.includeArchived'),
                active: state.includeArchived,
                path: href((next) => {
                  next.includeArchived = !next.includeArchived
                }),
              },
            ]
          : []),
      ],
      customFilter: {
        fields: (spec.filterable ?? []).map((field) => ({
          value: field.key,
          label: labelOf(_, field.label),
        })),
        operators: [
          { value: 'contains', label: _('backend.chrome.operator.contains') },
          { value: 'equals', label: '=' },
          { value: 'notEquals', label: '≠' },
          { value: 'gte', label: '≥' },
          { value: 'lte', label: '≤' },
          { value: 'isSet', label: _('backend.chrome.operator.isSet') },
          { value: 'isNotSet', label: _('backend.chrome.operator.isNotSet') },
        ],
        fieldLabel: _('backend.chrome.customField'),
        operatorLabel: _('backend.chrome.customOperator'),
        valueLabel: _('backend.chrome.customValue'),
        applyLabel: _('backend.chrome.apply'),
      },
    },
    { id: 'group', label: _('backend.chrome.groupBy'), items: groupItems },
  ]
}

export const listFacets = (_: Translator, url: URL, state: ListState, spec: ListSearchSpec) => {
  const href = (change: (next: ListState) => void) => {
    const next = cloneListState(state)
    change(next)
    next.page = 1
    return encodeListState(next, url)
  }
  return [
    ...(state.q
      ? [{ label: `${_('backend.chrome.searchFacet')}: ${state.q}`, without: href((next) => delete next.q) }]
      : []),
    ...state.presets.map((key) => ({
      label: labelOf(_, spec.presets?.find((preset) => preset.key === key)?.label ?? key),
      without: href((next) => {
        next.presets = next.presets.filter((preset) => preset !== key)
      }),
    })),
    ...state.filters.map((filter, index) => ({
      label:
        filter.kind === 'rule'
          ? `${labelOf(_, spec.filterable?.find((field) => field.key === filter.field)?.label ?? filter.field)} ${filter.operator}`
          : `${filter.op.toUpperCase()} (…)`,
      without: href((next) => {
        next.filters.splice(index, 1)
      }),
    })),
    ...state.groupBy.map((group, index) => ({
      label: `${_('backend.chrome.groupBy')}: ${labelOf(_, spec.groupable?.find((field) => field.key === group.key)?.label ?? group.key)}${group.interval ? ` / ${group.interval}` : ''}`,
      without: href((next) => {
        next.groupBy.splice(index, 1)
        next.openGroups = []
        next.groupPages = {}
      }),
    })),
  ]
}

const startsWith = (path: unknown[], prefix: unknown[]): boolean =>
  prefix.every((value, index) => JSON.stringify(path[index]) === JSON.stringify(value))

export const loadListGroups = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  state: ListState,
  timezone: string,
  options: {
    groupFunction: string
    listFunction: string
    listArgs?: AnyRow
    label: (field: string, value: unknown) => string
  },
  path: unknown[] = [],
): Promise<TableGroup<AnyRow>[]> => {
  const groups = (await ctx.call(
    options.groupFunction,
    { ...(options.listArgs ?? {}), listState: state, path, timezone, limit: FLOW_PAGE_SIZE },
    url,
    req,
  )) as SavedGroup[]
  const selected = state.groupBy[path.length]!
  return Promise.all(
    groups.map(async (group) => {
      const value = group.key[0]
      const nextPath = [...path, value]
      const open = state.openGroups.some(
        (candidate) => startsWith(candidate, nextPath) && candidate.length === nextPath.length,
      )
      const next = cloneListState(state)
      next.openGroups = open
        ? next.openGroups.filter((candidate) => !startsWith(candidate, nextPath))
        : [...next.openGroups, nextPath]
      const children =
        open && path.length + 1 < state.groupBy.length
          ? await loadListGroups(ctx, url, req, state, timezone, options, nextPath)
          : undefined
      const pageKey = JSON.stringify(nextPath)
      const page = state.groupPages[pageKey] ?? 1
      const result =
        open && path.length + 1 === state.groupBy.length
          ? ((await ctx.call(
              options.listFunction,
              {
                ...(options.listArgs ?? {}),
                listState: state,
                path: nextPath,
                timezone,
                cursor: String((page - 1) * FLOW_PAGE_SIZE),
                limit: FLOW_PAGE_SIZE,
              },
              url,
              req,
            )) as { rows?: AnyRow[] })
          : null
      const rows = result?.rows
      const pagerHref = (target: number) => {
        const paged = cloneListState(state)
        if (target <= 1) delete paged.groupPages[pageKey]
        else paged.groupPages[pageKey] = target
        return encodeListState(paged, url)
      }
      const from = (page - 1) * FLOW_PAGE_SIZE + 1
      const to = Math.min(page * FLOW_PAGE_SIZE, Number(group.count))
      return {
        id: JSON.stringify(nextPath),
        label: options.label(selected.key, value),
        count: Number(group.count),
        depth: path.length,
        open,
        href: encodeListState(next, url),
        children,
        rows,
        pager:
          rows && Number(group.count) > FLOW_PAGE_SIZE
            ? {
                label: `${from}-${to} / ${Number(group.count)}`,
                prev: page > 1 ? pagerHref(page - 1) : undefined,
                next: to < Number(group.count) ? pagerHref(page + 1) : undefined,
              }
            : undefined,
      }
    }),
  )
}
