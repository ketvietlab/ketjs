// The record-modal context for a role (KetSuite record-modal contract).
//
// The roles collection opens a role — and its create action — in a client-side
// modal. One permission-checked read hands that modal what it renders: the role,
// where its authority comes from, who holds it, and what this viewer may do.
//
// A managed role and a custom role are the same record read two ways. A managed
// role is this deployment's own policy: it is not edited here, it is copied. A
// custom role is a local decision, so its areas are editable.

import { defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { AUTHORIZATION_EFFECTS, effectiveFunctionKeys, managedRoleHealthIssues } from './authorization.ts'
import { authorizationRevisionOf } from './authorization.ts'
import {
  capabilityTone,
  permissionArea,
  permissionGroupLabels,
  permissionGroupOrder,
} from './permission-areas.ts'

type Lang = 'vi' | 'en'
type Can = (fn: string) => boolean

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

const permissionCheck = async (ctx: Ctx): Promise<Can> => {
  const allowed = ctx.actor ? await effectiveFunctionKeys(ctx, ctx.actor) : []
  return (fn) => allowed === null || allowed.includes(fn)
}

/**
 * Where a managed role's authority comes from.
 *
 * Each grant names the work it allows and the template that put it there, so a
 * reader can see that nobody granted this by hand — and which template version to
 * look at when it changes.
 */
const grantSources = async (ctx: Ctx, roleId: string, lang: Lang): Promise<Row[]> => {
  const G = ctx.table('user.Grant')
  const S = ctx.table('user.GrantSource')
  const sources = new Map(
    (await ctx.db.all(from(S).where(eq(S.roleId, roleId)))).map((row) => [String(row.fnKey), row as Row]),
  )
  const functions = ctx.manifest.permissions.functions ?? {}
  return (await ctx.db.all(from(G).where(eq(G.roleId, roleId))))
    .map((grant): Row => {
      const fnKey = String(grant.fnKey)
      const declared = functions[fnKey] as { bundles?: string[] } | undefined
      const bundleKey = declared?.bundles?.[0] ?? ''
      const bundle = bundleKey
        ? ((ctx.manifest.permissions.bundles ?? {})[bundleKey] as
            | { labels?: Record<string, string> }
            | undefined)
        : undefined
      const source = sources.get(fnKey)
      return {
        fnKey,
        work: bundle?.labels?.[lang] ?? bundleKey ?? fnKey,
        // A grant with no source row was written directly, before templates.
        sourceKind: source ? String(source.sourceKind ?? 'template') : 'legacy-direct',
        sourceKey: source ? String(source.sourceKey ?? '') : '',
        sourceVersion: source?.sourceVersion == null ? null : Number(source.sourceVersion),
      }
    })
    .sort(
      (a, b) =>
        String(a.work).localeCompare(String(b.work)) || String(a.fnKey).localeCompare(String(b.fnKey)),
    )
}

/** The areas a custom role may be given, and how much of each it holds today. */
const bundleChoices = async (ctx: Ctx, roleId: string, lang: Lang): Promise<Row[]> => {
  const G = ctx.table('user.Grant')
  const granted = new Set(
    (await ctx.db.all(from(G).where(eq(G.roleId, roleId)))).map((row) => String(row.fnKey)),
  )
  return Object.entries(ctx.manifest.permissions.bundles ?? {})
    .map(([key, bundle]) => {
      const declared = bundle as { labels?: Record<string, string>; functions?: string[] }
      const functions = declared.functions ?? []
      const dot = key.indexOf('.')
      const module = dot === -1 ? key : key.slice(0, dot)
      const capability = dot === -1 ? key : key.slice(dot + 1)
      const label = declared.labels?.[lang] ?? key
      const area = permissionArea(module, lang)
      return {
        key,
        label,
        // The row already names the area, so the checkbox says only what it hands out.
        short: label.split(' · ')[0] ?? label,
        module,
        area: area.label,
        group: area.group,
        tone: capabilityTone(capability),
        total: functions.length,
        covered: functions.filter((fn) => granted.has(fn)).length,
        held: functions.length > 0 && functions.every((fn) => granted.has(fn)),
      }
    })
    .sort(
      (a, b) =>
        permissionGroupOrder.indexOf(a.group) - permissionGroupOrder.indexOf(b.group) ||
        a.area.localeCompare(b.area, lang) ||
        a.module.localeCompare(b.module) ||
        // Seeing and doing first; running the place and private data last.
        Number(a.tone !== null) - Number(b.tone !== null) ||
        a.short.localeCompare(b.short, lang),
    )
}

/** Who holds this role, wherever they hold it. */
const holders = async (ctx: Ctx, roleId: string): Promise<Row[]> => {
  const A = ctx.table('user.Assignment')
  const userIds = [
    ...new Set((await ctx.db.all(from(A).where(eq(A.roleId, roleId)))).map((row) => String(row.userId))),
  ]
  if (!userIds.length) return []
  const people = await ctx.db.select('user.User')
  return people
    .filter((person) => userIds.includes(String(person.id)))
    .map(
      (person): Row => ({
        id: String(person.id),
        name: String(person.name ?? person.login ?? person.id),
        login: String(person.login ?? ''),
        active: person.active !== false,
      }),
    )
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

const newRoleRecord = (): Row => ({
  id: '',
  name: '',
  description: '',
  mode: 'custom',
  templateKey: null,
  templateVersion: null,
  revision: 0,
  healthy: true,
})

export const roleModalContextFunctions: Record<string, FnSpec> = {
  roleModalContext: defineFn({
    input: { id: 'id?', locale: 'text?' },
    effects: [
      ...readEffects,
      'read:user.Role',
      'read:user.Grant',
      'read:user.GrantSource',
      'read:user.Assignment',
      'read:user.User',
    ],
    handler: async (ctx, args) => {
      const can = await permissionCheck(ctx)
      const permissions = {
        create: can('user.saveRole'),
        save: can('user.saveRole'),
        clone: can('user.cloneManagedRole'),
        // Editing a custom role's areas is a grant, which is its own authority.
        grant: can('user.grantFunction') && can('user.revokeFunction'),
        holders: can('user.listUsers'),
      }
      const creating = !args.id
      if (creating ? !permissions.create : !can('user.getRole')) return null
      const R = ctx.table('user.Role')
      const role = creating ? newRoleRecord() : await ctx.db.one(from(R).where(eq(R.id, args.id)))
      if (!role) return null
      const lang: Lang = args.locale === 'en' ? 'en' : 'vi'
      const roleId = String(role.id ?? '')
      const managed = String(role.mode ?? '') === 'managed'
      const grants = creating
        ? []
        : await ctx.db.all(from(ctx.table('user.Grant')).where(eq(ctx.table('user.Grant').roleId, roleId)))
      const sources = creating
        ? []
        : await ctx.db.all(
            from(ctx.table('user.GrantSource')).where(eq(ctx.table('user.GrantSource').roleId, roleId)),
          )
      return {
        data: {
          record: {
            id: roleId,
            name: String(role.name ?? ''),
            description: String(role.description ?? ''),
            mode: managed ? 'managed' : 'custom',
            templateKey: role.templateKey ? String(role.templateKey) : null,
            templateVersion: role.templateVersion == null ? null : Number(role.templateVersion),
            revision: Number(role.revision ?? 0),
            // A managed role whose template has moved on still grants what it
            // granted; saying so is the point of the state badge.
            healthy:
              creating ||
              !managed ||
              managedRoleHealthIssues(ctx.manifest, role, grants, sources).length === 0,
          },
          sources: creating || !managed ? [] : await grantSources(ctx, roleId, lang),
          bundles: creating || managed ? [] : await bundleChoices(ctx, roleId, lang),
          groups: permissionGroupOrder.map((id) => ({ id, label: permissionGroupLabels[id][lang] })),
          holders: creating || !permissions.holders ? [] : await holders(ctx, roleId),
          revision: await authorizationRevisionOf(ctx),
          permissions,
          lang,
        },
        messages: messagesFor(ctx, lang),
      }
    },
  }),
}
