import { userModalMessages } from './modal-messages.ts'
import { defineFn, deleteFrom, eq, from, permissionDigest } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import {
  AUTHORIZATION_EFFECTS,
  abortAuthorization,
  authorizationTransaction,
  authorizationRevisionOf,
  assertAssignableRoles,
  bumpRevision,
  completeOperation,
  operationReplay,
  effectiveFunctionKeys,
  normalizeAssignmentScope,
  managedRoleHealthIssues,
  recordAuthorizationAudit,
} from './authorization.ts'
import { workplaces } from './user-modal-context.ts'
import { templateTier } from './access-surfaces.ts'

const kinds = ['idpGroup', 'department', 'jobTitle']
const fail = (field: string, code: string): never =>
  abortAuthorization({ ok: false, errors: [{ field, code }] })
export const ACCESS_POLICY_EFFECTS = [
  ...AUTHORIZATION_EFFECTS,
  'read:partner.Partner',
  'read:user.DirectoryFact',
  'write:user.DirectoryFact',
  'read:user.AccessPolicy',
  'write:user.AccessPolicy',
  'write:user.PolicyAssignment',
]
const reads = ACCESS_POLICY_EFFECTS.filter((effect) => !effect.startsWith('write:'))

async function authority(ctx: Ctx, fn: string) {
  if (!ctx.actor) fail('actor', 'E_ACTOR_REQUIRED')
  const held = await effectiveFunctionKeys(ctx, ctx.actor!)
  if (held !== null && !held.includes(fn)) fail('actor', 'E_AUTHORIZATION_FORBIDDEN')
  return held === null
}

async function validatedPolicy(ctx: Ctx, args: Row): Promise<Row> {
  const id = String(args.id ?? '')
  const previous = id ? (await ctx.db.select('user.AccessPolicy', { id }))[0] : undefined
  const roleIds = Array.isArray(args.roleIds) ? [...new Set(args.roleIds.map(String))].sort() : []
  if (!String(args.name ?? '').trim()) fail('name', 'user.error.required')
  if (!kinds.includes(String(args.matchKind))) fail('matchKind', 'user.error.required')
  if (!roleIds.length) fail('roleIds', 'user.error.required')
  const roles = await assertAssignableRoles(ctx, roleIds)
  const superuser = await authority(ctx, 'user.saveAccessPolicy')
  if (!superuser && roles.some((role) => templateTier(ctx, String(role.templateKey)) === 'security'))
    fail('roleIds', 'E_SECURITY_ROLE_FORBIDDEN')
  const facts = await ctx.db.select('user.DirectoryFact', { kind: args.matchKind, value: args.matchValue })
  if (!facts.length && !(previous?.matchKind === args.matchKind && previous?.matchValue === args.matchValue))
    fail('matchValue', 'E_DIRECTORY_VALUE_UNKNOWN')
  const scopeKind = String(args.scopeKind ?? 'company')
  if (!['tenant', 'company', 'branch'].includes(scopeKind)) fail('scopeKind', 'E_ASSIGNMENT_SCOPE_INVALID')
  const companyId = scopeKind === 'tenant' ? null : args.companyId || null
  const branchId = scopeKind === 'branch' ? args.branchId || null : null
  if (
    scopeKind !== 'tenant' &&
    !(await ctx.db.select('company.Company', { id: companyId, active: true })).length
  )
    fail('companyId', 'E_ASSIGNMENT_SCOPE_INVALID')
  if (
    scopeKind === 'branch' &&
    !(await ctx.db.select('company.Branch', { id: branchId, companyId, active: true })).length
  )
    fail('branchId', 'E_ASSIGNMENT_SCOPE_INVALID')
  return {
    id,
    name: String(args.name).trim(),
    description: args.description || null,
    matchKind: args.matchKind,
    matchValue: args.matchValue,
    roleIds,
    scopeKind,
    companyId,
    branchId,
    active: previous?.active !== false,
  }
}

