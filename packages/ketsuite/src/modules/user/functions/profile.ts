import { asc, defineFn, eq, from, inArray, isTimezone, like, or } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { hashPassword, verifyPassword } from '../password.ts'
import { reserveUserEmail, authorizationTransaction, abortAuthorization } from '../authorization.ts'
import {
  type Issue,
  issue,
  invalid,
  normalizeLogin,
  audit,
  superuser,
  liveSuperusers,
  lockLastSuperuser,
} from './shared.ts'

export async function listUsersHandler(ctx: Ctx, a: Record<string, unknown>) {
  const U = ctx.table('user.User')
  const asked = Array.isArray(a.ids) ? [...new Set(a.ids.map(String))] : null
  const narrowed: string[][] = []
  if (a.companyId) {
    const M = ctx.table('user.Membership')
    narrowed.push(
      (await ctx.db.all(from(M).where(eq(M.companyId, String(a.companyId))))).map((row) =>
        String(row.userId),
      ),
    )
  }
  if (a.roleId) {
    const A = ctx.table('user.Assignment')
    narrowed.push(
      (await ctx.db.all(from(A).where(eq(A.roleId, String(a.roleId))))).map((row) => String(row.userId)),
    )
  }
  // Every filter narrows the same set, so a person must satisfy all of them.
  const wanted = narrowed.reduce(
    (kept: string[] | null, ids) => (kept === null ? ids : kept.filter((id) => ids.includes(id))),
    asked,
  )
  if (wanted && !wanted.length) return []
  let q = from(U).orderBy(asc(U.login))
  if (wanted) q = q.where(inArray(U.id, wanted))
  if (a.includeArchived !== true) q = q.where(eq(U.active, true))
  if (a.search) {
    const needle = `%${String(a.search).trim()}%`
    q = q.where(or(like(U.name, needle), like(U.login, needle)))
  }
  if (typeof a.limit === 'number') q = q.limit(Math.max(1, Math.min(500, a.limit)))
  const rows = await ctx.db.all(q)
  return rows.map((row) => ({
    ...row,
    passwordReady: Boolean(row.passwordHash),
  }))
}

export async function getUserHandler(ctx: Ctx, a: Record<string, unknown>) {
  const U = ctx.table('user.User')
  const row = await ctx.db.one(
    from(U).where(eq(U.id, a.id)).preload('memberships').preload('branchMemberships').preload('assignments'),
  )
  return row ? { ...row, passwordReady: Boolean(row.passwordHash) } : null
}

