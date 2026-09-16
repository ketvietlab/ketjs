// The record-modal context for a user (KetSuite record-modal contract).
//
// The users collection opens a person — and its create action — in a client-side
// modal. One permission-checked read hands that modal everything it renders: the
// record or its defaults, the workplaces and roles its form may offer, what the
// viewer may do, and the authorization revision a role assignment must carry. The
// view never fetches anything else, so a reader sees one loading state and the
// server stays the only place that decides what is allowed.

import { and, defineFn, desc, eq, from, isNotNull } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { AUTHORIZATION_EFFECTS, authorizationRevisionOf, effectiveFunctionKeys } from './authorization.ts'

type Lang = 'vi' | 'en'
type Can = (fn: string) => boolean

/** Message prefixes the user views read. */
const MESSAGE_PREFIXES = ['user_backend.', 'user.']

const messagesFor = (ctx: Ctx, lang: Lang): Record<string, string> => {
  const catalog = ctx.manifest.messages?.[lang] ?? {}
  const out: Record<string, string> = {}
  for (const [key, message] of Object.entries(catalog)) {
    if (!MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) continue
    out[key] =
      typeof message === 'string' ? message : String(message.other ?? Object.values(message)[0] ?? key)
  }
  return out
}

const readEffects = AUTHORIZATION_EFFECTS.filter((effect) => !effect.startsWith('write:'))

/** What the actor may call. A superuser (null) may call everything; no actor, nothing. */
const permissionCheck = async (ctx: Ctx): Promise<Can> => {
  const allowed = ctx.actor ? await effectiveFunctionKeys(ctx, ctx.actor) : []
  return (fn) => allowed === null || allowed.includes(fn)
}

const byName = (a: Row, b: Row) =>
  String(a.name ?? '').localeCompare(String(b.name ?? '')) || String(a.id).localeCompare(String(b.id))

/**
 * The roles this modal may offer, which is exactly the set the server will accept.
 *
 * `assertAssignableRoles` takes a managed role whose stored template still matches
 * the one this deployment ships; anything else — a custom role, a row written
 * before the managed-role migration, a role left behind by a template that has
 * moved on — is refused. Offering a wider list would put choices on screen that
 * only fail on submit.
 */
const assignableRoles = async (ctx: Ctx): Promise<Row[]> =>
  (await ctx.db.select('user.Role'))
    .filter((role) => {
      if (String(role.mode ?? '') !== 'managed') return false
      const template = ctx.manifest.permissions.roleTemplates[String(role.templateKey)]
      return (
        !!template &&
        template.version === Number(role.templateVersion) &&
        template.digest === role.templateDigest
      )
    })
    .map((role): Row => ({ id: String(role.id), name: String(role.name ?? role.id) }))
    .sort(byName)

/**
 * What a company is called.
 *
 * A company row holds no name: its party record does, and the business code is
 * what stands in when there is no party. Reading `name` off the company row gives
 * the reader a uuid.
 */
const companyNames = async (ctx: Ctx): Promise<Map<string, string>> => {
  const companies = await ctx.db.select('company.Company')
  const partners = new Map(
    (await ctx.db.select('partner.Partner')).map((row) => [String(row.id), String(row.name ?? '')]),
  )
  return new Map(
    companies.map((company) => [
      String(company.id),
      partners.get(String(company.partnerId)) || String(company.code ?? company.id),
    ]),
  )
}

const workplaces = async (ctx: Ctx): Promise<{ companies: Row[]; branches: Row[] }> => {
  const names = await companyNames(ctx)
  const companies = (await ctx.db.select('company.Company', { active: true }))
    .map(
      (company): Row => ({
        id: String(company.id),
        name: names.get(String(company.id)) ?? String(company.id),
      }),
    )
    .sort(byName)
  const known = new Set(companies.map((company) => String(company.id)))
  const branches = (await ctx.db.select('company.Branch', { active: true }))
    .filter((branch) => known.has(String(branch.companyId)))
    .map(
      (branch): Row => ({
        id: String(branch.id),
        name: String(branch.name ?? branch.id),
        companyId: String(branch.companyId),
      }),
    )
    .sort(byName)
  return { companies, branches }
}

/**
 * What this person holds today: one row per assignment, named and placed.
 *
 * The access tab reads these; the overview counts them. A role removed from the
 * catalogue still shows its assignment, marked by its id, because hiding it would
 * hide authority the person still carries.
 */
const assignmentsOf = async (ctx: Ctx, userId: string): Promise<Row[]> => {
  const roles = new Map(
    (await ctx.db.select('user.Role')).map((role) => [String(role.id), String(role.name ?? role.id)]),
  )
  const companies = await companyNames(ctx)
  const branches = new Map(
    (await ctx.db.select('company.Branch')).map((row) => [String(row.id), String(row.name ?? row.id)]),
  )
  return (await ctx.db.select('user.Assignment', { userId })).map((assignment): Row => {
    const companyId = assignment.companyId ? String(assignment.companyId) : ''
    const branchId = assignment.branchId ? String(assignment.branchId) : ''
    return {
      id: String(assignment.id),
      roleId: String(assignment.roleId),
      roleName: roles.get(String(assignment.roleId)) ?? String(assignment.roleId),
      scopeKind: String(assignment.scopeKind ?? 'tenant'),
      companyId: companyId || null,
      branchId: branchId || null,
      // The scope as the remove path names it. A tenant assignment stores no scope
      // key at all, and `unassignScopedRole` matches that null against 'tenant'.
      scopeKey: String(assignment.scopeKey ?? 'tenant'),
      company: companyId ? (companies.get(companyId) ?? companyId) : null,
      branch: branchId ? (branches.get(branchId) ?? branchId) : null,
    }
  })
}