/** Recompute only this owner's edges; memberships are never silently granted by a rule. */
async function desiredAssignments(ctx: Ctx, policy: Row): Promise<Row[]> {
  if (!policy.active) return []
  // An outdated or disabled managed role must stop granting access without blocking directory updates.
  for (const id of policy.roleIds as string[]) {
    const role = (await ctx.db.select('user.Role', { id }))[0]
    if (
      !role ||
      role.mode !== 'managed' ||
      managedRoleHealthIssues(
        ctx.manifest,
        role,
        await ctx.db.select('user.Grant', { roleId: id }),
        await ctx.db.select('user.GrantSource', { roleId: id }),
      ).length
    )
      return []
  }
  const facts = await ctx.db.select('user.DirectoryFact', {
    kind: policy.matchKind,
    value: policy.matchValue,
  })
  const rows: Row[] = []
  for (const userId of [...new Set(facts.map((row) => String(row.userId)))].sort()) {
    const person = (await ctx.db.select('user.User', { id: userId, active: true }))[0]
    if (!person || person.accessKind !== 'internal') continue
    const scope = await normalizeAssignmentScope(ctx, userId, policy)
    if (!scope.ok) continue
    for (const roleId of policy.roleIds as string[])
      rows.push({
        id: permissionDigest([policy.id, userId, roleId, scope.scope.scopeKey]),
        policyId: policy.id,
        userId,
        roleId,
        ...scope.scope,
      })
  }
  return rows
}

async function difference(ctx: Ctx, policy: Row) {
  const before = await ctx.db.select('user.PolicyAssignment', { policyId: policy.id })
  const after = await desiredAssignments(ctx, policy)
  const beforeIds = new Set(before.map((row) => row.id)),
    afterIds = new Set(after.map((row) => row.id))
  return {
    before,
    after,
    added: after.filter((row) => !beforeIds.has(row.id)),
    removed: before.filter((row) => !afterIds.has(row.id)),
  }
}

async function reconcile(ctx: Ctx, policy: Row, revision: number, allowSelf = false) {
  const diff = await difference(ctx, policy)
  if (!allowSelf && [...diff.added, ...diff.removed].some((row) => row.userId === ctx.actor))
    fail('roleIds', 'E_SELF_AUTHORIZATION_FORBIDDEN')
  for (const row of diff.removed) {
    const A = ctx.table('user.PolicyAssignment')
    await ctx.db.del(deleteFrom(A).where(eq(A.id, row.id)))
  }
  for (const row of diff.added) await ctx.db.insert('user.PolicyAssignment', row)
  for (const userId of new Set([...diff.added, ...diff.removed].map((row) => String(row.userId)))) {
    await recordAuthorizationAudit(ctx, {
      event: 'authorization.policy.reconciled',
      targetKind: 'policy',
      targetId: String(policy.id),
      userId,
      source: String(policy.id),
      reason: '',
      revision,
      before: diff.before.filter((row) => row.userId === userId),
      after: diff.after.filter((row) => row.userId === userId),
    })
  }
  return diff
}

/** Reconcile membership and catalogue changes that originate outside the policy editor. */
export async function reconcileAccessPolicies(ctx: Ctx) {
  return authorizationTransaction(ctx, async (tx) => {
    const changed: Row[] = []
    for (const policy of await tx.db.select('user.AccessPolicy')) {
      const diff = await difference(tx, policy)
      if (diff.added.length || diff.removed.length) changed.push(policy)
    }
    if (!changed.length) return { ok: true, changed: 0 }
    const revision = await bumpRevision(tx, await authorizationRevisionOf(tx))
    if (revision === null) fail('revision', 'E_AUTHORIZATION_REVISION_CONFLICT')
    for (const policy of changed) await reconcile(tx, policy, revision!, true)
    return { ok: true, changed: changed.length }
  })
}

async function previewDigest(ctx: Ctx, policy: Row) {
  const diff = await difference(ctx, policy)
  const { id: _id, ...rule } = policy
  const identity = (row: Row) => [row.userId, row.roleId, row.scopeKey]
  return permissionDigest({
    rule,
    revision: await authorizationRevisionOf(ctx),
    added: diff.added.map(identity),
    removed: diff.removed.map(identity),
  })
}

