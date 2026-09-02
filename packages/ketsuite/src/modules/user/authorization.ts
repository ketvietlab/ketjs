import { randomUUID } from 'node:crypto'
import {
  asc,
  defineFn,
  deleteFrom,
  eq,
  from,
  inArray,
  isNotNull,
  KetError,
  permissionDigest,
} from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Manifest, Row } from '@ketvietlab/ketjs'

type Issue = { field: string; code: string; params?: Record<string, unknown> }
const issue = (field: string, code: string, params?: Record<string, unknown>): Issue => ({
  field,
  code,
  ...(params ? { params } : {}),
})
const invalid = (errors: Issue[]) => ({ ok: false as const, errors })
const nowIso = () => new Date().toISOString()

class AuthorizationAbort extends Error {
  readonly result: ReturnType<typeof invalid>

  constructor(result: ReturnType<typeof invalid>) {
    super('authorization mutation aborted')
    this.result = result
  }
}

const abort = (result: ReturnType<typeof invalid>): never => {
  throw new AuthorizationAbort(result)
}

const authorizationTransaction = async <T>(ctx: Ctx, body: (tx: Ctx) => Promise<T>) => {
  try {
    return await ctx.tx(body)
  } catch (error) {
    if (error instanceof AuthorizationAbort) return error.result
    throw error
  }
}

export type AssignmentScope = {
  scopeKind: 'tenant' | 'company' | 'branch'
  companyId: string | null
  branchId: string | null
  scopeKey: string
}

export type EffectivePermissionPath = {
  assignmentId: string
  scopeKey: string
  roleId: string
  roleMode: 'managed' | 'custom'
  templateKey: string | null
  templateVersion: number | null
  bundlePath: string[]
  sourceKind: string
}

export type EffectivePermission = {
  key: string
  risk: string | null
  paths: EffectivePermissionPath[]
}

export type EffectiveAccess = {
  revision: number
  context: { companyId: string | null; branchId: string | null }
  superuser: boolean
  functions: EffectivePermission[]
  issues: Array<{ code: string; roleId?: string; fnKey?: string }>
}

const activeCompanyMemberships = async (ctx: Ctx, userId: string): Promise<Set<string>> => {
  const M = ctx.table('user.Membership')
  const rows = await ctx.db.all(from(M).where(eq(M.userId, userId)))
  if (!rows.length) return new Set()
  const C = ctx.table('company.Company')
  const companies = await ctx.db.all(
    from(C).where(
      inArray(
        C.id,
        rows.map((row) => String(row.companyId)),
      ),
      eq(C.active, true),
    ),
  )
  return new Set(companies.map((row) => String(row.id)))
}

const activeBranchMemberships = async (
  ctx: Ctx,
  userId: string,
  companyIds: ReadonlySet<string>,
): Promise<Map<string, string>> => {
  const BM = ctx.table('user.BranchMembership')
  const memberships = await ctx.db.all(from(BM).where(eq(BM.userId, userId)))
  if (!memberships.length) return new Map()
  const B = ctx.table('company.Branch')
  const branches = await ctx.db.all(
    from(B).where(
      inArray(
        B.id,
        memberships.map((row) => String(row.branchId)),
      ),
      eq(B.active, true),
    ),
  )
  return new Map(
    branches
      .filter((branch) => companyIds.has(String(branch.companyId)))
      .map((branch) => [String(branch.id), String(branch.companyId)]),
  )
}

export const normalizeAssignmentScope = async (
  ctx: Ctx,
  userId: string,
  values: { scopeKind?: unknown; companyId?: unknown; branchId?: unknown },
): Promise<{ ok: true; scope: AssignmentScope } | { ok: false; errors: Issue[] }> => {
  const kind = String(values.scopeKind ?? 'tenant')
  if (!['tenant', 'company', 'branch'].includes(kind))
    return invalid([issue('scopeKind', 'E_ASSIGNMENT_SCOPE_INVALID')])
  const companyIds = await activeCompanyMemberships(ctx, userId)
  if (!companyIds.size) return invalid([issue('companyId', 'E_ASSIGNMENT_MEMBERSHIP_REQUIRED')])
  if (kind === 'tenant')
    return {
      ok: true,
      scope: {
        scopeKind: 'tenant',
        companyId: null,
        branchId: null,
        scopeKey: 'tenant',
      },
    }
  const companyId = String(values.companyId ?? '')
  if (!companyId || !companyIds.has(companyId))
    return invalid([issue('companyId', 'E_ASSIGNMENT_MEMBERSHIP_REQUIRED')])
  if (kind === 'company')
    return {
      ok: true,
      scope: {
        scopeKind: 'company',
        companyId,
        branchId: null,
        scopeKey: `company:${companyId}`,
      },
    }
  const branchId = String(values.branchId ?? '')
  const branches = await activeBranchMemberships(ctx, userId, companyIds)
  if (!branchId || branches.get(branchId) !== companyId)
    return invalid([issue('branchId', 'E_ASSIGNMENT_MEMBERSHIP_REQUIRED')])
  return {
    ok: true as const,
    scope: {
      scopeKind: 'branch',
      companyId,
      branchId,
      scopeKey: `branch:${companyId}:${branchId}`,
    },
  }
}

export const authorizationRevisionOf = async (ctx: Ctx): Promise<number> => {
  const R = ctx.table('user.AuthorizationRevision')
  const row = await ctx.db.one(from(R).where(eq(R.id, 'tenant')))
  return Number(row?.revision ?? 0)
}

