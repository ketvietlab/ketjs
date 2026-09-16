// The record-modal context for a user (KetSuite record-modal contract).
//
// The users collection opens a person — and its create action — in a client-side
// modal. One permission-checked read hands that modal everything it renders: the
// record or its defaults, the workplaces and roles its form may offer, what the
// viewer may do, and the authorization revision a role assignment must carry. The
// view never fetches anything else, so a reader sees one loading state and the
// server stays the only place that decides what is allowed.

import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { AUTHORIZATION_EFFECTS, effectiveFunctionKeys } from './authorization.ts'

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
 * The roles a create form may offer.
 *
 * Managed roles only: a custom role is a local edit of one deployment's policy and
 * is assigned from the access tab, where its provenance is on screen. A role row
 * written before the managed-role migration has no mode and is not offered either.
 */
const assignableRoles = async (ctx: Ctx): Promise<Row[]> =>
  (await ctx.db.select('user.Role'))
    .filter((role) => String(role.mode ?? '') === 'managed')
    .map((role): Row => ({ id: String(role.id), name: String(role.name ?? role.id) }))
    .sort(byName)

const workplaces = async (ctx: Ctx): Promise<{ companies: Row[]; branches: Row[] }> => {
  const companies = (await ctx.db.select('company.Company', { active: true }))
    .map((company): Row => ({ id: String(company.id), name: String(company.name ?? company.id) }))
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

/** The revision a role assignment must present, so a stale modal is refused rather than applied. */
const authorizationRevision = async (ctx: Ctx): Promise<number> =>
  Number((await ctx.db.select('user.AuthorizationRevision', { id: 'global' }))[0]?.revision ?? 0)

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
      'read:company.Company',
      'read:company.Branch',
    ],
    handler: async (ctx, args) => {
      const can = await permissionCheck(ctx)
      const permissions = {
        create: can('user.createUser'),
        save: can('user.saveUser'),
        assignRole: can('user.assignScopedRole'),
        invite: can('user.issueAuthToken'),
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
          },
          companies,
          branches,
          roles: await assignableRoles(ctx),
          scopeKinds: ['company', 'branch', 'tenant'],
          revision: await authorizationRevision(ctx),
          permissions,
          lang,
        },
        messages: messagesFor(ctx, lang),
      }
    },
  }),
}