async function mutate(
  ctx: Ctx,
  args: Row,
  action: string,
  body: (tx: Ctx, revision: number) => Promise<Row>,
) {
  return authorizationTransaction(ctx, async (tx) => {
    await authority(tx, action === 'save' ? 'user.saveAccessPolicy' : 'user.setAccessPolicyActive')
    if (!String(args.idempotencyKey ?? '').trim()) fail('idempotencyKey', 'user.error.required')
    const key = `policy:${action}:${ctx.actor}:${args.idempotencyKey}`
    const replay = await operationReplay(tx, key, args)
    if ('conflict' in replay) fail('idempotencyKey', 'E_AUTHORIZATION_REVISION_CONFLICT')
    if ('replay' in replay && replay.replay) return { ...(replay.result as Row), replayed: true }
    const revision = await bumpRevision(tx, Number(args.expectedAuthorizationRevision))
    if (revision === null) fail('expectedAuthorizationRevision', 'E_AUTHORIZATION_REVISION_CONFLICT')
    const result = { ok: true, ...(await body(tx, revision!)), revision, replayed: false }
    await completeOperation(tx, key, result)
    return result
  })
}

const policyInput = {
  id: 'id?',
  name: 'text',
  description: 'text?',
  matchKind: 'text',
  matchValue: 'text',
  roleIds: 'json',
  scopeKind: 'text',
  companyId: 'id?',
  branchId: 'id?',
} as const
const writeInput = { expectedAuthorizationRevision: 'int', idempotencyKey: 'text' } as const

async function previewAccessPolicy(ctx: Ctx, args: Row) {
  return authorizationTransaction(ctx, async (tx) => {
    await authority(tx, 'user.previewAccessPolicy')
    const policy = await validatedPolicy(tx, args)
    const diff = await difference(tx, policy)
    const users = new Map((await tx.db.select('user.User')).map((row) => [String(row.id), row]))
    const roles = new Map((await tx.db.select('user.Role')).map((row) => [String(row.id), String(row.name)]))
    const changed = [...new Set([...diff.added, ...diff.removed].map((row) => String(row.userId)))]
    return {
      ok: true,
      previewDigest: await previewDigest(tx, policy),
      changes: changed.map((userId) => ({
        userId,
        name: users.get(userId)?.name ?? userId,
        added: diff.added.filter((row) => row.userId === userId).map((row) => roles.get(String(row.roleId))),
        removed: diff.removed
          .filter((row) => row.userId === userId)
          .map((row) => roles.get(String(row.roleId))),
      })),
      unchanged: new Set(diff.after.map((row) => row.userId).filter((id) => !changed.includes(String(id))))
        .size,
    }
  })
}
async function saveAccessPolicy(ctx: Ctx, args: Row) {
  return mutate(ctx, args, 'save', async (tx, revision) => {
    if (!args.id) fail('id', 'user.error.required')
    const policy = await validatedPolicy(tx, args)
    // Compare against the revision shown in the preview, before this transaction's CAS increment.
    if (args.previewDigest) {
      const diff = await difference(tx, policy)
      const { id: _id, ...rule } = policy
      const identity = (row: Row) => [row.userId, row.roleId, row.scopeKey]
      const expected = permissionDigest({
        rule,
        revision: revision - 1,
        added: diff.added.map(identity),
        removed: diff.removed.map(identity),
      })
      if (expected !== args.previewDigest) fail('previewDigest', 'E_AUTHORIZATION_REVISION_CONFLICT')
    }
    const before = (await tx.db.select('user.AccessPolicy', { id: policy.id }))[0] ?? null
    if (before) await tx.db.update('user.AccessPolicy', { id: policy.id }, policy)
    else await tx.db.insert('user.AccessPolicy', policy)
    await reconcile(tx, policy, revision)
    await recordAuthorizationAudit(tx, {
      event: 'authorization.policy.saved',
      targetKind: 'policy',
      targetId: String(policy.id),
      source: String(policy.id),
      reason: '',
      before,
      after: policy,
      revision,
    })
    return { id: policy.id }
  })
}
async function setAccessPolicyActive(ctx: Ctx, args: Row) {
  return mutate(ctx, args, 'active', async (tx, revision) => {
    const before = (await tx.db.select('user.AccessPolicy', { id: args.id }))[0]
    if (!before) fail('id', 'user.error.required')
    const superuser = await authority(tx, 'user.setAccessPolicyActive')
    const roles = args.active
      ? await assertAssignableRoles(tx, before.roleIds as string[])
      : (await tx.db.select('user.Role')).filter((role) =>
          (before.roleIds as string[]).includes(String(role.id)),
        )
    if (!superuser && roles.some((role) => templateTier(tx, String(role.templateKey)) === 'security'))
      fail('roleIds', 'E_SECURITY_ROLE_FORBIDDEN')
    const policy = { ...before, active: args.active }
    await tx.db.update('user.AccessPolicy', { id: args.id }, { active: args.active })
    await reconcile(tx, policy, revision)
    await recordAuthorizationAudit(tx, {
      event: 'authorization.policy.state',
      targetKind: 'policy',
      targetId: String(args.id),
      source: String(args.id),
      reason: '',
      before,
      after: policy,
      revision,
    })
    return { id: args.id }
  })
}

