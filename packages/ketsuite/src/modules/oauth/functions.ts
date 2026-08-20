import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { asc, defineFn, deleteFrom, eq, from, inArray } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { safeOidcUrl } from './protocol.ts'

type Issue = { field: string; code: string; params?: Record<string, unknown> }
const issue = (field: string, code: string, params?: Record<string, unknown>): Issue => ({
  field,
  code,
  ...(params ? { params } : {}),
})
const invalid = (errors: Issue[]) => ({ ok: false, errors })
const nowIso = () => new Date().toISOString()
const digest = (value: string): string => createHash('sha256').update(value).digest('hex')
const timestamp = (value: unknown): number =>
  value instanceof Date ? value.getTime() : Date.parse(String(value ?? ''))
const codeOf = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
const hasUnsafePathCharacter = (value: string): boolean =>
  value.includes('\\') ||
  [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })
const safeReturnTo = (value: unknown): string => {
  const path = String(value ?? '')
  if (!path.startsWith('/') || path.startsWith('//') || hasUnsafePathCharacter(path) || /%5c/i.test(path))
    return '/admin'
  const parsed = new URL(path, 'http://ket.local')
  return parsed.origin === 'http://ket.local' ? `${parsed.pathname}${parsed.search}${parsed.hash}` : '/admin'
}
const normalizeWords = (value: unknown): string[] => [
  ...new Set(
    String(value ?? '')
      .trim()
      .split(/\s+/)
      .filter(Boolean),
  ),
]
const normalizeLogin = (value: unknown): string =>
  String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
const subjectOf = (value: unknown): string | null => {
  const subject = String(value ?? '')
  return subject && Buffer.byteLength(subject) <= 255 && /^[\x20-\x7e]+$/.test(subject) ? subject : null
}

class IdentityLinkRace extends Error {}

const providerFields = {
  id: 'id',
  code: 'text',
  name: 'text',
  protocol: 'text',
  issuer: 'text',
  clientId: 'text',
  clientAuthMethod: 'text',
  clientSecretEnv: 'text?',
  scopes: 'text',
  redirectUri: 'text',
  allowedAlgorithms: 'text',
  allowLinking: 'bool',
  autoProvision: 'bool',
  requireVerifiedEmail: 'bool',
  defaultCompanyId: 'id?',
  defaultRoleId: 'id?',
  sequence: 'int',
  active: 'bool',
  createdAt: 'datetime',
  updatedAt: 'datetime',
} as const

const identityFields = {
  id: 'id',
  providerId: 'id',
  userId: 'id',
  issuer: 'text',
  subject: 'text',
  email: 'text?',
  displayName: 'text?',
  preferredUsername: 'text?',
  lastLoginAt: 'datetime?',
  createdAt: 'datetime',
  updatedAt: 'datetime',
  provider: 'json?',
  user: 'json?',
} as const

const providerById = async (ctx: Ctx, id: unknown): Promise<Row | null> => {
  const P = ctx.table('oauth.Provider')
  return ctx.db.one(from(P).where(eq(P.id, id)))
}

const activeProviderByCode = async (ctx: Ctx, code: unknown): Promise<Row | null> => {
  const P = ctx.table('oauth.Provider')
  return ctx.db.one(from(P).where(eq(P.code, codeOf(code)), eq(P.active, true)))
}

