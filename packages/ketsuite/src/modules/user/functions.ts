import { asc, defineFn, deleteFrom, eq, from, inArray } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { hashPassword, needsRehash, verifyPassword } from './password.ts'
import { roleFunctions } from './roles.ts'

type Issue = { field: string; code: string; params?: Record<string, unknown> }
const issue = (field: string, code: string, params?: Record<string, unknown>): Issue => ({
  field,
  code,
  ...(params ? { params } : {}),
})
const invalid = (errors: Issue[]) => ({ ok: false, errors })

type LiveIdentity = {
  user: Row
  companies: Row[]
  branches: Row[]
}

const liveIdentity = async (ctx: Ctx, userId: string): Promise<LiveIdentity | null> => {
  const U = ctx.table('user.User')
  const user = await ctx.db.one(from(U).where(eq(U.id, userId), eq(U.active, true)))
  if (!user) return null
  const M = ctx.table('user.Membership')
  const companyIds = (await ctx.db.all(from(M).where(eq(M.userId, userId)))).map((row) => row.companyId)
  if (!companyIds.length) return { user, companies: [], branches: [] }
  const C = ctx.table('company.Company')
  const companies = await ctx.db.all(
    from(C).where(inArray(C.id, companyIds), eq(C.active, true)).orderBy(asc(C.code)).preload('partner'),
  )
  const allowedCompanies = new Set(companies.map((row) => row.id))
  const BM = ctx.table('user.BranchMembership')
  const branchIds = (await ctx.db.all(from(BM).where(eq(BM.userId, userId)))).map((row) => row.branchId)
  if (!branchIds.length) return { user, companies, branches: [] }
  const B = ctx.table('company.Branch')
  const branches = (
    await ctx.db.all(from(B).where(inArray(B.id, branchIds), eq(B.active, true)).orderBy(asc(B.code)))
  ).filter((row) => allowedCompanies.has(row.companyId))
  return { user, companies, branches }
}

const requestedIds = (value: unknown): string[] | null =>
  Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : null

const contextFor = (
  live: LiveIdentity,
  requested: {
    companies?: unknown
    company?: unknown
    branches?: unknown
    branch?: unknown
    securityVersion?: unknown
  },
  strict: boolean,
) => {
  const allowedCompanies = new Set(live.companies.map((row) => String(row.id)))
  const askedCompanies = requestedIds(requested.companies)
  let companies = (askedCompanies ?? [...allowedCompanies]).filter((id) => allowedCompanies.has(id))
  const preferredCompany = String(requested.company ?? live.user.defaultCompanyId ?? '')
  let company = companies.includes(preferredCompany) ? preferredCompany : ''
  if (!company && !strict) {
    const fallback = String(live.user.defaultCompanyId ?? '')
    company = allowedCompanies.has(fallback) ? fallback : (companies[0] ?? [...allowedCompanies][0] ?? '')
    if (company && !companies.includes(company)) companies = [...companies, company]
  }
  if (!company || !companies.length)
    return invalid([issue('companyId', strict ? 'user.error.contextCompany' : 'user.error.noLiveCompany')])

  const allowedBranches = new Map(
    live.branches
      .filter((row) => companies.includes(String(row.companyId)))
      .map((row) => [String(row.id), row]),
  )
  const askedBranches = requestedIds(requested.branches)
  let branches = (askedBranches ?? [...allowedBranches.keys()]).filter((id) => allowedBranches.has(id))
  const preferredBranch = String(requested.branch ?? live.user.defaultBranchId ?? '')
  let branch =
    branches.includes(preferredBranch) && allowedBranches.get(preferredBranch)?.companyId === company
      ? preferredBranch
      : ''
  if (!branch && !strict) {
    const fallback = String(live.user.defaultBranchId ?? '')
    branch =
      allowedBranches.get(fallback)?.companyId === company
        ? fallback
        : (branches.find((id) => allowedBranches.get(id)?.companyId === company) ?? '')
    if (branch && !branches.includes(branch)) branches = [...branches, branch]
  }
  if (!branch)
    return invalid([issue('branchId', strict ? 'user.error.contextBranch' : 'user.error.noLiveBranch')])
  return {
    ok: true,
    context: {
      companies,
      company,
      branches,
      branch,
      securityVersion: Number(requested.securityVersion ?? 0),
    },
  }
}