export const advanceAuthorizationRevision = async (ctx: Ctx): Promise<number> => {
  for (let attempt = 0; attempt < 5; attempt++) {
    const expected = await authorizationRevisionOf(ctx)
    const revision = await bumpRevision(ctx, expected)
    if (revision != null) return revision
  }
  throw new KetError({
    code: 'E_AUTHORIZATION_REVISION_CONFLICT',
    module: 'user',
    message: 'authorization revision changed concurrently',
  })
}

const bumpRevision = async (ctx: Ctx, expected: number): Promise<number | null> => {
  const R = ctx.table('user.AuthorizationRevision')
  const row = await ctx.db.one(from(R).where(eq(R.id, 'tenant')))
  if (!row) {
    if (expected !== 0) return null
    const inserted = await ctx.db.insertIfAbsent('user.AuthorizationRevision', {
      id: 'tenant',
      revision: 1,
      updatedAt: nowIso(),
    })
    return 'dryRun' in inserted || inserted.inserted ? 1 : null
  }
  if (Number(row.revision) !== expected) return null
  const changed = await ctx.db.compareAndSet(
    'user.AuthorizationRevision',
    { id: 'tenant' },
    { revision: expected },
    { revision: expected + 1, updatedAt: nowIso() },
  )
  return 'dryRun' in changed || changed.matched ? expected + 1 : null
}

export const recordAuthorizationAudit = async (
  ctx: Ctx,
  values: {
    event: string
    targetKind: string
    targetId: string
    scopeKey?: string | null
    source: string
    reason: string
    before: unknown
    after: unknown
    revision: number
    outcome?: string
  },
) => {
  await ctx.db.insert('user.SecurityAudit', {
    id: randomUUID(),
    userId: null,
    event: values.event,
    occurredAt: nowIso(),
    networkFingerprint: null,
    metadata: null,
    actorKey: ctx.actor,
    targetKind: values.targetKind,
    targetId: values.targetId,
    scopeKey: values.scopeKey ?? null,
    source: values.source,
    reason: values.reason,
    beforeDigest: permissionDigest(values.before),
    afterDigest: permissionDigest(values.after),
    authorizationRevision: values.revision,
    outcome: values.outcome ?? 'success',
  })
}

const operationReplay = async (
  ctx: Ctx,
  id: string,
  input: unknown,
): Promise<{ replay: true; result: unknown } | { replay: false; digest: string } | { conflict: true }> => {
  const digest = permissionDigest(input)
  const O = ctx.table('user.AuthorizationOperation')
  const existing = await ctx.db.one(from(O).where(eq(O.id, id)))
  if (existing)
    return existing.digest === digest && existing.completedAt
      ? { replay: true, result: existing.result }
      : { conflict: true }
  const inserted = await ctx.db.insertIfAbsent('user.AuthorizationOperation', {
    id,
    digest,
    result: null,
    completedAt: null,
  })
  return 'dryRun' in inserted || inserted.inserted ? { replay: false, digest } : { conflict: true }
}

const completeOperation = async (ctx: Ctx, id: string, result: unknown) => {
  await ctx.db.update('user.AuthorizationOperation', { id }, { result, completedAt: nowIso() })
}

const roleApplies = (assignment: Row, companyId: string, branchId: string): boolean => {
  const kind = String(assignment.scopeKind ?? 'tenant')
  if (kind === 'tenant') return true
  if (kind === 'company') return String(assignment.companyId ?? '') === companyId
  return (
    kind === 'branch' &&
    String(assignment.companyId ?? '') === companyId &&
    String(assignment.branchId ?? '') === branchId
  )
}

/**
 * Validate the persisted union behind a managed role.
 *
 * Role metadata alone is not sufficient: authorization must also reject a
 * partially materialized template, a stale managed source, or a grant without
 * provenance. Otherwise a damaged/forged Grant row could silently become live.
 */
export const managedRoleHealthIssues = (
  manifest: Manifest,
  role: Row,
  grants: readonly Row[],
  sources: readonly Row[],
): string[] => {
  if (String(role.mode ?? 'custom') !== 'managed') return []
  const roleId = String(role.id)
  const templateKey = String(role.templateKey ?? '')
  const template = manifest.permissions.roleTemplates[templateKey]
  if (
    !template ||
    Number(role.templateVersion ?? 0) !== template.version ||
    String(role.templateDigest ?? '') !== template.digest
  )
    return ['stale-managed-role']

  const roleGrants = grants.filter((grant) => String(grant.roleId) === roleId)
  const roleSources = sources.filter((source) => String(source.roleId) === roleId)
  const grantKeys = new Set(roleGrants.map((grant) => String(grant.fnKey)))
  const sourcedKeys = new Set(roleSources.map((source) => String(source.fnKey)))
  const expected = new Set(template.functions)
  const managed = roleSources.filter((source) => String(source.sourceKind) === 'managed-template')
  const managedKeys = new Set(managed.map((source) => String(source.fnKey)))
  const invalidManagedSource = managed.some(
    (source) =>
      String(source.sourceKey) !== templateKey ||
      Number(source.sourceVersion ?? 0) !== template.version ||
      !expected.has(String(source.fnKey)),
  )
  const exactManagedSet =
    managed.length === expected.size &&
    managedKeys.size === expected.size &&
    [...expected].every((fnKey) => managedKeys.has(fnKey))
  const exactMaterializedUnion =
    roleSources.every((source) => grantKeys.has(String(source.fnKey))) &&
    roleGrants.every((grant) => sourcedKeys.has(String(grant.fnKey)))

  return invalidManagedSource || !exactManagedSet || !exactMaterializedUnion
    ? ['stale-managed-provenance']
    : []
}

