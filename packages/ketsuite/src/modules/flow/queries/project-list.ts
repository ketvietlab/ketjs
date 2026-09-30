import type { Ctx, Row } from '@ketvietlab/ketjs'
import { visibleProjects } from '../membership.ts'
import { projectsWithMyWork } from '../projects.ts'
import { normalized } from '../domain/command.ts'

/** Project visibility and collection filters must run before either paging or counting. */
export const matchingProjects = async (ctx: Ctx, args: Record<string, unknown>): Promise<Row[]> => {
  const visible = await visibleProjects(ctx)
  if (visible !== null && !visible.length) return []
  const visibleIds = visible === null ? null : new Set(visible)
  const mine = args.mine === true ? await projectsWithMyWork(ctx) : null
  const needle = normalized(args.search)
  const rows = await ctx.db.select(
    'flow.Project',
    args.archivedOnly === true ? { active: false } : args.includeArchived === true ? {} : { active: true },
  )
  return rows
    .filter(
      (row) =>
        (visibleIds === null || visibleIds.has(String(row.id))) &&
        (mine === null || mine.has(String(row.id))) &&
        (!needle || normalized(row.name).includes(needle) || normalized(row.key).includes(needle)),
    )
    .sort(
      (a, b) =>
        String(a.name ?? '').localeCompare(String(b.name ?? '')) || String(a.id).localeCompare(String(b.id)),
    )
}