/**
 * Not one of these declares `password` in its output, which is what keeps the hash
 * inside the server: the projection picks declared fields, so a handler that
 * returned the whole row would still hand back only what is named here.
 */
export const functions: Record<string, FnSpec> = {
  ...roleFunctions,

  listUsers: defineFn({
    input: { includeArchived: 'bool?' },
    output: {
      id: 'id',
      login: 'text',
      name: 'text',
      email: 'text?',
      partnerId: 'id?',
      defaultCompanyId: 'id?',
      defaultBranchId: 'id?',
      active: 'bool',
      superuser: 'bool',
    },
    effects: ['read:user.User'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      const q = from(U).orderBy(asc(U.login))
      return ctx.db.all(a.includeArchived === true ? q : q.where(eq(U.active, true)))
    },
  }),

  getUser: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      login: 'text',
      name: 'text',
      email: 'text?',
      lang: 'text?',
      partnerId: 'id?',
      defaultCompanyId: 'id?',
      defaultBranchId: 'id?',
      active: 'bool',
      superuser: 'bool',
      memberships: 'json?',
    },
    effects: ['read:user.User', 'read:user.Membership'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      return ctx.db.one(from(U).where(eq(U.id, a.id)).preload('memberships'))
    },
  }),

  createUser: defineFn({
    input: {
      id: 'id',
      login: 'text',
      password: 'text',
      name: 'text',
      email: 'text?',
      partnerId: 'id?',
      defaultCompanyId: 'id?',
      defaultBranchId: 'id?',
      superuser: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:user.User', 'write:user.User'],
    idempotent: true,
    // Deliberately not an agent tool: an agent that can mint logins is an agent
    // that can mint itself one.
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      if (await ctx.db.one(from(U).where(eq(U.login, a.login)))) {
        return { ok: false, errors: [{ field: 'login', message: 'tên đăng nhập đã tồn tại' }] }
      }
      if (String(a.password).length < 8) {
        return { ok: false, errors: [{ field: 'password', message: 'mật khẩu phải dài ít nhất 8 ký tự' }] }
      }
      const cs = ctx
        .change('user.User', { ...a, password: await hashPassword(String(a.password)) }, null)
        .cast([
          'id',
          'login',
          'password',
          'name',
          'email',
          'partnerId',
          'defaultCompanyId',
          'defaultBranchId',
        ])
        .required(['login', 'password', 'name'])
        .put('active', true)
        .put('superuser', a.superuser === true)
      if (!cs.valid) return { ok: false, errors: cs.errors }
      await ctx.db.commit(cs)
      return { ok: true, id: a.id }
    },
  }),

  /**
   * Changing a password takes the old one, even for an administrator acting on
   * their own account: a session someone walked away from should not be enough.
   */
  setPassword: defineFn({
    input: { id: 'id', currentPassword: 'text', newPassword: 'text' },
    output: { ok: 'bool', errors: 'json?' },
    effects: ['read:user.User', 'write:user.User'],
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      const row = await ctx.db.one(from(U).where(eq(U.id, a.id)))
      if (!row || !(await verifyPassword(String(a.currentPassword), String(row.password)))) {
        return { ok: false, errors: [{ field: 'currentPassword', message: 'mật khẩu hiện tại không đúng' }] }
      }
      if (String(a.newPassword).length < 8) {
        return { ok: false, errors: [{ field: 'newPassword', message: 'mật khẩu phải dài ít nhất 8 ký tự' }] }
      }
      await ctx.db.update('user.User', { id: a.id }, {
        password: await hashPassword(String(a.newPassword)),
      } as Row)
      return { ok: true }
    },
  }),

  /**
   * The one function that reads a password hash, and it returns a verdict rather
   * than a row. It also answers the same way for an unknown login and a wrong
   * password: telling those apart is how an attacker enumerates accounts.
   */
  authenticate: defineFn({
    // There is no session yet — checking the password is how one begins.
    anonymous: true,
    input: { login: 'text', password: 'text' },
    output: {
      ok: 'bool',
      userId: 'id?',
      companies: 'json?',
      defaultCompanyId: 'id?',
      branches: 'json?',
      defaultBranchId: 'id?',
      rehash: 'bool?',
    },
    effects: [
      'read:user.User',
      'read:user.Membership',
      'read:user.BranchMembership',
      'read:company.Company',
      'read:company.Branch',
      'read:partner.Partner',
    ],
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      const row = await ctx.db.one(from(U).where(eq(U.login, a.login), eq(U.active, true)))
      if (!row) {
        // Verify against nothing anyway, so a missing account does not answer
        // faster than a wrong password.
        await verifyPassword(String(a.password), 'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA')
        return { ok: false }
      }
      if (!(await verifyPassword(String(a.password), String(row.password)))) return { ok: false }

      const live = await liveIdentity(ctx, String(row.id))
      const companies = live?.companies.map((company) => String(company.id)) ?? []
      const branches = live?.branches.map((branch) => String(branch.id)) ?? []
      const defaultCompanyId = companies.includes(String(row.defaultCompanyId ?? ''))
        ? String(row.defaultCompanyId)
        : (companies[0] ?? null)
      const defaultBranchId =
        branches.find(
          (id) =>
            id === String(row.defaultBranchId ?? '') &&
            live?.branches.find((branch) => String(branch.id) === id)?.companyId === defaultCompanyId,
        ) ??
        live?.branches.find((branch) => branch.companyId === defaultCompanyId)?.id ??
        null
      return {
        ok: true,
        userId: row.id,
        companies,
        defaultCompanyId,
        branches,
        defaultBranchId,
        rehash: needsRehash(String(row.password)),
      }
    },
  }),

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
    ],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
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
        if (!existing)
          await tx.db.insertIfAbsent('user.Membership', {
            id: membershipId,
            userId: a.userId,
            companyId: a.companyId,
          })
        await tx.db.insertIfAbsent('user.BranchMembership', {
          id: `root:${a.userId}:${root.id}`,
          userId: a.userId,
          branchId: root.id,
        })
        const patch: Row = {}
        if (!heldUser.defaultCompanyId) patch.defaultCompanyId = a.companyId
        if (!heldUser.defaultBranchId || !heldUser.defaultCompanyId) patch.defaultBranchId = root.id
        if (Object.keys(patch).length) await tx.db.update('user.User', { id: a.userId }, patch)
        return { ok: true, id: membershipId }
      })
    },
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
    ],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      const heldUser = await ctx.db.one(from(U).where(eq(U.id, a.userId)))
      if (heldUser?.active === true && heldUser.defaultCompanyId === a.companyId)
        return invalid([issue('companyId', 'user.error.defaultCompanyRevoke')])
      return ctx.tx(async (tx) => {
        const B = tx.table('company.Branch')
        const branchIds = (await tx.db.all(from(B).where(eq(B.companyId, a.companyId)))).map((row) => row.id)
        if (branchIds.length) {
          const BM = tx.table('user.BranchMembership')
          await tx.db.del(deleteFrom(BM).where(eq(BM.userId, a.userId), inArray(BM.branchId, branchIds)))
        }
        const M = tx.table('user.Membership')
        const { changes } = await tx.db.del(
          deleteFrom(M).where(eq(M.userId, a.userId), eq(M.companyId, a.companyId)),
        )
        return { ok: true, removed: changes }
      })
    },
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
    ],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      if (!(await ctx.db.one(from(U).where(eq(U.id, a.userId)))))
        return invalid([issue('userId', 'user.error.userMissing')])
      const B = ctx.table('company.Branch')
      const branch = await ctx.db.one(from(B).where(eq(B.id, a.branchId), eq(B.active, true)))
      if (!branch) return invalid([issue('branchId', 'user.error.branchMissing')])
      const M = ctx.table('user.Membership')
      if (!(await ctx.db.one(from(M).where(eq(M.userId, a.userId), eq(M.companyId, branch.companyId)))))
        return invalid([issue('branchId', 'user.error.branchCompanyMembership')])
      const inserted = await ctx.db.insertIfAbsent('user.BranchMembership', {
        id: a.id,
        userId: a.userId,
        branchId: a.branchId,
      })
      if ('dryRun' in inserted || inserted.inserted) return { ok: true, id: a.id }
      const BM = ctx.table('user.BranchMembership')
      const held = await ctx.db.one(from(BM).where(eq(BM.userId, a.userId), eq(BM.branchId, a.branchId)))
      return { ok: true, id: held?.id }
    },
  }),

  revokeBranch: defineFn({
    input: { userId: 'id', branchId: 'id' },
    output: { ok: 'bool', removed: 'int?', errors: 'json?' },
    effects: ['read:user.User', 'read:user.BranchMembership', 'write:user.BranchMembership'],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      const user = await ctx.db.one(from(U).where(eq(U.id, a.userId)))
      if (user?.active === true && user.defaultBranchId === a.branchId)
        return invalid([issue('branchId', 'user.error.defaultBranchRevoke')])
      const BM = ctx.table('user.BranchMembership')
      const { changes } = await ctx.db.del(
        deleteFrom(BM).where(eq(BM.userId, a.userId), eq(BM.branchId, a.branchId)),
      )
      return { ok: true, removed: changes }
    },
  }),

  setDefaultContext: defineFn({
    input: { userId: 'id', companyId: 'id', branchId: 'id' },
    output: { ok: 'bool', errors: 'json?' },
    effects: [
      'read:user.User',
      'write:user.User',
      'read:user.Membership',
      'read:user.BranchMembership',
      'read:company.Branch',
    ],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
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
      await ctx.db.update(
        'user.User',
        { id: a.userId },
        { defaultCompanyId: a.companyId, defaultBranchId: a.branchId },
      )
      return { ok: true }
    },
  }),

  contextOptions: defineFn({
    exposure: 'internal',
    input: { userId: 'id' },
    output: { ok: 'bool', companies: 'json?', branches: 'json?', defaults: 'json?', errors: 'json?' },
    effects: [
      'read:user.User',
      'read:user.Membership',
      'read:user.BranchMembership',
      'read:company.Company',
      'read:company.Branch',
      'read:partner.Partner',
    ],
    handler: async (ctx: Ctx, a) => {
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
    },
  }),

  prepareContext: defineFn({
    exposure: 'internal',
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
    handler: async (ctx: Ctx, a) => {
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
    },
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
    handler: async (ctx: Ctx, a) => {
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
    },
  }),

  archiveCompany: defineFn({
    input: { id: 'id', active: 'bool' },
    output: { ok: 'bool', id: 'id?', active: 'bool?', errors: 'json?' },
    effects: ['read:user.User', 'read:company.Company', 'write:company.Company'],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const C = ctx.table('company.Company')
      const company = await ctx.db.one(from(C).where(eq(C.id, a.id)))
      if (!company) return invalid([issue('id', 'company.error.missing')])
      if (a.active === false) {
        const U = ctx.table('user.User')
        if (await ctx.db.one(from(U).where(eq(U.defaultCompanyId, a.id), eq(U.active, true))))
          return invalid([issue('active', 'user.error.companyDefaultActive')])
        if ((await ctx.db.count(from(C).where(eq(C.active, true)))) <= 1)
          return invalid([issue('active', 'company.error.lastActive')])
      }
      await ctx.db.update('company.Company', { id: a.id }, { active: a.active })
      return { ok: true, id: a.id, active: a.active }
    },
  }),

  archiveBranch: defineFn({
    input: { id: 'id', active: 'bool' },
    output: { ok: 'bool', id: 'id?', active: 'bool?', errors: 'json?' },
    effects: ['read:user.User', 'read:company.Company', 'read:company.Branch', 'write:company.Branch'],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const B = ctx.table('company.Branch')
      const branch = await ctx.db.one(from(B).where(eq(B.id, a.id)))
      if (!branch) return invalid([issue('id', 'company.error.branchMissing')])
      if (a.active === false) {
        if (branch.rootKey) return invalid([issue('active', 'company.error.rootArchive')])
        const U = ctx.table('user.User')
        if (await ctx.db.one(from(U).where(eq(U.defaultBranchId, a.id), eq(U.active, true))))
          return invalid([issue('active', 'user.error.branchDefaultActive')])
        const active = await ctx.db.count(
          from(B).where(eq(B.companyId, branch.companyId), eq(B.active, true)),
        )
        if (active <= 1) return invalid([issue('active', 'company.error.lastBranch')])
      } else {
        const C = ctx.table('company.Company')
        if (!(await ctx.db.one(from(C).where(eq(C.id, branch.companyId), eq(C.active, true)))))
          return invalid([issue('active', 'user.error.branchCompanyArchived')])
      }
      await ctx.db.update('company.Branch', { id: a.id }, { active: a.active })
      return { ok: true, id: a.id, active: a.active }
    },
  }),

  archiveUser: defineFn({
    input: { id: 'id', active: 'bool' },
    output: { id: 'id', active: 'bool' },
    effects: ['write:user.User'],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      await ctx.db.update('user.User', { id: a.id }, { active: a.active } as Row)
      return { id: a.id, active: a.active }
    },
  }),
}