/** Resolve and explain the exact set used by request authorization. */
export async function resolveEffectivePermissions(ctx: Ctx, userId: string): Promise<EffectiveAccess> {
  const revision = await authorizationRevisionOf(ctx)
  const empty = (issues: EffectiveAccess['issues'] = []): EffectiveAccess => ({
    revision,
    context: {
      companyId: ctx.scope.company ?? null,
      branchId: ctx.scope.branch ?? null,
    },
    superuser: false,
    functions: [],
    issues,
  })
  const U = ctx.table('user.User')
  const user = await ctx.db.one(from(U).where(eq(U.id, userId), eq(U.active, true)))
  if (!user) return empty([{ code: 'inactive-user' }])
  if (user.superuser === true) {
    const expiresAt = user.superuserExpiresAt ? Date.parse(String(user.superuserExpiresAt)) : null
    if (expiresAt == null || expiresAt > Date.now()) return { ...empty(), superuser: true }
  }
  const companyId = String(ctx.scope.company ?? '')
  if (!companyId) return empty([{ code: 'invalid-company-context' }])
  const companyIds = await activeCompanyMemberships(ctx, userId)
  if (!companyIds.has(companyId)) return empty([{ code: 'invalid-company-context' }])
  const branchId = String(ctx.scope.branch ?? '')
  const branches = await activeBranchMemberships(ctx, userId, companyIds)
  if (branchId && branches.get(branchId) !== companyId) return empty([{ code: 'invalid-branch-context' }])

  const A = ctx.table('user.Assignment')
  const assignments = (await ctx.db.all(from(A).where(eq(A.userId, userId)))).filter((assignment) =>
    roleApplies(assignment, companyId, branchId),
  )
  if (!assignments.length) return empty()
  const roleIds = [...new Set(assignments.map((assignment) => String(assignment.roleId)))]
  const R = ctx.table('user.Role')
  const roles = new Map(
    (await ctx.db.all(from(R).where(inArray(R.id, roleIds)))).map((role) => [String(role.id), role]),
  )
  const issues: EffectiveAccess['issues'] = []
  const healthyRoleIds = new Set<string>()
  for (const [roleId, role] of roles) {
    if (String(role.mode ?? 'custom') === 'managed') {
      const key = String(role.templateKey ?? '')
      const template = ctx.manifest.permissions.roleTemplates[key]
      if (
        !template ||
        Number(role.templateVersion ?? 0) !== template.version ||
        String(role.templateDigest ?? '') !== template.digest
      ) {
        issues.push({ code: 'stale-managed-role', roleId })
        continue
      }
    }
    healthyRoleIds.add(roleId)
  }
  if (!healthyRoleIds.size) return empty(issues)
  const G = ctx.table('user.Grant')
  const grants = await ctx.db.all(from(G).where(inArray(G.roleId, [...healthyRoleIds])))
  const S = ctx.table('user.GrantSource')
  const sources = await ctx.db.all(from(S).where(inArray(S.roleId, [...healthyRoleIds])))
  for (const roleId of [...healthyRoleIds]) {
    const role = roles.get(roleId)!
    const healthIssues = managedRoleHealthIssues(ctx.manifest, role, grants, sources)
    if (healthIssues.includes('stale-managed-provenance')) {
      issues.push({ code: 'stale-managed-provenance', roleId })
      healthyRoleIds.delete(roleId)
    }
  }
  if (!healthyRoleIds.size) return empty(issues)
  const sourceMap = new Map<string, Row[]>()
  for (const source of sources) {
    if (!healthyRoleIds.has(String(source.roleId))) continue
    const key = `${source.roleId}\0${source.fnKey}`
    ;(sourceMap.get(key) ?? sourceMap.set(key, []).get(key)!).push(source)
  }
  const paths = new Map<string, EffectivePermissionPath[]>()
  for (const grant of grants) {
    if (!healthyRoleIds.has(String(grant.roleId))) continue
    const fnKey = String(grant.fnKey)
    if (!ctx.manifest.functions[fnKey]) {
      issues.push({
        code: 'stale-function',
        roleId: String(grant.roleId),
        fnKey,
      })
      continue
    }
    const role = roles.get(String(grant.roleId))!
    for (const assignment of assignments.filter((item) => item.roleId === grant.roleId)) {
      const held = sourceMap.get(`${grant.roleId}\0${fnKey}`) ?? []
      const effectiveSources = held.length
        ? held
        : [
            {
              sourceKind: 'legacy-direct',
              sourceKey: fnKey,
              sourceVersion: null,
            },
          ]
      for (const source of effectiveSources) {
        const template =
          source.sourceKind === 'managed-template'
            ? ctx.manifest.permissions.roleTemplates[String(source.sourceKey)]
            : null
        const bundlePath = template?.functionPaths[fnKey]?.[0] ?? []
        ;(paths.get(fnKey) ?? paths.set(fnKey, []).get(fnKey)!).push({
          assignmentId: String(assignment.id),
          scopeKey: String(assignment.scopeKey ?? 'tenant'),
          roleId: String(role.id),
          roleMode: String(role.mode ?? 'custom') === 'managed' ? 'managed' : 'custom',
          templateKey: role.templateKey ? String(role.templateKey) : null,
          templateVersion: role.templateVersion == null ? null : Number(role.templateVersion),
          bundlePath,
          sourceKind: String(source.sourceKind),
        })
      }
    }
  }
  return {
    revision,
    context: { companyId, branchId: branchId || null },
    superuser: false,
    functions: [...paths.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, permissionPaths]) => ({
        key,
        risk: ctx.manifest.permissions.functions[key]?.risk ?? null,
        paths: permissionPaths.sort((left, right) =>
          `${left.scopeKey}\0${left.roleId}\0${left.sourceKind}`.localeCompare(
            `${right.scopeKey}\0${right.roleId}\0${right.sourceKind}`,
          ),
        ),
      })),
    issues,
  }
}

