import {
  and,
  or,
  eq,
  inArray,
  from,
  asc,
  desc,
  compileListFilter,
  defineListSearch,
  bucketEq,
  isNull,
} from '@ketvietlab/ketjs'
import type { Ctx, ListState, FilterNode, Expr } from '@ketvietlab/ketjs'
import { company } from './scope.ts'

/** SQL-backed workbench; never materialize the order history to display one page. */
export async function orderPage(ctx: Ctx, args: Record<string, any>) {
  const O = ctx.table('sale.Order'),
    P = ctx.table('partner.Partner')
  const state = args.listState as ListState
  const timezone = String(args.timezone ?? 'Asia/Ho_Chi_Minh')
  const empty: ListState = {
    presets: [],
    filters: [],
    groupBy: [],
    sort: [],
    openGroups: [],
    groupPages: {},
    page: 1,
    includeArchived: false,
  }
  const fields = [
    { key: 'name', label: 'Name', col: O.name, type: 'text' as const },
    { key: 'dateOrder', label: 'Date', col: O.dateOrder, type: 'datetime' as const },
    {
      key: 'invoiceStatus',
      label: 'Invoice status',
      col: O.invoiceStatus,
      type: 'selection' as const,
      choices: ['no', 'upselling', 'invoiced', 'to invoice'],
    },
    { key: 'locked', label: 'Locked', col: O.locked, type: 'boolean' as const },
    { key: 'amountTotal', label: 'Amount', col: O.amountTotal, type: 'number' as const },
  ]
  const spec = defineListSearch({
    key: 'sale.orders',
    searchable: [{ key: 'name', col: O.name }],
    filterable: fields,
    groupable: [
      { key: 'invoiceStatus', label: 'Status', col: O.invoiceStatus },
      { key: 'partnerName', label: 'Customer', col: O.partnerId },
      { key: 'dateOrder', label: 'Date', col: O.dateOrder, intervals: ['day', 'week', 'month'] },
    ],
    sortable: fields.filter((f) => ['name', 'dateOrder', 'amountTotal'].includes(f.key)),
    presets: [
      ...['no', 'upselling', 'invoiced', 'to invoice'].map((v) => ({
        key: v,
        label: v,
        group: 'invoiceStatus',
        expr: eq(O.invoiceStatus, v),
      })),
      { key: 'locked', label: 'Locked', group: 'locked', expr: eq(O.locked, true) },
      { key: 'unlocked', label: 'Unlocked', group: 'locked', expr: eq(O.locked, false) },
    ],
  })
  const partnerSpec = defineListSearch({
    key: 'sale.customer_names',
    searchable: [{ key: 'partnerName', col: P.name }],
    filterable: [{ key: 'partnerName', label: 'Customer', col: P.name, type: 'text' }],
    sortable: [],
  })
  const partnerMatch = async (input: ListState): Promise<Expr> => {
    const expr = compileListFilter(partnerSpec, input, { timezone })
    const rows = await ctx.db.all(
      from(P)
        .select(P.id)
        .where(...(expr ? [expr] : [])),
    )
    return inArray(
      O.partnerId,
      rows.map((row) => String(row.id)),
    )
  }
  const filter = async (node: FilterNode): Promise<Expr> => {
    if (node.kind === 'group') {
      const children = await Promise.all(node.children.map(filter))
      return node.op === 'and' ? and(...children) : or(...children)
    }
    if (node.field === 'partnerName') return partnerMatch({ ...empty, filters: [node] })
    return compileListFilter(spec, { ...empty, filters: [node] }, { timezone })!
  }
  let query = from(O).where(eq(O.companyId, company(ctx)), eq(O.state, String(args.state ?? 'sale')))
  const preset = compileListFilter(spec, { ...empty, presets: state.presets ?? [] }, { timezone })
  if (preset) query = query.where(preset)
  if (state.q)
    query = query.where(
      or(
        compileListFilter(spec, { ...empty, q: state.q }, { timezone })!,
        await partnerMatch({ ...empty, q: state.q }),
      ),
    )
  for (const node of state.filters ?? []) query = query.where(await filter(node))
  const path = Array.isArray(args.path) ? args.path : []
  for (let i = 0; i < path.length; i++) {
    const selected = state.groupBy[i],
      field = spec.groupable?.find((f) => f.key === selected?.key)
    if (!field) throw Error('Invalid order group')
    query = query.where(
      path[i] == null
        ? isNull(field.col)
        : selected.interval
          ? bucketEq(field.col, selected.interval, timezone, String(path[i]))
          : eq(field.col, path[i]),
    )
  }
  if (args.listMode === 'groups') {
    const selected = state.groupBy[path.length],
      field = spec.groupable?.find((f) => f.key === selected?.key)
    if (!field) return []
    return ctx.db.group(
      query
        .groupBy({ col: field.col, interval: selected.interval, timezone })
        .orderGroupsBy({ by: 'key', dir: 'asc' })
        .limit(50),
    )
  }
  const total = await ctx.db.count(query)
  if (args.listMode === 'count') return { rows: [], total }
  for (const sort of state.sort?.length ? state.sort : [{ key: 'dateOrder', dir: 'desc' }]) {
    const field = spec.sortable?.find((f) => f.key === sort.key)
    if (field) query = query.orderBy(sort.dir === 'asc' ? asc(field.col) : desc(field.col))
  }
  query = query
    .orderBy(desc(O.id))
    .limit(50)
    .offset(Math.max(0, Number(args.cursor ?? (state.page - 1) * 50) || 0))
  const rows = await ctx.db.all(query)
  const ids = [...new Set(rows.map((r) => String(r.partnerId)))]
  const partners = ids.length ? await ctx.db.all(from(P).select(P.id, P.name).where(inArray(P.id, ids))) : []
  const names = new Map(partners.map((r) => [String(r.id), r.name]))
  return {
    rows: rows.map((row) => ({ ...row, partnerName: names.get(String(row.partnerId)) ?? '—' })),
    total,
  }
}
