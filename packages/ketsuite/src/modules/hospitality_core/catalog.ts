import { asc, defineFn, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { resolveAddress } from '../address/format.ts'

const page = (limit: unknown, offset: unknown) => ({
  limit: Math.min(Math.max(Number.isInteger(limit) ? Number(limit) : 50, 1), 200),
  offset: Math.min(Math.max(Number.isInteger(offset) ? Number(offset) : 0, 0), 100_000),
})

const idsOf = (value: unknown): string[] | null =>
  Array.isArray(value) ? [...new Set(value.map(String).filter(Boolean))] : null

const imageProjection = (row: Row) => ({
  attachmentId: String(row.attachmentId),
  category: String(row.category),
  caption: row.caption == null ? null : String(row.caption),
})

const amenityProjection = (row: Row) => ({
  id: String(row.id),
  categoryId: row.categoryId == null ? null : String(row.categoryId),
  code: String(row.code),
  name: String(row.name),
})

const publicAddress = async (ctx: Ctx, row: Row): Promise<string | null> => {
  if (!row.countryId)
    return (
      [row.street1, row.street2, row.divisionText, row.locality, row.postalCode, row.countryCode]
        .filter(Boolean)
        .join(', ') || null
    )
  const resolved = await resolveAddress(ctx, {
    street1: row.street1,
    street2: row.street2,
    locality: row.locality,
    postalCode: row.postalCode,
    countryId: row.countryId,
    divisionId: row.divisionId,
  })
  return resolved.value?.oneLine ?? null
}

const propertyOutput = {
  id: 'id',
  companyId: 'id',
  branchId: 'id?',
  code: 'text',
  name: 'text',
  publicName: 'text?',
  accommodationType: 'text',
  timezone: 'text',
  starRating: 'int',
  addressLine: 'text?',
  locality: 'text?',
  countryCode: 'text?',
  latitude: 'decimal?',
  longitude: 'decimal?',
  description: 'text?',
  houseRules: 'text?',
  childrenStayFree: 'bool',
  minimumGuestAge: 'int?',
  active: 'bool',
  primaryImage: 'json?',
  amenities: 'json?',
}

const roomTypeOutput = {
  id: 'id',
  companyId: 'id',
  propertyId: 'id',
  code: 'text',
  name: 'text',
  publicName: 'text?',
  description: 'text?',
  defaultCapacity: 'int',
  maxAdults: 'int',
  maxChildren: 'int',
  maxInfants: 'int',
  maxExtraBeds: 'int',
  sizeSqm: 'decimal?',
  viewType: 'text?',
  sharedBathroom: 'bool',
  baseRate: 'decimal',
  active: 'bool',
  published: 'bool',
  primaryImage: 'json?',
  images: 'json?',
  amenities: 'json?',
  beds: 'json?',
}

const projectProperties = async (ctx: Ctx, rows: Row[]): Promise<Row[]> => {
  if (!rows.length) return []
  const propertyIds = rows.map((row) => String(row.id))
  const Assignment = ctx.table('hospitality_core.PropertyAmenity')
  const Image = ctx.table('hospitality_core.ContentImage')
  const [assignments, images] = await Promise.all([
    ctx.db.all(from(Assignment).where(inArray(Assignment.propertyId, propertyIds)).preload('amenity')),
    ctx.db.all(from(Image).where(inArray(Image.propertyId, propertyIds), eq(Image.primary, true))),
  ])
  const amenities = new Map<string, ReturnType<typeof amenityProjection>[]>()
  for (const assignment of assignments) {
    const amenity = assignment.amenity as Row | null
    if (amenity?.active !== true) continue
    const key = String(assignment.propertyId)
    const values = amenities.get(key) ?? []
    values.push(amenityProjection(amenity))
    amenities.set(key, values)
  }
  const primaryImages = new Map(images.map((image) => [String(image.propertyId), imageProjection(image)]))
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      companyId: row.companyId,
      branchId: row.branchId ?? null,
      code: row.code,
      name: row.name,
      publicName: row.publicName ?? null,
      accommodationType: row.accommodationType,
      timezone: row.timezone,
      starRating: row.starRating,
      addressLine: await publicAddress(ctx, row),
      locality: row.locality ?? null,
      countryCode: row.countryCode ?? null,
      latitude: row.latitude ?? null,
      longitude: row.longitude ?? null,
      description: row.description ?? null,
      houseRules: row.houseRules ?? null,
      childrenStayFree: row.childrenStayFree,
      minimumGuestAge: row.minimumGuestAge ?? null,
      active: row.active,
      primaryImage: primaryImages.get(String(row.id)) ?? null,
      amenities: amenities.get(String(row.id)) ?? [],
    })),
  )
}

