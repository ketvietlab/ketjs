import { createHash, randomBytes, randomUUID } from 'node:crypto'
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
const nowIso = () => new Date().toISOString()
const normalizeLogin = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const timestampMs = (value: unknown): number =>
  value instanceof Date ? value.getTime() : Date.parse(String(value))
const DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

class TokenClaimRace extends Error {}

const audit = async (
  ctx: Ctx,
  event: string,
  userId?: unknown,
  networkFingerprint?: unknown,
  metadata?: Record<string, unknown>,
) => {
  await ctx.db.insert('user.SecurityAudit', {
    id: randomUUID(),
    userId: userId || null,
    event,
    occurredAt: nowIso(),
    networkFingerprint: networkFingerprint || null,
    metadata: metadata ?? null,
  })
}

const superuser = async (ctx: Ctx, userId: string): Promise<boolean> => {
  const U = ctx.table('user.User')
  return Boolean(await ctx.db.one(from(U).where(eq(U.id, userId), eq(U.active, true), eq(U.superuser, true))))
}

const liveSuperusers = async (ctx: Ctx): Promise<number> => {
  const U = ctx.table('user.User')
  return ctx.db.count(from(U).where(eq(U.active, true), eq(U.superuser, true), eq(U.accessKind, 'internal')))
}

const lockLastSuperuser = async (ctx: Ctx): Promise<void> => {
  const id = 'last-superuser'
  await ctx.db.insertIfAbsent('user.SecurityGuard', { id, updatedAt: nowIso() })
  // PostgreSQL holds this row lock until the surrounding transaction commits.
  // SQLite already serializes writers, so the same portable statement is enough.
  await ctx.db.update('user.SecurityGuard', { id }, { updatedAt: nowIso() })
}

const throttleIds = (login: string, networkFingerprint: string): string[] => [
  `login:${digest(login)}`,
  `network:${digest(networkFingerprint || 'unknown')}`,
]

const throttled = async (ctx: Ctx, ids: string[], at: number): Promise<boolean> => {
  const T = ctx.table('user.AuthThrottle')
  const rows = await ctx.db.all(from(T).where(inArray(T.id, ids)))
  return rows.some((row) => row.blockedUntil && timestampMs(row.blockedUntil) > at)
}

const failThrottle = async (ctx: Ctx, ids: string[], at: number): Promise<void> => {
  for (const id of ids) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const T = ctx.table('user.AuthThrottle')
      const row = await ctx.db.one(from(T).where(eq(T.id, id)))
      if (!row) {
        const inserted = await ctx.db.insertIfAbsent('user.AuthThrottle', {
          id,
          failures: 1,
          blockedUntil: null,
          updatedAt: new Date(at).toISOString(),
        })
        if ('dryRun' in inserted || inserted.inserted) break
        continue
      }
      const failures = Math.min(Number(row.failures) + 1, 20)
      const delay = failures < 3 ? 0 : Math.min(15 * 60_000, 1000 * 2 ** Math.min(failures - 3, 9))
      const changed = await ctx.db.compareAndSet(
        'user.AuthThrottle',
        { id },
        { failures: row.failures, blockedUntil: row.blockedUntil },
        {
          failures,
          blockedUntil: delay ? new Date(at + delay).toISOString() : null,
          updatedAt: new Date(at).toISOString(),
        },
      )
      if ('dryRun' in changed || changed.matched) break
    }
  }
}

const clearThrottle = async (ctx: Ctx, ids: string[]): Promise<void> => {
  const T = ctx.table('user.AuthThrottle')
  await ctx.db.del(deleteFrom(T).where(inArray(T.id, ids)))
}

type LiveIdentity = {
  user: Row
  companies: Row[]
  branches: Row[]
}

