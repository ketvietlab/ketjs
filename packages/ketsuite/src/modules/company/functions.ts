import { asc, defineFn, eq, from } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'

type Issue = { field: string; code: string; params?: Record<string, unknown> }
const issue = (field: string, code: string, params?: Record<string, unknown>): Issue => ({
  field,
  code,
  ...(params ? { params } : {}),
})
const invalid = (errors: Issue[]) => ({ ok: false, errors })
const clean = (value: unknown): string => String(value ?? '').trim()

const companyParentIssue = async (ctx: Ctx, id: string, parentId?: unknown): Promise<Issue | null> => {
  if (!parentId) return null
  const C = ctx.table('company.Company')
  const seen = new Set<string>()
  let current = String(parentId)
  while (current) {
    if (current === id || seen.has(current)) return issue('parentId', 'company.error.parentCycle')
    seen.add(current)
    const row = await ctx.db.one(from(C).where(eq(C.id, current)))
    if (!row) return issue('parentId', 'company.error.parentMissing')
    current = row.parentId ? String(row.parentId) : ''
  }
  return null
}

const branchParentIssue = async (
  ctx: Ctx,
  id: string,
  companyId: string,
  parentId: string,
): Promise<Issue | null> => {
  const B = ctx.table('company.Branch')
  const seen = new Set<string>()
  let current = parentId
  while (current) {
    if (current === id || seen.has(current)) return issue('parentId', 'company.error.branchCycle')
    seen.add(current)
    const row = await ctx.db.one(from(B).where(eq(B.id, current)))
    if (!row) return issue('parentId', 'company.error.branchParentMissing')
    if (row.companyId !== companyId) return issue('parentId', 'company.error.branchParentCompany')
    current = row.parentId ? String(row.parentId) : ''
  }
  return null
}

const rootFor = async (ctx: Ctx, companyId: string): Promise<Row | null> => {
  const B = ctx.table('company.Branch')
  return ctx.db.one(from(B).where(eq(B.rootKey, companyId)))
}