/** Called only by a tenant-bound, authenticated directory adapter, never by a browser. */
async function replaceDirectoryFacts(ctx: Ctx, args: Row) {
  return authorizationTransaction(ctx, async (tx) => {
    if (tx.actor !== 'system:user-directory') fail('actor', 'E_AUTHORIZATION_FORBIDDEN')
    if (!String(args.idempotencyKey ?? '').trim()) fail('idempotencyKey', 'user.error.required')
    if (!Array.isArray(args.facts) || args.facts.length > 1000) fail('facts', 'E_DIRECTORY_VALUE_UNKNOWN')
    const facts: Row[] = []
    for (const value of args.facts as unknown[]) {
      if (!value || typeof value !== 'object') fail('facts', 'E_DIRECTORY_VALUE_UNKNOWN')
      const fact = value as Row
      if (
        !kinds.includes(String(fact.kind)) ||
        !String(fact.value ?? '').trim() ||
        !String(fact.label ?? '').trim()
      )
        fail('facts', 'E_DIRECTORY_VALUE_UNKNOWN')
      facts.push({
        id: permissionDigest([args.userId, fact.kind, fact.value]),
        userId: args.userId,
        kind: String(fact.kind),
        value: String(fact.value),
        label: String(fact.label),
      })
    }
    if (!(await tx.db.select('user.User', { id: args.userId })).length)
      fail('userId', 'user.error.userMissing')
    const key = `directory:${args.idempotencyKey}`
    const replay = await operationReplay(tx, key, args)
    if ('conflict' in replay) fail('idempotencyKey', 'E_AUTHORIZATION_REVISION_CONFLICT')
    if ('replay' in replay && replay.replay) return { ...(replay.result as Row), replayed: true }
    const revision = await bumpRevision(tx, Number(args.expectedAuthorizationRevision))
    if (revision === null) fail('expectedAuthorizationRevision', 'E_AUTHORIZATION_REVISION_CONFLICT')
    const F = tx.table('user.DirectoryFact')
    await tx.db.del(deleteFrom(F).where(eq(F.userId, args.userId)))
    for (const fact of new Map(facts.map((row) => [row.id, row])).values())
      await tx.db.insert('user.DirectoryFact', fact)
    for (const policy of await tx.db.select('user.AccessPolicy')) await reconcile(tx, policy, revision!, true)
    const result = { ok: true, revision }
    await completeOperation(tx, key, result)
    return result
  })
}