const liveIdentity = async (ctx: Ctx, userId: string): Promise<LiveIdentity | null> => {
  const U = ctx.table('user.User')
  const user = await ctx.db.one(
    from(U)
      .select(U.id, U.defaultCompanyId, U.defaultBranchId, U.securityVersion)
      .where(eq(U.id, userId), eq(U.active, true)),
  )
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
  const liveVersion = Number(live.user.securityVersion ?? 0)
  if (Number(requested.securityVersion ?? 0) !== liveVersion)
    return invalid([issue('securityVersion', 'user.error.sessionRevoked')])
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
      securityVersion: liveVersion,
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
      accessKind: 'text',
      securityVersion: 'int',
      lastLoginAt: 'datetime?',
      passwordReady: 'bool',
      active: 'bool',
      superuser: 'bool',
    },
    effects: ['read:user.User'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      const q = from(U).orderBy(asc(U.login))
      const rows = await ctx.db.all(a.includeArchived === true ? q : q.where(eq(U.active, true)))
      return rows.map((row) => ({ ...row, passwordReady: Boolean(row.passwordHash) }))
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
      accessKind: 'text',
      securityVersion: 'int',
      lastLoginAt: 'datetime?',
      passwordReady: 'bool',
      active: 'bool',
      superuser: 'bool',
      memberships: 'json?',
      branchMemberships: 'json?',
      assignments: 'json?',
    },
    effects: ['read:user.User', 'read:user.Membership', 'read:user.BranchMembership', 'read:user.Assignment'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      const row = await ctx.db.one(
        from(U)
          .where(eq(U.id, a.id))
          .preload('memberships')
          .preload('branchMemberships')
          .preload('assignments'),
      )
      return row ? { ...row, passwordReady: Boolean(row.passwordHash) } : null
    },
  }),

  createUser: defineFn({
    input: {
      id: 'id',
      login: 'text',
      password: 'text?',
      name: 'text',
      email: 'text?',
      partnerId: 'id?',
      defaultCompanyId: 'id?',
      defaultBranchId: 'id?',
      accessKind: 'text?',
      superuser: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:user.User', 'write:user.User'],
    idempotent: true,
    // Deliberately not an agent tool: an agent that can mint logins is an agent
    // that can mint itself one.
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      const login = normalizeLogin(a.login)
      const password = String(a.password ?? '')
      const accessKind = String(a.accessKind ?? 'internal')
      const errors: Issue[] = []
      if (!login) errors.push(issue('login', 'user.error.required'))
      if (!String(a.name).trim()) errors.push(issue('name', 'user.error.required'))
      if (!['internal', 'portal', 'public'].includes(accessKind))
        errors.push(issue('accessKind', 'user.error.accessKind'))
      if (password && password.length < 8) errors.push(issue('password', 'user.error.passwordLength'))
      if (password && ctx.actor) errors.push(issue('password', 'user.error.adminPassword'))
      if (await ctx.db.one(from(U).where(eq(U.login, login))))
        errors.push(issue('login', 'user.error.loginUnique'))
      if (a.superuser === true && ctx.actor && !(await superuser(ctx, ctx.actor)))
        errors.push(issue('superuser', 'user.error.superuserRequired'))
      if (errors.length) return invalid(errors)
      const inserted = await ctx.db.insertIfAbsent('user.User', {
        id: a.id,
        login,
        passwordHash: password ? await hashPassword(password) : null,
        name: String(a.name).trim(),
        email: a.email || null,
        partnerId: a.partnerId || null,
        defaultCompanyId: a.defaultCompanyId || null,
        defaultBranchId: a.defaultBranchId || null,
        accessKind,
        securityVersion: 0,
        lastLoginAt: null,
        active: true,
        superuser: a.superuser === true,
      })
      return 'dryRun' in inserted || inserted.inserted
        ? { ok: true, id: a.id }
        : invalid([issue('login', 'user.error.loginUnique')])
    },
  }),

  saveUser: defineFn({
    input: {
      id: 'id',
      login: 'text',
      name: 'text',
      email: 'text?',
      partnerId: 'id?',
      accessKind: 'text',
      active: 'bool',
      superuser: 'bool',
    },
    output: { ok: 'bool', id: 'id?', securityVersion: 'int?', errors: 'json?' },
    effects: ['read:user.User', 'write:user.User', 'read:user.SecurityGuard', 'write:user.SecurityGuard'],
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      const row = await ctx.db.one(from(U).where(eq(U.id, a.id)))
      if (!row) return invalid([issue('id', 'user.error.userMissing')])
      const login = normalizeLogin(a.login)
      const accessKind = String(a.accessKind)
      const errors: Issue[] = []
      if (!login) errors.push(issue('login', 'user.error.required'))
      if (!String(a.name).trim()) errors.push(issue('name', 'user.error.required'))
      if (!['internal', 'portal', 'public'].includes(accessKind))
        errors.push(issue('accessKind', 'user.error.accessKind'))
      const owner = await ctx.db.one(from(U).where(eq(U.login, login)))
      if (owner && owner.id !== a.id) errors.push(issue('login', 'user.error.loginUnique'))
      if (a.superuser === true && row.superuser !== true && ctx.actor && !(await superuser(ctx, ctx.actor)))
        errors.push(issue('superuser', 'user.error.superuserRequired'))
      const removesLiveSuperuser =
        row.superuser === true &&
        row.active === true &&
        row.accessKind === 'internal' &&
        (a.superuser !== true || a.active !== true || accessKind !== 'internal')
      if (errors.length) return invalid(errors)
      const update = async (writeCtx: Ctx, held: Row) => {
        const securityChange =
          login !== held.login || a.active !== held.active || accessKind !== held.accessKind
        const securityVersion = Number(held.securityVersion ?? 0) + (securityChange ? 1 : 0)
        await writeCtx.db.update(
          'user.User',
          { id: a.id },
          {
            login,
            name: String(a.name).trim(),
            email: a.email || null,
            partnerId: a.partnerId || null,
            accessKind,
            active: a.active,
            superuser: a.superuser,
            securityVersion,
          },
        )
        return { ok: true, id: a.id, securityVersion }
      }
      if (!removesLiveSuperuser) return update(ctx, row)
      return ctx.tx(async (tx) => {
        await lockLastSuperuser(tx)
        const U2 = tx.table('user.User')
        const held = await tx.db.one(from(U2).where(eq(U2.id, a.id)))
        if (
          held?.active === true &&
          held.superuser === true &&
          held.accessKind === 'internal' &&
          (await liveSuperusers(tx)) <= 1
        )
          return invalid([issue('active', 'user.error.lastSuperuser')])
        if (!held) return invalid([issue('id', 'user.error.userMissing')])
        return update(tx, held)
      })
    },
  }),

  /**
   * Changing a password takes the old one, even for an administrator acting on
   * their own account: a session someone walked away from should not be enough.
   */
  setPassword: defineFn({
    exposure: 'internal',
    anonymous: true,
    input: { id: 'id', currentPassword: 'text', newPassword: 'text' },
    output: { ok: 'bool', securityVersion: 'int?', errors: 'json?' },
    effects: ['read:user.User', 'write:user.User', 'write:user.SecurityAudit'],
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      const row = await ctx.db.one(from(U).where(eq(U.id, a.id)))
      if (ctx.actor !== a.id) return invalid([issue('id', 'user.error.passwordActor')])
      if (!row?.passwordHash || !(await verifyPassword(String(a.currentPassword), String(row.passwordHash))))
        return invalid([issue('currentPassword', 'user.error.currentPassword')])
      if (String(a.newPassword).length < 8)
        return invalid([issue('newPassword', 'user.error.passwordLength')])
      const securityVersion = Number(row.securityVersion ?? 0) + 1
      await ctx.db.update(
        'user.User',
        { id: a.id },
        {
          passwordHash: await hashPassword(String(a.newPassword)),
          securityVersion,
        },
      )
      await audit(ctx, 'password.change', a.id)
      return { ok: true, securityVersion }
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
    exposure: 'internal',
    input: { login: 'text', password: 'text', networkFingerprint: 'text?' },
    output: {
      ok: 'bool',
      userId: 'id?',
      companies: 'json?',
      defaultCompanyId: 'id?',
      branches: 'json?',
      defaultBranchId: 'id?',
      securityVersion: 'int?',
      rehash: 'bool?',
    },
    effects: [
      'read:user.User',
      'read:user.Membership',
      'read:user.BranchMembership',
      'read:company.Company',
      'read:company.Branch',
      'read:partner.Partner',
      'read:user.AuthThrottle',
      'write:user.AuthThrottle',
      'write:user.User',
      'write:user.SecurityAudit',
    ],
    handler: async (ctx: Ctx, a) => {
      const login = normalizeLogin(a.login)
      const fingerprint = String(a.networkFingerprint ?? 'unknown')
      const throttle = throttleIds(login, fingerprint)
      const at = Date.now()
      if (await throttled(ctx, throttle, at)) {
        await verifyPassword(String(a.password), DUMMY_HASH)
        await audit(ctx, 'login.failure', undefined, fingerprint, { reason: 'cooldown' })
        return { ok: false }
      }
      const U = ctx.table('user.User')
      const row = await ctx.db.one(from(U).where(eq(U.login, login), eq(U.active, true)))
      const verified = await verifyPassword(String(a.password), String(row?.passwordHash ?? DUMMY_HASH))
      if (row?.accessKind !== 'internal' || !row.passwordHash || !verified) {
        await failThrottle(ctx, throttle, at)
        await audit(ctx, 'login.failure', undefined, fingerprint)
        return { ok: false }
      }

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
      if (needsRehash(String(row.passwordHash)))
        await ctx.db.update(
          'user.User',
          { id: row.id },
          { passwordHash: await hashPassword(String(a.password)) },
        )
      await ctx.db.update('user.User', { id: row.id }, { lastLoginAt: new Date(at).toISOString() })
      // A successful account login clears that account's failures. Keep the
      // network bucket: otherwise an attacker can repeatedly sign in to one
      // account to erase failures from every other login on the same network.
      await clearThrottle(ctx, [throttle[0]!])
      await audit(ctx, 'login.success', row.id, fingerprint)
      return {
        ok: true,
        userId: row.id,
        companies,
        defaultCompanyId,
        branches,
        defaultBranchId,
        securityVersion: Number(row.securityVersion ?? 0),
        rehash: false,
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
    anonymous: true,
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
    },
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

  issueAuthToken: defineFn({
    exposure: 'internal',
    input: { userId: 'id', kind: 'text', realm: 'text?' },
    output: { ok: 'bool', token: 'text?', expiresAt: 'datetime?', errors: 'json?' },
    effects: ['read:user.User', 'read:user.AuthToken', 'write:user.AuthToken'],
    handler: async (ctx: Ctx, a) => {
      const kind = String(a.kind)
      if (!['invitation', 'reset'].includes(kind)) return invalid([issue('kind', 'user.error.tokenKind')])
      const U = ctx.table('user.User')
      const user = await ctx.db.one(from(U).where(eq(U.id, a.userId), eq(U.active, true)))
      if (!user) return invalid([issue('userId', 'user.error.userMissing')])
      const token = randomBytes(32).toString('base64url')
      const at = Date.now()
      const expiresAt = new Date(at + (kind === 'invitation' ? 144 : 4) * 60 * 60_000).toISOString()
      const id = `auth:${a.userId}:${kind}`
      const values = {
        userId: a.userId,
        kind,
        realm: String(a.realm ?? 'backend'),
        digest: digest(token),
        securityVersion: Number(user.securityVersion ?? 0),
        expiresAt,
        consumedAt: null,
        createdAt: new Date(at).toISOString(),
      }
      const inserted = await ctx.db.insertIfAbsent('user.AuthToken', { id, ...values })
      if (!('dryRun' in inserted) && !inserted.inserted) await ctx.db.update('user.AuthToken', { id }, values)
      return { ok: true, token, expiresAt }
    },
  }),

  consumeAuthToken: defineFn({
    exposure: 'internal',
    anonymous: true,
    input: { token: 'text', kind: 'text', realm: 'text?', password: 'text' },
    output: { ok: 'bool', userId: 'id?', errors: 'json?' },
    effects: [
      'read:user.AuthToken',
      'write:user.AuthToken',
      'read:user.User',
      'write:user.User',
      'write:user.SecurityAudit',
    ],
    handler: async (ctx: Ctx, a) => {
      if (String(a.password).length < 8) return invalid([issue('password', 'user.error.passwordLength')])
      const T = ctx.table('user.AuthToken')
      const row = await ctx.db.one(from(T).where(eq(T.digest, digest(String(a.token)))))
      const realm = String(a.realm ?? 'backend')
      if (
        !row ||
        row.kind !== a.kind ||
        row.realm !== realm ||
        row.consumedAt ||
        timestampMs(row.expiresAt) <= Date.now()
      )
        return invalid([issue('token', 'user.error.tokenInvalid')])
      const U = ctx.table('user.User')
      const user = await ctx.db.one(from(U).where(eq(U.id, row.userId), eq(U.active, true)))
      if (!user || Number(user.securityVersion ?? 0) !== Number(row.securityVersion))
        return invalid([issue('token', 'user.error.tokenInvalid')])
      const passwordHash = await hashPassword(String(a.password))
      const consumedAt = nowIso()
      try {
        return await ctx.tx(async (tx) => {
          const claimed = await tx.db.compareAndSet(
            'user.AuthToken',
            { id: row.id },
            { digest: row.digest, consumedAt: null, securityVersion: row.securityVersion },
            { consumedAt },
          )
          if (!('dryRun' in claimed) && !claimed.matched)
            return invalid([issue('token', 'user.error.tokenInvalid')])
          const securityVersion = Number(user.securityVersion ?? 0) + 1
          const updated = await tx.db.compareAndSet(
            'user.User',
            { id: user.id },
            { active: true, securityVersion: user.securityVersion },
            { passwordHash, securityVersion },
          )
          if (!('dryRun' in updated) && !updated.matched) throw new TokenClaimRace()
          await audit(tx, a.kind === 'invitation' ? 'invitation.accept' : 'password.reset', user.id)
          return { ok: true, userId: user.id }
        })
      } catch (error) {
        if (error instanceof TokenClaimRace) return invalid([issue('token', 'user.error.tokenInvalid')])
        throw error
      }
    },
  }),

  recordSecurityEvent: defineFn({
    exposure: 'internal',
    anonymous: true,
    input: { event: 'text', userId: 'id?', networkFingerprint: 'text?', metadata: 'json?' },
    output: { ok: 'bool' },
    effects: ['read:user.User', 'write:user.SecurityAudit'],
    handler: async (ctx: Ctx, a) => {
      if (a.userId && ctx.actor && ctx.actor !== a.userId && !(await superuser(ctx, ctx.actor)))
        return { ok: false }
      await audit(
        ctx,
        String(a.event),
        a.userId,
        a.networkFingerprint,
        (a.metadata as Record<string, unknown> | null) ?? undefined,
      )
      return { ok: true }
    },
  }),

  listSecurityAudit: defineFn({
    input: { userId: 'id?' },
    output: {
      id: 'id',
      userId: 'id?',
      event: 'text',
      occurredAt: 'datetime',
      networkFingerprint: 'text?',
      metadata: 'json?',
    },
    effects: ['read:user.SecurityAudit'],
    handler: (ctx: Ctx, a) => {
      const A = ctx.table('user.SecurityAudit')
      let q = from(A).orderBy(asc(A.occurredAt))
      if (a.userId) q = q.where(eq(A.userId, a.userId))
      return ctx.db.all(q)
    },
  }),

  archiveUser: defineFn({
    input: { id: 'id', active: 'bool' },
    output: { ok: 'bool', id: 'id?', active: 'bool?', securityVersion: 'int?', errors: 'json?' },
    effects: [
      'read:user.User',
      'write:user.User',
      'write:user.SecurityAudit',
      'read:user.SecurityGuard',
      'write:user.SecurityGuard',
    ],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const U = ctx.table('user.User')
      const row = await ctx.db.one(from(U).where(eq(U.id, a.id)))
      if (!row) return invalid([issue('id', 'user.error.userMissing')])
      const update = async (writeCtx: Ctx, held: Row) => {
        const securityVersion = Number(held.securityVersion ?? 0) + (held.active === a.active ? 0 : 1)
        await writeCtx.db.update('user.User', { id: a.id }, { active: a.active, securityVersion })
        if (held.active !== a.active) await audit(writeCtx, a.active ? 'user.restore' : 'user.archive', a.id)
        return { ok: true, id: a.id, active: a.active, securityVersion }
      }
      if (!(a.active === false && row.active === true && row.superuser === true)) return update(ctx, row)
      return ctx.tx(async (tx) => {
        await lockLastSuperuser(tx)
        const U2 = tx.table('user.User')
        const held = await tx.db.one(from(U2).where(eq(U2.id, a.id)))
        if (!held) return invalid([issue('id', 'user.error.userMissing')])
        if (held.active === true && held.superuser === true && (await liveSuperusers(tx)) <= 1)
          return invalid([issue('active', 'user.error.lastSuperuser')])
        return update(tx, held)
      })
    },
  }),
}