export const functions: Record<string, FnSpec> = {
  listCompanies: defineFn({
    input: { includeArchived: 'bool?' },
    output: {
      id: 'id',
      code: 'text',
      name: 'text',
      partnerId: 'id',
      parentId: 'id?',
      currency: 'text',
      rootBranchId: 'id?',
      active: 'bool',
    },
    effects: ['read:company.Company', 'read:company.Branch', 'read:partner.Partner'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const C = ctx.table('company.Company')
      const B = ctx.table('company.Branch')
      let q = from(C).orderBy(asc(C.code)).preload('partner')
      if (a.includeArchived !== true) q = q.where(eq(C.active, true))
      const [rows, roots] = await Promise.all([
        ctx.db.all(q),
        ctx.db.all(from(B).where(eq(B.parentId, null))),
      ])
      const rootByCompany = new Map(roots.map((root) => [String(root.companyId), String(root.id)]))
      return rows.map((row) => ({
        ...row,
        name: String((row.partner as Row | null)?.name ?? row.code),
        rootBranchId: rootByCompany.get(String(row.id)) ?? null,
      }))
    },
  }),

  getCompany: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      code: 'text',
      name: 'text',
      partnerId: 'id',
      parentId: 'id?',
      currency: 'text',
      active: 'bool',
      branches: 'json?',
    },
    effects: ['read:company.Company', 'read:company.Branch', 'read:partner.Partner'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const C = ctx.table('company.Company')
      const row = await ctx.db.one(from(C).where(eq(C.id, a.id)).preload('partner'))
      if (!row) return null
      const B = ctx.table('company.Branch')
      const branches = await ctx.db.all(from(B).where(eq(B.companyId, a.id)).orderBy(asc(B.code)))
      return {
        ...row,
        name: String((row.partner as Row | null)?.name ?? row.code),
        branches: branches.map((branch) => ({ ...branch, isRoot: branch.rootKey === row.id })),
      }
    },
  }),

  saveCompany: defineFn({
    input: { id: 'id', code: 'text?', partnerId: 'id', parentId: 'id?', currency: 'text' },
    output: { ok: 'bool', id: 'id?', rootBranchId: 'id?', errors: 'json?' },
    effects: [
      'read:partner.Partner',
      'read:company.Company',
      'read:company.Branch',
      'write:company.Company',
      'write:company.Branch',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const id = String(a.id)
      const C = ctx.table('company.Company')
      const existing = await ctx.db.one(from(C).where(eq(C.id, id)))
      const code = clean(a.code || existing?.code || id).toUpperCase()
      const currency = clean(a.currency).toUpperCase()
      const errors: Issue[] = []
      if (!code) errors.push(issue('code', 'company.error.required'))
      if (!currency) errors.push(issue('currency', 'company.error.required'))

      const P = ctx.table('partner.Partner')
      const party = await ctx.db.one(from(P).where(eq(P.id, a.partnerId)))
      if (!party) errors.push(issue('partnerId', 'company.error.partnerMissing'))
      else if (party.kind !== 'company') errors.push(issue('partnerId', 'company.error.partnerKind'))

      const hierarchy = await companyParentIssue(ctx, id, a.parentId)
      if (hierarchy) errors.push(hierarchy)
      const codeOwner = await ctx.db.one(from(C).where(eq(C.code, code)))
      if (codeOwner && codeOwner.id !== id) errors.push(issue('code', 'company.error.codeUnique'))
      const partyOwner = await ctx.db.one(from(C).where(eq(C.partnerId, a.partnerId)))
      if (partyOwner && partyOwner.id !== id) errors.push(issue('partnerId', 'company.error.partnerUnique'))
      if (errors.length) return invalid(errors)

      const rootId = `root:${id}`
      return ctx.tx(async (tx) => {
        if (existing) {
          const cs = tx
            .change('company.Company', { ...a, code, currency }, existing)
            .cast(['id', 'code', 'partnerId', 'parentId', 'currency'])
          if (!cs.valid) return invalid(cs.errors.map((error) => issue(error.field, 'company.error.invalid')))
          await tx.db.commit(cs, { id })
          const root = await rootFor(tx, id)
          if (root) await tx.db.update('company.Branch', { id: root.id }, { code, name: String(party!.name) })
          return { ok: true, id, rootBranchId: String(root?.id ?? rootId) }
        }

        const inserted = await tx.db.insertIfAbsent('company.Company', {
          id,
          code,
          partnerId: a.partnerId,
          parentId: a.parentId ?? null,
          currency,
          active: true,
        })
        if (!('dryRun' in inserted) && !inserted.inserted)
          return invalid([issue('id', 'company.error.uniqueConflict')])
        const root = await tx.db.insertIfAbsent('company.Branch', {
          id: rootId,
          companyId: id,
          code,
          name: String(party!.name),
          parentId: null,
          rootKey: id,
          active: true,
        })
        if (!('dryRun' in root) && !root.inserted)
          return invalid([issue('code', 'company.error.rootConflict')])
        return { ok: true, id, rootBranchId: rootId }
      })
    },
  }),

  listBranches: defineFn({
    input: { companyId: 'id', includeArchived: 'bool?' },
    output: {
      id: 'id',
      companyId: 'id',
      code: 'text',
      name: 'text',
      parentId: 'id?',
      isRoot: 'bool',
      active: 'bool',
    },
    effects: ['read:company.Branch'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const B = ctx.table('company.Branch')
      let q = from(B).where(eq(B.companyId, a.companyId)).orderBy(asc(B.code))
      if (a.includeArchived !== true) q = q.where(eq(B.active, true))
      return (await ctx.db.all(q)).map((row) => ({ ...row, isRoot: row.rootKey === a.companyId }))
    },
  }),

  saveBranch: defineFn({
    input: { id: 'id', companyId: 'id', code: 'text', name: 'text', parentId: 'id?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:company.Company', 'read:company.Branch', 'write:company.Branch'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const id = String(a.id)
      const companyId = String(a.companyId)
      const code = clean(a.code).toUpperCase()
      const name = clean(a.name)
      const C = ctx.table('company.Company')
      const company = await ctx.db.one(from(C).where(eq(C.id, companyId)))
      const errors: Issue[] = []
      if (!company) errors.push(issue('companyId', 'company.error.missing'))
      else if (company.active !== true) errors.push(issue('companyId', 'company.error.archived'))
      if (!code) errors.push(issue('code', 'company.error.required'))
      if (!name) errors.push(issue('name', 'company.error.required'))

      const B = ctx.table('company.Branch')
      const existing = await ctx.db.one(from(B).where(eq(B.id, id)))
      if (existing?.rootKey) errors.push(issue('id', 'company.error.rootManagedByCompany'))
      if (existing && existing.companyId !== companyId)
        errors.push(issue('companyId', 'company.error.branchCompanyImmutable'))
      const root = await rootFor(ctx, companyId)
      if (!root) errors.push(issue('companyId', 'company.error.rootMissing'))
      const parentId = String(a.parentId || root?.id || '')
      if (parentId) {
        const hierarchy = await branchParentIssue(ctx, id, companyId, parentId)
        if (hierarchy) errors.push(hierarchy)
      }
      const codeOwner = await ctx.db.one(from(B).where(eq(B.companyId, companyId), eq(B.code, code)))
      if (codeOwner && codeOwner.id !== id) errors.push(issue('code', 'company.error.branchCodeUnique'))
      if (errors.length) return invalid(errors)

      if (existing) {
        await ctx.db.update('company.Branch', { id }, { code, name, parentId })
        return { ok: true, id }
      }
      const inserted = await ctx.db.insertIfAbsent('company.Branch', {
        id,
        companyId,
        code,
        name,
        parentId,
        rootKey: null,
        active: true,
      })
      return 'dryRun' in inserted || inserted.inserted
        ? { ok: true, id }
        : invalid([issue('code', 'company.error.branchUniqueConflict')])
    },
  }),

  archiveCompany: defineFn({
    input: { id: 'id', active: 'bool' },
    output: { ok: 'bool', id: 'id?', active: 'bool?', errors: 'json?' },
    effects: ['read:company.Company', 'write:company.Company'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const C = ctx.table('company.Company')
      const row = await ctx.db.one(from(C).where(eq(C.id, a.id)))
      if (!row) return invalid([issue('id', 'company.error.missing')])
      if (a.active === false && ctx.manifest.models['user.User'])
        return invalid([issue('active', 'company.error.identityGuardRequired')])
      if (a.active === false && (await ctx.db.count(from(C).where(eq(C.active, true)))) <= 1)
        return invalid([issue('active', 'company.error.lastActive')])
      await ctx.db.update('company.Company', { id: a.id }, { active: a.active } as Row)
      return { ok: true, id: a.id, active: a.active }
    },
  }),

  archiveBranch: defineFn({
    input: { id: 'id', active: 'bool' },
    output: { ok: 'bool', id: 'id?', active: 'bool?', errors: 'json?' },
    effects: ['read:company.Company', 'read:company.Branch', 'write:company.Branch'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const B = ctx.table('company.Branch')
      const row = await ctx.db.one(from(B).where(eq(B.id, a.id)))
      if (!row) return invalid([issue('id', 'company.error.branchMissing')])
      if (a.active === false && row.rootKey) return invalid([issue('active', 'company.error.rootArchive')])
      if (a.active === false && ctx.manifest.models['user.User'])
        return invalid([issue('active', 'company.error.identityGuardRequired')])
      if (a.active === false) {
        const active = await ctx.db.count(from(B).where(eq(B.companyId, row.companyId), eq(B.active, true)))
        if (active <= 1) return invalid([issue('active', 'company.error.lastBranch')])
      }
      await ctx.db.update('company.Branch', { id: a.id }, { active: a.active } as Row)
      return { ok: true, id: a.id, active: a.active }
    },
  }),

  contextLabels: defineFn({
    exposure: 'internal',
    input: { companyId: 'id?', branchId: 'id?' },
    output: {
      companyName: 'text?',
      branchName: 'text?',
      branchCode: 'text?',
      branchIsRoot: 'bool?',
    },
    effects: ['read:company.Company', 'read:company.Branch', 'read:partner.Partner'],
    handler: async (ctx: Ctx, a) => {
      const C = ctx.table('company.Company')
      const B = ctx.table('company.Branch')
      const [company, branch] = await Promise.all([
        a.companyId ? ctx.db.one(from(C).where(eq(C.id, a.companyId)).preload('partner')) : null,
        a.branchId ? ctx.db.one(from(B).where(eq(B.id, a.branchId))) : null,
      ])
      return {
        companyName: company ? String((company.partner as Row | null)?.name ?? company.code) : null,
        branchName: branch ? String(branch.name) : null,
        branchCode: branch ? String(branch.code) : null,
        branchIsRoot: branch ? Boolean(branch.rootKey) : null,
      }
    },
  }),
}
