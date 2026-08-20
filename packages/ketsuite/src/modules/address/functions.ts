import { asc, defineFn, eq, from, isNull, like } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { availableCatalogs, loadCatalog } from './loader.ts'
import { divisionPath, resolveAddress, snapshotAddress, validateAddress } from './format.ts'

const issue = (field: string, code: string, params?: Record<string, unknown>) => ({
  field,
  code,
  ...(params ? { params } : {}),
})
const invalid = (field: string, code: string, params?: Record<string, unknown>) => ({
  ok: false,
  errors: [issue(field, code, params)],
})
const ISO = /^[A-Z]{2}$/
class CatalogConflict extends Error {}
const installedEffects = [
  'read:address.Country',
  'write:address.Country',
  'read:address.Catalog',
  'write:address.Catalog',
  'read:address.CurrentCatalog',
  'write:address.CurrentCatalog',
  'read:address.Division',
  'write:address.Division',
]

export const functions: Record<string, FnSpec> = {
  availableCatalogs: defineFn({
    input: {},
    output: { countryCode: 'text', version: 'text', recommended: 'bool' },
    effects: [],
    handler: () => availableCatalogs(),
  }),

  installCatalog: defineFn({
    input: { countryCode: 'text', version: 'text?' },
    output: {
      ok: 'bool',
      countryId: 'id?',
      catalogId: 'id?',
      recordCount: 'int?',
      alreadyInstalled: 'bool?',
      errors: 'json?',
    },
    effects: installedEffects,
    exposure: 'internal',
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      const countryCode = String(args.countryCode).trim().toUpperCase()
      if (!ISO.test(countryCode)) return invalid('countryCode', 'address.error.countryCode')
      let bundle: Awaited<ReturnType<typeof loadCatalog>>
      try {
        bundle = await loadCatalog(countryCode, args.version ? String(args.version) : undefined)
      } catch (error) {
        return invalid('countryCode', 'address.error.bundleInvalid', {
          reason: error instanceof Error ? error.message : String(error),
        })
      }
      const catalogId = `${countryCode}:${bundle.catalog.version}`
      try {
        return await ctx.tx(async (tx) => {
          const countryRow: Row = {
            id: countryCode,
            code: countryCode,
            alpha3: bundle.country.alpha3 ?? null,
            numericCode: bundle.country.numericCode ?? null,
            name: bundle.country.name,
            officialName: bundle.country.officialName ?? null,
            localName: bundle.country.localName ?? null,
            callingCode: bundle.country.callingCode ?? null,
            policy: bundle.policy,
            active: true,
          }
          const countryInsert = await tx.db.insertIfAbsent('address.Country', countryRow)
          if (!('dryRun' in countryInsert) && !countryInsert.inserted)
            await tx.db.update('address.Country', { id: countryCode }, countryRow)

          const T = tx.table('address.Catalog')
          const existing = await tx.db.one(from(T).where(eq(T.id, catalogId)))
          if (existing) {
            if (existing.checksum !== bundle.checksum)
              return invalid('version', 'address.error.catalogImmutable')
            if (existing.status === 'active' || existing.status === 'verified') {
              return {
                ok: true,
                countryId: countryCode,
                catalogId,
                recordCount: Number(existing.recordCount),
                alreadyInstalled: true,
              }
            }
            return invalid('version', 'address.error.catalogBusy')
          }
          const claimed = await tx.db.insertIfAbsent('address.Catalog', {
            id: catalogId,
            countryId: countryCode,
            version: bundle.catalog.version,
            codeSystem: bundle.catalog.codeSystem,
            authority: bundle.catalog.authority,
            legalBasis: bundle.catalog.legalBasis ?? null,
            sourceUrl: bundle.catalog.sourceUrl ?? null,
            sourceAttribution: bundle.catalog.sourceAttribution ?? null,
            sourceFiles: bundle.catalog.sourceFiles ?? null,
            checksum: bundle.checksum,
            effectiveFrom: bundle.catalog.effectiveFrom,
            status: 'importing',
            recordCount: bundle.divisions.length,
            counts: bundle.catalog.divisions.counts,
            importedAt: null,
          })
          if (!('dryRun' in claimed) && !claimed.inserted) {
            const held = await tx.db.one(from(T).where(eq(T.id, catalogId)))
            if (held?.checksum === bundle.checksum && ['verified', 'active'].includes(String(held.status)))
              return {
                ok: true,
                countryId: countryCode,
                catalogId,
                recordCount: Number(held.recordCount),
                alreadyInstalled: true,
              }
            return invalid('version', 'address.error.catalogBusy')
          }

          const idOf = (code: string) => `${catalogId}:${code}`
          for (const row of bundle.divisions)
            await tx.db.insert('address.Division', {
              id: idOf(row.code),
              countryId: countryCode,
              catalogId,
              parentId: row.parentCode ? idOf(row.parentCode) : null,
              code: row.code,
              officialName: row.officialName,
              shortName: row.shortName ?? null,
              kind: row.kind,
              level: row.level,
              active: true,
            })
          const importedAt = new Date().toISOString()
          await tx.db.update('address.Catalog', { id: catalogId }, { status: 'verified', importedAt })

          const P = tx.table('address.CurrentCatalog')
          const pointer = await tx.db.one(from(P).where(eq(P.countryId, countryCode)))
          if (!pointer) {
            await tx.db.insertIfAbsent('address.CurrentCatalog', {
              id: countryCode,
              countryId: countryCode,
              catalogId,
              version: 1,
              activatedAt: importedAt,
            })
          } else if (pointer.catalogId !== catalogId) {
            const changed = await tx.db.compareAndSet(
              'address.CurrentCatalog',
              { id: pointer.id },
              { version: pointer.version, catalogId: pointer.catalogId },
              { catalogId, version: Number(pointer.version) + 1, activatedAt: importedAt },
            )
            if (!('dryRun' in changed) && !changed.matched) throw new CatalogConflict()
            await tx.db.update('address.Catalog', { id: pointer.catalogId }, { status: 'retired' })
          }
          await tx.db.update('address.Catalog', { id: catalogId }, { status: 'active' })
          return {
            ok: true,
            countryId: countryCode,
            catalogId,
            recordCount: bundle.divisions.length,
            alreadyInstalled: false,
          }
        })
      } catch (error) {
        if (error instanceof CatalogConflict) return invalid('version', 'address.error.catalogBusy')
        throw error
      }
    },
  }),

  listCountries: defineFn({
    input: { includeInactive: 'bool?' },
    output: {
      id: 'id',
      code: 'text',
      name: 'text',
      localName: 'text?',
      callingCode: 'text?',
      active: 'bool',
    },
    effects: ['read:address.Country'],
    agent: true,
    handler: (ctx: Ctx, args) => {
      const C = ctx.table('address.Country')
      let query = from(C)
        .select(C.id, C.code, C.name, C.localName, C.callingCode, C.active)
        .orderBy(asc(C.name))
      if (args.includeInactive !== true) query = query.where(eq(C.active, true))
      return ctx.db.all(query)
    },
  }),

  catalogStatus: defineFn({
    input: { countryCode: 'text?' },
    output: {
      countryId: 'id',
      countryName: 'text',
      catalogId: 'id?',
      version: 'text?',
      status: 'text?',
      recordCount: 'int?',
      codeSystem: 'text?',
      effectiveFrom: 'date?',
    },
    effects: ['read:address.Country', 'read:address.CurrentCatalog', 'read:address.Catalog'],
    handler: async (ctx: Ctx, args) => {
      const C = ctx.table('address.Country')
      let countries = await ctx.db.all(from(C).where(eq(C.active, true)).orderBy(asc(C.name)))
      if (args.countryCode)
        countries = countries.filter((row) => row.code === String(args.countryCode).trim().toUpperCase())
      const P = ctx.table('address.CurrentCatalog')
      const T = ctx.table('address.Catalog')
      const out: Row[] = []
      for (const country of countries) {
        const pointer = await ctx.db.one(from(P).where(eq(P.countryId, country.id)))
        const catalog = pointer ? await ctx.db.one(from(T).where(eq(T.id, pointer.catalogId))) : null
        out.push({
          countryId: country.id,
          countryName: country.localName || country.name,
          catalogId: catalog?.id ?? null,
          version: catalog?.version ?? null,
          status: catalog?.status ?? null,
          recordCount: catalog ? Number(catalog.recordCount) : null,
          codeSystem: catalog?.codeSystem ?? null,
          effectiveFrom: catalog?.effectiveFrom ?? null,
        })
      }
      return out
    },
  }),

  listDivisionChildren: defineFn({
    input: { countryCode: 'text', parentId: 'id?', search: 'text?', limit: 'int?' },
    output: {
      id: 'id',
      code: 'text',
      parentId: 'id?',
      officialName: 'text',
      shortName: 'text?',
      kind: 'text',
      level: 'int',
    },
    effects: ['read:address.CurrentCatalog', 'read:address.Division'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const countryCode = String(args.countryCode).trim().toUpperCase()
      const P = ctx.table('address.CurrentCatalog')
      const pointer = await ctx.db.one(from(P).where(eq(P.countryId, countryCode)))
      if (!pointer) return []
      const D = ctx.table('address.Division')
      let query = from(D)
        .select(D.id, D.code, D.parentId, D.officialName, D.shortName, D.kind, D.level)
        .where(
          eq(D.catalogId, pointer.catalogId),
          eq(D.active, true),
          args.parentId ? eq(D.parentId, args.parentId) : isNull(D.parentId),
        )
        .orderBy(asc(D.officialName))
      if (args.search) query = query.where(like(D.officialName, `%${String(args.search).trim()}%`))
      query = query.limit(Math.min(Math.max(Number(args.limit ?? 500), 1), 1000))
      return ctx.db.all(query)
    },
  }),

  resolveDivisionPath: defineFn({
    input: { id: 'id' },
    output: { id: 'id', code: 'text', officialName: 'text', kind: 'text', level: 'int' },
    effects: ['read:address.Division'],
    handler: (ctx: Ctx, args) => divisionPath(ctx, String(args.id)),
  }),

  validate: defineFn({
    input: {
      street1: 'text?',
      street2: 'text?',
      locality: 'text?',
      postalCode: 'text?',
      countryId: 'id',
      divisionId: 'id?',
    },
    output: { ok: 'bool', errors: 'json?' },
    effects: ['read:address.Country', 'read:address.CurrentCatalog', 'read:address.Division'],
    handler: async (ctx: Ctx, args) => {
      const checked = await validateAddress(ctx, args)
      return checked.issues.length ? { ok: false, errors: checked.issues } : { ok: true }
    },
  }),

  format: defineFn({
    input: {
      street1: 'text?',
      street2: 'text?',
      locality: 'text?',
      postalCode: 'text?',
      countryId: 'id',
      divisionId: 'id?',
    },
    output: { ok: 'bool', oneLine: 'text?', lines: 'json?', errors: 'json?' },
    effects: ['read:address.Country', 'read:address.CurrentCatalog', 'read:address.Division'],
    handler: async (ctx: Ctx, args) => {
      const resolved = await resolveAddress(ctx, args)
      return resolved.value
        ? { ok: true, oneLine: resolved.value.oneLine, lines: resolved.value.lines }
        : { ok: false, errors: resolved.issues }
    },
  }),

  snapshot: defineFn({
    input: {
      sourceAddressId: 'id?',
      street1: 'text?',
      street2: 'text?',
      locality: 'text?',
      postalCode: 'text?',
      countryId: 'id',
      divisionId: 'id?',
    },
    output: { ok: 'bool', snapshot: 'json?', errors: 'json?' },
    effects: ['read:address.Country', 'read:address.CurrentCatalog', 'read:address.Division'],
    handler: async (ctx: Ctx, args) => {
      const result = await snapshotAddress(ctx, { ...args, id: args.sourceAddressId })
      return result.snapshot ? { ok: true, snapshot: result.snapshot } : { ok: false, errors: result.issues }
    },
  }),
}
