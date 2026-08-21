import { createHash } from 'node:crypto'
import { defineFn, eq, from } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import {
  CUSTOMER_DUMMY_HASH,
  hashCustomerPassword,
  verifyCustomerPassword,
} from './customer-password.ts'

const DEFAULT_IDLE_SECONDS = 7 * 24 * 60 * 60
const DEFAULT_ABSOLUTE_SECONDS = 30 * 24 * 60 * 60
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })
const accountView = (account: Row) => ({
  id: account.id,
  realmId: account.realmId,
  partnerId: account.partnerId,
  email: account.email,
  displayName: account.displayName,
  status: account.status,
  securityVersion: account.securityVersion,
})

export const normalizeCustomerEmail = (value: unknown): string => String(value ?? '').trim().toLowerCase()

const validPassword = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.length < 10 || value.length > 128) return false
  return Buffer.byteLength(value, 'utf8') <= 512
}

const realmForSite = async (ctx: Ctx, siteId: unknown): Promise<Row | null> => {
  const Link = ctx.table('website.CustomerRealmSite')
  const link = await ctx.db.one(from(Link).where(eq(Link.siteId, siteId), eq(Link.active, true)))
  if (!link) return null
  const realm = (await ctx.db.select('website.CustomerRealm', { id: link.realmId }))[0]
  return realm?.active === true ? realm : null
}

export const ensureCustomerRealm = async (ctx: Ctx, siteId: string, name: string): Promise<string> => {
  const existing = await realmForSite(ctx, siteId)
  if (existing) return String(existing.id)
  const realmId = `site:${ctx.scope.company ?? 'default'}:${siteId}`
  await ctx.db.insertIfAbsent('website.CustomerRealm', {
    id: realmId,
    name,
    active: true,
    sessionIdleSeconds: DEFAULT_IDLE_SECONDS,
    sessionAbsoluteSeconds: DEFAULT_ABSOLUTE_SECONDS,
  })
  await ctx.db.insertIfAbsent('website.CustomerRealmSite', {
    id: `site:${ctx.scope.company ?? 'default'}:${siteId}`,
    realmId,
    siteId,
    primary: true,
    active: true,
  })
  return realmId
}

const claimRateSlot = async (
  ctx: Ctx,
  realmId: string,
  action: string,
  key: string,
  limit: number,
  windowMs: number,
  now: Date,
): Promise<boolean> => {
  const id = digest(`${realmId}\n${action}\n${key}`)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const held = (await ctx.db.select('website.CustomerAuthRateLimit', { id }))[0]
    if (!held) {
      const inserted = await ctx.db.insertIfAbsent('website.CustomerAuthRateLimit', {
        id,
        realmId,
        action,
        key,
        windowStartedAt: now.toISOString(),
        count: 1,
      })
      if ('dryRun' in inserted || inserted.inserted) return true
      continue
    }
    const startedAt = new Date(String(held.windowStartedAt))
    const inWindow = now.getTime() - startedAt.getTime() < windowMs
    if (inWindow && Number(held.count) >= limit) return false
    const changed = await ctx.db.compareAndSet(
      'website.CustomerAuthRateLimit',
      { id },
      { windowStartedAt: held.windowStartedAt, count: held.count },
      {
        windowStartedAt: inWindow ? held.windowStartedAt : now.toISOString(),
        count: inWindow ? Number(held.count) + 1 : 1,
      },
    )
    if ('dryRun' in changed || changed.matched) return true
  }
  return false
}

const accountByEmail = async (ctx: Ctx, realmId: unknown, email: string): Promise<Row | null> => {
  const Account = ctx.table('website.CustomerAccount')
  return ctx.db.one(
    from(Account).where(eq(Account.realmId, realmId), eq(Account.emailNormalized, email)),
  )
}

