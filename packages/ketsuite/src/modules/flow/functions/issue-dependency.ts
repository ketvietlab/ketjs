import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { addDependency } from '../domain/issue-dependency.ts'
import { readableRow } from '../membership.ts'
import { invalid, issue } from '../domain/command.ts'
import { defineFn, deleteFrom, eq } from '@ketvietlab/ketjs'
import { membershipEffects } from './effects.ts'

export function issueDependencyAddHandler(ctx: Ctx, args: Record<string, unknown>) {
  return addDependency(ctx, {
    id: String(args.id),
    issueId: String(args.issueId),
    dependsOnIssueId: String(args.dependsOnIssueId),
    relation: String(args.relation),
    idempotencyKey: String(args.idempotencyKey),
  })
}

export async function issueDependencyRemoveHandler(ctx: Ctx, args: Record<string, unknown>) {
  const existing = (await ctx.db.select('flow.IssueDependency', { id: args.id }))[0]
  // The edge carries no project of its own, so it is read through the issue
  // it hangs off — cutting a link between two issues is editing the project
  // they are in, and needs the same standing as anything else there.
  if (!existing || !(await readableRow(ctx, 'flow.Issue', existing.issueId)))
    return invalid(issue('id', 'flow.error.notFound'))
  const D = ctx.table('flow.IssueDependency')
  await ctx.db.del(deleteFrom(D).where(eq(D.id, args.id)))
  return { ok: true, id: args.id }
}

export const issueDependencyFunctions: Record<string, FnSpec> = {
  'issue.dependency.add': defineFn({
    input: { id: 'id', issueId: 'id', dependsOnIssueId: 'id', relation: 'text', idempotencyKey: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:flow.Issue',
      'read:flow.IssueDependency',
      'write:flow.IssueDependency',
      ...membershipEffects,
    ],
    idempotent: true,
    agent: true,
    handler: issueDependencyAddHandler,
  }),
  'issue.dependency.remove': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:flow.IssueDependency',
      'write:flow.IssueDependency',
      'read:flow.Issue',
      ...membershipEffects,
    ],
    idempotent: true,
    agent: true,
    handler: issueDependencyRemoveHandler,
  }),
}
