import { each, signal } from '@ketvietlab/ketjs-view'
import type { IslandController, IslandProps, TemplateResult } from '@ketvietlab/ketjs-view'
import { Avatar, Badge, Code } from '../../primitives/status/index.tsx'
import type { Tone } from '../../primitives/status/index.tsx'
import { EmptyState, Notice } from '../../primitives/feedback/index.tsx'
import { FormattedDate, FormattedMoney, FormattedNumber } from '../../record/formatted-values/index.tsx'

export const HOOKS = [
  'ket-table',
  'kt-scroll',
  'kt-grid',
  'kt-select-col',
  'kt-select-all',
  'kt-col',
  'kt-sort-button',
  'kt-sort-icon',
  'kt-row',
  'kt-cell',
  'kt-person',
  'kt-select-cell',
  'kt-row-select',
  'kt-row-link',
  'kt-group-row',
  'kt-group-cell',
  'kt-group-toggle',
  'kt-group-indent',
  'kt-group-count',
  'kt-pager',
  'kt-pager-label',
  'kt-pager-button',
  'kt-select-persisted',
] as const

export type KetTableRow = Record<string, unknown>

/**
 * A cell's shape as data, not code — a column's `format` has to cross the
 * island's server/browser props boundary as JSON (see `IslandController`),
 * so unlike a plain SSR table there is no `cell: (row) => JSX` closure here.
 * `custom` is the escape hatch for anything the other 7 kinds can't express.
 */
export type KetTableCellFormat =
  | { kind: 'text'; field: string }
  | { kind: 'number'; field: string; minimumFractionDigits?: number; maximumFractionDigits?: number }
  | { kind: 'currency'; field: string; currency: string }
  | { kind: 'date'; field: string }
  | { kind: 'status'; field: string; tones: Record<string, { label: string; tone: Tone }> }
  | { kind: 'identifier'; field: string }
  | { kind: 'person'; field: string }
  | { kind: 'link'; field: string; hrefField: string }
  | { kind: 'custom'; field: string; renderer: string; options?: Record<string, unknown> }

export type KetTableColumn = {
  key: string
  label: string
  format: KetTableCellFormat
  align?: 'start' | 'end'
  priority?: 'primary' | 'secondary' | 'tertiary'
  width?: 'narrow' | 'medium' | 'wide'
  sortable?: boolean
}

export type KetTableSort = { field: string; direction: 'asc' | 'desc' }

/**
 * `listFunction` is the only RPC a sort or page change ever calls — over the
 * same `callApi`/`/_ket/fn/` contract `relation-select`/`search-filter`
 * already use. There is deliberately no `countFunction` here: `listInput`
 * never changes from inside KetTable itself, so the row count it would
 * recompute is always the one `KetTableConfig.total` already holds from the
 * page's own initial render — the caller counts once, server-side, the same
 * way it already builds that first page. `groupFunction` is only needed when
 * `KetTableConfig.groupBy` is non-empty.
 */
export type KetTableManager = {
  listFunction: string
  groupFunction?: string
  listInput?: Record<string, unknown>
  pageSize?: number
}

/**
 * Targets an *external* form by id — e.g. a screen's existing bulk-action
 * form. Each selected row becomes a hidden `{fieldName}.{id}` input targeting
 * that form, the same "selected.<id>" convention ketsuite's own bulk-action
 * forms already parse — so a form built for that convention needs no change.
 */
export type KetTableSelection = {
  formId: string
  fieldName?: string
}

/**
 * One group level's node. Reuses the same shape design-system's SSR
 * `TableGroup` and ketsuite's `loadListGroups` already return — `children`
 * (subgroups) or `rows` (a leaf group's rows) are absent until that node is
 * expanded and fetched, or until the caller pre-populates them statically
 * (a manager-less demo can supply an already-open tree with no RPC needed).
 */
export type KetTableGroup = {
  id: string
  label: string
  count: number
  children?: KetTableGroup[]
  rows?: KetTableRow[]
}

export type KetTableLabels = {
  selectAll: string
  selectRow: string
  sortedAscending: string
  sortedDescending: string
  previousPage: string
  nextPage: string
  loading: string
  loadError: string
  retry: string
  empty: string
  emptyHint: string
}

