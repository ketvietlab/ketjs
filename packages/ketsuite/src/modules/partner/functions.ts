import { asc, defineFn, deleteFrom, eq, from, like } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { ADDRESS_USES, PARTNER_KINDS, PARTNER_ROLES } from './types.ts'
import { resolveAddress, snapshotAddress, validateAddress } from '../address/format.ts'

type Issue = { field: string; code: string; params?: Record<string, unknown> }
const issue = (field: string, code: string, params?: Record<string, unknown>): Issue => ({
  field,
  code,
  ...(params ? { params } : {}),
})
const invalid = (errors: Issue[]) => ({ ok: false, errors })
class DefaultConflict extends Error {}
const changeIssues = (errors: Array<{ field: string }>): Issue[] =>
  errors.map((error) => issue(error.field, 'partner.error.invalid'))

type AddressArgs = Record<string, unknown>
const canonicalAddress = (args: AddressArgs) => ({
  street1: String(args.street1 ?? args.street ?? '').trim(),
  street2: args.street2 ? String(args.street2).trim() : null,
  locality: args.locality || args.city ? String(args.locality ?? args.city).trim() : null,
  postalCode: args.postalCode || args.zip ? String(args.postalCode ?? args.zip).trim() : null,
  countryCode: String(args.countryId ?? args.countryCode ?? args.country ?? '')
    .trim()
    .toUpperCase(),
  divisionId: args.divisionId ? String(args.divisionId) : null,
  divisionText: args.divisionText || args.state ? String(args.divisionText ?? args.state).trim() : null,
})

const presentationOf = async (ctx: Ctx, row: Row): Promise<Row> => {
  const canonical = {
    id: row.id,
    street1: row.street1,
    street2: row.street2,
    locality: row.locality,
    postalCode: row.postalCode,
    countryId: row.countryId,
    divisionId: row.divisionId,
  }
  let oneLine = [row.street1, row.street2, row.divisionText, row.locality, row.postalCode, row.countryCode]
    .filter(Boolean)
    .join(', ')
  let divisionPath: Row[] = []
  if (row.countryId) {
    const resolved = await resolveAddress(ctx, canonical)
    if (resolved.value) {
      oneLine = resolved.value.oneLine
      divisionPath = resolved.value.divisions
    }
  }
  return {
    ...row,
    oneLine,
    divisionPath,
    // Compatibility projection for callers created before canonical address refs.
    street: row.street1,
    city: divisionPath.at(-1)?.officialName ?? row.locality ?? '',
    zip: row.postalCode,
    state: divisionPath.at(-2)?.officialName ?? row.divisionText,
    country: row.countryCode,
  }
}

export const defaultAddressFor = async (ctx: Ctx, partnerId: string, use: string): Promise<Row | null> => {
  const D = ctx.table('partner.AddressDefault')
  const selected = await ctx.db.one(from(D).where(eq(D.partnerId, partnerId), eq(D.use, use)))
  if (!selected) return null
  const A = ctx.table('partner.Address')
  return ctx.db.one(from(A).where(eq(A.id, selected.addressId)))
}

export const snapshotPartnerAddress = async (
  ctx: Ctx,
  addressId: string | null | undefined,
  capturedAt = new Date().toISOString(),
): Promise<Record<string, unknown> | null> => {
  if (!addressId) return null
  const A = ctx.table('partner.Address')
  const row = await ctx.db.one(from(A).where(eq(A.id, addressId)))
  if (!row) return null
  if (row.countryId) {
    const result = await snapshotAddress(
      ctx,
      {
        id: row.id,
        street1: row.street1,
        street2: row.street2,
        locality: row.locality,
        postalCode: row.postalCode,
        countryId: row.countryId,
        divisionId: row.divisionId,
      },
      capturedAt,
    )
    if (result.snapshot) return result.snapshot
  }
  const fallback = await presentationOf(ctx, row)
  return {
    schemaVersion: 1,
    sourceAddressId: row.id,
    capturedAt,
    catalogId: null,
    country: { id: null, code: row.countryCode, name: row.countryCode },
    divisions: [],
    street1: row.street1,
    street2: row.street2 ?? null,
    locality: row.locality ?? null,
    postalCode: row.postalCode ?? null,
    lines: [row.street1, row.street2, row.divisionText, row.locality, row.postalCode, row.countryCode].filter(
      Boolean,
    ),
    oneLine: fallback.oneLine,
  }
}

