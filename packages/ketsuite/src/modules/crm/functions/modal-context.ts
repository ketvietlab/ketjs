// Record-modal contexts for the CRM configuration catalogues.
//
// Each catalogue (team, stage, tag, assignment rule, score rule) opens its rows
// and its create action in a client-side record modal (KetSuite record-modal
// contract). One permission-checked read per kind hands the modal everything it
// renders — the record or its defaults, the choices its form offers and what the
// viewer may do — so the views never fetch.

import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { AUTHORIZATION_EFFECTS, effectiveFunctionKeys } from '../../user/authorization.ts'
import { CRM_RECORD_MODAL_LABELS } from '../record-modal-labels.ts'
import { n } from '../operations.ts'
import { ASSIGNMENT_MODES, CASE_KINDS, SCORE_RULE_OPERATORS, TERMINAL_STATES } from '../types.ts'

type Lang = 'vi' | 'en'
type Can = (fn: string) => boolean

/** Message prefixes the configuration views read, plus the error codes a refusal names. */
const MESSAGE_PREFIXES = ['crm_backend.', 'crm.']

const messagesFor = (ctx: Ctx, lang: Lang): Record<string, string> => {
  const catalog = ctx.manifest.messages?.[lang] ?? {}
  const out: Record<string, string> = {}
  for (const [key, message] of Object.entries(catalog)) {
    if (!MESSAGE_PREFIXES.some((prefix) => key.startsWith(prefix))) continue
    out[key] =
      typeof message === 'string' ? message : String(message.other ?? Object.values(message)[0] ?? key)
  }
  return { ...out, ...CRM_RECORD_MODAL_LABELS[lang] }
}

const readEffects = AUTHORIZATION_EFFECTS.filter((effect) => !effect.startsWith('write:'))

/** What the actor may call. A superuser (null) may call everything; no actor, nothing. */
const permissionCheck = async (ctx: Ctx): Promise<{ allowed: string[] | null; can: Can }> => {
  const allowed = ctx.actor ? await effectiveFunctionKeys(ctx, ctx.actor) : []
  return { allowed, can: (fn) => allowed === null || allowed.includes(fn) }
}

const byName = (a: Row, b: Row) =>
  String(a.name ?? '').localeCompare(String(b.name ?? '')) || String(a.id).localeCompare(String(b.id))

/**
 * The people a picker may offer. Listing every user needs `user.listUsers`;
 * without it the modal offers the people already active in a CRM team, exactly as
 * the configuration screen does.
 */
const peopleFor = async (ctx: Ctx, can: Can): Promise<Row[]> => {
  const users = await ctx.db.select('user.User', { active: true })
  if (can('user.listUsers'))
    return users.map((user) => ({ id: String(user.id), name: String(user.name ?? user.id) })).sort(byName)
  if (!can('crm.team.member.list')) return []
  const names = new Map(users.map((user) => [String(user.id), String(user.name ?? user.id)]))
  const byUser = new Map<string, Row>()
  for (const member of await ctx.db.select('crm.TeamMember', { active: true })) {
    const id = String(member.userId)
    if (names.has(id) && !byUser.has(id)) byUser.set(id, { id, name: names.get(id) })
  }
  return [...byUser.values()].sort(byName)
}

/**
 * Teams a picker may offer: active ones only. A record still pointing at an
 * archived team keeps that one as an option, marked, so its value stays visible
 * and saving it is refused on the field instead of silently changed.
 */
const teamChoices = async (ctx: Ctx, currentId: unknown): Promise<Row[]> => {
  const teams = await ctx.db.select('crm.Team')
  return teams
    .filter((team) => team.active !== false || (currentId && String(team.id) === String(currentId)))
    .map((team) => ({
      id: String(team.id),
      name: String(team.name ?? team.code ?? team.id),
      active: team.active !== false,
    }))
    .sort(byName)
}

const langOf = (args: Record<string, unknown>): Lang => (args.locale === 'en' ? 'en' : 'vi')

const find = async (ctx: Ctx, model: string, id: unknown): Promise<Row | null> =>
  id ? ((await ctx.db.select(model, { id }))[0] ?? null) : null

const contextInput = { id: 'id?', locale: 'text?' } as const