const providerValidation = async (ctx: Ctx, values: Row, id: string): Promise<Issue[]> => {
  const errors: Issue[] = []
  const code = codeOf(values.code)
  if (!/^[a-z][a-z0-9_-]{1,63}$/.test(code)) errors.push(issue('code', 'oauth.error.codeInvalid'))
  if (!String(values.name ?? '').trim()) errors.push(issue('name', 'oauth.error.required'))
  if (values.protocol !== 'oidc') errors.push(issue('protocol', 'oauth.error.protocolUnsupported'))
  const authMethod = String(values.clientAuthMethod ?? '')
  if (!['none', 'client_secret_basic', 'client_secret_post'].includes(authMethod))
    errors.push(issue('clientAuthMethod', 'oauth.error.clientAuthMethod'))
  const secretEnv = String(values.clientSecretEnv ?? '').trim()
  if (authMethod !== 'none' && !/^[A-Z][A-Z0-9_]{1,127}$/.test(secretEnv))
    errors.push(issue('clientSecretEnv', 'oauth.error.secretEnv'))
  if (!String(values.clientId ?? '').trim()) errors.push(issue('clientId', 'oauth.error.required'))

  try {
    const issuer = safeOidcUrl(String(values.issuer ?? '').trim(), 'issuer')
    if (issuer.search) errors.push(issue('issuer', 'oauth.error.issuerInvalid'))
  } catch (error) {
    errors.push(issue('issuer', (error as { code?: string }).code ?? 'oauth.error.issuerInvalid'))
  }
  try {
    const redirect = safeOidcUrl(String(values.redirectUri ?? '').trim(), 'redirectUri')
    if (redirect.search || redirect.pathname !== `/auth/oauth/${code}/callback`)
      errors.push(issue('redirectUri', 'oauth.error.redirectUri'))
  } catch (error) {
    errors.push(issue('redirectUri', (error as { code?: string }).code ?? 'oauth.error.redirectUri'))
  }

  const scopes = normalizeWords(values.scopes)
  if (!scopes.includes('openid')) errors.push(issue('scopes', 'oauth.error.openidScope'))
  const algorithms = normalizeWords(values.allowedAlgorithms)
  if (!algorithms.length || algorithms.some((algorithm) => !['RS256', 'PS256', 'ES256'].includes(algorithm)))
    errors.push(issue('allowedAlgorithms', 'oauth.error.algorithmInvalid'))

  if (values.autoProvision === true) {
    if (!values.defaultCompanyId) errors.push(issue('defaultCompanyId', 'oauth.error.defaultCompanyRequired'))
    else {
      const C = ctx.table('company.Company')
      const B = ctx.table('company.Branch')
      const [company, root] = await Promise.all([
        ctx.db.one(from(C).where(eq(C.id, values.defaultCompanyId), eq(C.active, true))),
        ctx.db.one(from(B).where(eq(B.rootKey, values.defaultCompanyId), eq(B.active, true))),
      ])
      if (!company || !root) errors.push(issue('defaultCompanyId', 'oauth.error.defaultCompanyInvalid'))
    }
  }
  if (values.defaultRoleId) {
    const R = ctx.table('user.Role')
    if (!(await ctx.db.one(from(R).where(eq(R.id, values.defaultRoleId)))))
      errors.push(issue('defaultRoleId', 'oauth.error.defaultRoleInvalid'))
  }

  const P = ctx.table('oauth.Provider')
  const [codeOwner, clientOwner] = await Promise.all([
    ctx.db.one(from(P).where(eq(P.code, code))),
    ctx.db.one(from(P).where(eq(P.issuer, values.issuer), eq(P.clientId, values.clientId))),
  ])
  if (codeOwner && codeOwner.id !== id) errors.push(issue('code', 'oauth.error.codeUnique'))
  if (clientOwner && clientOwner.id !== id) errors.push(issue('clientId', 'oauth.error.issuerClientUnique'))
  return errors
}

const liveSession = async (ctx: Ctx, userId: string) => {
  const U = ctx.table('user.User')
  const user = await ctx.db.one(
    from(U).where(eq(U.id, userId), eq(U.active, true), eq(U.accessKind, 'internal')),
  )
  if (!user) return null
  const M = ctx.table('user.Membership')
  const companyIds = (await ctx.db.all(from(M).where(eq(M.userId, userId)))).map((row) =>
    String(row.companyId),
  )
  if (!companyIds.length) return null
  const C = ctx.table('company.Company')
  const companies = await ctx.db.all(
    from(C).where(inArray(C.id, companyIds), eq(C.active, true)).orderBy(asc(C.code)),
  )
  const readableCompanies = companies.map((row) => String(row.id))
  const defaultCompanyId = readableCompanies.includes(String(user.defaultCompanyId ?? ''))
    ? String(user.defaultCompanyId)
    : (readableCompanies[0] ?? null)
  if (!defaultCompanyId) return null
  const BM = ctx.table('user.BranchMembership')
  const branchIds = (await ctx.db.all(from(BM).where(eq(BM.userId, userId)))).map((row) =>
    String(row.branchId),
  )
  const B = ctx.table('company.Branch')
  const branches = branchIds.length
    ? await ctx.db.all(from(B).where(inArray(B.id, branchIds), eq(B.active, true)).orderBy(asc(B.code)))
    : []
  const readableBranches = branches
    .filter((row) => readableCompanies.includes(String(row.companyId)))
    .map((row) => String(row.id))
  const defaultBranchId =
    branches.find((row) => row.id === user.defaultBranchId && String(row.companyId) === defaultCompanyId)
      ?.id ??
    branches.find((row) => String(row.companyId) === defaultCompanyId)?.id ??
    null
  if (!defaultBranchId) return null
  return {
    ok: true,
    userId: user.id,
    companies: readableCompanies,
    defaultCompanyId,
    branches: readableBranches,
    defaultBranchId,
    securityVersion: Number(user.securityVersion ?? 0),
  }
}