const parentIssue = async (
  ctx: Ctx,
  candidate: { id: unknown; kind: unknown; parentId?: unknown },
): Promise<Issue | null> => {
  if (!candidate.parentId) return null
  const P = ctx.table('partner.Partner')
  const id = String(candidate.id)
  const seen = new Set<string>()
  let current = String(candidate.parentId)
  let first = true
  while (current) {
    if (current === id || seen.has(current)) return issue('parentId', 'partner.error.parentCycle')
    seen.add(current)
    const row = await ctx.db.one(from(P).where(eq(P.id, current)))
    if (!row) return issue('parentId', 'partner.error.parentMissing')
    if (first && candidate.kind === 'company' && row.kind === 'person')
      return issue('parentId', 'partner.error.personCannotOwnCompany')
    first = false
    current = row.parentId ? String(row.parentId) : ''
  }
  return null
}

/** Keep one default mapping under concurrent writers. The deterministic id and
 * unique index make the row singular; the final atomic update chooses the winner. */
const selectDefault = async (
  ctx: Ctx,
  partnerId: string,
  use: string,
  addressId: string,
): Promise<boolean> => {
  const id = `default:${partnerId}:${use}`
  const changed = await ctx.db.update('partner.AddressDefault', { id }, { addressId })
  if ('dryRun' in changed || changed.changes > 0) return true
  const inserted = await ctx.db.insertIfAbsent('partner.AddressDefault', {
    id,
    partnerId,
    use,
    addressId,
  })
  if ('dryRun' in inserted || inserted.inserted) return true
  const retried = await ctx.db.update('partner.AddressDefault', { id }, { addressId })
  if ('dryRun' in retried || retried.changes > 0) return true
  return false
}