export type KetTableConfig = {
  columns: KetTableColumn[]
  /** First page, server-rendered — ignored once `groupBy` is non-empty. */
  rows: KetTableRow[]
  total: number
  idField: string
  /** A `{id}`-interpolated href, replacing a function-typed `rowHref` that couldn't cross the props boundary. */
  rowHrefTemplate?: string
  /** The active group-by keys, in order — the array `search-filter`'s active Group By facets already produce. Empty ⇒ a flat table. */
  groupBy?: string[]
  /** The server-rendered top level, when `groupBy` is non-empty. */
  groups?: KetTableGroup[]
  selection?: KetTableSelection
  manager: KetTableManager
  labels: KetTableLabels
}

export type KetTableExtensions = Record<
  string,
  (value: unknown, row: KetTableRow, options: Record<string, unknown> | undefined) => TemplateResult
>

type KetTableIslandProps = IslandProps & { id: string; config: KetTableConfig }
type ApiPayload = { ok?: boolean; value?: unknown; message?: unknown; errors?: Array<{ message?: unknown }> }

const string = (value: unknown): string => (value == null ? '' : String(value))

/**
 * Below 10,000, the exact count. At or above it, rounded down to the nearest
 * 10,000 and shown as an open-ended "≥" figure (`"110K+"`) instead of the
 * exact number — a filtered COUNT over a very large table is expensive
 * enough that callers are expected to cache it (see `partner.countPartners`
 * for the pattern), and a cached count is itself already a snapshot, so
 * presenting it as exact would overstate a precision nobody is maintaining.
 */
const formatApproxCount = (total: number): string =>
  total < 10_000 ? String(total) : `${Math.floor(total / 10_000) * 10}K+`

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

const pathKey = (path: readonly string[]): string => JSON.stringify(path)

/** Replaces the node identified by `path` (matching each level's `id`) via `updater`. */
const updateNodeAt = (
  nodes: readonly KetTableGroup[],
  path: readonly string[],
  updater: (node: KetTableGroup) => KetTableGroup,
): KetTableGroup[] => {
  const [head, ...rest] = path
  return nodes.map((node) => {
    if (node.id !== head) return node
    return rest.length
      ? { ...node, children: updateNodeAt(node.children ?? [], rest, updater) }
      : updater(node)
  })
}