export const effectiveFunctionKeys = async (ctx: Ctx, userId: string): Promise<string[] | null> => {
  const effective = await resolveEffectivePermissions(ctx, userId)
  return effective.superuser ? null : effective.functions.map((permission) => permission.key)
}

const liveSuperuser = async (ctx: Ctx, userId: string | null): Promise<boolean> => {
  if (!userId) return false
  const U = ctx.table('user.User')
  const row = await ctx.db.one(from(U).where(eq(U.id, userId), eq(U.active, true), eq(U.superuser, true)))
  if (!row) return false
  const expiresAt = row.superuserExpiresAt ? Date.parse(String(row.superuserExpiresAt)) : null
  return expiresAt == null || expiresAt > Date.now()
}

const roleTemplatePreview = async (ctx: Ctx, roleId: string, templateKey: string) => {
  const template = ctx.manifest.permissions.roleTemplates[templateKey]
  if (!template) return invalid([issue('templateKey', 'E_PERMISSION_BUNDLE_UNKNOWN')])
  const S = ctx.table('user.GrantSource')
  const sources = roleId ? await ctx.db.all(from(S).where(eq(S.roleId, roleId))) : []
  const G = ctx.table('user.Grant')
  const grants = roleId ? await ctx.db.all(from(G).where(eq(G.roleId, roleId))) : []
  const currentManaged = new Set(
    sources
      .filter((source) => source.sourceKind === 'managed-template')
      .map((source) => String(source.fnKey)),
  )
  const sourcedFunctions = new Set(sources.map((source) => String(source.fnKey)))
  const other = new Set(
    sources
      .filter((source) => source.sourceKind !== 'managed-template')
      .map((source) => String(source.fnKey)),
  )
  for (const grant of grants) if (!sourcedFunctions.has(String(grant.fnKey))) other.add(String(grant.fnKey))
  const effective = new Set(grants.map((grant) => String(grant.fnKey)))
  const candidate = new Set(template.functions)
  const managedAdded = template.functions.filter((fn) => !currentManaged.has(fn))
  const managedRemoved = [...currentManaged].filter((fn) => !candidate.has(fn)).sort()
  const added = template.functions.filter((fn) => !effective.has(fn))
  const removed = [...currentManaged].filter((fn) => !candidate.has(fn) && !other.has(fn)).sort()
  const highRiskAdded = added.filter((fn) =>
    ['approve', 'configure', 'sensitive', 'security'].includes(
      ctx.manifest.permissions.functions[fn]?.risk ?? '',
    ),
  )
  return {
    ok: true as const,
    templateKey,
    templateVersion: template.version,
    templateDigest: template.digest,
    managedAdded,
    managedRemoved,
    added,
    removed,
    highRiskAdded,
  }
}

const AUTHORIZATION_EFFECTS = [
  'read:user.User',
  'write:user.User',
  'read:user.Role',
  'write:user.Role',
  'read:user.Grant',
  'write:user.Grant',
  'read:user.GrantSource',
  'write:user.GrantSource',
  'read:user.Assignment',
  'write:user.Assignment',
  'read:user.Membership',
  'read:user.BranchMembership',
  'read:user.AuthorizationRevision',
  'write:user.AuthorizationRevision',
  'read:user.AuthorizationOperation',
  'write:user.AuthorizationOperation',
  'write:user.SecurityAudit',
  'read:company.Company',
  'read:company.Branch',
]