const sessionOutput = {
  id: 'id',
  realmId: 'id',
  accountId: 'id',
  partnerId: 'id',
  email: 'text',
  displayName: 'text',
  securityVersion: 'int',
  idleExpiresAt: 'datetime',
  absoluteExpiresAt: 'datetime',
} as const

export const customerFunctions: Record<string, FnSpec> = {
  customerRealmForSite: defineFn({
    anonymous: true,
    exposure: 'internal',
    input: { siteId: 'id' },
    output: {
      id: 'id',
      name: 'text',
      sessionIdleSeconds: 'int',
      sessionAbsoluteSeconds: 'int',
    },
    effects: ['read:website.CustomerRealmSite', 'read:website.CustomerRealm'],
    handler: (ctx: Ctx, args) => realmForSite(ctx, args.siteId),
  }),

  registerCustomer: defineFn({
    anonymous: true,
    exposure: 'internal',
    input: {
      realmId: 'id',
      displayName: 'text',
      email: 'text',
      password: 'text',
      rateKey: 'text?',
    },
    output: {
      ok: 'bool',
      account: 'json?',
      errors: 'json?',
    },
    effects: [
      'read:website.CustomerRealm',
      'read:website.CustomerAccount',
      'write:website.CustomerAccount',
      'write:website.CustomerCredential',
      'read:website.CustomerAuthRateLimit',
      'write:website.CustomerAuthRateLimit',
      'write:partner.Partner',
    ],
    handler: async (ctx: Ctx, args) => {
      const realm = (await ctx.db.select('website.CustomerRealm', { id: args.realmId }))[0]
      if (realm?.active !== true) return invalid('realm', 'website.customer.error.realmUnavailable')
      const displayName = String(args.displayName ?? '').trim()
      const email = normalizeCustomerEmail(args.email)
      if (!displayName || displayName.length > 200)
        return invalid('displayName', 'website.customer.error.invalidName')
      if (!EMAIL.test(email) || email.length > 320)
        return invalid('email', 'website.customer.error.invalidEmail')
      if (!validPassword(args.password))
        return invalid('password', 'website.customer.error.invalidPassword')
      const now = new Date()
      const rateKey = String(args.rateKey ?? 'anonymous').slice(0, 256)
      if (
        !(await claimRateSlot(ctx, String(args.realmId), 'register', rateKey, 5, 60 * 60 * 1000, now)) ||
        !(await claimRateSlot(ctx, String(args.realmId), 'register-email', email, 5, 60 * 60 * 1000, now))
      )
        return invalid('email', 'website.customer.error.rateLimit')
      if (await accountByEmail(ctx, args.realmId, email))
        return invalid('email', 'website.customer.error.emailInUse')

      const stable = digest(`${String(args.realmId)}\n${email}`).slice(0, 32)
      const accountId = `customer-${stable}`
      const partnerId = `${accountId}:partner`
      const passwordHash = await hashCustomerPassword(String(args.password))
      return ctx.tx(async (tx) => {
        const duplicate = await accountByEmail(tx, args.realmId, email)
        if (duplicate) return invalid('email', 'website.customer.error.emailInUse')
        await tx.db.insertIfAbsent('partner.Partner', {
          id: partnerId,
          kind: 'person',
          name: displayName,
          parentId: null,
          vat: null,
          ref: null,
          email,
          phone: null,
          lang: null,
          active: true,
        })
        const inserted = await tx.db.insertIfAbsent('website.CustomerAccount', {
          id: accountId,
          realmId: args.realmId,
          partnerId,
          email,
          emailNormalized: email,
          displayName,
          status: 'active',
          emailVerifiedAt: null,
          securityVersion: 0,
          failedLoginCount: 0,
          lockedUntil: null,
          lastLoginAt: null,
        })
        if (!('dryRun' in inserted) && !inserted.inserted)
          return invalid('email', 'website.customer.error.emailInUse')
        await tx.db.insert('website.CustomerCredential', {
          id: accountId,
          accountId,
          passwordHash,
          changedAt: now.toISOString(),
        })
        const account = (await tx.db.select('website.CustomerAccount', { id: accountId }))[0]
        return { ok: true, account: accountView(account!) }
      })
    },
  }),

  authenticateCustomer: defineFn({
    anonymous: true,
    exposure: 'internal',
    input: { realmId: 'id', email: 'text', password: 'text', rateKey: 'text?' },
    output: { ok: 'bool', account: 'json?', errors: 'json?' },
    effects: [
      'read:website.CustomerRealm',
      'read:website.CustomerAccount',
      'write:website.CustomerAccount',
      'read:website.CustomerCredential',
      'read:website.CustomerAuthRateLimit',
      'write:website.CustomerAuthRateLimit',
    ],
    handler: async (ctx: Ctx, args) => {
      const realm = (await ctx.db.select('website.CustomerRealm', { id: args.realmId }))[0]
      if (realm?.active !== true) return invalid('email', 'website.customer.error.invalidCredentials')
      const email = normalizeCustomerEmail(args.email)
      const now = new Date()
      const rateKey = String(args.rateKey ?? 'anonymous').slice(0, 256)
      if (
        !(await claimRateSlot(ctx, String(args.realmId), 'login', rateKey, 10, 15 * 60 * 1000, now)) ||
        !(await claimRateSlot(ctx, String(args.realmId), 'login-email', email, 10, 15 * 60 * 1000, now))
      )
        return invalid('email', 'website.customer.error.rateLimit')
      const account = await accountByEmail(ctx, args.realmId, email)
      const credential = account
        ? (await ctx.db.select('website.CustomerCredential', { accountId: account.id }))[0]
        : null
      const valid = await verifyCustomerPassword(
        String(args.password ?? ''),
        String(credential?.passwordHash ?? CUSTOMER_DUMMY_HASH),
      )
      const locked = account?.lockedUntil && new Date(String(account.lockedUntil)) > now
      if (!valid || !account || account.status !== 'active' || locked) {
        if (account) {
          const failures = Number(account.failedLoginCount ?? 0) + 1
          await ctx.db.update(
            'website.CustomerAccount',
            { id: account.id },
            {
              failedLoginCount: failures,
              lockedUntil: failures >= 10 ? new Date(now.getTime() + 15 * 60 * 1000).toISOString() : null,
            },
          )
        }
        return invalid('email', 'website.customer.error.invalidCredentials')
      }
      await ctx.db.update(
        'website.CustomerAccount',
        { id: account.id },
        { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now.toISOString() },
      )
      return { ok: true, account: accountView({ ...account, failedLoginCount: 0, lockedUntil: null }) }
    },
  }),

  startCustomerSession: defineFn({
    anonymous: true,
    exposure: 'internal',
    input: { id: 'id', accountId: 'id', tokenDigest: 'text', networkFingerprint: 'text?' },
    output: sessionOutput,
    effects: [
      'read:website.CustomerAccount',
      'read:website.CustomerRealm',
      'write:website.CustomerSession',
    ],
    handler: async (ctx: Ctx, args) => {
      const account = (await ctx.db.select('website.CustomerAccount', { id: args.accountId }))[0]
      if (account?.status !== 'active') return null
      const realm = (await ctx.db.select('website.CustomerRealm', { id: account.realmId }))[0]
      if (realm?.active !== true) return null
      const now = new Date()
      const idleSeconds = Math.min(
        Math.max(Number(realm.sessionIdleSeconds ?? DEFAULT_IDLE_SECONDS), 60),
        DEFAULT_ABSOLUTE_SECONDS,
      )
      const absoluteSeconds = Math.min(
        Math.max(Number(realm.sessionAbsoluteSeconds ?? DEFAULT_ABSOLUTE_SECONDS), idleSeconds),
        90 * 24 * 60 * 60,
      )
      const idleExpiresAt = new Date(now.getTime() + idleSeconds * 1000).toISOString()
      const absoluteExpiresAt = new Date(now.getTime() + absoluteSeconds * 1000).toISOString()
      await ctx.db.insert('website.CustomerSession', {
        id: args.id,
        realmId: account.realmId,
        accountId: account.id,
        tokenDigest: args.tokenDigest,
        securityVersion: account.securityVersion,
        createdAt: now.toISOString(),
        lastSeenAt: now.toISOString(),
        idleExpiresAt,
        absoluteExpiresAt,
        revokedAt: null,
        revokeReason: null,
        networkFingerprint: args.networkFingerprint ?? null,
      })
      return {
        id: args.id,
        realmId: account.realmId,
        accountId: account.id,
        partnerId: account.partnerId,
        email: account.email,
        displayName: account.displayName,
        securityVersion: account.securityVersion,
        idleExpiresAt,
        absoluteExpiresAt,
      }
    },
  }),

  resolveCustomerSession: defineFn({
    anonymous: true,
    exposure: 'internal',
    input: { siteId: 'id', tokenDigest: 'text' },
    output: sessionOutput,
    effects: [
      'read:website.CustomerRealmSite',
      'read:website.CustomerSession',
      'write:website.CustomerSession',
      'read:website.CustomerAccount',
      'read:website.CustomerRealm',
    ],
    handler: async (ctx: Ctx, args) => {
      const realm = await realmForSite(ctx, args.siteId)
      if (!realm) return null
      const Session = ctx.table('website.CustomerSession')
      const session = await ctx.db.one(
        from(Session).where(eq(Session.tokenDigest, args.tokenDigest), eq(Session.realmId, realm.id)),
      )
      if (!session || session.revokedAt) return null
      const account = (await ctx.db.select('website.CustomerAccount', { id: session.accountId }))[0]
      const now = new Date()
      if (
        account?.status !== 'active' ||
        Number(account.securityVersion) !== Number(session.securityVersion) ||
        new Date(String(session.idleExpiresAt)) <= now ||
        new Date(String(session.absoluteExpiresAt)) <= now
      )
        return null
      let idleExpiresAt = String(session.idleExpiresAt)
      if (now.getTime() - new Date(String(session.lastSeenAt)).getTime() >= 15 * 60 * 1000) {
        const extended = Math.min(
          now.getTime() + Number(realm.sessionIdleSeconds) * 1000,
          new Date(String(session.absoluteExpiresAt)).getTime(),
        )
        idleExpiresAt = new Date(extended).toISOString()
        await ctx.db.update(
          'website.CustomerSession',
          { id: session.id },
          { lastSeenAt: now.toISOString(), idleExpiresAt },
        )
      }
      return {
        id: session.id,
        realmId: account.realmId,
        accountId: account.id,
        partnerId: account.partnerId,
        email: account.email,
        displayName: account.displayName,
        securityVersion: account.securityVersion,
        idleExpiresAt,
        absoluteExpiresAt: session.absoluteExpiresAt,
      }
    },
  }),

  revokeCustomerSession: defineFn({
    anonymous: true,
    exposure: 'internal',
    input: { tokenDigest: 'text', reason: 'text?' },
    output: { ok: 'bool' },
    effects: ['read:website.CustomerSession', 'write:website.CustomerSession'],
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const Session = ctx.table('website.CustomerSession')
      const session = await ctx.db.one(from(Session).where(eq(Session.tokenDigest, args.tokenDigest)))
      if (session && !session.revokedAt)
        await ctx.db.update(
          'website.CustomerSession',
          { id: session.id },
          { revokedAt: new Date().toISOString(), revokeReason: String(args.reason ?? 'logout').slice(0, 100) },
        )
      return { ok: true }
    },
  }),

  revokeAllCustomerSessions: defineFn({
    anonymous: true,
    exposure: 'internal',
    input: { accountId: 'id', reason: 'text?' },
    output: { ok: 'bool', securityVersion: 'int' },
    effects: [
      'read:website.CustomerAccount',
      'write:website.CustomerAccount',
      'read:website.CustomerSession',
      'write:website.CustomerSession',
    ],
    handler: async (ctx: Ctx, args) => {
      const account = (await ctx.db.select('website.CustomerAccount', { id: args.accountId }))[0]
      if (!account) return null
      const securityVersion = Number(account.securityVersion) + 1
      const revokedAt = new Date().toISOString()
      await ctx.tx(async (tx) => {
        await tx.db.update('website.CustomerAccount', { id: account.id }, { securityVersion })
        const sessions = await tx.db.select('website.CustomerSession', { accountId: account.id })
        for (const session of sessions)
          if (!session.revokedAt)
            await tx.db.update(
              'website.CustomerSession',
              { id: session.id },
              { revokedAt, revokeReason: String(args.reason ?? 'logout-all').slice(0, 100) },
            )
      })
      return { ok: true, securityVersion }
    },
  }),

  updateCustomerProfile: defineFn({
    anonymous: true,
    exposure: 'internal',
    input: { accountId: 'id', displayName: 'text' },
    output: { ok: 'bool', account: 'json?', errors: 'json?' },
    effects: [
      'read:website.CustomerAccount',
      'write:website.CustomerAccount',
      'write:partner.Partner',
    ],
    handler: async (ctx: Ctx, args) => {
      const account = (await ctx.db.select('website.CustomerAccount', { id: args.accountId }))[0]
      if (account?.status !== 'active') return invalid('account', 'website.customer.error.sessionExpired')
      const displayName = String(args.displayName ?? '').trim()
      if (!displayName || displayName.length > 200)
        return invalid('displayName', 'website.customer.error.invalidName')
      await ctx.tx(async (tx) => {
        await tx.db.update('website.CustomerAccount', { id: account.id }, { displayName })
        await tx.db.update('partner.Partner', { id: account.partnerId }, { name: displayName })
      })
      return { ok: true, account: accountView({ ...account, displayName }) }
    },
  }),

  changeCustomerPassword: defineFn({
    anonymous: true,
    exposure: 'internal',
    input: { accountId: 'id', currentPassword: 'text', newPassword: 'text' },
    output: { ok: 'bool', account: 'json?', errors: 'json?' },
    effects: [
      'read:website.CustomerAccount',
      'write:website.CustomerAccount',
      'read:website.CustomerCredential',
      'write:website.CustomerCredential',
      'read:website.CustomerSession',
      'write:website.CustomerSession',
    ],
    handler: async (ctx: Ctx, args) => {
      const account = (await ctx.db.select('website.CustomerAccount', { id: args.accountId }))[0]
      const credential = account
        ? (await ctx.db.select('website.CustomerCredential', { accountId: account.id }))[0]
        : null
      if (
        !account ||
        !credential ||
        !(await verifyCustomerPassword(String(args.currentPassword ?? ''), String(credential.passwordHash)))
      )
        return invalid('currentPassword', 'website.customer.error.invalidCredentials')
      if (!validPassword(args.newPassword))
        return invalid('newPassword', 'website.customer.error.invalidPassword')
      const passwordHash = await hashCustomerPassword(String(args.newPassword))
      const securityVersion = Number(account.securityVersion) + 1
      const now = new Date().toISOString()
      await ctx.tx(async (tx) => {
        await tx.db.update(
          'website.CustomerCredential',
          { id: credential.id },
          { passwordHash, changedAt: now },
        )
        await tx.db.update('website.CustomerAccount', { id: account.id }, { securityVersion })
        const sessions = await tx.db.select('website.CustomerSession', { accountId: account.id })
        for (const session of sessions)
          if (!session.revokedAt)
            await tx.db.update(
              'website.CustomerSession',
              { id: session.id },
              { revokedAt: now, revokeReason: 'password-change' },
            )
      })
      return { ok: true, account: accountView({ ...account, securityVersion }) }
    },
  }),
}