export const functions: Record<string, FnSpec> = {
  listPartners: defineFn({
    input: {
      role: 'text?',
      kind: 'text?',
      search: 'text?',
      includeArchived: 'bool?',
      limit: 'int?',
      offset: 'int?',
    },
    output: {
      id: 'id',
      kind: 'text',
      name: 'text',
      ref: 'text?',
      email: 'text?',
      phone: 'text?',
      active: 'bool',
    },
    effects: ['read:partner.Partner', 'read:partner.Role'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const P = ctx.table('partner.Partner')
      let q = from(P).select(P.id, P.kind, P.name, P.ref, P.email, P.phone, P.active).orderBy(asc(P.name))
      if (a.includeArchived !== true) q = q.where(eq(P.active, true))
      if (a.kind) q = q.where(eq(P.kind, a.kind))
      if (a.search) q = q.where(like(P.name, `%${String(a.search)}%`))
      if (!a.role) {
        if (typeof a.limit === 'number') q = q.limit(a.limit)
        if (typeof a.offset === 'number') q = q.offset(a.offset)
        return ctx.db.all(q)
      }
      let rows = await ctx.db.all(q)
      if (a.role) {
        const R = ctx.table('partner.Role')
        const holders = new Set(
          (await ctx.db.all(from(R).select(R.partnerId).where(eq(R.role, a.role)))).map(
            (row) => row.partnerId,
          ),
        )
        rows = rows.filter((row) => holders.has(row.id))
      }
      const offset = typeof a.offset === 'number' ? a.offset : 0
      const end = typeof a.limit === 'number' ? offset + a.limit : undefined
      return rows.slice(offset, end)
    },
  }),

  countPartners: defineFn({
    input: { role: 'text?', kind: 'text?', search: 'text?', includeArchived: 'bool?' },
    output: { count: 'int' },
    effects: ['read:partner.Partner', 'read:partner.Role'],
    handler: async (ctx: Ctx, a) => {
      const P = ctx.table('partner.Partner')
      let q = from(P).select(P.id)
      if (a.includeArchived !== true) q = q.where(eq(P.active, true))
      if (a.kind) q = q.where(eq(P.kind, a.kind))
      if (a.search) q = q.where(like(P.name, `%${String(a.search)}%`))
      if (!a.role) return { count: await ctx.db.count(q) }
      const rows = await ctx.db.all(q)
      const R = ctx.table('partner.Role')
      const holders = new Set(
        (await ctx.db.all(from(R).select(R.partnerId).where(eq(R.role, a.role)))).map((row) => row.partnerId),
      )
      return { count: rows.filter((row) => holders.has(row.id)).length }
    },
  }),

  getPartner: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      kind: 'text',
      name: 'text',
      parentId: 'id?',
      vat: 'text?',
      ref: 'text?',
      email: 'text?',
      phone: 'text?',
      lang: 'text?',
      active: 'bool',
      addresses: 'json?',
      roles: 'json?',
    },
    effects: [
      'read:partner.Partner',
      'read:partner.Address',
      'read:partner.AddressDefault',
      'read:partner.Role',
      'read:address.Country',
      'read:address.CurrentCatalog',
      'read:address.Division',
    ],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const P = ctx.table('partner.Partner')
      const row = await ctx.db.one(from(P).where(eq(P.id, a.id)))
      if (!row) return null
      const A = ctx.table('partner.Address')
      const D = ctx.table('partner.AddressDefault')
      const R = ctx.table('partner.Role')
      const [addresses, defaults, roles] = await Promise.all([
        ctx.db.all(from(A).where(eq(A.partnerId, a.id))),
        ctx.db.all(from(D).select(D.addressId).where(eq(D.partnerId, a.id))),
        ctx.db.all(from(R).where(eq(R.partnerId, a.id))),
      ])
      const selected = new Set(defaults.map((item) => item.addressId))
      return {
        ...row,
        addresses: await Promise.all(
          addresses.map(async (address) => ({
            ...(await presentationOf(ctx, address)),
            isDefault: selected.has(address.id),
          })),
        ),
        roles,
      }
    },
  }),

  listAddresses: defineFn({
    input: { partnerId: 'id', use: 'text?' },
    output: {
      id: 'id',
      partnerId: 'id',
      use: 'text',
      street1: 'text',
      street2: 'text?',
      locality: 'text?',
      postalCode: 'text?',
      countryCode: 'text',
      countryId: 'id?',
      divisionId: 'id?',
      divisionText: 'text?',
      oneLine: 'text',
      isDefault: 'bool',
    },
    effects: [
      'read:partner.Address',
      'read:partner.AddressDefault',
      'read:address.Country',
      'read:address.CurrentCatalog',
      'read:address.Division',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const A = ctx.table('partner.Address')
      let query = from(A).where(eq(A.partnerId, args.partnerId))
      if (args.use) query = query.where(eq(A.use, args.use))
      const rows = await ctx.db.all(query)
      const D = ctx.table('partner.AddressDefault')
      const defaults = new Set(
        (await ctx.db.all(from(D).select(D.addressId).where(eq(D.partnerId, args.partnerId)))).map(
          (row) => row.addressId,
        ),
      )
      return Promise.all(
        rows.map(async (row) => ({ ...(await presentationOf(ctx, row)), isDefault: defaults.has(row.id) })),
      )
    },
  }),

  savePartner: defineFn({
    input: {
      id: 'id',
      kind: 'text',
      name: 'text',
      parentId: 'id?',
      vat: 'text?',
      ref: 'text?',
      email: 'text?',
      phone: 'text?',
      lang: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:partner.Partner', 'write:partner.Partner'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const errors: Issue[] = []
      if (!PARTNER_KINDS.includes(String(a.kind) as never))
        errors.push(issue('kind', 'partner.error.kind', { allowed: PARTNER_KINDS }))
      if (!String(a.name).trim()) errors.push(issue('name', 'partner.error.required'))
      const hierarchy = await parentIssue(ctx, { id: a.id, kind: a.kind, parentId: a.parentId })
      if (hierarchy) errors.push(hierarchy)
      const P = ctx.table('partner.Partner')
      if (a.kind === 'person') {
        const companyChild = await ctx.db.one(from(P).where(eq(P.parentId, a.id), eq(P.kind, 'company')))
        if (companyChild) errors.push(issue('kind', 'partner.error.personCannotOwnCompany'))
      }
      if (errors.length) return invalid(errors)
      const existing = await ctx.db.one(from(P).where(eq(P.id, a.id)))
      let cs = ctx
        .change('partner.Partner', { ...a, name: String(a.name).trim() }, existing)
        .cast(['id', 'kind', 'name', 'parentId', 'vat', 'ref', 'email', 'phone', 'lang'])
      if (!existing) cs = cs.put('active', true)
      if (!cs.valid) return invalid(changeIssues(cs.errors))
      await ctx.db.commit(cs, existing ? { id: a.id } : undefined)
      return { ok: true, id: a.id }
    },
  }),

  archivePartner: defineFn({
    input: { id: 'id', active: 'bool' },
    output: { id: 'id', active: 'bool' },
    effects: ['write:partner.Partner'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      await ctx.db.update('partner.Partner', { id: a.id }, { active: a.active } as Row)
      return { id: a.id, active: a.active }
    },
  }),

  saveAddress: defineFn({
    input: {
      id: 'id',
      partnerId: 'id',
      use: 'text',
      street: 'text?',
      street1: 'text?',
      street2: 'text?',
      city: 'text?',
      locality: 'text?',
      zip: 'text?',
      postalCode: 'text?',
      state: 'text?',
      divisionText: 'text?',
      country: 'text?',
      countryCode: 'text?',
      countryId: 'id?',
      divisionId: 'id?',
      isDefault: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:partner.Partner',
      'read:partner.Address',
      'read:partner.AddressDefault',
      'write:partner.Address',
      'write:partner.AddressDefault',
      'read:address.Country',
      'read:address.CurrentCatalog',
      'read:address.Division',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const errors: Issue[] = []
      const address = canonicalAddress(a)
      if (!ADDRESS_USES.includes(String(a.use) as never))
        errors.push(issue('use', 'partner.error.addressUse', { allowed: ADDRESS_USES }))
      if (!address.street1) errors.push(issue('street1', 'partner.error.required'))
      if (!/^[A-Z]{2}$/.test(address.countryCode))
        errors.push(issue('countryId', 'address.error.countryCode'))
      const country = /^[A-Z]{2}$/.test(address.countryCode)
        ? await ctx.db.one(
            from(ctx.table('address.Country')).where(
              eq(ctx.table('address.Country').id, address.countryCode),
            ),
          )
        : null
      if (country) {
        const checked = await validateAddress(ctx, {
          ...address,
          countryId: address.countryCode,
        })
        errors.push(...checked.issues)
      } else if (address.divisionId) {
        errors.push(issue('divisionId', 'address.error.catalogNotInstalled'))
      }
      if (errors.length) return invalid(errors)

      try {
        return await ctx.tx(async (tx) => {
          const A = tx.table('partner.Address')
          const D = tx.table('partner.AddressDefault')
          const existing = await tx.db.one(from(A).where(eq(A.id, a.id)))
          if (existing && existing.partnerId !== a.partnerId)
            return invalid([issue('partnerId', 'partner.error.addressOwner')])
          if (!existing) {
            const P = tx.table('partner.Partner')
            if (!(await tx.db.one(from(P).where(eq(P.id, a.partnerId)))))
              return invalid([issue('partnerId', 'partner.error.partnerMissing')])
          }
          const values = {
            id: a.id,
            partnerId: a.partnerId,
            use: a.use,
            ...address,
            countryId: country ? address.countryCode : null,
          }
          const cs = tx
            .change('partner.Address', values, existing)
            .cast([
              'id',
              'partnerId',
              'use',
              'street1',
              'street2',
              'locality',
              'postalCode',
              'countryCode',
              'countryId',
              'divisionId',
              'divisionText',
            ])
          if (!cs.valid) return invalid(changeIssues(cs.errors))
          await tx.db.commit(cs, existing ? { id: a.id } : undefined)
          if (a.isDefault !== true || (existing && existing.use !== a.use)) {
            const previous = await tx.db.one(from(D).where(eq(D.addressId, a.id)))
            if (previous) await tx.db.del(deleteFrom(D).where(eq(D.id, previous.id)))
          }
          if (
            a.isDefault === true &&
            !(await selectDefault(tx, String(a.partnerId), String(a.use), String(a.id)))
          )
            throw new DefaultConflict()
          return { ok: true, id: a.id }
        })
      } catch (error) {
        if (error instanceof DefaultConflict)
          return invalid([issue('isDefault', 'partner.error.defaultConflict')])
        throw error
      }
    },
  }),

  snapshotAddress: defineFn({
    input: { id: 'id' },
    output: { ok: 'bool', snapshot: 'json?', errors: 'json?' },
    effects: [
      'read:partner.Address',
      'read:address.Country',
      'read:address.CurrentCatalog',
      'read:address.Division',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const snapshot = await snapshotPartnerAddress(ctx, String(args.id))
      return snapshot ? { ok: true, snapshot } : invalid([issue('id', 'partner.error.addressMissing')])
    },
  }),

  grantRole: defineFn({
    input: { id: 'id', partnerId: 'id', role: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:partner.Partner', 'read:partner.Role', 'write:partner.Role'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      if (!PARTNER_ROLES.includes(String(a.role) as never))
        return invalid([issue('role', 'partner.error.role', { allowed: PARTNER_ROLES })])
      const P = ctx.table('partner.Partner')
      if (!(await ctx.db.one(from(P).where(eq(P.id, a.partnerId)))))
        return invalid([issue('partnerId', 'partner.error.partnerMissing')])
      const inserted = await ctx.db.insertIfAbsent('partner.Role', {
        id: a.id,
        partnerId: a.partnerId,
        role: a.role,
      })
      if ('dryRun' in inserted || inserted.inserted) return { ok: true, id: a.id }
      return { ok: true }
    },
  }),

  revokeRole: defineFn({
    input: { partnerId: 'id', role: 'text' },
    output: { ok: 'bool', removed: 'int' },
    effects: ['read:partner.Role', 'write:partner.Role'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const R = ctx.table('partner.Role')
      const { changes } = await ctx.db.del(
        deleteFrom(R).where(eq(R.partnerId, a.partnerId), eq(R.role, a.role)),
      )
      return { ok: true, removed: changes }
    },
  }),

  saveTerms: defineFn({
    input: { id: 'id', partnerId: 'id', creditLimit: 'decimal?', note: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:partner.Partner', 'read:partner.CompanyTerms', 'write:partner.CompanyTerms'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const P = ctx.table('partner.Partner')
      if (!(await ctx.db.one(from(P).where(eq(P.id, a.partnerId)))))
        return invalid([issue('partnerId', 'partner.error.partnerMissing')])
      return ctx.tx(async (tx) => {
        const T = tx.table('partner.CompanyTerms')
        const existing = await tx.db.one(from(T).where(eq(T.partnerId, a.partnerId)))
        const cs = tx
          .change('partner.CompanyTerms', a, existing)
          .cast(['id', 'partnerId', 'creditLimit', 'note'])
        if (!cs.valid) return invalid(changeIssues(cs.errors))
        if (existing) {
          await tx.db.commit(cs, { id: existing.id })
          return { ok: true, id: existing.id }
        }
        const inserted = await tx.db.insertIfAbsent('partner.CompanyTerms', {
          id: a.id,
          partnerId: a.partnerId,
          ...(a.creditLimit === undefined ? {} : { creditLimit: a.creditLimit }),
          ...(a.note === undefined ? {} : { note: a.note }),
        })
        if ('dryRun' in inserted || inserted.inserted) return { ok: true, id: a.id }
        const held = await tx.db.one(from(T).where(eq(T.partnerId, a.partnerId)))
        if (held)
          await tx.db.update(
            'partner.CompanyTerms',
            { id: held.id },
            { creditLimit: a.creditLimit, note: a.note },
          )
        return { ok: true, id: held?.id ?? a.id }
      })
    },
  }),

  getTerms: defineFn({
    input: { partnerId: 'id' },
    output: { id: 'id', partnerId: 'id', creditLimit: 'decimal?', note: 'text?' },
    effects: ['read:partner.CompanyTerms'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const T = ctx.table('partner.CompanyTerms')
      return ctx.db.one(from(T).where(eq(T.partnerId, a.partnerId)))
    },
  }),
}