export function createKetTableView(
  props: KetTableIslandProps,
  extensions?: KetTableExtensions,
): IslandController {
  const { config } = props
  const labels = config.labels
  const manager = config.manager
  const pageSize = manager.pageSize ?? 50
  const columns = config.columns

  const rows = signal<KetTableRow[]>(config.rows ?? [])
  const total = signal(config.total ?? 0)
  const page = signal(1)
  const sort = signal<KetTableSort | null>(null)
  const groupBy = signal<string[]>(config.groupBy ?? [])
  const groups = signal<KetTableGroup[]>(config.groups ?? [])
  // Top-level groups start open — a screen without any JS running (this
  // island unhydrated, e.g. a static catalogue snapshot) would otherwise show
  // an entirely empty table; a reader can still collapse from here once the
  // page does hydrate.
  const openGroups = signal<Set<string>>(new Set((config.groups ?? []).map((node) => pathKey([node.id]))))
  const selectedIds = signal<Set<string>>(new Set())
  const loading = signal(false)
  const error = signal('')

  const isGrouped = (): boolean => groupBy().length > 0
  // Flat `sortField`/`sortDirection` scalars, matching the manager RPCs'
  // own input schema convention (e.g. `partner.listPartners`) rather than a
  // nested object those schemas would need extra shape to accept.
  const sortParams = (): { sortField?: string; sortDirection?: 'asc' | 'desc' } => {
    const current = sort()
    return current ? { sortField: current.field, sortDirection: current.direction } : {}
  }
  const idOf = (row: KetTableRow): string => string(row[config.idField])
  const isSelected = (row: KetTableRow): boolean => selectedIds().has(idOf(row))

  const toggleSelect = (row: KetTableRow): void => {
    const id = idOf(row)
    const next = new Set(selectedIds())
    if (next.has(id)) next.delete(id)
    else next.add(id)
    selectedIds.set(next)
  }

  const visibleRows = (): KetTableRow[] => (isGrouped() ? flattenVisibleRows(groups(), []) : rows())

  const flattenVisibleRows = (nodes: readonly KetTableGroup[], path: readonly string[]): KetTableRow[] =>
    nodes.flatMap((node) => {
      if (!openGroups().has(pathKey([...path, node.id]))) return []
      return [...(node.rows ?? []), ...flattenVisibleRows(node.children ?? [], [...path, node.id])]
    })

  const allVisibleSelected = (): boolean => {
    const visible = visibleRows()
    return visible.length > 0 && visible.every(isSelected)
  }

  const toggleSelectAllVisible = (): void => {
    const visible = visibleRows().map(idOf)
    const allSelected = visible.every((id) => selectedIds().has(id))
    const next = new Set(selectedIds())
    for (const id of visible) {
      if (allSelected) next.delete(id)
      else next.add(id)
    }
    selectedIds.set(next)
  }

  const fetchFlat = async (): Promise<void> => {
    if (!manager.listFunction) return
    loading.set(true)
    error.set('')
    try {
      // `limit`/`offset`, not `page`/`pageSize` — the same pagination shape
      // ketsuite's other manager RPCs (e.g. `relation-select`'s) already use.
      const input = {
        ...(manager.listInput ?? {}),
        ...sortParams(),
        limit: pageSize,
        offset: (page() - 1) * pageSize,
      }
      // No `countFunction` call here: `manager.listInput` never changes from
      // inside KetTable itself (sort/page are the only client-driven state),
      // so the row count a sort or page change would recompute is always the
      // same one `total` already holds from the initial config — recounting
      // on every click would just repeat the same expensive query for free.
      const listValue = await callApi(manager.listFunction, input)
      rows.set(Array.isArray(listValue) ? (listValue as KetTableRow[]) : [])
    } catch (caught) {
      error.set(caught instanceof Error ? caught.message : labels.loadError)
    } finally {
      loading.set(false)
    }
  }

  const toggleSort = (column: KetTableColumn): void => {
    if (!column.sortable || isGrouped()) return
    const current = sort()
    sort.set(
      !current || current.field !== column.key
        ? { field: column.key, direction: 'asc' }
        : current.direction === 'asc'
          ? { field: column.key, direction: 'desc' }
          : null,
    )
    page.set(1)
    void fetchFlat()
  }

  const goToPage = (target: number): void => {
    if (target < 1 || isGrouped()) return
    page.set(target)
    void fetchFlat()
  }

  const nodeAt = (path: readonly string[]): KetTableGroup | null => {
    let level = groups()
    let node: KetTableGroup | null = null
    for (const id of path) {
      node = level.find((candidate) => candidate.id === id) ?? null
      if (!node) return null
      level = node.children ?? []
    }
    return node
  }

  const fetchGroupLevel = async (path: readonly string[]): Promise<void> => {
    const depth = path.length
    const keys = groupBy()
    loading.set(true)
    error.set('')
    try {
      if (depth === keys.length) {
        if (!manager.listFunction) return
        const value = (await callApi(manager.listFunction, {
          ...(manager.listInput ?? {}),
          groupBy: keys,
          groupPath: path,
          ...sortParams(),
        })) as unknown
        groups.set(
          updateNodeAt(groups(), path, (node) => ({
            ...node,
            rows: Array.isArray(value) ? (value as KetTableRow[]) : [],
          })),
        )
      } else {
        if (!manager.groupFunction) return
        const value = (await callApi(manager.groupFunction, {
          ...(manager.listInput ?? {}),
          groupBy: keys,
          path,
        })) as Array<{ id: string; label: string; count: number }>
        groups.set(
          updateNodeAt(groups(), path, (node) => ({
            ...node,
            children: (value ?? []).map((child) => ({
              id: child.id,
              label: child.label,
              count: child.count,
            })),
          })),
        )
      }
    } catch (caught) {
      error.set(caught instanceof Error ? caught.message : labels.loadError)
    } finally {
      loading.set(false)
    }
  }

  const toggleGroup = (path: readonly string[]): void => {
    const key = pathKey(path)
    const next = new Set(openGroups())
    if (next.has(key)) {
      next.delete(key)
      openGroups.set(next)
      return
    }
    next.add(key)
    openGroups.set(next)
    const node = nodeAt(path)
    if (node && node.children === undefined && node.rows === undefined) void fetchGroupLevel(path)
  }

  const rowHrefFor = (row: KetTableRow): string =>
    config.rowHrefTemplate ? config.rowHrefTemplate.replace('{id}', encodeURIComponent(idOf(row))) : ''

  const renderCell = (row: KetTableRow, format: KetTableCellFormat): TemplateResult => {
    const value = row[format.field]
    switch (format.kind) {
      case 'text':
        return <>{string(value)}</>
      case 'number':
        return typeof value === 'number' ? (
          <FormattedNumber
            value={value}
            minimumFractionDigits={format.minimumFractionDigits}
            maximumFractionDigits={format.maximumFractionDigits}
          />
        ) : (
          <>—</>
        )
      case 'currency':
        return typeof value === 'number' ? (
          <FormattedMoney value={value} currency={format.currency} />
        ) : (
          <>—</>
        )
      case 'date':
        return <FormattedDate value={string(value)} />
      case 'status': {
        const entry = format.tones[string(value)]
        return entry ? <Badge label={entry.label} tone={entry.tone} /> : <>{string(value)}</>
      }
      case 'identifier':
        return value ? <Code value={string(value)} /> : <>—</>
      case 'person':
        return (
          <span data-ui="kt-person">
            <Avatar name={string(value)} />
            <span>{string(value)}</span>
          </span>
        )
      case 'link':
        return (
          <a data-ui="kt-row-link" href={string(row[format.hrefField])}>
            {string(value)}
          </a>
        )
      case 'custom': {
        const renderer = extensions?.[format.renderer]
        return renderer ? renderer(value, row, format.options) : <>{string(value)}</>
      }
    }
  }

  const tableRow = (row: KetTableRow): TemplateResult => (
    <tr data-ui="kt-row" data-row={idOf(row)} data-selected={isSelected(row) ? 'true' : null}>
      {config.selection ? (
        <td data-ui="kt-select-cell">
          <input
            data-ui="kt-row-select"
            type="checkbox"
            checked={isSelected(row)}
            aria-label={`${labels.selectRow}: ${idOf(row)}`}
            onChange={() => toggleSelect(row)}
          />
        </td>
      ) : null}
      {each(
        columns,
        (column) => column.key,
        (column, index) => (
          <td
            data-ui="kt-cell"
            data-col={column.key}
            data-align={column.align ?? 'start'}
            data-priority={column.priority ?? 'secondary'}
          >
            {index === 0 && config.rowHrefTemplate ? (
              <a data-ui="kt-row-link" href={rowHrefFor(row)}>
                {renderCell(row, column.format)}
              </a>
            ) : (
              renderCell(row, column.format)
            )}
          </td>
        ),
      )}
    </tr>
  )

  const groupSpan = (): number => columns.length + (config.selection ? 1 : 0)

  const groupRowView = (node: KetTableGroup, path: readonly string[], depth: number): TemplateResult => {
    const open = openGroups().has(pathKey(path))
    return (
      <>
        <tr data-ui="kt-group-row" data-depth={String(depth)}>
          <td data-ui="kt-group-cell" colSpan={String(groupSpan())}>
            <button
              data-ui="kt-group-toggle"
              type="button"
              aria-expanded={String(open)}
              onClick={() => toggleGroup(path)}
            >
              <span data-ui="kt-group-indent" style={`--kt-group-depth: ${depth}`} aria-hidden="true" />
              <span aria-hidden="true">{open ? '▾' : '▸'}</span>
              <span>{node.label}</span>
              <span data-ui="kt-group-count">{String(node.count)}</span>
            </button>
          </td>
        </tr>
        {open && node.children
          ? each(
              node.children,
              (child) => child.id,
              (child) => groupRowView(child, [...path, child.id], depth + 1),
            )
          : null}
        {open && node.rows ? each(node.rows, idOf, tableRow) : null}
      </>
    )
  }

  const columnHeader = (column: KetTableColumn): TemplateResult => {
    const active = sort()?.field === column.key
    const direction = active ? (sort()?.direction ?? null) : null
    return (
      <th
        data-ui="kt-col"
        data-col={column.key}
        data-align={column.align ?? 'start'}
        data-priority={column.priority ?? 'secondary'}
        data-width={column.width ?? null}
        aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : null}
        scope="col"
      >
        {column.sortable ? (
          <button data-ui="kt-sort-button" type="button" onClick={() => toggleSort(column)}>
            <span>{column.label}</span>
            {direction ? (
              <span
                data-ui="kt-sort-icon"
                aria-hidden="true"
                title={direction === 'asc' ? labels.sortedAscending : labels.sortedDescending}
              >
                {direction === 'asc' ? '↑' : '↓'}
              </span>
            ) : null}
          </button>
        ) : (
          column.label
        )}
      </th>
    )
  }

  const pagerView = (): TemplateResult => {
    const totalPages = Math.max(1, Math.ceil(total() / pageSize))
    const from = total() === 0 ? 0 : (page() - 1) * pageSize + 1
    const to = Math.min(page() * pageSize, total())
    return (
      <div data-ui="kt-pager">
        <span data-ui="kt-pager-label">{`${from}–${to} / ${formatApproxCount(total())}`}</span>
        <button
          data-ui="kt-pager-button"
          data-direction="prev"
          type="button"
          disabled={page() <= 1}
          aria-label={labels.previousPage}
          onClick={() => goToPage(page() - 1)}
        >
          ‹
        </button>
        <button
          data-ui="kt-pager-button"
          data-direction="next"
          type="button"
          disabled={page() >= totalPages}
          aria-label={labels.nextPage}
          onClick={() => goToPage(page() + 1)}
        >
          ›
        </button>
      </div>
    )
  }

  const persistedInputs = (): TemplateResult | null =>
    config.selection ? (
      <div data-ui="kt-select-persisted" aria-hidden="true">
        {each(
          [...selectedIds()],
          (id) => id,
          (id) => (
            <input
              type="hidden"
              name={`${config.selection?.fieldName ?? 'selected'}.${id}`}
              value="1"
              form={config.selection?.formId}
            />
          ),
        )}
      </div>
    ) : null

  return {
    view: () => (
      <div data-ui="ket-table" data-busy={loading() ? 'true' : null}>
        {error() ? (
          <Notice
            tone="danger"
            title={labels.loadError}
            message={error()}
            actions={
              <button type="button" onClick={() => void (isGrouped() ? undefined : fetchFlat())}>
                {labels.retry}
              </button>
            }
          />
        ) : null}
        {persistedInputs()}
        {!isGrouped() && rows().length === 0 ? (
          <EmptyState title={labels.empty} message={labels.emptyHint} />
        ) : (
          <div data-ui="kt-scroll">
            <table data-ui="kt-grid">
              <thead>
                <tr>
                  {config.selection ? (
                    <th data-ui="kt-select-col" scope="col">
                      <input
                        data-ui="kt-select-all"
                        type="checkbox"
                        checked={allVisibleSelected()}
                        aria-label={labels.selectAll}
                        onChange={toggleSelectAllVisible}
                      />
                    </th>
                  ) : null}
                  {each(columns, (column) => column.key, columnHeader)}
                </tr>
              </thead>
              <tbody>
                {isGrouped()
                  ? each(
                      groups(),
                      (node) => node.id,
                      (node) => groupRowView(node, [node.id], 0),
                    )
                  : each(rows(), idOf, tableRow)}
              </tbody>
            </table>
          </div>
        )}
        {!isGrouped() ? pagerView() : null}
      </div>
    ),
    dispose: () => {
      loading.set(false)
    },
  }
}

export const ketTable = (props: IslandProps): IslandController =>
  createKetTableView(props as KetTableIslandProps)
