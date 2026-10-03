import { randomBytes } from 'node:crypto'
import { asc, defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'
import { hashPassword, needsRehash, verifyPassword } from '../password.ts'

import {
  issue,
  invalid,
  nowIso,
  normalizeLogin,
  digest,
  timestampMs,
  DUMMY_HASH,
  TokenClaimRace,
  audit,
  superuser,
  throttleIds,
  throttled,
  failThrottle,
  clearThrottle,
  liveIdentity,
} from './shared.ts'

export async function setPasswordHandler(ctx: Ctx, a: Record<string, unknown>) {
  const U = ctx.table('user.User')
  const row = await ctx.db.one(from(U).where(eq(U.id, a.id)))
  if (ctx.actor !== a.id) return invalid([issue('id', 'user.error.passwordActor')])
  if (!row?.passwordHash || !(await verifyPassword(String(a.currentPassword), String(row.passwordHash))))
    return invalid([issue('currentPassword', 'user.error.currentPassword')])
  if (String(a.newPassword).length < 8) return invalid([issue('newPassword', 'user.error.passwordLength')])
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
}

export async function authenticateHandler(ctx: Ctx, a: Record<string, unknown>) {
  const login = normalizeLogin(a.login)
  const fingerprint = String(a.networkFingerprint ?? 'unknown')
  const throttle = throttleIds(login, fingerprint)
  const at = Date.now()
  if (await throttled(ctx, throttle, at)) {
    await verifyPassword(String(a.password), DUMMY_HASH)
    await audit(ctx, 'login.failure', undefined, fingerprint, {
      reason: 'cooldown',
    })
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
    await ctx.db.update('user.User', { id: row.id }, { passwordHash: await hashPassword(String(a.password)) })
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
}

export async function issueAuthTokenHandler(ctx: Ctx, a: Record<string, unknown>) {
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
  const inserted = await ctx.db.insertIfAbsent('user.AuthToken', {
    id,
    ...values,
  })
  if (!('dryRun' in inserted) && !inserted.inserted) await ctx.db.update('user.AuthToken', { id }, values)
  return { ok: true, token, expiresAt }
}

export async function consumeAuthTokenHandler(ctx: Ctx, a: Record<string, unknown>) {
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
        {
          digest: row.digest,
          consumedAt: null,
          securityVersion: row.securityVersion,
        },
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
}

export async function recordSecurityEventHandler(ctx: Ctx, a: Record<string, unknown>) {
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
}

export async function listSecurityAuditHandler(ctx: Ctx, a: Record<string, unknown>) {
  const A = ctx.table('user.SecurityAudit')
  let q = from(A).orderBy(asc(A.occurredAt))
  if (a.userId) q = q.where(eq(A.userId, a.userId))
  return ctx.db.all(q)
}

export const authenticationFunctions: Record<string, FnSpec> = {
  setPassword: defineFn({
    exposure: 'internal',
    anonymous: true,
    input: { id: 'id', currentPassword: 'text', newPassword: 'text' },
    output: { ok: 'bool', securityVersion: 'int?', errors: 'json?' },
    effects: ['read:user.User', 'write:user.User', 'write:user.SecurityAudit'],
    handler: setPasswordHandler,
  }),
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
    handler: authenticateHandler,
  }),
  issueAuthToken: defineFn({
    exposure: 'internal',
    input: { userId: 'id', kind: 'text', realm: 'text?' },
    output: {
      ok: 'bool',
      token: 'text?',
      expiresAt: 'datetime?',
      errors: 'json?',
    },
    effects: ['read:user.User', 'read:user.AuthToken', 'write:user.AuthToken'],
    handler: issueAuthTokenHandler,
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
    handler: consumeAuthTokenHandler,
  }),
  recordSecurityEvent: defineFn({
    exposure: 'internal',
    anonymous: true,
    input: {
      event: 'text',
      userId: 'id?',
      networkFingerprint: 'text?',
      metadata: 'json?',
    },
    output: { ok: 'bool' },
    effects: ['read:user.User', 'write:user.SecurityAudit'],
    handler: recordSecurityEventHandler,
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
    handler: listSecurityAuditHandler,
  }),
}