export async function createUserHandler(ctx: Ctx, a: Record<string, unknown>) {
  const U = ctx.table('user.User')
  const existing = await ctx.db.one(from(U).where(eq(U.id, a.id)))
  const login = normalizeLogin(a.login)
  const password = String(a.password ?? '')
  const accessKind = String(a.accessKind ?? 'internal')
  const errors: Issue[] = []
  if (!login) errors.push(issue('login', 'user.error.required'))
  if (!String(a.name).trim()) errors.push(issue('name', 'user.error.required'))
  if (!['internal', 'portal', 'public'].includes(accessKind))
    errors.push(issue('accessKind', 'user.error.accessKind'))
  if (a.timezone && !isTimezone(String(a.timezone))) errors.push(issue('timezone', 'user.error.timezone'))
  if (password && password.length < 8) errors.push(issue('password', 'user.error.passwordLength'))
  if (password && ctx.actor) errors.push(issue('password', 'user.error.adminPassword'))
  const loginOwner = await ctx.db.one(from(U).where(eq(U.login, login)))
  if (loginOwner && loginOwner.id !== a.id) errors.push(issue('login', 'user.error.loginUnique'))
  if (a.superuser === true && ctx.actor && !(await superuser(ctx, ctx.actor)))
    errors.push(issue('superuser', 'user.error.superuserRequired'))
  if (errors.length) return invalid(errors)
  if (existing) {
    const samePassword = password
      ? !!existing.passwordHash && (await verifyPassword(password, String(existing.passwordHash)))
      : !existing.passwordHash
    const same =
      existing.login === login &&
      existing.name === String(a.name).trim() &&
      (existing.email ?? null) === (a.email || null) &&
      (existing.timezone ?? null) === (a.timezone || null) &&
      (existing.partnerId ?? null) === (a.partnerId || null) &&
      existing.accessKind === accessKind &&
      existing.superuser === (a.superuser === true) &&
      samePassword
    return same ? { ok: true, id: a.id } : invalid([issue('id', 'user.error.idConflict')])
  }
  return authorizationTransaction(ctx, async (tx) => {
    await reserveUserEmail(tx, a.email ? String(a.email) : null, String(a.id))
    const inserted = await tx.db.insertIfAbsent('user.User', {
      id: a.id,
      login,
      passwordHash: password ? await hashPassword(password) : null,
      name: String(a.name).trim(),
      email: a.email || null,
      timezone: a.timezone && isTimezone(String(a.timezone)) ? String(a.timezone) : null,
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
      : abortAuthorization(invalid([issue('login', 'user.error.loginUnique')]))
  })
}

export async function saveUserHandler(ctx: Ctx, a: Record<string, unknown>) {
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
  if (a.timezone && !isTimezone(String(a.timezone))) errors.push(issue('timezone', 'user.error.timezone'))
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
    const securityChange = login !== held.login || a.active !== held.active || accessKind !== held.accessKind
    const securityVersion = Number(held.securityVersion ?? 0) + (securityChange ? 1 : 0)
    if (
      String(a.email ?? '')
        .trim()
        .toLowerCase() !==
      String(held.email ?? '')
        .trim()
        .toLowerCase()
    )
      await reserveUserEmail(writeCtx, a.email ? String(a.email) : null, String(a.id))
    await writeCtx.db.update(
      'user.User',
      { id: a.id },
      {
        login,
        name: String(a.name).trim(),
        email: a.email || null,
        timezone: a.timezone === undefined ? (held.timezone ?? null) : a.timezone || null,
        partnerId: a.partnerId || null,
        accessKind,
        active: a.active,
        superuser: a.superuser,
        securityVersion,
      },
    )
    return { ok: true, id: a.id, securityVersion }
  }
  if (!removesLiveSuperuser) return authorizationTransaction(ctx, (tx) => update(tx, row))
  return authorizationTransaction(ctx, async (tx) => {
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
}

export async function setTimezoneHandler(ctx: Ctx, a: Record<string, unknown>) {
  if (!ctx.actor) return invalid([issue('userId', 'user.error.userMissing')])
  const timezone = String(a.timezone).trim()
  if (!isTimezone(timezone)) return invalid([issue('timezone', 'user.error.timezone')])
  const user = await ctx.db.select('user.User', { id: ctx.actor })
  if (!user.length) return invalid([issue('userId', 'user.error.userMissing')])
  await ctx.db.update('user.User', { id: ctx.actor }, { timezone })
  return { ok: true, timezone }
}

export async function archiveUserHandler(ctx: Ctx, a: Record<string, unknown>) {
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
}

export const profileFunctions: Record<string, FnSpec> = {
  listUsers: defineFn({
    // `search` and `limit` are what a relational picker sends on every
    // keystroke; without them the field could only ever be a plain select over
    // every user in the tenant.
    // `ids` is for the caller that already knows who it needs. A page of tasks
    // wants the names behind its handful of assigneeIds, and the search-and-limit
    // shape a picker sends cannot answer that: it caps at five hundred, so the
    // five hundred and first user comes back as a raw id where a name belongs.
    // `companyId` and `roleId` are the two questions the users screen narrows by —
    // where somebody works and what they hold. Both live in other tables, so a
    // caller holding a row of this one cannot answer them.
    input: {
      includeArchived: 'bool?',
      search: 'text?',
      ids: 'json?',
      limit: 'int?',
      companyId: 'id?',
      roleId: 'id?',
    },
    output: {
      id: 'id',
      login: 'text',
      name: 'text',
      email: 'text?',
      timezone: 'text?',
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
    effects: ['read:user.User', 'read:user.Membership', 'read:user.Assignment'],
    agent: true,
    handler: listUsersHandler,
  }),
  getUser: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      login: 'text',
      name: 'text',
      email: 'text?',
      lang: 'text?',
      timezone: 'text?',
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
    handler: getUserHandler,
  }),
  createUser: defineFn({
    input: {
      id: 'id',
      login: 'text',
      password: 'text?',
      name: 'text',
      email: 'text?',
      timezone: 'text?',
      partnerId: 'id?',
      defaultCompanyId: 'id?',
      defaultBranchId: 'id?',
      accessKind: 'text?',
      superuser: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:user.User',
      'write:user.User',
      'read:user.EmailReservation',
      'write:user.EmailReservation',
    ],
    idempotent: true,
    // Deliberately not an agent tool: an agent that can mint logins is an agent
    // that can mint itself one.
    handler: createUserHandler,
  }),
  saveUser: defineFn({
    idempotent: true,
    input: {
      id: 'id',
      login: 'text',
      name: 'text',
      email: 'text?',
      timezone: 'text?',
      partnerId: 'id?',
      accessKind: 'text',
      active: 'bool',
      superuser: 'bool',
    },
    output: { ok: 'bool', id: 'id?', securityVersion: 'int?', errors: 'json?' },
    effects: [
      'read:user.User',
      'write:user.User',
      'read:user.SecurityGuard',
      'write:user.SecurityGuard',
      'read:user.EmailReservation',
      'write:user.EmailReservation',
    ],
    handler: saveUserHandler,
  }),
  setTimezone: defineFn({
    exposure: 'internal',
    input: { timezone: 'text' },
    output: { ok: 'bool', timezone: 'text?', errors: 'json?' },
    effects: ['read:user.User', 'write:user.User'],
    handler: setTimezoneHandler,
  }),
  archiveUser: defineFn({
    input: { id: 'id', active: 'bool' },
    output: {
      ok: 'bool',
      id: 'id?',
      active: 'bool?',
      securityVersion: 'int?',
      errors: 'json?',
    },
    effects: [
      'read:user.User',
      'write:user.User',
      'write:user.SecurityAudit',
      'read:user.SecurityGuard',
      'write:user.SecurityGuard',
    ],
    idempotent: true,
    handler: archiveUserHandler,
  }),
}