export const accessPolicyFunctions: Record<string, FnSpec> = {
  replaceDirectoryFacts: defineFn({
    exposure: 'internal',
    input: { userId: 'id', facts: 'json', ...writeInput },
    effects: ACCESS_POLICY_EFFECTS,
    idempotent: true,
    handler: replaceDirectoryFacts,
  }),
  previewAccessPolicy: defineFn({ input: policyInput, effects: reads, handler: previewAccessPolicy }),
  saveAccessPolicy: defineFn({
    input: { ...policyInput, ...writeInput, previewDigest: 'text?' },
    effects: ACCESS_POLICY_EFFECTS,
    idempotent: true,
    handler: saveAccessPolicy,
  }),
  setAccessPolicyActive: defineFn({
    input: { id: 'id', active: 'bool', ...writeInput },
    effects: ACCESS_POLICY_EFFECTS,
    idempotent: true,
    handler: setAccessPolicyActive,
  }),
  listAccessPolicies: defineFn({
    input: {},
    effects: reads,
    handler: async (ctx) => {
      await authority(ctx, 'user.listAccessPolicies')
      const policies = await ctx.db.select('user.AccessPolicy')
      const assignments = await ctx.db.select('user.PolicyAssignment')
      const facts = await ctx.db.select('user.DirectoryFact')
      return policies.map((policy) => ({
        ...policy,
        matchLabel:
          facts.find((fact) => fact.kind === policy.matchKind && fact.value === policy.matchValue)?.label ??
          policy.matchValue,
        memberCount: new Set(assignments.filter((row) => row.policyId === policy.id).map((row) => row.userId))
          .size,
      }))
    },
  }),
  accessPolicyModalContext: defineFn({
    input: { id: 'id?', locale: 'text?' },
    effects: reads,
    handler: async (ctx, args) => {
      await authority(ctx, 'user.accessPolicyModalContext')
      const record = args.id
        ? (await ctx.db.select('user.AccessPolicy', { id: args.id }))[0]
        : {
            id: '',
            name: '',
            description: '',
            active: true,
            matchKind: 'idpGroup',
            matchValue: '',
            roleIds: [],
            scopeKind: 'company',
            companyId: null,
            branchId: null,
          }
      if (!record) return null
      const held = await effectiveFunctionKeys(ctx, ctx.actor!)
      const can = (fn: string) => held === null || held.includes(fn)
      const facts = await ctx.db.select('user.DirectoryFact')
      const roles: Row[] = []
      for (const role of await ctx.db.select('user.Role')) {
        if (role.mode !== 'managed') continue
        const grants = await ctx.db.select('user.Grant', { roleId: role.id })
        const sources = await ctx.db.select('user.GrantSource', { roleId: role.id })
        if (!managedRoleHealthIssues(ctx.manifest, role, grants, sources).length)
          roles.push({ id: role.id, name: role.name, tier: templateTier(ctx, String(role.templateKey)) })
      }
      const assignments = args.id ? await ctx.db.select('user.PolicyAssignment', { policyId: args.id }) : []
      const users = new Map((await ctx.db.select('user.User')).map((row) => [String(row.id), row]))
      const matching =
        args.id && record.active
          ? facts.filter((fact) => fact.kind === record.matchKind && fact.value === record.matchValue)
          : []
      const applied = new Set(assignments.map((row) => String(row.userId)))
      const memberIds = [...new Set([...applied, ...matching.map((row) => String(row.userId))])]
      const lang = args.locale === 'en' ? 'en' : 'vi'
      const places = await workplaces(ctx)
      return {
        data: {
          record,
          roles,
          companies: places.companies,
          branches: places.branches,
          scopeKinds: ['tenant', 'company', 'branch'],
          matchKinds: kinds,
          matchOptions: Object.fromEntries(
            kinds.map((kind) => [
              kind,
              [
                ...new Map(
                  facts
                    .filter((row) => row.kind === kind)
                    .map((row) => [String(row.value), { value: row.value, label: row.label }]),
                ).values(),
              ],
            ]),
          ),
          members: memberIds.map((id) => ({
            id,
            name: users.get(id)?.name ?? id,
            login: users.get(id)?.login ?? '',
            status: applied.has(id) ? 'applied' : 'blocked',
          })),
          revision: await authorizationRevisionOf(ctx),
          lang,
          actor: { superuser: held === null },
          permissions: {
            create: can('user.saveAccessPolicy'),
            save: can('user.saveAccessPolicy'),
            pause: can('user.setAccessPolicyActive'),
          },
        },
        messages: userModalMessages(ctx, lang),
      }
    },
  }),
}
