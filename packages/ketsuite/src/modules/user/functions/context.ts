import { defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'

import { advanceAuthorizationRevision, recordAuthorizationAudit } from '../authorization.ts'
import { issue, invalid, AUTHORIZATION_SCOPE_EFFECTS, liveIdentity, contextFor } from './shared.ts'

export async function setDefaultContextHandler(ctx: Ctx, a: Record<string, unknown>) {
  const M = ctx.table('user.Membership')
  const BM = ctx.table('user.BranchMembership')
  const B = ctx.table('company.Branch')
  const [membership, branchMembership, branch] = await Promise.all([
    ctx.db.one(from(M).where(eq(M.userId, a.userId), eq(M.companyId, a.companyId))),
    ctx.db.one(from(BM).where(eq(BM.userId, a.userId), eq(BM.branchId, a.branchId))),
    ctx.db.one(from(B).where(eq(B.id, a.branchId), eq(B.active, true))),
  ])
  if (!membership) return invalid([issue('companyId', 'user.error.companyMembership')])
  if (!branchMembership || branch?.companyId !== a.companyId)
    return invalid([issue('branchId', 'user.error.branchMembership')])
  const U = ctx.table('user.User')
  const user = await ctx.db.one(from(U).where(eq(U.id, a.userId)))
  if (user?.defaultCompanyId === a.companyId && user?.defaultBranchId === a.branchId) return { ok: true }
  return ctx.tx(async (tx) => {
    await tx.db.update(
      'user.User',
      { id: a.userId },
      { defaultCompanyId: a.companyId, defaultBranchId: a.branchId },
    )
    const revision = await advanceAuthorizationRevision(tx)
    await recordAuthorizationAudit(tx, {
      event: 'authorization.scope.default-context-changed',
      targetKind: 'user',
      targetId: String(a.userId),
      scopeKey: `branch:${String(a.companyId)}:${String(a.branchId)}`,
      source: 'default-context',
      reason: 'legacy default context compatibility',
      before: {
        companyId: user?.defaultCompanyId ?? null,
        branchId: user?.defaultBranchId ?? null,
      },
      after: { companyId: a.companyId, branchId: a.branchId },
      revision,
    })
    return { ok: true }
  })
}

export async function contextOptionsHandler(ctx: Ctx, a: Record<string, unknown>) {
  if (ctx.actor && ctx.actor !== a.userId) return invalid([issue('userId', 'user.error.contextActor')])
  const live = await liveIdentity(ctx, String(a.userId))
  if (!live) return invalid([issue('userId', 'user.error.userMissing')])
  return {
    ok: true,
    companies: live.companies.map((row) => ({
      id: row.id,
      code: row.code,
      name: (row.partner as Row | null)?.name ?? row.code,
    })),
    branches: live.branches.map((row) => ({
      id: row.id,
      companyId: row.companyId,
      code: row.code,
      name: row.name,
      isRoot: Boolean(row.rootKey),
    })),
    defaults: {
      companyId: live.user.defaultCompanyId ?? null,
      branchId: live.user.defaultBranchId ?? null,
    },
  }
}

export async function prepareContextHandler(ctx: Ctx, a: Record<string, unknown>) {
  if (ctx.actor && ctx.actor !== a.userId) return invalid([issue('userId', 'user.error.contextActor')])
  const live = await liveIdentity(ctx, String(a.userId))
  if (!live) return invalid([issue('userId', 'user.error.userMissing')])
  return contextFor(
    live,
    {
      company: a.companyId,
      branch: a.branchId,
      companies: a.companies,
      branches: a.branches,
      securityVersion: a.securityVersion,
    },
    true,
  )
}

export async function resolveSessionContextHandler(ctx: Ctx, a: Record<string, unknown>) {
  const live = await liveIdentity(ctx, String(a.userId))
  if (!live) return invalid([issue('userId', 'user.error.userMissing')])
  return contextFor(
    live,
    {
      company: a.companyId,
      branch: a.branchId,
      companies: a.companies,
      branches: a.branches,
      securityVersion: a.securityVersion,
    },
    false,
  )
}

export const contextFunctions: Record<string, FnSpec> = {
  setDefaultContext: defineFn({
    input: { userId: 'id', companyId: 'id', branchId: 'id' },
    output: { ok: 'bool', errors: 'json?' },
    effects: [
      'read:user.User',
      'write:user.User',
      'read:user.Membership',
      'read:user.BranchMembership',
      'read:company.Branch',
      ...AUTHORIZATION_SCOPE_EFFECTS,
    ],
    idempotent: true,
    handler: setDefaultContextHandler,
  }),
  contextOptions: defineFn({
    exposure: 'internal',
    anonymous: true,
    input: { userId: 'id' },
    output: {
      ok: 'bool',
      companies: 'json?',
      branches: 'json?',
      defaults: 'json?',
      errors: 'json?',
    },
    effects: [
      'read:user.User',
      'read:user.Membership',
      'read:user.BranchMembership',
      'read:company.Company',
      'read:company.Branch',
      'read:partner.Partner',
    ],
    handler: contextOptionsHandler,
  }),
  prepareContext: defineFn({
    exposure: 'internal',
    anonymous: true,
    input: {
      userId: 'id',
      companyId: 'id',
      branchId: 'id',
      companies: 'json',
      branches: 'json',
      securityVersion: 'int?',
    },
    output: { ok: 'bool', context: 'json?', errors: 'json?' },
    effects: [
      'read:user.User',
      'read:user.Membership',
      'read:user.BranchMembership',
      'read:company.Company',
      'read:company.Branch',
      'read:partner.Partner',
    ],
    handler: prepareContextHandler,
  }),
  resolveSessionContext: defineFn({
    exposure: 'internal',
    input: {
      userId: 'id',
      companyId: 'id?',
      branchId: 'id?',
      companies: 'json?',
      branches: 'json?',
      securityVersion: 'int?',
    },
    output: { ok: 'bool', context: 'json?', errors: 'json?' },
    effects: [
      'read:user.User',
      'read:user.Membership',
      'read:user.BranchMembership',
      'read:company.Company',
      'read:company.Branch',
      'read:partner.Partner',
    ],
    handler: resolveSessionContextHandler,
  }),
}