/**
 * What was done to this person's authority, newest first.
 *
 * The log tab reads these. It is a separate permission from opening the record:
 * a viewer may be allowed to see who somebody is without being allowed to read
 * the history of who gave them what.
 */
const authorizationAuditOf = async (ctx: Ctx, userId: string): Promise<Row[]> => {
  const A = ctx.table('user.SecurityAudit')
  const rows = await ctx.db.all(
    from(A)
      // By `userId`, which is the person the authority belongs to. `targetId` is the
      // assignment row, so filtering on it would drop every removal from the log —
      // exactly the entries that take authority away.
      .where(and(eq(A.userId, userId), isNotNull(A.authorizationRevision)))
      .orderBy(desc(A.authorizationRevision), desc(A.id))
      .limit(AUDIT_PAGE),
  )
  return rows.map((row): Row => {
    const metadata = (row.metadata ?? {}) as { roleIds?: unknown; roleId?: unknown }
    const roleIds = Array.isArray(metadata.roleIds)
      ? metadata.roleIds.map(String)
      : metadata.roleId
        ? [String(metadata.roleId)]
        : []
    return {
      id: String(row.id),
      event: String(row.event ?? ''),
      occurredAt: row.occurredAt ? String(row.occurredAt) : null,
      actor: row.actorKey ? String(row.actorKey) : null,
      reason: row.reason ? String(row.reason) : null,
      scopeKey: row.scopeKey ? String(row.scopeKey) : 'tenant',
      outcome: String(row.outcome ?? 'success'),
      roleIds,
    }
  })
}

/** How much of the log one read carries. A tab is a window, not an export. */
const AUDIT_PAGE = 50

const newUserRecord = (): Row => ({
  id: '',
  name: '',
  login: '',
  email: '',
  accessKind: 'internal',
  active: true,
  superuser: false,
})

export const userModalContextFunctions: Record<string, FnSpec> = {
  userModalContext: defineFn({
    input: { id: 'id?', locale: 'text?' },
    effects: [
      ...readEffects,
      'read:user.User',
      'read:user.Role',
      'read:user.Assignment',
      'read:company.Company',
      'read:company.Branch',
      // A company is named by its party record.
      'read:partner.Partner',
      // The log tab reads what was done to this person's authority.
      'read:user.SecurityAudit',
    ],
    handler: async (ctx, args) => {
      const can = await permissionCheck(ctx)
      const permissions = {
        create: can('user.createUser'),
        save: can('user.saveUser'),
        // Each names the function the access tab would actually call, so a viewer is
        // never offered a control whose command the server then refuses.
        assign: can('user.assignRoles'),
        remove: can('user.unassignScopedRole'),
        preview: can('user.previewRoleAssignment'),
        resetPassword: can('user.issueAuthToken'),
        audit: can('user.listAuthorizationAudit'),
      }
      const creating = !args.id
      // The modal is a read of a person, so it answers only a viewer allowed that read:
      // the create form's choices to whoever may create one, an existing record to
      // whoever may open a user. Neither is inferred from the other.
      if (creating ? !permissions.create : !can('user.getUser')) return null
      const record = creating
        ? newUserRecord()
        : ((await ctx.db.select('user.User', { id: args.id }))[0] ?? null)
      if (!record) return null
      const { companies, branches } = await workplaces(ctx)
      const lang: Lang = args.locale === 'en' ? 'en' : 'vi'
      return {
        data: {
          record: {
            id: String(record.id ?? ''),
            name: String(record.name ?? ''),
            login: String(record.login ?? ''),
            email: String(record.email ?? ''),
            accessKind: String(record.accessKind ?? 'internal'),
            active: record.active !== false,
            // Carried so saving a profile cannot quietly drop or grant it; the form
            // never offers it, because who may mint a superuser is its own decision.
            superuser: record.superuser === true,
            // Whether they have ever signed in is what the login tab reports, and
            // what tells a prepared account from a live one.
            lastLoginAt: record.lastLoginAt ? String(record.lastLoginAt) : null,
            passwordReady: !!record.passwordHash,
          },
          companies,
          branches,
          assignments: creating ? [] : await assignmentsOf(ctx, String(args.id)),
          audit: creating || !permissions.audit ? [] : await authorizationAuditOf(ctx, String(args.id)),
          roles: await assignableRoles(ctx),
          scopeKinds: ['company', 'branch', 'tenant'],
          // The revision a write must carry. It has to be read the way the writers
          // read it: a different row id here is a revision that never moves, which
          // every write then refuses as stale.
          revision: await authorizationRevisionOf(ctx),
          permissions,
          lang,
        },
        messages: messagesFor(ctx, lang),
      }
    },
  }),
}
