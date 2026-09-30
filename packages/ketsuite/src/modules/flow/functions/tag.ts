import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { optionRows } from '../queries/options.ts'
import { defineFn, deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import { invalid, issue, n } from '../domain/command.ts'

export async function tagListHandler(ctx: Ctx, args: Record<string, unknown>) {
  const rows = await optionRows(ctx, 'flow.Tag', args)
  if (!rows.length) return rows
  const IT = ctx.table('flow.IssueTag')
  // Every row, archived issues included, because that is what `tag.archive`
  // deletes. A count that quietly skipped archived work would understate
  // exactly the thing the reader is about to lose.
  //
  // Counted across every project on purpose, membership notwithstanding.
  // The figure exists to answer "what will archiving this destroy", and
  // archiving a tag clears it from every project at once (FLW-DEC-006) — a
  // count narrowed to the reader's own projects would understate the damage
  // and make the warning a lie. What it gives away is one number about work
  // the reader cannot otherwise see, which is the price of the warning
  // being true. See the exception list in flow-membership.test.ts.
  const groups = await ctx.db.group(
    from(IT)
      .where(
        inArray(
          IT.tagId!,
          rows.map((row) => String(row.id)),
        ),
      )
      .groupBy({ col: IT.tagId! }),
  )
  const counted = new Map(groups.map((group) => [String(group.key[0] ?? ''), n(group.count)]))
  return rows.map((row) => ({ ...row, usage: counted.get(String(row.id)) ?? 0 }))
}

export async function tagSaveHandler(ctx: Ctx, args: Record<string, unknown>) {
  const name = String(args.name ?? '').trim()
  if (!name) return invalid(issue('name', 'flow.error.required'))
  const existing = (await ctx.db.select('flow.Tag', { id: args.id }))[0]
  const clash = (await ctx.db.select('flow.Tag', { name })).find((row) => row.id !== args.id)
  if (clash) return invalid(issue('name', 'flow.error.duplicateName'))
  const values = {
    name,
    color: args.color ? String(args.color) : (existing?.color ?? null),
    active: args.active ?? existing?.active ?? true,
  }
  if (existing) await ctx.db.update('flow.Tag', { id: args.id }, values)
  else await ctx.db.insert('flow.Tag', { id: args.id, ...values })
  return { ok: true, id: args.id }
}

export async function tagArchiveHandler(ctx: Ctx, args: Record<string, unknown>) {
  const existing = (await ctx.db.select('flow.Tag', { id: args.id }))[0]
  if (!existing) return invalid(issue('id', 'flow.error.notFound'))
  await ctx.db.update('flow.Tag', { id: args.id }, { active: false })
  const IT = ctx.table('flow.IssueTag')
  await ctx.db.del(deleteFrom(IT).where(eq(IT.tagId, args.id)))
  return { ok: true, id: args.id }
}

export const tagFunctions: Record<string, FnSpec> = {
  /**
   * Every tag, with how much work in the company carries it.
   *
   * The count is here rather than on the screen because of what archiving a tag
   * does: it deletes every `IssueTag` row for it, across every project, and
   * cannot be undone. The block that offers that button sits inside a *project's*
   * settings — so the number is the only thing that says how far the button
   * reaches. One grouped query, not one count per tag.
   */
  'tag.list': defineFn({
    input: { search: 'text?', limit: 'int?', includeArchived: 'bool?' },
    output: { id: 'id', name: 'text', color: 'text?', active: 'bool', usage: 'int' },
    effects: ['read:flow.Tag', 'read:flow.IssueTag'],
    agent: true,
    handler: tagListHandler,
  }),
  'tag.save': defineFn({
    input: { id: 'id', name: 'text', color: 'text?', active: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.Tag', 'write:flow.Tag'],
    idempotent: true,
    agent: true,
    handler: tagSaveHandler,
  }),
  'tag.archive': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:flow.Tag', 'write:flow.Tag', 'read:flow.IssueTag', 'write:flow.IssueTag'],
    idempotent: true,
    agent: true,
    handler: tagArchiveHandler,
  }),
}