const audit = async (ctx: Ctx, event: string, userId: unknown, metadata: Record<string, unknown>) => {
  await ctx.db.insert('user.SecurityAudit', {
    id: randomUUID(),
    userId: userId || null,
    event,
    occurredAt: nowIso(),
    networkFingerprint: null,
    metadata,
  })
}

const externalIdentity = async (ctx: Ctx, providerId: unknown, issuer: unknown, subject: unknown) => {
  const E = ctx.table('oauth.ExternalIdentity')
  return ctx.db.one(from(E).where(eq(E.providerId, providerId), eq(E.issuer, issuer), eq(E.subject, subject)))
}

const safeIdentityRows = (rows: Row[]): Row[] =>
  rows.map((row) => {
    const provider = row.provider as Row | null
    const user = row.user as Row | null
    return {
      ...row,
      provider: provider ? { id: provider.id, code: provider.code, name: provider.name } : null,
      user: user ? { id: user.id, login: user.login, name: user.name } : null,
    }
  })

const provisionLogin = async (
  ctx: Ctx,
  provider: Row,
  input: {
    issuer: string
    subject: string
    email?: string | null
    emailVerified?: boolean
    displayName?: string | null
    preferredUsername?: string | null
  },
) => {
  if (provider.autoProvision !== true) return invalid([issue('subject', 'oauth.error.identityUnlinked')])
  if (provider.requireVerifiedEmail === true && (!input.email || input.emailVerified !== true))
    return invalid([issue('email', 'oauth.error.verifiedEmailRequired')])
  if (!provider.defaultCompanyId) return invalid([issue('providerId', 'oauth.error.defaultCompanyRequired')])
  const C = ctx.table('company.Company')
  const B = ctx.table('company.Branch')
  const [company, root] = await Promise.all([
    ctx.db.one(from(C).where(eq(C.id, provider.defaultCompanyId), eq(C.active, true))),
    ctx.db.one(from(B).where(eq(B.rootKey, provider.defaultCompanyId), eq(B.active, true))),
  ])
  if (!company || !root) return invalid([issue('providerId', 'oauth.error.defaultCompanyInvalid')])

  const identityHash = digest(`${input.issuer}\n${input.subject}`)
  const userId = `oauth:${provider.code}:${identityHash.slice(0, 24)}`
  const U = ctx.table('user.User')
  const preferred = normalizeLogin(input.preferredUsername || input.email || '')
  const preferredOwner = preferred ? await ctx.db.one(from(U).where(eq(U.login, preferred))) : null
  const login = preferred && !preferredOwner ? preferred : `${provider.code}.${identityHash.slice(0, 16)}`
  const at = nowIso()
  try {
    return await ctx.tx(async (tx) => {
      const held = await externalIdentity(tx, provider.id, input.issuer, input.subject)
      if (held) return { ok: true, userId: held.userId }
      const insertedUser = await tx.db.insertIfAbsent('user.User', {
        id: userId,
        login,
        passwordHash: null,
        partnerId: null,
        name: String(input.displayName || input.preferredUsername || input.email || `${provider.name} user`),
        email: input.email || null,
        lang: null,
        defaultCompanyId: provider.defaultCompanyId,
        defaultBranchId: root.id,
        accessKind: 'internal',
        securityVersion: 0,
        lastLoginAt: at,
        superuser: false,
        active: true,
      })
      if (!('dryRun' in insertedUser) && !insertedUser.inserted) {
        const existingUser = await tx.db.one(
          from(tx.table('user.User')).where(eq(tx.table('user.User').id, userId)),
        )
        if (!existingUser) {
          const fallback = await tx.db.insertIfAbsent('user.User', {
            id: userId,
            login: `${provider.code}.${identityHash.slice(0, 16)}`,
            passwordHash: null,
            partnerId: null,
            name: String(
              input.displayName || input.preferredUsername || input.email || `${provider.name} user`,
            ),
            email: input.email || null,
            lang: null,
            defaultCompanyId: provider.defaultCompanyId,
            defaultBranchId: root.id,
            accessKind: 'internal',
            securityVersion: 0,
            lastLoginAt: at,
            superuser: false,
            active: true,
          })
          if (!('dryRun' in fallback) && !fallback.inserted)
            return invalid([issue('subject', 'oauth.error.provisionConflict')])
        }
      }
      await tx.db.insertIfAbsent('user.Membership', {
        id: `oauth:${userId}:${provider.defaultCompanyId}`,
        userId,
        companyId: provider.defaultCompanyId,
      })
      await tx.db.insertIfAbsent('user.BranchMembership', {
        id: `oauth:${userId}:${root.id}`,
        userId,
        branchId: root.id,
      })
      if (provider.defaultRoleId)
        await tx.db.insertIfAbsent('user.Assignment', {
          id: `oauth:${userId}:${provider.defaultRoleId}`,
          userId,
          roleId: provider.defaultRoleId,
        })
      const insertedIdentity = await tx.db.insertIfAbsent('oauth.ExternalIdentity', {
        id: `oauth:${provider.code}:${identityHash}`,
        providerId: provider.id,
        userId,
        issuer: input.issuer,
        subject: input.subject,
        email: input.email || null,
        displayName: input.displayName || null,
        preferredUsername: input.preferredUsername || null,
        lastLoginAt: at,
        createdAt: at,
        updatedAt: at,
      })
      if (!('dryRun' in insertedIdentity) && !insertedIdentity.inserted) {
        const winner = await externalIdentity(tx, provider.id, input.issuer, input.subject)
        if (!winner) return invalid([issue('subject', 'oauth.error.identityConflict')])
        if (winner.userId !== userId) throw new IdentityLinkRace()
        return { ok: true, userId: winner.userId }
      }
      return { ok: true, userId }
    })
  } catch (error) {
    if (!(error instanceof IdentityLinkRace)) throw error
    const winner = await externalIdentity(ctx, provider.id, input.issuer, input.subject)
    return winner
      ? { ok: true, userId: winner.userId }
      : invalid([issue('subject', 'oauth.error.identityConflict')])
  }
}