export const authorizationFunctions: Record<string, FnSpec> = {
  authorizationState: defineFn({
    input: {},
    output: { revision: 'int' },
    effects: ['read:user.AuthorizationRevision'],
    handler: async (ctx: Ctx) => ({
      revision: await authorizationRevisionOf(ctx),
    }),
  }),

  permissionBundleCatalogue: defineFn({
    input: {},
    output: {
      version: 'int',
      digest: 'text',
      bundles: 'json',
      functions: 'json',
      roleTemplates: 'json',
    },
    effects: [],
    handler: (ctx: Ctx) => ({
      version: ctx.manifest.permissions.version,
      digest: ctx.manifest.permissions.digest,
      bundles: ctx.manifest.permissions.bundles,
      functions: ctx.manifest.permissions.functions,
      roleTemplates: ctx.manifest.permissions.roleTemplates,
    }),
  }),

  effectiveAccess: defineFn({
    input: { userId: 'id' },
    output: {
      revision: 'int',
      context: 'json',
      superuser: 'bool',
      functions: 'json',
      issues: 'json',
    },
    effects: AUTHORIZATION_EFFECTS.filter((effect) => !effect.startsWith('write:')),
    handler: (ctx: Ctx, args) => resolveEffectivePermissions(ctx, String(args.userId)),
  }),

  previewRoleTemplate: defineFn({
    input: { roleId: 'id?', templateKey: 'text' },
    output: {
      ok: 'bool',
      templateKey: 'text?',
      templateVersion: 'int?',
      templateDigest: 'text?',
      managedAdded: 'json?',
      managedRemoved: 'json?',
      added: 'json?',
      removed: 'json?',
      highRiskAdded: 'json?',
      errors: 'json?',
    },
    effects: ['read:user.Grant', 'read:user.GrantSource'],
    handler: (ctx: Ctx, args) =>
      roleTemplatePreview(ctx, String(args.roleId ?? ''), String(args.templateKey)),
  }),

  applyRoleTemplate: defineFn({
    input: {
      roleId: 'id',
      templateKey: 'text',
      expectedRoleRevision: 'int',
      expectedAuthorizationRevision: 'int',
      idempotencyKey: 'text',
      reason: 'text',
    },
    output: {
      ok: 'bool',
      roleId: 'id?',
      revision: 'int?',
      replayed: 'bool?',
      diff: 'json?',
      errors: 'json?',
    },
    effects: AUTHORIZATION_EFFECTS,
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const templateKey = String(args.templateKey)
      const template = ctx.manifest.permissions.roleTemplates[templateKey]
      if (!template) return invalid([issue('templateKey', 'E_PERMISSION_BUNDLE_UNKNOWN')])
      const reason = String(args.reason).trim()
      const operationId = `role-template:${String(args.idempotencyKey).trim()}`
      if (!reason || operationId.endsWith(':')) return invalid([issue('reason', 'user.error.required')])
      return authorizationTransaction(ctx, async (tx) => {
        const replay = await operationReplay(tx, operationId, args)
        if ('conflict' in replay) abort(invalid([issue('idempotencyKey', 'E_ROLE_TEMPLATE_CONFLICT')]))
        if ('replay' in replay && replay.replay)
          return {
            ...(replay.result as Record<string, unknown>),
            replayed: true,
          }
        const R = tx.table('user.Role')
        const roleId = String(args.roleId)
        const role = await tx.db.one(from(R).where(eq(R.id, roleId)))
        const expectedRoleRevision = Number(args.expectedRoleRevision)
        if (Number(role?.revision ?? 0) !== expectedRoleRevision)
          abort(invalid([issue('expectedRoleRevision', 'E_ROLE_TEMPLATE_CONFLICT')]))
        if (role && String(role.mode ?? 'custom') !== 'managed')
          abort(invalid([issue('roleId', 'E_ROLE_TEMPLATE_CONFLICT')]))
        if (role && Number(role.templateVersion ?? 0) > template.version)
          abort(invalid([issue('templateKey', 'E_ROLE_TEMPLATE_STALE')]))
        if ((await authorizationRevisionOf(tx)) !== Number(args.expectedAuthorizationRevision))
          abort(invalid([issue('expectedAuthorizationRevision', 'E_AUTHORIZATION_REVISION_CONFLICT')]))
        const preview = await roleTemplatePreview(tx, roleId, templateKey)
        const validPreview = preview.ok ? preview : abort(preview)
        if (
          role &&
          role.templateKey === templateKey &&
          Number(role.templateVersion) === template.version &&
          role.templateDigest === template.digest &&
          managedRoleHealthIssues(
            tx.manifest,
            role,
            await tx.db.all(from(tx.table('user.Grant')).where(eq(tx.table('user.Grant').roleId, roleId))),
            await tx.db.all(
              from(tx.table('user.GrantSource')).where(eq(tx.table('user.GrantSource').roleId, roleId)),
            ),
          ).length === 0 &&
          validPreview.managedAdded.length === 0 &&
          validPreview.managedRemoved.length === 0
        ) {
          const result = {
            ok: true,
            roleId,
            revision: Number(args.expectedAuthorizationRevision),
            replayed: false,
            diff: validPreview,
          }
          await completeOperation(tx, operationId, result)
          return result
        }
        const before = role ?? null
        if (!role) {
          const inserted = await tx.db.insertIfAbsent('user.Role', {
            id: roleId,
            name: template.labels.vi,
            description: template.summary?.vi ?? template.labels.en,
            mode: 'managed',
            templateKey,
            templateVersion: template.version,
            templateDigest: template.digest,
            revision: 1,
          })
          if (!('dryRun' in inserted) && !inserted.inserted)
            abort(invalid([issue('roleId', 'E_ROLE_TEMPLATE_CONFLICT')]))
        } else {
          const changed = await tx.db.compareAndSet(
            'user.Role',
            { id: roleId },
            { revision: expectedRoleRevision },
            {
              name: template.labels.vi,
              description: template.summary?.vi ?? template.labels.en,
              mode: 'managed',
              templateKey,
              templateVersion: template.version,
              templateDigest: template.digest,
              revision: expectedRoleRevision + 1,
            },
          )
          if (!('dryRun' in changed) && !changed.matched)
            abort(invalid([issue('expectedRoleRevision', 'E_ROLE_TEMPLATE_CONFLICT')]))
        }
        const S = tx.table('user.GrantSource')
        const G = tx.table('user.Grant')
        const managed = await tx.db.all(
          from(S).where(eq(S.roleId, roleId), eq(S.sourceKind, 'managed-template')),
        )
        const target = new Set(template.functions)
        const affected = new Set<string>(template.functions)
        for (const grant of await tx.db.all(from(G).where(eq(G.roleId, roleId))))
          affected.add(String(grant.fnKey))
        for (const source of managed) {
          affected.add(String(source.fnKey))
          await tx.db.del(deleteFrom(S).where(eq(S.id, source.id)))
        }
        for (const fnKey of template.functions) {
          await tx.db.insertIfAbsent('user.GrantSource', {
            id: `template:${roleId}:${templateKey}:${fnKey}`,
            roleId,
            fnKey,
            sourceKind: 'managed-template',
            sourceKey: templateKey,
            sourceVersion: template.version,
          })
          await tx.db.insertIfAbsent('user.Grant', {
            id: `materialized:${roleId}:${fnKey}`,
            roleId,
            fnKey,
          })
        }
        for (const fnKey of affected) {
          if (target.has(fnKey)) continue
          const remaining = await tx.db.one(from(S).where(eq(S.roleId, roleId), eq(S.fnKey, fnKey)))
          if (!remaining) await tx.db.del(deleteFrom(G).where(eq(G.roleId, roleId), eq(G.fnKey, fnKey)))
        }
        const revision =
          (await bumpRevision(tx, Number(args.expectedAuthorizationRevision))) ??
          abort(invalid([issue('expectedAuthorizationRevision', 'E_AUTHORIZATION_REVISION_CONFLICT')]))
        const result = {
          ok: true,
          roleId,
          revision,
          replayed: false,
          diff: validPreview,
        }
        await recordAuthorizationAudit(tx, {
          event: 'authorization.role-template.applied',
          targetKind: 'role',
          targetId: roleId,
          source: templateKey,
          reason,
          before,
          after: {
            templateKey,
            version: template.version,
            digest: template.digest,
          },
          revision,
        })
        await completeOperation(tx, operationId, result)
        return result
      })
    },
  }),

  assignScopedRole: defineFn({
    input: {
      id: 'id',
      userId: 'id',
      roleId: 'id',
      scopeKind: 'text',
      companyId: 'id?',
      branchId: 'id?',
      expectedAuthorizationRevision: 'int',
      idempotencyKey: 'text',
      reason: 'text',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      scopeKey: 'text?',
      revision: 'int?',
      replayed: 'bool?',
      errors: 'json?',
    },
    effects: AUTHORIZATION_EFFECTS,
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const normalized = await normalizeAssignmentScope(ctx, String(args.userId), args)
      if (!normalized.ok) return normalized
      const reason = String(args.reason).trim()
      const operationId = `assignment:${String(args.idempotencyKey).trim()}`
      if (!reason || operationId.endsWith(':')) return invalid([issue('reason', 'user.error.required')])
      return authorizationTransaction(ctx, async (tx) => {
        const liveScope = await normalizeAssignmentScope(tx, String(args.userId), args)
        const scope = liveScope.ok ? liveScope.scope : abort(liveScope)
        const replay = await operationReplay(tx, operationId, {
          ...args,
          scope,
        })
        if ('conflict' in replay)
          abort(invalid([issue('idempotencyKey', 'E_AUTHORIZATION_REVISION_CONFLICT')]))
        if ('replay' in replay && replay.replay)
          return {
            ...(replay.result as Record<string, unknown>),
            replayed: true,
          }
        const R = tx.table('user.Role')
        if (!(await tx.db.one(from(R).where(eq(R.id, args.roleId)))))
          abort(invalid([issue('roleId', 'user.error.roleMissing')]))
        if ((await authorizationRevisionOf(tx)) !== Number(args.expectedAuthorizationRevision))
          abort(invalid([issue('expectedAuthorizationRevision', 'E_AUTHORIZATION_REVISION_CONFLICT')]))
        const A = tx.table('user.Assignment')
        const held = await tx.db.one(
          from(A).where(eq(A.userId, args.userId), eq(A.roleId, args.roleId), eq(A.scopeKey, scope.scopeKey)),
        )
        const assignmentId = String(held?.id ?? args.id)
        if (held) {
          const result = {
            ok: true,
            id: assignmentId,
            scopeKey: scope.scopeKey,
            revision: Number(args.expectedAuthorizationRevision),
            replayed: false,
          }
          await completeOperation(tx, operationId, result)
          return result
        }
        await tx.db.insertIfAbsent('user.Assignment', {
          id: assignmentId,
          userId: args.userId,
          roleId: args.roleId,
          ...scope,
        })
        const revision =
          (await bumpRevision(tx, Number(args.expectedAuthorizationRevision))) ??
          abort(invalid([issue('expectedAuthorizationRevision', 'E_AUTHORIZATION_REVISION_CONFLICT')]))
        const result = {
          ok: true,
          id: assignmentId,
          scopeKey: scope.scopeKey,
          revision,
          replayed: false,
        }
        await recordAuthorizationAudit(tx, {
          event: held ? 'authorization.assignment.replayed' : 'authorization.assignment.created',
          targetKind: 'assignment',
          targetId: assignmentId,
          scopeKey: scope.scopeKey,
          source: String(args.roleId),
          reason,
          before: held ?? null,
          after: { userId: args.userId, roleId: args.roleId, ...scope },
          revision,
        })
        await completeOperation(tx, operationId, result)
        return result
      })
    },
  }),

  unassignScopedRole: defineFn({
    input: {
      userId: 'id',
      roleId: 'id',
      scopeKey: 'text',
      expectedAuthorizationRevision: 'int',
      idempotencyKey: 'text',
      reason: 'text',
    },
    output: {
      ok: 'bool',
      removed: 'int?',
      revision: 'int?',
      replayed: 'bool?',
      errors: 'json?',
    },
    effects: AUTHORIZATION_EFFECTS,
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const reason = String(args.reason).trim()
      const operationId = `unassignment:${String(args.idempotencyKey).trim()}`
      if (!reason || operationId.endsWith(':')) return invalid([issue('reason', 'user.error.required')])
      return authorizationTransaction(ctx, async (tx) => {
        const replay = await operationReplay(tx, operationId, args)
        if ('conflict' in replay)
          abort(invalid([issue('idempotencyKey', 'E_AUTHORIZATION_REVISION_CONFLICT')]))
        if ('replay' in replay && replay.replay)
          return {
            ...(replay.result as Record<string, unknown>),
            replayed: true,
          }
        if ((await authorizationRevisionOf(tx)) !== Number(args.expectedAuthorizationRevision))
          abort(invalid([issue('expectedAuthorizationRevision', 'E_AUTHORIZATION_REVISION_CONFLICT')]))
        const A = tx.table('user.Assignment')
        const before = await tx.db.one(
          from(A).where(eq(A.userId, args.userId), eq(A.roleId, args.roleId), eq(A.scopeKey, args.scopeKey)),
        )
        if (!before) {
          const result = {
            ok: true,
            removed: 0,
            revision: Number(args.expectedAuthorizationRevision),
            replayed: false,
          }
          await completeOperation(tx, operationId, result)
          return result
        }
        const removed = (
          await tx.db.del(
            deleteFrom(A).where(
              eq(A.userId, args.userId),
              eq(A.roleId, args.roleId),
              eq(A.scopeKey, args.scopeKey),
            ),
          )
        ).changes
        const revision =
          (await bumpRevision(tx, Number(args.expectedAuthorizationRevision))) ??
          abort(invalid([issue('expectedAuthorizationRevision', 'E_AUTHORIZATION_REVISION_CONFLICT')]))
        const result = { ok: true, removed, revision, replayed: false }
        await recordAuthorizationAudit(tx, {
          event: 'authorization.assignment.removed',
          targetKind: 'assignment',
          targetId: String(before?.id ?? `${args.userId}:${args.roleId}:${args.scopeKey}`),
          scopeKey: String(args.scopeKey),
          source: String(args.roleId),
          reason,
          before,
          after: null,
          revision,
        })
        await completeOperation(tx, operationId, result)
        return result
      })
    },
  }),

  cloneManagedRole: defineFn({
    input: {
      id: 'id',
      sourceRoleId: 'id',
      name: 'text',
      expectedAuthorizationRevision: 'int',
      idempotencyKey: 'text',
      reason: 'text',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      revision: 'int?',
      replayed: 'bool?',
      errors: 'json?',
    },
    effects: AUTHORIZATION_EFFECTS,
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const reason = String(args.reason).trim()
      const name = String(args.name).trim()
      const operationId = `role-clone:${String(args.idempotencyKey).trim()}`
      if (!reason || !name || operationId.endsWith(':'))
        return invalid([issue('name', 'user.error.required')])
      return authorizationTransaction(ctx, async (tx) => {
        const replay = await operationReplay(tx, operationId, args)
        if ('conflict' in replay) abort(invalid([issue('idempotencyKey', 'E_ROLE_TEMPLATE_CONFLICT')]))
        if ('replay' in replay && replay.replay)
          return {
            ...(replay.result as Record<string, unknown>),
            replayed: true,
          }
        const R = tx.table('user.Role')
        const sourceRow = await tx.db.one(from(R).where(eq(R.id, args.sourceRoleId)))
        const source =
          sourceRow && String(sourceRow.mode ?? 'custom') === 'managed'
            ? sourceRow
            : abort(invalid([issue('sourceRoleId', 'E_ROLE_TEMPLATE_CONFLICT')]))
        if ((await authorizationRevisionOf(tx)) !== Number(args.expectedAuthorizationRevision))
          abort(invalid([issue('expectedAuthorizationRevision', 'E_AUTHORIZATION_REVISION_CONFLICT')]))
        const inserted = await tx.db.insertIfAbsent('user.Role', {
          id: args.id,
          name,
          description: source.description ?? null,
          mode: 'custom',
          templateKey: null,
          templateVersion: null,
          templateDigest: null,
          revision: 1,
        })
        if (!('dryRun' in inserted) && !inserted.inserted)
          abort(invalid([issue('id', 'E_ROLE_TEMPLATE_CONFLICT')]))
        const G = tx.table('user.Grant')
        for (const grant of await tx.db.all(from(G).where(eq(G.roleId, args.sourceRoleId)))) {
          const fnKey = String(grant.fnKey)
          await tx.db.insertIfAbsent('user.GrantSource', {
            id: `custom:${String(args.id)}:${fnKey}`,
            roleId: args.id,
            fnKey,
            sourceKind: 'custom',
            sourceKey: 'clone',
            sourceVersion: null,
          })
          await tx.db.insertIfAbsent('user.Grant', {
            id: `materialized:${String(args.id)}:${fnKey}`,
            roleId: args.id,
            fnKey,
          })
        }
        const revision =
          (await bumpRevision(tx, Number(args.expectedAuthorizationRevision))) ??
          abort(invalid([issue('expectedAuthorizationRevision', 'E_AUTHORIZATION_REVISION_CONFLICT')]))
        const result = { ok: true, id: args.id, revision, replayed: false }
        await recordAuthorizationAudit(tx, {
          event: 'authorization.role.cloned',
          targetKind: 'role',
          targetId: String(args.id),
          source: String(args.sourceRoleId),
          reason,
          before: source,
          after: { id: args.id, mode: 'custom', name },
          revision,
        })
        await completeOperation(tx, operationId, result)
        return result
      })
    },
  }),

  setBreakGlass: defineFn({
    input: {
      userId: 'id',
      enabled: 'bool',
      expiresAt: 'datetime?',
      expectedAuthorizationRevision: 'int',
      idempotencyKey: 'text',
      reason: 'text',
    },
    output: {
      ok: 'bool',
      userId: 'id?',
      enabled: 'bool?',
      expiresAt: 'datetime?',
      revision: 'int?',
      replayed: 'bool?',
      errors: 'json?',
    },
    effects: AUTHORIZATION_EFFECTS,
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const reason = String(args.reason).trim()
      const operationId = `break-glass:${String(args.idempotencyKey).trim()}`
      const enabled = args.enabled === true
      const expiresAt = args.expiresAt ? new Date(String(args.expiresAt)) : null
      const expiryMs = expiresAt?.getTime() ?? Number.NaN
      if (!reason || operationId.endsWith(':')) return invalid([issue('reason', 'user.error.required')])
      if (enabled && (!expiresAt || !Number.isFinite(expiryMs) || expiryMs <= Date.now()))
        return invalid([issue('expiresAt', 'E_BREAK_GLASS_EXPIRY_REQUIRED')])
      if (!(await liveSuperuser(ctx, ctx.actor)))
        return invalid([issue('enabled', 'user.error.superuserRequired')])
      return authorizationTransaction(ctx, async (tx) => {
        const normalizedExpiry = enabled ? expiresAt!.toISOString() : null
        const replay = await operationReplay(tx, operationId, {
          userId: args.userId,
          enabled,
          expiresAt: normalizedExpiry,
          expectedAuthorizationRevision: args.expectedAuthorizationRevision,
          reason,
        })
        if ('conflict' in replay)
          abort(invalid([issue('idempotencyKey', 'E_AUTHORIZATION_REVISION_CONFLICT')]))
        if ('replay' in replay && replay.replay)
          return {
            ...(replay.result as Record<string, unknown>),
            replayed: true,
          }
        if ((await authorizationRevisionOf(tx)) !== Number(args.expectedAuthorizationRevision))
          abort(invalid([issue('expectedAuthorizationRevision', 'E_AUTHORIZATION_REVISION_CONFLICT')]))
        const U = tx.table('user.User')
        const user = await tx.db.one(from(U).where(eq(U.id, args.userId), eq(U.active, true)))
        if (!user || String(user.accessKind) !== 'internal')
          abort(invalid([issue('userId', 'user.error.userMissing')]))
        const target = user ?? abort(invalid([issue('userId', 'user.error.userMissing')]))
        const after = enabled
          ? {
              superuser: true,
              superuserOwner: ctx.actor,
              superuserReason: reason,
              superuserExpiresAt: normalizedExpiry,
            }
          : {
              superuser: false,
              superuserOwner: null,
              superuserReason: null,
              superuserExpiresAt: null,
            }
        const unchanged =
          target.superuser === after.superuser &&
          (target.superuserOwner ?? null) === after.superuserOwner &&
          (target.superuserReason ?? null) === after.superuserReason &&
          (target.superuserExpiresAt ? new Date(String(target.superuserExpiresAt)).toISOString() : null) ===
            after.superuserExpiresAt
        if (unchanged) {
          const result = {
            ok: true,
            userId: String(args.userId),
            enabled,
            expiresAt: normalizedExpiry,
            revision: Number(args.expectedAuthorizationRevision),
            replayed: false,
          }
          await completeOperation(tx, operationId, result)
          return result
        }
        await tx.db.update('user.User', { id: args.userId }, after)
        const revision =
          (await bumpRevision(tx, Number(args.expectedAuthorizationRevision))) ??
          abort(invalid([issue('expectedAuthorizationRevision', 'E_AUTHORIZATION_REVISION_CONFLICT')]))
        const result = {
          ok: true,
          userId: String(args.userId),
          enabled,
          expiresAt: normalizedExpiry,
          revision,
          replayed: false,
        }
        await recordAuthorizationAudit(tx, {
          event: enabled ? 'authorization.break-glass.activated' : 'authorization.break-glass.revoked',
          targetKind: 'user',
          targetId: String(args.userId),
          source: String(ctx.actor),
          reason,
          before: {
            superuser: target.superuser,
            owner: target.superuserOwner ?? null,
            expiresAt: target.superuserExpiresAt ?? null,
          },
          after: {
            superuser: after.superuser,
            owner: after.superuserOwner,
            expiresAt: normalizedExpiry,
          },
          revision,
        })
        await completeOperation(tx, operationId, result)
        return result
      })
    },
  }),

  listAuthorizationAudit: defineFn({
    input: { targetKind: 'text?', targetId: 'text?', limit: 'int?' },
    output: {
      id: 'id',
      event: 'text',
      occurredAt: 'datetime',
      actorKey: 'text?',
      targetKind: 'text?',
      targetId: 'text?',
      scopeKey: 'text?',
      source: 'text?',
      reason: 'text?',
      beforeDigest: 'text?',
      afterDigest: 'text?',
      authorizationRevision: 'int?',
      outcome: 'text?',
    },
    effects: ['read:user.SecurityAudit'],
    handler: async (ctx: Ctx, args) => {
      const A = ctx.table('user.SecurityAudit')
      let query = from(A)
        .where(isNotNull(A.authorizationRevision))
        .orderBy(asc(A.authorizationRevision), asc(A.id))
      if (args.targetKind) query = query.where(eq(A.targetKind, args.targetKind))
      if (args.targetId) query = query.where(eq(A.targetId, args.targetId))
      return ctx.db.all(query.limit(Math.max(1, Math.min(500, Number(args.limit ?? 100)))))
    },
  }),
}
