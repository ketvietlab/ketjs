import { defineFn, deleteFrom, eq } from '@ketvietlab/ketjs'
import type { FnSpec, Row } from '@ketvietlab/ketjs'
import { invalid, issue, n, normalized, stageKinds } from '../operations.ts'
import { ASSIGNMENT_MODES, CASE_KINDS, TERMINAL_STATES } from '../types.ts'
import { command, optionRows, saveConfiguration } from './shared.ts'

export const configurationFunctions: Record<string, FnSpec> = {
  /**
   * The lists the relational pickers page through.
   *
   * Each one takes the `search` and `limit` the picker sends on every keystroke
   * and returns a plain array, which is the shape `backend:relation.select`
   * reads. They exist so a user filling in a case never has to leave the form to
   * find a team, a stage or a tag.
   */
  'team.list': defineFn({
    input: { search: 'text?', limit: 'int?', includeArchived: 'bool?' },
    output: { id: 'id', code: 'text', name: 'text', assignmentMode: 'text', active: 'bool' },
    effects: ['read:crm.Team'],
    agent: true,
    handler: (ctx, args) => optionRows(ctx, 'crm.Team', args),
  }),

  'stage.list': defineFn({
    input: { search: 'text?', limit: 'int?', kind: 'text?', includeArchived: 'bool?' },
    output: {
      id: 'id',
      code: 'text',
      name: 'text',
      sequence: 'int',
      terminalState: 'text',
      allowedKinds: 'json',
      active: 'bool',
    },
    effects: ['read:crm.Stage'],
    agent: true,
    handler: async (ctx, args) => {
      const rows = await optionRows(ctx, 'crm.Stage', args, (a, b) => n(a.sequence) - n(b.sequence))
      return args.kind ? rows.filter((row) => stageKinds(row).includes(String(args.kind))) : rows
    },
  }),

  'tag.list': defineFn({
    input: { search: 'text?', limit: 'int?', includeArchived: 'bool?' },
    output: { id: 'id', name: 'text', color: 'text?', active: 'bool' },
    effects: ['read:crm.Tag'],
    agent: true,
    handler: (ctx, args) => optionRows(ctx, 'crm.Tag', args),
  }),

  /**
   * Tags were reachable from the data model and from `case.save`, but nothing
   * could create one — so the field could never hold a value. This is the
   * missing half, shaped for the picker's inline editor: an id and a name, no
   * idempotency key, because the picker mints the id itself.
   */
  'tag.save': defineFn({
    input: { id: 'id', name: 'text', color: 'text?', active: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:crm.Tag', 'write:crm.Tag'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const name = String(args.name ?? '').trim()
      if (!name) return invalid(issue('name', 'crm.error.required'))
      const existing = (await ctx.db.select('crm.Tag', { id: args.id }))[0]
      const clash = (await ctx.db.select('crm.Tag', { name })).find((row) => row.id !== args.id)
      if (clash) return invalid(issue('name', 'crm.error.duplicateName'))
      const values = {
        name,
        color: args.color ? String(args.color) : (existing?.color ?? null),
        active: args.active ?? existing?.active ?? true,
      }
      if (existing) await ctx.db.update('crm.Tag', { id: args.id }, values)
      else await ctx.db.insert('crm.Tag', { id: args.id, ...values })
      return { ok: true, id: args.id }
    },
  }),

  'tag.archive': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:crm.Tag', 'write:crm.Tag', 'read:crm.CaseTag', 'write:crm.CaseTag'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('crm.Tag', { id: args.id }))[0]
      if (!existing) return invalid(issue('id', 'crm.error.notFound'))
      await ctx.db.update('crm.Tag', { id: args.id }, { active: false })
      const CT = ctx.table('crm.CaseTag')
      await ctx.db.del(deleteFrom(CT).where(eq(CT.tagId, args.id)))
      return { ok: true, id: args.id }
    },
  }),

  'team.member.list': defineFn({
    input: { teamId: 'id?', search: 'text?', limit: 'int?' },
    output: {
      id: 'id',
      teamId: 'id',
      userId: 'id',
      userName: 'text?',
      capacity: 'int',
      sequence: 'int',
      assignedCount: 'int',
      active: 'bool',
    },
    effects: ['read:crm.TeamMember', 'read:user.User'],
    agent: true,
    handler: async (ctx, args) => {
      const rows = args.teamId
        ? await ctx.db.select('crm.TeamMember', { teamId: args.teamId })
        : await ctx.db.select('crm.TeamMember')
      const users = new Map((await ctx.db.select('user.User')).map((user) => [String(user.id), user]))
      const needle = normalized(args.search)
      const named: Row[] = rows.map((row) => ({
        ...row,
        userName: users.get(String(row.userId))?.name ?? String(row.userId),
      }))
      return named
        .filter((row) => !needle || normalized(row.userName).includes(needle))
        .sort((a, b) => n(a.sequence) - n(b.sequence) || String(a.id).localeCompare(String(b.id)))
        .slice(0, Math.max(1, Math.min(200, n(args.limit ?? 100))))
    },
  }),

  'team.member.remove': defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:crm.TeamMember', 'write:crm.TeamMember'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('crm.TeamMember', { id: args.id }))[0]
      if (!existing) return invalid(issue('id', 'crm.error.notFound'))
      await ctx.db.update('crm.TeamMember', { id: args.id }, { active: false })
      return { ok: true, id: args.id }
    },
  }),

  'configuration.get': defineFn({
    input: {},
    output: {
      teams: 'json',
      stages: 'json',
      assignmentRules: 'json',
      scoreRules: 'json',
    },
    effects: [
      'read:crm.Team',
      'read:crm.TeamMember',
      'read:crm.Stage',
      'read:crm.AssignmentRule',
      'read:crm.ScoreRule',
    ],
    handler: async (ctx) => {
      const [teams, members, stages, assignmentRules, scoreRules] = await Promise.all([
        ctx.db.select('crm.Team'),
        ctx.db.select('crm.TeamMember'),
        ctx.db.select('crm.Stage'),
        ctx.db.select('crm.AssignmentRule'),
        ctx.db.select('crm.ScoreRule'),
      ])
      const membersByTeam = new Map<string, Row[]>()
      for (const member of members) {
        const key = String(member.teamId)
        const rows = membersByTeam.get(key) ?? []
        rows.push(member)
        membersByTeam.set(key, rows)
      }
      return {
        teams: teams.map((team) => ({ ...team, members: membersByTeam.get(String(team.id)) ?? [] })),
        stages,
        assignmentRules,
        scoreRules,
      }
    },
  }),

  'team.save': saveConfiguration('crm.Team', (args, existing) => ({
    code: String(args.code ?? existing?.code ?? args.id).trim(),
    name: String(args.name ?? '').trim(),
    active: args.active ?? existing?.active ?? true,
    leaderUserId: args.leaderUserId ?? existing?.leaderUserId ?? null,
    assignmentMode: ASSIGNMENT_MODES.includes(args.assignmentMode as never)
      ? args.assignmentMode
      : (existing?.assignmentMode ?? 'manual'),
    assignmentCursor: existing?.assignmentCursor ?? 0,
    version: n(existing?.version) + 1,
  })),

  'team.member.save': defineFn({
    input: {
      id: 'id',
      teamId: 'id',
      userId: 'id',
      capacity: 'int?',
      sequence: 'int?',
      active: 'bool?',
      idempotencyKey: 'text',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:crm.Team', 'read:crm.TeamMember', 'write:crm.TeamMember', 'read:user.User'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const error = command(ctx, args.idempotencyKey)
      if (error) return error
      const [team, user] = await Promise.all([
        ctx.db.select('crm.Team', { id: args.teamId, active: true }),
        ctx.db.select('user.User', { id: args.userId, active: true }),
      ])
      if (!team[0]) return invalid(issue('teamId', 'crm.error.notFound'))
      if (!user[0]) return invalid(issue('userId', 'crm.error.notFound'))
      const existing = (await ctx.db.select('crm.TeamMember', { id: args.id }))[0]
      const values = {
        teamId: args.teamId,
        userId: args.userId,
        capacity: Math.max(1, n(args.capacity ?? existing?.capacity ?? 1)),
        sequence: n(args.sequence ?? existing?.sequence ?? 10),
        active: args.active ?? existing?.active ?? true,
        assignedCount: n(existing?.assignedCount),
        lastAssignedAt: existing?.lastAssignedAt ?? null,
      }
      if (existing) await ctx.db.update('crm.TeamMember', { id: args.id }, values)
      else await ctx.db.insert('crm.TeamMember', { id: args.id, ...values })
      return { ok: true, id: args.id }
    },
  }),

  'stage.save': saveConfiguration(
    'crm.Stage',
    (args, existing) => ({
      code: String(args.code ?? existing?.code ?? args.id).trim(),
      name: String(args.name ?? '').trim(),
      sequence: n(args.sequence ?? existing?.sequence ?? 10),
      allowedKinds: Array.isArray(args.allowedKinds)
        ? args.allowedKinds.map(String).filter((kind) => CASE_KINDS.includes(kind as never))
        : (existing?.allowedKinds ?? ['lead', 'opportunity']),
      terminalState: TERMINAL_STATES.includes(args.terminalState as never)
        ? args.terminalState
        : (existing?.terminalState ?? 'open'),
      teamId: args.teamId ?? existing?.teamId ?? null,
      fold: args.fold ?? existing?.fold ?? false,
      active: args.active ?? existing?.active ?? true,
    }),
    async (ctx, args) => {
      if (!String(args.name ?? '').trim() || !String(args.code ?? '').trim())
        return invalid(issue('name', 'crm.error.required'))
      if (!Array.isArray(args.allowedKinds) || args.allowedKinds.length === 0)
        return invalid(issue('allowedKinds', 'crm.error.required'))
      if (args.teamId && !(await ctx.db.select('crm.Team', { id: args.teamId, active: true }))[0])
        return invalid(issue('teamId', 'crm.error.notFound'))
      return null
    },
    ['read:crm.Team'],
  ),

  'assignmentRule.save': saveConfiguration(
    'crm.AssignmentRule',
    (args, existing) => ({
      name: String(args.name ?? '').trim(),
      priority: n(args.priority ?? existing?.priority ?? 10),
      allowedKinds: Array.isArray(args.allowedKinds)
        ? args.allowedKinds.map(String)
        : (existing?.allowedKinds ?? []),
      teamId: args.teamId ?? existing?.teamId,
      assigneeUserId: args.assigneeUserId ?? existing?.assigneeUserId ?? null,
      utmSource: args.utmSource ?? existing?.utmSource ?? null,
      minimumScore: args.minimumScore ?? existing?.minimumScore ?? null,
      active: args.active ?? existing?.active ?? true,
    }),
    async (ctx, args) => {
      if (!String(args.name ?? '').trim() || !Array.isArray(args.allowedKinds) || !args.allowedKinds.length)
        return invalid(issue('name', 'crm.error.required'))
      const team = args.teamId
        ? (await ctx.db.select('crm.Team', { id: args.teamId, active: true }))[0]
        : null
      if (!team) return invalid(issue('teamId', 'crm.error.notFound'))
      if (args.assigneeUserId) {
        const member = (
          await ctx.db.select('crm.TeamMember', {
            teamId: args.teamId,
            userId: args.assigneeUserId,
            active: true,
          })
        )[0]
        if (!member && team.leaderUserId !== args.assigneeUserId)
          return invalid(issue('assigneeUserId', 'crm.error.notTeamMember'))
      }
      return null
    },
    ['read:crm.Team', 'read:crm.TeamMember'],
  ),

  'scoreRule.save': saveConfiguration(
    'crm.ScoreRule',
    (args, existing) => ({
      name: String(args.name ?? '').trim(),
      field: String(args.field ?? '').trim(),
      operator: String(args.operator ?? 'eq'),
      value: String(args.value ?? ''),
      points: String(args.points ?? '0'),
      active: args.active ?? existing?.active ?? true,
      sequence: n(args.sequence ?? existing?.sequence ?? 10),
    }),
    (_ctx, args) => {
      const field = String(args.field ?? '')
      const operator = String(args.operator ?? '')
      const allowed =
        field === 'expectedRevenue'
          ? ['gte', 'eq']
          : field === 'email' || field === 'utmSource'
            ? ['eq', 'contains', 'present']
            : []
      if (!String(args.name ?? '').trim()) return invalid(issue('name', 'crm.error.required'))
      if (!allowed.includes(operator)) return invalid(issue('operator', 'crm.error.invalidKind'))
      if (operator !== 'present' && !String(args.value ?? '').trim())
        return invalid(issue('value', 'crm.error.required'))
      if (field === 'expectedRevenue' && !Number.isFinite(Number(args.value)))
        return invalid(issue('value', 'crm.error.invalidKind'))
      return null
    },
  ),
}
