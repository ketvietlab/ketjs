import type { Ctx, Row } from '@ketvietlab/ketjs'
import { n, normalized } from '../domain/command.ts'

/** Small pickers read this shape: active first, filtered by name, capped to a page. */
export const optionRows = async (
  ctx: Ctx,
  model: string,
  args: Record<string, unknown>,
  order?: (a: Row, b: Row) => number,
): Promise<Row[]> => {
  const rows = await ctx.db.select(model, args.includeArchived === true ? {} : { active: true })
  const needle = normalized(args.search)
  return rows
    .filter(
      (row) => !needle || normalized(row.name).includes(needle) || normalized(row.code).includes(needle),
    )
    .sort(
      (a, b) =>
        (order ? order(a, b) : 0) ||
        String(a.name ?? '').localeCompare(String(b.name ?? '')) ||
        String(a.id).localeCompare(String(b.id)),
    )
    .slice(
      Math.max(0, n(args.cursor ?? 0)),
      Math.max(0, n(args.cursor ?? 0)) + Math.max(1, Math.min(200, n(args.limit ?? 80))),
    )
}
