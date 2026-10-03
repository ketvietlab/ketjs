import { defineFn, deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'

import { advanceAuthorizationRevision, recordAuthorizationAudit } from '../authorization.ts'
import { issue, invalid, AUTHORIZATION_SCOPE_EFFECTS } from './shared.ts'

export async function grantCompanyHandler(ctx: Ctx, a: Record<string, unknown>) {
  const U = ctx.table('user.User')
  const C = ctx.table('company.Company')
  const heldUser = await ctx.db.one(from(U).where(eq(U.id, a.userId)))
  if (!heldUser) return invalid([issue('userId', 'user.error.userMissing')])
  const heldCompany = await ctx.db.one(from(C).where(eq(C.id, a.companyId), eq(C.active, true)))
  if (!heldCompany) return invalid([issue('companyId', 'user.error.companyMissing')])
  const B = ctx.table('company.Branch')
  const root = await ctx.db.one(from(B).where(eq(B.rootKey, a.companyId), eq(B.active, true)))
  if (!root) return invalid([issue('companyId', 'user.error.rootBranchMissing')])

  return ctx.tx(async (tx) => {
    const M = tx.table('user.Membership')
    const existing = await tx.db.one(from(M).where(eq(M.userId, a.userId), eq(M.companyId, a.companyId)))
    const membershipId = String(existing?.id ?? a.id)
    const membership = existing
      ? null
      : await tx.db.insertIfAbsent('user.Membership', {
          id: membershipId,
          userId: a.userId,
          companyId: a.companyId,
        })
    const branchMembership = await tx.db.insertIfAbsent('user.BranchMembership', {
      id: `root:${a.userId}:${root.id}`,
      userId: a.userId,
      branchId: root.id,
    })
    const patch: Row = {}
    if (!heldUser.defaultCompanyId) patch.defaultCompanyId = a.companyId
    if (!heldUser.defaultBranchId || !heldUser.defaultCompanyId) patch.defaultBranchId = root.id
    if (Object.keys(patch).length) await tx.db.update('user.User', { id: a.userId }, patch)
    const changed =
      Boolean(membership && ('dryRun' in membership || membership.inserted)) ||
      'dryRun' in branchMembership ||
      branchMembership.inserted ||
      Object.keys(patch).length > 0
    if (changed) {
      const revision = await advanceAuthorizationRevision(tx)
      await recordAuthorizationAudit(tx, {
        event: 'authorization.scope.company-granted',
        targetKind: 'user',
        targetId: String(a.userId),
        scopeKey: `company:${String(a.companyId)}`,
        source: 'membership',
        reason: 'legacy company membership compatibility',
        before: { membership: existing?.id ?? null },
        after: { membershipId, rootBranchId: root.id, defaults: patch },
        revision,
      })
    }
    return { ok: true, id: membershipId }
  })
}

export async function revokeCompanyHandler(ctx: Ctx, a: Record<string, unknown>) {
  const U = ctx.table('user.User')
  const heldUser = await ctx.db.one(from(U).where(eq(U.id, a.userId)))
  if (heldUser?.active === true && heldUser.defaultCompanyId === a.companyId)
    return invalid([issue('companyId', 'user.error.defaultCompanyRevoke')])
  return ctx.tx(async (tx) => {
    const B = tx.table('company.Branch')
    const branchIds = (await tx.db.all(from(B).where(eq(B.companyId, a.companyId)))).map((row) => row.id)
    let branchChanges = 0
    if (branchIds.length) {
      const BM = tx.table('user.BranchMembership')
      branchChanges = (
        await tx.db.del(deleteFrom(BM).where(eq(BM.userId, a.userId), inArray(BM.branchId, branchIds)))
      ).changes
    }
    const M = tx.table('user.Membership')
    const { changes } = await tx.db.del(
      deleteFrom(M).where(eq(M.userId, a.userId), eq(M.companyId, a.companyId)),
    )
    if (changes || branchChanges) {
      const revision = await advanceAuthorizationRevision(tx)
      await recordAuthorizationAudit(tx, {
        event: 'authorization.scope.company-revoked',
        targetKind: 'user',
        targetId: String(a.userId),
        scopeKey: `company:${String(a.companyId)}`,
        source: 'membership',
        reason: 'legacy company membership compatibility',
        before: { membership: changes, branchMemberships: branchChanges },
        after: null,
        revision,
      })
    }
    return { ok: true, removed: changes }
  })
}

export async function grantBranchHandler(ctx: Ctx, a: Record<string, unknown>) {
  const U = ctx.table('user.User')
  if (!(await ctx.db.one(from(U).where(eq(U.id, a.userId)))))
    return invalid([issue('userId', 'user.error.userMissing')])
  const B = ctx.table('company.Branch')
  const branch = await ctx.db.one(from(B).where(eq(B.id, a.branchId), eq(B.active, true)))
  if (!branch) return invalid([issue('branchId', 'user.error.branchMissing')])
  const M = ctx.table('user.Membership')
  if (!(await ctx.db.one(from(M).where(eq(M.userId, a.userId), eq(M.companyId, branch.companyId)))))
    return invalid([issue('branchId', 'user.error.branchCompanyMembership')])
  return ctx.tx(async (tx) => {
    const inserted = await tx.db.insertIfAbsent('user.BranchMembership', {
      id: a.id,
      userId: a.userId,
      branchId: a.branchId,
    })
    if (!('dryRun' in inserted) && !inserted.inserted) {
      const BM = tx.table('user.BranchMembership')
      const held = await tx.db.one(from(BM).where(eq(BM.userId, a.userId), eq(BM.branchId, a.branchId)))
      return { ok: true, id: held?.id }
    }
    const revision = await advanceAuthorizationRevision(tx)
    await recordAuthorizationAudit(tx, {
      event: 'authorization.scope.branch-granted',
      targetKind: 'user',
      targetId: String(a.userId),
      scopeKey: `branch:${String(branch.companyId)}:${String(a.branchId)}`,
      source: 'branch-membership',
      reason: 'legacy branch membership compatibility',
      before: null,
      after: { id: a.id, branchId: a.branchId },
      revision,
    })
    return { ok: true, id: a.id }
  })
}

export async function revokeBranchHandler(ctx: Ctx, a: Record<string, unknown>) {
  const U = ctx.table('user.User')
  const user = await ctx.db.one(from(U).where(eq(U.id, a.userId)))
  if (user?.active === true && user.defaultBranchId === a.branchId)
    return invalid([issue('branchId', 'user.error.defaultBranchRevoke')])
  return ctx.tx(async (tx) => {
    const BM = tx.table('user.BranchMembership')
    const B = tx.table('company.Branch')
    const branch = await tx.db.one(from(B).where(eq(B.id, a.branchId)))
    const { changes } = await tx.db.del(
      deleteFrom(BM).where(eq(BM.userId, a.userId), eq(BM.branchId, a.branchId)),
    )
    if (changes) {
      const revision = await advanceAuthorizationRevision(tx)
      await recordAuthorizationAudit(tx, {
        event: 'authorization.scope.branch-revoked',
        targetKind: 'user',
        targetId: String(a.userId),
        scopeKey: `branch:${String(branch?.companyId ?? 'unknown')}:${String(a.branchId)}`,
        source: 'branch-membership',
        reason: 'legacy branch membership compatibility',
        before: { branchId: a.branchId },
        after: null,
        revision,
      })
    }
    return { ok: true, removed: changes }
  })
}

export async function archiveCompanyHandler(ctx: Ctx, a: Record<string, unknown>) {
  const C = ctx.table('company.Company')
  const company = await ctx.db.one(from(C).where(eq(C.id, a.id)))
  if (!company) return invalid([issue('id', 'company.error.missing')])
  const currentVersion = Number(company.version ?? 0)
  if (company.active === a.active)
    return {
      ok: true,
      id: a.id,
      active: company.active,
      version: currentVersion,
    }
  if (a.expectedVersion != null && currentVersion !== Number(a.expectedVersion))
    return invalid([issue('expectedVersion', 'company.error.versionConflict')])
  if (a.active === false) {
    const U = ctx.table('user.User')
    if (await ctx.db.one(from(U).where(eq(U.defaultCompanyId, a.id), eq(U.active, true))))
      return invalid([issue('active', 'user.error.companyDefaultActive')])
    if ((await ctx.db.count(from(C).where(eq(C.active, true)))) <= 1)
      return invalid([issue('active', 'company.error.lastActive')])
  }
  const version = currentVersion + 1
  const changed = await ctx.db.compareAndSet(
    'company.Company',
    { id: a.id },
    { version: company.version ?? null },
    { active: a.active, version },
  )
  if (!('dryRun' in changed) && !changed.matched)
    return invalid([issue('expectedVersion', 'company.error.versionConflict')])
  return { ok: true, id: a.id, active: a.active, version }
}

export async function archiveBranchHandler(ctx: Ctx, a: Record<string, unknown>) {
  const B = ctx.table('company.Branch')
  const branch = await ctx.db.one(from(B).where(eq(B.id, a.id)))
  if (!branch) return invalid([issue('id', 'company.error.branchMissing')])
  if (a.active === false) {
    if (branch.rootKey) return invalid([issue('active', 'company.error.rootArchive')])
    const U = ctx.table('user.User')
    if (await ctx.db.one(from(U).where(eq(U.defaultBranchId, a.id), eq(U.active, true))))
      return invalid([issue('active', 'user.error.branchDefaultActive')])
    const active = await ctx.db.count(from(B).where(eq(B.companyId, branch.companyId), eq(B.active, true)))
    if (active <= 1) return invalid([issue('active', 'company.error.lastBranch')])
  } else {
    const C = ctx.table('company.Company')
    if (!(await ctx.db.one(from(C).where(eq(C.id, branch.companyId), eq(C.active, true)))))
      return invalid([issue('active', 'user.error.branchCompanyArchived')])
  }
  await ctx.db.update('company.Branch', { id: a.id }, { active: a.active })
  return { ok: true, id: a.id, active: a.active }
}

export const workplacesFunctions: Record<string, FnSpec> = {
  grantCompany: defineFn({
    input: { id: 'id', userId: 'id', companyId: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:user.User',
      'write:user.User',
      'read:company.Company',
      'read:company.Branch',
      'read:user.Membership',
      'write:user.Membership',
      'read:user.BranchMembership',
      'write:user.BranchMembership',
      ...AUTHORIZATION_SCOPE_EFFECTS,
    ],
    idempotent: true,
    handler: grantCompanyHandler,
  }),
  revokeCompany: defineFn({
    input: { userId: 'id', companyId: 'id' },
    output: { ok: 'bool', removed: 'int?', errors: 'json?' },
    effects: [
      'read:user.User',
      'read:user.Membership',
      'write:user.Membership',
      'read:user.BranchMembership',
      'write:user.BranchMembership',
      'read:company.Branch',
      ...AUTHORIZATION_SCOPE_EFFECTS,
    ],
    idempotent: true,
    handler: revokeCompanyHandler,
  }),
  grantBranch: defineFn({
    input: { id: 'id', userId: 'id', branchId: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:user.User',
      'read:user.Membership',
      'read:user.BranchMembership',
      'write:user.BranchMembership',
      'read:company.Branch',
      ...AUTHORIZATION_SCOPE_EFFECTS,
    ],
    idempotent: true,
    handler: grantBranchHandler,
  }),
  revokeBranch: defineFn({
    input: { userId: 'id', branchId: 'id' },
    output: { ok: 'bool', removed: 'int?', errors: 'json?' },
    effects: [
      'read:user.User',
      'read:user.BranchMembership',
      'write:user.BranchMembership',
      'read:company.Branch',
      ...AUTHORIZATION_SCOPE_EFFECTS,
    ],
    idempotent: true,
    handler: revokeBranchHandler,
  }),
  archiveCompany: defineFn({
    input: { id: 'id', active: 'bool', expectedVersion: 'int?' },
    output: {
      ok: 'bool',
      id: 'id?',
      active: 'bool?',
      version: 'int?',
      errors: 'json?',
    },
    effects: ['read:user.User', 'read:company.Company', 'write:company.Company'],
    idempotent: true,
    handler: archiveCompanyHandler,
  }),
  archiveBranch: defineFn({
    input: { id: 'id', active: 'bool' },
    output: { ok: 'bool', id: 'id?', active: 'bool?', errors: 'json?' },
    effects: ['read:user.User', 'read:company.Company', 'read:company.Branch', 'write:company.Branch'],
    idempotent: true,
    handler: archiveBranchHandler,
  }),
}