const projectRoomTypes = async (ctx: Ctx, rows: Row[]): Promise<Row[]> => {
  if (!rows.length) return []
  const roomTypeIds = rows.map((row) => String(row.id))
  const Assignment = ctx.table('hospitality_core.RoomTypeAmenity')
  const Image = ctx.table('hospitality_core.ContentImage')
  const Bed = ctx.table('hospitality_core.Bed')
  const [assignments, images, beds] = await Promise.all([
    ctx.db.all(from(Assignment).where(inArray(Assignment.roomTypeId, roomTypeIds)).preload('amenity')),
    ctx.db.all(
      from(Image).where(inArray(Image.roomTypeId, roomTypeIds)).orderBy(asc(Image.sequence), asc(Image.id)),
    ),
    ctx.db.all(from(Bed).where(inArray(Bed.roomTypeId, roomTypeIds)).orderBy(asc(Bed.id))),
  ])
  const amenities = new Map<string, ReturnType<typeof amenityProjection>[]>()
  for (const assignment of assignments) {
    const amenity = assignment.amenity as Row | null
    if (amenity?.active !== true) continue
    const key = String(assignment.roomTypeId)
    const values = amenities.get(key) ?? []
    values.push(amenityProjection(amenity))
    amenities.set(key, values)
  }
  const imageMap = new Map<
    string,
    Array<{ projection: ReturnType<typeof imageProjection>; primary: boolean }>
  >()
  for (const image of images) {
    const key = String(image.roomTypeId)
    const values = imageMap.get(key) ?? []
    values.push({ projection: imageProjection(image), primary: image.primary === true })
    imageMap.set(key, values)
  }
  const bedMap = new Map<string, Array<{ type: string; quantity: number; roomName: string | null }>>()
  for (const bed of beds) {
    const key = String(bed.roomTypeId)
    const values = bedMap.get(key) ?? []
    values.push({
      type: String(bed.type),
      quantity: Number(bed.quantity),
      roomName: bed.roomName == null ? null : String(bed.roomName),
    })
    bedMap.set(key, values)
  }
  return rows.map((row) => {
    const heldImages = imageMap.get(String(row.id)) ?? []
    const projectedImages = heldImages.map((image) => image.projection)
    return {
      id: row.id,
      companyId: row.companyId,
      propertyId: row.propertyId,
      code: row.code,
      name: row.name,
      publicName: row.publicName ?? null,
      description: row.description ?? null,
      defaultCapacity: row.defaultCapacity,
      maxAdults: row.maxAdults,
      maxChildren: row.maxChildren,
      maxInfants: row.maxInfants,
      maxExtraBeds: row.maxExtraBeds,
      sizeSqm: row.sizeSqm ?? null,
      viewType: row.viewType ?? null,
      sharedBathroom: row.sharedBathroom,
      baseRate: row.baseRate,
      active: row.active,
      published: row.published,
      primaryImage: heldImages.find((image) => image.primary)?.projection ?? null,
      images: projectedImages,
      amenities: amenities.get(String(row.id)) ?? [],
      beds: bedMap.get(String(row.id)) ?? [],
    }
  })
}

const catalogEffects = [
  'read:hospitality_core.Property',
  'read:hospitality_core.RoomType',
  'read:hospitality_core.PropertyAmenity',
  'read:hospitality_core.RoomTypeAmenity',
  'read:hospitality_core.Amenity',
  'read:hospitality_core.ContentImage',
  'read:hospitality_core.Bed',
  'read:address.Country',
  'read:address.CurrentCatalog',
  'read:address.Division',
]

export const catalog: Record<string, FnSpec> = {
  listPropertyCatalog: defineFn({
    exposure: 'internal',
    input: { propertyIds: 'json?', active: 'bool?', limit: 'int?', offset: 'int?' },
    output: propertyOutput,
    effects: catalogEffects,
    handler: async (ctx: Ctx, args) => {
      const propertyIds = idsOf(args.propertyIds)
      if (propertyIds?.length === 0) return []
      const P = ctx.table('hospitality_core.Property')
      const paging = page(args.limit, args.offset)
      let query = from(P)
        .where(eq(P.active, args.active !== false))
        .orderBy(asc(P.name), asc(P.id))
      if (propertyIds) query = query.where(inArray(P.id, propertyIds))
      return projectProperties(ctx, await ctx.db.all(query.limit(paging.limit).offset(paging.offset)))
    },
  }),

  getPropertyCatalog: defineFn({
    exposure: 'internal',
    input: { id: 'id' },
    output: propertyOutput,
    effects: catalogEffects,
    handler: async (ctx: Ctx, args) => {
      const P = ctx.table('hospitality_core.Property')
      const row = await ctx.db.one(from(P).where(eq(P.id, args.id), eq(P.active, true)))
      return (await projectProperties(ctx, row ? [row] : []))[0] ?? null
    },
  }),

  listRoomTypeCatalog: defineFn({
    exposure: 'internal',
    input: {
      propertyId: 'id',
      roomTypeIds: 'json?',
      active: 'bool?',
      published: 'bool?',
      limit: 'int?',
      offset: 'int?',
    },
    output: roomTypeOutput,
    effects: catalogEffects,
    handler: async (ctx: Ctx, args) => {
      const roomTypeIds = idsOf(args.roomTypeIds)
      if (roomTypeIds?.length === 0) return []
      const P = ctx.table('hospitality_core.Property')
      const property = await ctx.db.one(from(P).where(eq(P.id, args.propertyId), eq(P.active, true)))
      if (!property) return []
      const T = ctx.table('hospitality_core.RoomType')
      const paging = page(args.limit, args.offset)
      let query = from(T)
        .where(
          eq(T.propertyId, args.propertyId),
          eq(T.active, args.active !== false),
          eq(T.published, args.published !== false),
        )
        .orderBy(asc(T.name), asc(T.id))
      if (roomTypeIds) query = query.where(inArray(T.id, roomTypeIds))
      return projectRoomTypes(ctx, await ctx.db.all(query.limit(paging.limit).offset(paging.offset)))
    },
  }),

  getRoomTypeCatalog: defineFn({
    exposure: 'internal',
    input: { id: 'id' },
    output: roomTypeOutput,
    effects: catalogEffects,
    handler: async (ctx: Ctx, args) => {
      const T = ctx.table('hospitality_core.RoomType')
      const row = await ctx.db.one(
        from(T).where(eq(T.id, args.id), eq(T.active, true), eq(T.published, true)),
      )
      if (!row) return null
      const P = ctx.table('hospitality_core.Property')
      const property = await ctx.db.one(from(P).where(eq(P.id, row.propertyId), eq(P.active, true)))
      return property ? ((await projectRoomTypes(ctx, [row]))[0] ?? null) : null
    },
  }),
}