export const modalContextFunctions: Record<string, FnSpec> = {
  'team.modalContext': defineFn({
    input: contextInput,
    effects: [...readEffects, 'read:crm.Team', 'read:crm.TeamMember', 'read:user.User'],
    handler: async (ctx, args) => {
      const { can } = await permissionCheck(ctx)
      const permissions = {
        save: can('crm.team.save'),
        members: can('crm.team.member.save'),
      }
      const creating = !args.id
      if (creating && !permissions.save) return null
      const record = creating
        ? { name: '', code: '', leaderUserId: '', assignmentMode: 'manual', active: true }
        : await find(ctx, 'crm.Team', args.id)
      if (!record) return null
      const users = new Map(
        (await ctx.db.select('user.User')).map((user) => [String(user.id), String(user.name ?? user.id)]),
      )
      const members = creating
        ? []
        : (await ctx.db.select('crm.TeamMember', { teamId: args.id }))
            .map(
              (member): Row => ({
                ...member,
                userName: users.get(String(member.userId)) ?? String(member.userId),
              }),
            )
            .sort((a, b) => n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id)))
      const lang = langOf(args)
      return {
        data: {
          record,
          members,
          people: await peopleFor(ctx, can),
          assignmentModes: [...ASSIGNMENT_MODES],
          permissions,
          lang,
        },
        messages: messagesFor(ctx, lang),
      }
    },
  }),

  'stage.modalContext': defineFn({
    input: contextInput,
    effects: [...readEffects, 'read:crm.Stage', 'read:crm.Team'],
    handler: async (ctx, args) => {
      const { can } = await permissionCheck(ctx)
      const permissions = { save: can('crm.stage.save') }
      const creating = !args.id
      if (creating && !permissions.save) return null
      const record = creating
        ? {
            name: '',
            code: '',
            sequence: 10,
            allowedKinds: [...CASE_KINDS],
            teamId: '',
            terminalState: 'open',
            fold: false,
            active: true,
          }
        : await find(ctx, 'crm.Stage', args.id)
      if (!record) return null
      const lang = langOf(args)
      return {
        data: {
          record,
          teams: await teamChoices(ctx, record.teamId),
          kinds: [...CASE_KINDS],
          terminalStates: [...TERMINAL_STATES],
          permissions,
          lang,
        },
        messages: messagesFor(ctx, lang),
      }
    },
  }),

  'tag.modalContext': defineFn({
    input: contextInput,
    effects: [...readEffects, 'read:crm.Tag'],
    handler: async (ctx, args) => {
      const { can } = await permissionCheck(ctx)
      const permissions = { save: can('crm.tag.save'), archive: can('crm.tag.archive') }
      const creating = !args.id
      if (creating && !permissions.save) return null
      const record = creating ? { name: '', color: '', active: true } : await find(ctx, 'crm.Tag', args.id)
      if (!record) return null
      const lang = langOf(args)
      return { data: { record, permissions, lang }, messages: messagesFor(ctx, lang) }
    },
  }),

  'assignmentRule.modalContext': defineFn({
    input: contextInput,
    effects: [
      ...readEffects,
      'read:crm.AssignmentRule',
      'read:crm.Team',
      'read:crm.TeamMember',
      'read:user.User',
    ],
    handler: async (ctx, args) => {
      const { can } = await permissionCheck(ctx)
      const permissions = { save: can('crm.assignmentRule.save') }
      const creating = !args.id
      if (creating && !permissions.save) return null
      const record = creating
        ? {
            name: '',
            priority: 10,
            allowedKinds: [...CASE_KINDS],
            teamId: '',
            assigneeUserId: '',
            utmSource: '',
            minimumScore: null,
            active: true,
          }
        : await find(ctx, 'crm.AssignmentRule', args.id)
      if (!record) return null
      const teams = await teamChoices(ctx, record.teamId)
      const users = new Map(
        (await ctx.db.select('user.User', { active: true })).map((user) => [
          String(user.id),
          String(user.name ?? user.id),
        ]),
      )
      // `assignmentRule.save` accepts only an active member of the chosen team or
      // its leader, so that is all the assignee picker offers for each team.
      const rows = await ctx.db.select('crm.Team')
      const assignees: Record<string, Row[]> = {}
      for (const team of teams) {
        const leader = rows.find((row) => String(row.id) === team.id)?.leaderUserId
        const ids = new Set<string>(
          (await ctx.db.select('crm.TeamMember', { teamId: team.id, active: true })).map((member) =>
            String(member.userId),
          ),
        )
        if (leader) ids.add(String(leader))
        assignees[String(team.id)] = [...ids]
          .filter((id) => users.has(id))
          .map((id) => ({ id, name: users.get(id) }))
          .sort(byName)
      }
      const lang = langOf(args)
      return {
        data: { record, teams, assignees, kinds: [...CASE_KINDS], permissions, lang },
        messages: messagesFor(ctx, lang),
      }
    },
  }),

  'scoreRule.modalContext': defineFn({
    input: contextInput,
    effects: [...readEffects, 'read:crm.ScoreRule'],
    handler: async (ctx, args) => {
      const { can } = await permissionCheck(ctx)
      const permissions = { save: can('crm.scoreRule.save') }
      const creating = !args.id
      if (creating && !permissions.save) return null
      const record = creating
        ? { name: '', field: 'email', operator: 'eq', value: '', points: 0, sequence: 10, active: true }
        : await find(ctx, 'crm.ScoreRule', args.id)
      if (!record) return null
      const lang = langOf(args)
      return {
        data: {
          record,
          operators: Object.fromEntries(
            Object.entries(SCORE_RULE_OPERATORS).map(([field, list]) => [field, [...list]]),
          ),
          permissions,
          lang,
        },
        messages: messagesFor(ctx, lang),
      }
    },
  }),
}