export const functions: Record<string, FnSpec> = {
  listProviders: defineFn({
    input: { includeArchived: 'bool?' },
    output: providerFields,
    effects: ['read:oauth.Provider'],
    handler: (ctx: Ctx, a) => {
      const P = ctx.table('oauth.Provider')
      const query = from(P).orderBy(asc(P.sequence), asc(P.name))
      return ctx.db.all(a.includeArchived === true ? query : query.where(eq(P.active, true)))
    },
  }),

  getProvider: defineFn({
    input: { id: 'id' },
    output: providerFields,
    effects: ['read:oauth.Provider'],
    handler: (ctx: Ctx, a) => providerById(ctx, a.id),
  }),

  publicProviders: defineFn({
    anonymous: true,
    input: {},
    output: { id: 'id', code: 'text', name: 'text', sequence: 'int' },
    effects: ['read:oauth.Provider'],
    handler: (ctx: Ctx) => {
      const P = ctx.table('oauth.Provider')
      return ctx.db.all(
        from(P)
          .where(eq(P.active, true))
          .orderBy(asc(P.sequence), asc(P.name))
          .select(P.id, P.code, P.name, P.sequence),
      )
    },
  }),

  providerForLogin: defineFn({
    anonymous: true,
    exposure: 'internal',
    input: { code: 'text' },
    output: providerFields,
    effects: ['read:oauth.Provider'],
    handler: (ctx: Ctx, a) => activeProviderByCode(ctx, a.code),
  }),

  saveProvider: defineFn({
    input: {
      id: 'id',
      code: 'text',
      name: 'text',
      protocol: 'text?',
      issuer: 'text',
      clientId: 'text',
      clientAuthMethod: 'text?',
      clientSecretEnv: 'text?',
      scopes: 'text?',
      redirectUri: 'text',
      allowedAlgorithms: 'text?',
      allowLinking: 'bool?',
      autoProvision: 'bool?',
      requireVerifiedEmail: 'bool?',
      defaultCompanyId: 'id?',
      defaultRoleId: 'id?',
      sequence: 'int?',
      active: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:oauth.Provider',
      'write:oauth.Provider',
      'read:company.Company',
      'read:company.Branch',
      'read:user.Role',
    ],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const P = ctx.table('oauth.Provider')
      const existing = await ctx.db.one(from(P).where(eq(P.id, a.id)))
      const at = nowIso()
      const values: Row = {
        id: a.id,
        code: codeOf(a.code),
        name: String(a.name).trim(),
        protocol: String(a.protocol ?? 'oidc'),
        issuer: String(a.issuer).trim(),
        clientId: String(a.clientId).trim(),
        clientAuthMethod: String(a.clientAuthMethod ?? 'none'),
        clientSecretEnv: String(a.clientSecretEnv ?? '').trim() || null,
        scopes: normalizeWords(a.scopes ?? 'openid profile email').join(' '),
        redirectUri: String(a.redirectUri).trim(),
        allowedAlgorithms: normalizeWords(a.allowedAlgorithms ?? 'RS256').join(' '),
        allowLinking: a.allowLinking !== false,
        autoProvision: a.autoProvision === true,
        requireVerifiedEmail: a.requireVerifiedEmail !== false,
        defaultCompanyId: a.defaultCompanyId || null,
        defaultRoleId: a.defaultRoleId || null,
        sequence: Number(a.sequence ?? 10),
        active: a.active !== false,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
      }
      const errors = await providerValidation(ctx, values, String(a.id))
      if (errors.length) return invalid(errors)
      if (existing) {
        const { id: _, ...patch } = values
        await ctx.db.update('oauth.Provider', { id: a.id }, patch)
        return { ok: true, id: a.id }
      }
      const inserted = await ctx.db.insertIfAbsent('oauth.Provider', values)
      return 'dryRun' in inserted || inserted.inserted
        ? { ok: true, id: a.id }
        : invalid([issue('code', 'oauth.error.providerConflict')])
    },
  }),

  archiveProvider: defineFn({
    input: { id: 'id', active: 'bool' },
    output: { ok: 'bool', id: 'id?', active: 'bool?', errors: 'json?' },
    effects: ['read:oauth.Provider', 'write:oauth.Provider'],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      if (!(await providerById(ctx, a.id))) return invalid([issue('id', 'oauth.error.providerMissing')])
      await ctx.db.update('oauth.Provider', { id: a.id }, { active: a.active, updatedAt: nowIso() })
      return { ok: true, id: a.id, active: a.active }
    },
  }),

  manageOptions: defineFn({
    input: {},
    output: { companies: 'json', roles: 'json', users: 'json' },
    effects: ['read:company.Company', 'read:partner.Partner', 'read:user.Role', 'read:user.User'],
    handler: async (ctx: Ctx) => {
      const C = ctx.table('company.Company')
      const R = ctx.table('user.Role')
      const U = ctx.table('user.User')
      const [companies, roles, users] = await Promise.all([
        ctx.db.all(from(C).where(eq(C.active, true)).orderBy(asc(C.code)).preload('partner')),
        ctx.db.all(from(R).orderBy(asc(R.name))),
        ctx.db.all(from(U).where(eq(U.active, true), eq(U.accessKind, 'internal')).orderBy(asc(U.login))),
      ])
      return {
        companies: companies.map((row) => ({
          id: row.id,
          name: (row.partner as Row | null)?.name ?? row.code,
        })),
        roles: roles.map((row) => ({ id: row.id, name: row.name })),
        users: users.map((row) => ({ id: row.id, name: row.name, login: row.login })),
      }
    },
  }),

  listIdentities: defineFn({
    input: { providerId: 'id?', userId: 'id?' },
    output: identityFields,
    effects: ['read:oauth.ExternalIdentity', 'read:oauth.Provider', 'read:user.User'],
    handler: async (ctx: Ctx, a) => {
      const E = ctx.table('oauth.ExternalIdentity')
      let query = from(E).orderBy(asc(E.providerId), asc(E.subject)).preload('provider').preload('user')
      if (a.providerId) query = query.where(eq(E.providerId, a.providerId))
      if (a.userId) query = query.where(eq(E.userId, a.userId))
      return safeIdentityRows(await ctx.db.all(query))
    },
  }),

  myIdentities: defineFn({
    anonymous: true,
    input: {},
    output: identityFields,
    effects: ['read:oauth.ExternalIdentity', 'read:oauth.Provider', 'read:user.User'],
    handler: async (ctx: Ctx) => {
      if (!ctx.actor) return []
      const E = ctx.table('oauth.ExternalIdentity')
      return safeIdentityRows(
        await ctx.db.all(
          from(E)
            .where(eq(E.userId, ctx.actor))
            .orderBy(asc(E.providerId), asc(E.subject))
            .preload('provider')
            .preload('user'),
        ),
      )
    },
  }),

  linkIdentity: defineFn({
    input: {
      id: 'id',
      providerId: 'id',
      userId: 'id',
      subject: 'text',
      email: 'text?',
      displayName: 'text?',
      preferredUsername: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:oauth.Provider',
      'read:oauth.ExternalIdentity',
      'write:oauth.ExternalIdentity',
      'read:user.User',
      'write:user.SecurityAudit',
    ],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const provider = await providerById(ctx, a.providerId)
      if (!provider) return invalid([issue('providerId', 'oauth.error.providerMissing')])
      const U = ctx.table('user.User')
      if (
        !(await ctx.db.one(
          from(U).where(eq(U.id, a.userId), eq(U.active, true), eq(U.accessKind, 'internal')),
        ))
      )
        return invalid([issue('userId', 'oauth.error.userInvalid')])
      const subject = subjectOf(a.subject)
      if (!subject) return invalid([issue('subject', 'oauth.error.subjectInvalid')])
      return ctx.tx(async (tx) => {
        const held = await externalIdentity(tx, provider.id, provider.issuer, subject)
        if (held)
          return held.userId === a.userId
            ? { ok: true, id: held.id }
            : invalid([issue('subject', 'oauth.error.identityConflict')])
        const at = nowIso()
        const inserted = await tx.db.insertIfAbsent('oauth.ExternalIdentity', {
          id: a.id,
          providerId: provider.id,
          userId: a.userId,
          issuer: provider.issuer,
          subject,
          email: a.email || null,
          displayName: a.displayName || null,
          preferredUsername: a.preferredUsername || null,
          lastLoginAt: null,
          createdAt: at,
          updatedAt: at,
        })
        if (!('dryRun' in inserted) && !inserted.inserted)
          return invalid([issue('subject', 'oauth.error.identityConflict')])
        await audit(tx, 'oauth.identity.link.admin', a.userId, {
          provider: provider.code,
          subject: digest(subject),
        })
        return { ok: true, id: a.id }
      })
    },
  }),

  unlinkIdentity: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', removed: 'int?', errors: 'json?' },
    effects: [
      'read:oauth.ExternalIdentity',
      'write:oauth.ExternalIdentity',
      'read:user.User',
      'write:user.User',
      'write:user.SecurityAudit',
    ],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      return ctx.tx(async (tx) => {
        const E = tx.table('oauth.ExternalIdentity')
        const row = await tx.db.one(from(E).where(eq(E.id, a.id)))
        if (!row) return { ok: true, removed: 0 }
        const U = tx.table('user.User')
        const user = await tx.db.one(from(U).where(eq(U.id, row.userId)))
        if (user?.active === true && !user.passwordHash) {
          const count = await tx.db.count(from(E).where(eq(E.userId, row.userId)))
          if (count <= 1) return invalid([issue('id', 'oauth.error.lastLoginMethod')])
          const version = Number(user.securityVersion ?? 0)
          const claimed = await tx.db.compareAndSet(
            'user.User',
            { id: user.id },
            { securityVersion: version },
            { securityVersion: version + 1 },
          )
          if (!('dryRun' in claimed) && !claimed.matched)
            return invalid([issue('id', 'oauth.error.identityChanged')])
        }
        const { changes } = await tx.db.del(deleteFrom(E).where(eq(E.id, a.id)))
        if (changes)
          await audit(tx, 'oauth.identity.unlink.admin', row.userId, {
            provider: row.providerId,
            subject: digest(String(row.subject)),
          })
        return { ok: true, removed: changes }
      })
    },
  }),

  beginTransaction: defineFn({
    anonymous: true,
    exposure: 'internal',
    input: { providerId: 'id', mode: 'text?', linkUserId: 'id?', returnTo: 'text?', discovery: 'json' },
    output: {
      ok: 'bool',
      state: 'text?',
      nonce: 'text?',
      codeVerifier: 'text?',
      expiresAt: 'datetime?',
      errors: 'json?',
    },
    effects: ['read:oauth.Provider', 'write:oauth.Transaction'],
    handler: async (ctx: Ctx, a) => {
      const provider = await providerById(ctx, a.providerId)
      if (provider?.active !== true) return invalid([issue('providerId', 'oauth.error.providerUnavailable')])
      const mode = String(a.mode ?? 'login')
      if (!['login', 'link'].includes(mode)) return invalid([issue('mode', 'oauth.error.modeInvalid')])
      if (mode === 'link' && (provider.allowLinking !== true || !ctx.actor || ctx.actor !== a.linkUserId))
        return invalid([issue('mode', 'oauth.error.linkUnauthorized')])
      const discovery = (a.discovery ?? {}) as Row
      if (discovery.issuer !== provider.issuer)
        return invalid([issue('discovery', 'oauth.error.issuerMismatch')])
      try {
        safeOidcUrl(String(discovery.authorizationEndpoint ?? ''), 'authorization_endpoint')
        safeOidcUrl(String(discovery.tokenEndpoint ?? ''), 'token_endpoint')
        safeOidcUrl(String(discovery.jwksUri ?? ''), 'jwks_uri')
      } catch (error) {
        return invalid([
          issue('discovery', (error as { code?: string }).code ?? 'oauth.error.discoveryInvalid'),
        ])
      }
      const state = randomBytes(32).toString('base64url')
      const nonce = randomBytes(32).toString('base64url')
      const codeVerifier = randomBytes(48).toString('base64url')
      const at = Date.now()
      const expiresAt = new Date(at + 10 * 60_000).toISOString()
      await ctx.db.insert('oauth.Transaction', {
        id: randomUUID(),
        stateDigest: digest(state),
        providerId: provider.id,
        mode,
        linkUserId: mode === 'link' ? a.linkUserId : null,
        issuer: provider.issuer,
        redirectUri: provider.redirectUri,
        nonceDigest: digest(nonce),
        codeVerifier,
        discovery,
        returnTo: safeReturnTo(a.returnTo),
        providerUpdatedAt: provider.updatedAt,
        expiresAt,
        consumedAt: null,
        createdAt: new Date(at).toISOString(),
      })
      return { ok: true, state, nonce, codeVerifier, expiresAt }
    },
  }),

  claimTransaction: defineFn({
    anonymous: true,
    exposure: 'internal',
    input: { providerId: 'id', state: 'text' },
    output: {
      ok: 'bool',
      providerId: 'id?',
      mode: 'text?',
      linkUserId: 'id?',
      issuer: 'text?',
      redirectUri: 'text?',
      nonceDigest: 'text?',
      codeVerifier: 'text?',
      discovery: 'json?',
      returnTo: 'text?',
      providerUpdatedAt: 'datetime?',
      errors: 'json?',
    },
    effects: ['read:oauth.Transaction', 'write:oauth.Transaction'],
    handler: async (ctx: Ctx, a) => {
      const T = ctx.table('oauth.Transaction')
      const row = await ctx.db.one(from(T).where(eq(T.stateDigest, digest(String(a.state)))))
      if (!row || row.providerId !== a.providerId || row.consumedAt || timestamp(row.expiresAt) <= Date.now())
        return invalid([issue('state', 'oauth.error.transactionInvalid')])
      const consumedAt = nowIso()
      const claimed = await ctx.db.compareAndSet(
        'oauth.Transaction',
        { id: row.id },
        { stateDigest: row.stateDigest, consumedAt: null },
        { consumedAt },
      )
      if (!('dryRun' in claimed) && !claimed.matched)
        return invalid([issue('state', 'oauth.error.transactionInvalid')])
      await ctx.db.del(deleteFrom(T).where(eq(T.id, row.id)))
      return { ok: true, ...row, consumedAt: undefined, stateDigest: undefined, id: undefined }
    },
  }),

  resolveLogin: defineFn({
    anonymous: true,
    exposure: 'internal',
    input: {
      providerId: 'id',
      providerUpdatedAt: 'datetime',
      mode: 'text',
      linkUserId: 'id?',
      issuer: 'text',
      subject: 'text',
      email: 'text?',
      emailVerified: 'bool?',
      displayName: 'text?',
      preferredUsername: 'text?',
    },
    output: {
      ok: 'bool',
      userId: 'id?',
      companies: 'json?',
      defaultCompanyId: 'id?',
      branches: 'json?',
      defaultBranchId: 'id?',
      securityVersion: 'int?',
      linked: 'bool?',
      errors: 'json?',
    },
    effects: [
      'read:oauth.Provider',
      'read:oauth.ExternalIdentity',
      'write:oauth.ExternalIdentity',
      'read:user.User',
      'write:user.User',
      'read:user.Membership',
      'write:user.Membership',
      'read:user.BranchMembership',
      'write:user.BranchMembership',
      'write:user.Assignment',
      'write:user.SecurityAudit',
      'read:company.Company',
      'read:company.Branch',
    ],
    handler: async (ctx: Ctx, a) => {
      const provider = await providerById(ctx, a.providerId)
      if (
        provider?.active !== true ||
        provider.issuer !== a.issuer ||
        timestamp(provider.updatedAt) !== timestamp(a.providerUpdatedAt)
      )
        return invalid([issue('providerId', 'oauth.error.providerChanged')])
      const subject = subjectOf(a.subject)
      if (!subject) return invalid([issue('subject', 'oauth.error.subjectInvalid')])
      let identity = await externalIdentity(ctx, provider.id, provider.issuer, subject)
      let userId: string | null = identity ? String(identity.userId) : null

      if (String(a.mode) === 'link') {
        if (!provider.allowLinking || !ctx.actor || ctx.actor !== a.linkUserId)
          return invalid([issue('mode', 'oauth.error.linkUnauthorized')])
        if (identity && identity.userId !== a.linkUserId)
          return invalid([issue('subject', 'oauth.error.identityConflict')])
        if (!identity) {
          const at = nowIso()
          const inserted = await ctx.db.insertIfAbsent('oauth.ExternalIdentity', {
            id: `oauth:${provider.code}:${digest(`${provider.issuer}\n${subject}`)}`,
            providerId: provider.id,
            userId: a.linkUserId,
            issuer: provider.issuer,
            subject,
            email: a.email || null,
            displayName: a.displayName || null,
            preferredUsername: a.preferredUsername || null,
            lastLoginAt: at,
            createdAt: at,
            updatedAt: at,
          })
          if (!('dryRun' in inserted) && !inserted.inserted)
            return invalid([issue('subject', 'oauth.error.identityConflict')])
          userId = String(a.linkUserId)
          identity = await externalIdentity(ctx, provider.id, provider.issuer, subject)
        }
      } else if (!identity) {
        const provisioned = await provisionLogin(ctx, provider, {
          issuer: String(a.issuer),
          subject,
          email: a.email ? String(a.email) : null,
          emailVerified: a.emailVerified === true,
          displayName: a.displayName ? String(a.displayName) : null,
          preferredUsername: a.preferredUsername ? String(a.preferredUsername) : null,
        })
        if (provisioned.ok !== true || !('userId' in provisioned) || !provisioned.userId) return provisioned
        userId = String(provisioned.userId)
        identity = await externalIdentity(ctx, provider.id, provider.issuer, subject)
      }

      if (!userId) return invalid([issue('subject', 'oauth.error.identityUnlinked')])
      return ctx.tx(async (tx) => {
        const session = await liveSession(tx, userId)
        if (!session) return invalid([issue('userId', 'oauth.error.userUnavailable')])
        const at = nowIso()
        if (identity)
          await tx.db.update(
            'oauth.ExternalIdentity',
            { id: identity.id },
            {
              email: a.email || identity.email || null,
              displayName: a.displayName || identity.displayName || null,
              preferredUsername: a.preferredUsername || identity.preferredUsername || null,
              lastLoginAt: at,
              updatedAt: at,
            },
          )
        await tx.db.update('user.User', { id: userId }, { lastLoginAt: at })
        await audit(tx, String(a.mode) === 'link' ? 'oauth.identity.link' : 'oauth.login.success', userId, {
          provider: provider.code,
          subject: digest(subject),
        })
        return { ...session, linked: String(a.mode) === 'link' }
      })
    },
  }),
}
