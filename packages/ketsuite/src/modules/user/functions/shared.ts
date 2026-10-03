import { createHash, randomUUID } from 'node:crypto'
import { asc, deleteFrom, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, Row } from '@ketvietlab/ketjs'

export type Issue = {
  field: string
  code: string
  params?: Record<string, unknown>
}

export const issue = (field: string, code: string, params?: Record<string, unknown>): Issue => ({
  field,
  code,
  ...(params ? { params } : {}),
})

export const invalid = (errors: Issue[]) => ({ ok: false as const, errors })

export const nowIso = () => new Date().toISOString()

export const normalizeLogin = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()

export const digest = (value: string): string => createHash('sha256').update(value).digest('hex')

export const timestampMs = (value: unknown): number =>
  value instanceof Date ? value.getTime() : Date.parse(String(value))

export const DUMMY_HASH =
  'scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'

export class TokenClaimRace extends Error {}

export const audit = async (
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

export const superuser = async (ctx: Ctx, userId: string): Promise<boolean> => {
  const U = ctx.table('user.User')
  const row = await ctx.db.one(from(U).where(eq(U.id, userId), eq(U.active, true), eq(U.superuser, true)))
  if (!row) return false
  return !row.superuserExpiresAt || timestampMs(row.superuserExpiresAt) > Date.now()
}

export const liveSuperusers = async (ctx: Ctx): Promise<number> => {
  const U = ctx.table('user.User')
  const rows = await ctx.db.all(
    from(U).where(eq(U.active, true), eq(U.superuser, true), eq(U.accessKind, 'internal')),
  )
  return rows.filter((row) => !row.superuserExpiresAt || timestampMs(row.superuserExpiresAt) > Date.now())
    .length
}

export const lockSecurityGuard = async (ctx: Ctx, id: string): Promise<void> => {
  await ctx.db.insertIfAbsent('user.SecurityGuard', {
    id,
    updatedAt: nowIso(),
  })
  // PostgreSQL holds this row lock until the surrounding transaction commits.
  // SQLite already serializes writers, so the same portable statement is enough.
  await ctx.db.update('user.SecurityGuard', { id }, { updatedAt: nowIso() })
}

export const lockLastSuperuser = (ctx: Ctx): Promise<void> => lockSecurityGuard(ctx, 'last-superuser')

export const AUTHORIZATION_SCOPE_EFFECTS = [
  'read:user.AuthorizationRevision',
  'write:user.AuthorizationRevision',
  'write:user.SecurityAudit',
]

export const throttleIds = (login: string, networkFingerprint: string): string[] => [
  `login:${digest(login)}`,
  `network:${digest(networkFingerprint || 'unknown')}`,
]

export const throttled = async (ctx: Ctx, ids: string[], at: number): Promise<boolean> => {
  const T = ctx.table('user.AuthThrottle')
  const rows = await ctx.db.all(from(T).where(inArray(T.id, ids)))
  return rows.some((row) => row.blockedUntil && timestampMs(row.blockedUntil) > at)
}

export const failThrottle = async (ctx: Ctx, ids: string[], at: number): Promise<void> => {
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

export const clearThrottle = async (ctx: Ctx, ids: string[]): Promise<void> => {
  const T = ctx.table('user.AuthThrottle')
  await ctx.db.del(deleteFrom(T).where(inArray(T.id, ids)))
}

export type LiveIdentity = {
  user: Row
  companies: Row[]
  branches: Row[]
}

export const liveIdentity = async (ctx: Ctx, userId: string): Promise<LiveIdentity | null> => {
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

export const requestedIds = (value: unknown): string[] | null =>
  Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : null

export const contextFor = (
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
