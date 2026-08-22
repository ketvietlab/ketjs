import { asc, defineFn, eq, from, inArray } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { resolveAddress, validateAddress } from '../address/format.ts'
import { addCalendarDays, dateKeyIn } from './calendar.ts'
import { appendContentChange } from './content.ts'
import { recordInventoryChange, syncLedgerCapacity } from './inventory.ts'
import {
  ACCOMMODATION_TYPES,
  AMENITY_SCOPES,
  BED_TYPES,
  CANCELLATION_POLICY_TYPES,
  CONTACT_TYPES,
  ROOM_STATUSES,
  ROOM_VIEW_TYPES,
} from './types.ts'

/**
 * Room configuration changed, so the sellable count for its room type did too.
 * The ledger follows every future date it still owns, and one durable signal
 * goes out so a channel adapter learns the capacity moved.
 */
const followRoomCapacity = async (
  ctx: Ctx,
  propertyId: unknown,
  roomTypeId: unknown,
): Promise<{ date: string; committed: number; total: number }[]> => {
  const Property = ctx.table('hospitality_core.Property')
  const property = await ctx.db.one(from(Property).where(eq(Property.id, propertyId)))
  const today = dateKeyIn(new Date(), String(property?.timezone ?? 'UTC'))
  const synced = await syncLedgerCapacity(ctx, propertyId, roomTypeId, today)
  if (synced.changed)
    await recordInventoryChange(ctx, {
      propertyId,
      roomTypeId,
      kind: 'availability',
      dateFrom: today,
      dateTo: addCalendarDays(today, 365),
    })
  return synced.overcommitted
}

type Issue = { field: string; code: string; messageKey: string; params?: Record<string, unknown> }

const issue = (field: string, code: string, params?: Record<string, unknown>): Issue => ({
  field,
  code,
  messageKey: `hospitality_core.validation.${code}`,
  ...(params ? { params } : {}),
})

const success = (id: unknown) => ({ ok: true, id: String(id), errors: [] })
const failure = (...errors: Issue[]) => ({ ok: false, errors })
const cleanCode = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toUpperCase()
const cleanText = (value: unknown): string => String(value ?? '').trim()
const normalized = <T extends Record<string, unknown>>(
  raw: Record<string, unknown>,
  values: T,
): Record<string, unknown> & T => ({ ...raw, ...values })
const isClock = (value: unknown): boolean => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(value))
const isTimezone = (value: unknown): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: String(value) }).format()
    return true
  } catch {
    return false
  }
}
const countryCodeOf = (value: unknown): string => {
  const country = cleanText(value)
  if (/^vi(?:ệ|e)t\s*nam$/iu.test(country)) return 'VN'
  return country.toUpperCase()
}

const propertyPresentation = async (ctx: Ctx, row: Row): Promise<Row> => {
  let oneLine = [row.street1, row.street2, row.divisionText, row.locality, row.postalCode, row.countryCode]
    .filter(Boolean)
    .join(', ')
  let divisions: Row[] = []
  if (row.countryId) {
    const resolved = await resolveAddress(ctx, {
      street1: row.street1,
      street2: row.street2,
      locality: row.locality,
      postalCode: row.postalCode,
      countryId: row.countryId,
      divisionId: row.divisionId,
    })
    if (resolved.value) {
      oneLine = resolved.value.oneLine
      divisions = resolved.value.divisions
    }
  }
  return {
    ...row,
    addressLine: oneLine,
    city: divisions.at(-1)?.officialName ?? row.locality ?? row.divisionText ?? null,
    country: row.countryCode ?? null,
  }
}
const isOneOf = (values: readonly string[], value: unknown): boolean => values.includes(String(value))

const record = async (ctx: Ctx, model: string, id: unknown): Promise<Row | null> => {
  const table = ctx.table(model)
  return ctx.db.one(from(table).where(eq(table.id, id)))
}

class RoomStatusGuard extends Error {
  readonly problem: Issue

  constructor(problem: Issue) {
    super(problem.code)
    this.problem = problem
  }
}

class LocationLifecycleGuard extends Error {
  readonly problem: Issue

  constructor(problem: Issue) {
    super(problem.code)
    this.problem = problem
  }
}

class RoomLifecycleGuard extends Error {
  readonly problem: Issue

  constructor(problem: Issue) {
    super(problem.code)
    this.problem = problem
  }
}

const lockActiveFlag = async (ctx: Ctx, model: string, row: Row): Promise<boolean> => {
  const active = row.active === true
  const locked = await ctx.db.compareAndSet(model, { id: row.id }, { active }, { active })
  return 'matched' in locked && locked.matched
}

const duplicate = async (
  ctx: Ctx,
  model: string,
  field: string,
  value: unknown,
  exceptId: unknown,
  parent?: [string, unknown],
): Promise<boolean> => {
  const table = ctx.table(model)
  let query = from(table).where(eq(table[field]!, value))
  if (parent) query = query.where(eq(table[parent[0]]!, parent[1]))
  const rows = await ctx.db.all(query)
  return rows.some((row) => row.id !== exceptId)
}

const save = async (
  ctx: Ctx,
  model: string,
  args: Record<string, unknown>,
  fields: string[],
  defaults: Record<string, unknown> = {},
) => {
  const existing = await record(ctx, model, args.id)
  // An optional field that was not supplied is absent, not invalid. Casting an
  // explicit `undefined` failed the whole write, so leaving one blank in an
  // admin form rejected the record instead of leaving the column alone.
  // `null` still means "clear it".
  const supplied = Object.fromEntries(Object.entries(args).filter(([, value]) => value !== undefined))
  let changes = ctx.change(model, supplied, existing).cast(fields)
  if (!existing)
    for (const [key, value] of Object.entries(defaults))
      if (!(key in args) || args[key] == null) changes = changes.put(key, value)
  if (!changes.valid) return { ok: false, errors: changes.errors }
  await ctx.db.commit(changes, existing ? { id: args.id } : undefined)
  return success(args.id)
}

const signalAmenityUsers = async (ctx: Ctx, amenityId: unknown): Promise<void> => {
  const PropertyAmenity = ctx.table('hospitality_core.PropertyAmenity')
  const RoomTypeAmenity = ctx.table('hospitality_core.RoomTypeAmenity')
  const propertyAssignments = await ctx.db.all(
    from(PropertyAmenity).where(eq(PropertyAmenity.amenityId, amenityId)),
  )
  const roomAssignments = await ctx.db.all(
    from(RoomTypeAmenity).where(eq(RoomTypeAmenity.amenityId, amenityId)),
  )
  for (const assignment of propertyAssignments)
    await appendContentChange(ctx, {
      propertyId: assignment.propertyId,
      resourceType: 'property',
      resourceId: assignment.propertyId,
    })
  for (const assignment of roomAssignments) {
    const roomType = await record(ctx, 'hospitality_core.RoomType', assignment.roomTypeId)
    if (roomType)
      await appendContentChange(ctx, {
        propertyId: roomType.propertyId,
        resourceType: 'room_type',
        resourceId: roomType.id,
      })
  }
}

const signalPolicyUsers = async (ctx: Ctx, policyId: unknown): Promise<void> => {
  const Property = ctx.table('hospitality_core.Property')
  const RoomType = ctx.table('hospitality_core.RoomType')
  const properties = await ctx.db.all(
    from(Property).where(eq(Property.defaultCancellationPolicyId, policyId)),
  )
  const roomTypes = await ctx.db.all(from(RoomType).where(eq(RoomType.cancellationPolicyId, policyId)))
  for (const property of properties)
    await appendContentChange(ctx, {
      propertyId: property.id,
      resourceType: 'property',
      resourceId: property.id,
    })
  for (const roomType of roomTypes)
    await appendContentChange(ctx, {
      propertyId: roomType.propertyId,
      resourceType: 'room_type',
      resourceId: roomType.id,
    })
}

const writable = (name: string): string[] =>
  ({
    Property: [
      'id',
      'branchId',
      'code',
      'name',
      'publicName',
      'accommodationType',
      'timezone',
      'defaultCheckIn',
      'defaultCheckOut',
      'enforceTimes',
      'allowHourly',
      'allowWeekly',
      'allowMonthly',
      'longStayBillOnCheckIn',
      'starRating',
      'street1',
      'street2',
      'locality',
      'postalCode',
      'countryCode',
      'countryId',
      'divisionId',
      'divisionText',
      'latitude',
      'longitude',
      'description',
      'houseRules',
      'childrenStayFree',
      'minimumGuestAge',
      'defaultCancellationPolicyId',
    ],
    Building: ['id', 'propertyId', 'code', 'name', 'sequence'],
    Floor: ['id', 'propertyId', 'buildingId', 'code', 'name', 'sequence'],
    RoomType: [
      'id',
      'propertyId',
      'code',
      'name',
      'publicName',
      'description',
      'defaultCapacity',
      'maxAdults',
      'maxChildren',
      'maxInfants',
      'maxExtraBeds',
      'sizeSqm',
      'viewType',
      'sharedBathroom',
      'allowHourly',
      'allowWeekly',
      'allowMonthly',
      'minHourlyHours',
      'baseRate',
      'color',
      'cancellationPolicyId',
      'published',
    ],
    Room: ['id', 'propertyId', 'roomTypeId', 'buildingId', 'floorId', 'code', 'name', 'capacity'],
  })[name] ?? []

const result = { ok: 'bool', id: 'id?', errors: 'json?' }

export const functions: Record<string, FnSpec> = {
  listProperties: defineFn({
    input: { includeArchived: 'bool?' },
    output: {
      id: 'id',
      companyId: 'id',
      branchId: 'id?',
      code: 'text',
      name: 'text',
      publicName: 'text?',
      accommodationType: 'text',
      timezone: 'text',
      starRating: 'int',
      city: 'text?',
      country: 'text?',
      addressLine: 'text?',
      active: 'bool',
      rooms: 'int',
      availableRooms: 'int',
      attentionRooms: 'int',
    },
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.Room',
      'read:address.Country',
      'read:address.CurrentCatalog',
      'read:address.Division',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const P = ctx.table('hospitality_core.Property')
      let query = from(P).orderBy(asc(P.name))
      if (args.includeArchived !== true) query = query.where(eq(P.active, true))
      const properties = await ctx.db.all(query)
      const R = ctx.table('hospitality_core.Room')
      const rooms = await ctx.db.all(from(R).where(eq(R.active, true)))
      const attention = new Set(['dirty', 'cleaning', 'maintenance', 'out_of_order'])
      const counts = new Map<string, { rooms: number; availableRooms: number; attentionRooms: number }>()
      for (const room of rooms) {
        const key = String(room.propertyId)
        const count = counts.get(key) ?? { rooms: 0, availableRooms: 0, attentionRooms: 0 }
        count.rooms++
        if (room.status === 'available') count.availableRooms++
        if (attention.has(String(room.status))) count.attentionRooms++
        counts.set(key, count)
      }
      return Promise.all(
        properties.map(async (property) => {
          const count = counts.get(String(property.id)) ?? {
            rooms: 0,
            availableRooms: 0,
            attentionRooms: 0,
          }
          return {
            ...(await propertyPresentation(ctx, property)),
            ...count,
          }
        }),
      )
    },
  }),

  getProperty: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      companyId: 'id',
      branchId: 'id?',
      code: 'text',
      name: 'text',
      publicName: 'text?',
      accommodationType: 'text',
      timezone: 'text',
      defaultCheckIn: 'text',
      defaultCheckOut: 'text',
      enforceTimes: 'bool',
      allowHourly: 'bool',
      allowWeekly: 'bool',
      allowMonthly: 'bool',
      longStayBillOnCheckIn: 'bool?',
      starRating: 'int',
      street1: 'text?',
      street2: 'text?',
      locality: 'text?',
      postalCode: 'text?',
      countryCode: 'text?',
      countryId: 'id?',
      divisionId: 'id?',
      divisionText: 'text?',
      street: 'text?',
      city: 'text?',
      state: 'text?',
      country: 'text?',
      addressLine: 'text?',
      latitude: 'decimal?',
      longitude: 'decimal?',
      description: 'text?',
      houseRules: 'text?',
      childrenStayFree: 'bool',
      minimumGuestAge: 'int?',
      defaultCancellationPolicyId: 'id?',
      defaultCancellationPolicy: 'json?',
      active: 'bool',
      buildings: 'json?',
      floors: 'json?',
      roomTypes: 'json?',
      rooms: 'json?',
      contacts: 'json?',
    },
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.Building',
      'read:hospitality_core.Floor',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Room',
      'read:hospitality_core.PropertyContact',
      'read:hospitality_core.CancellationPolicy',
      'read:address.Country',
      'read:address.CurrentCatalog',
      'read:address.Division',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const P = ctx.table('hospitality_core.Property')
      const row = await ctx.db.one(
        from(P)
          .where(eq(P.id, args.id))
          .preload('buildings', 'floors', 'roomTypes', 'rooms', 'contacts', 'cancellationPolicy'),
      )
      if (!row) return null
      return {
        ...(await propertyPresentation(ctx, row)),
        defaultCancellationPolicy: row.cancellationPolicy ?? null,
      }
    },
  }),

  saveProperty: defineFn({
    input: {
      id: 'id',
      branchId: 'id?',
      code: 'text',
      name: 'text',
      publicName: 'text?',
      accommodationType: 'text',
      timezone: 'text?',
      defaultCheckIn: 'text?',
      defaultCheckOut: 'text?',
      enforceTimes: 'bool?',
      allowHourly: 'bool?',
      allowWeekly: 'bool?',
      allowMonthly: 'bool?',
      longStayBillOnCheckIn: 'bool?',
      starRating: 'int?',
      street: 'text?',
      street1: 'text?',
      street2: 'text?',
      city: 'text?',
      locality: 'text?',
      zip: 'text?',
      postalCode: 'text?',
      state: 'text?',
      country: 'text?',
      countryCode: 'text?',
      countryId: 'id?',
      divisionId: 'id?',
      divisionText: 'text?',
      latitude: 'decimal?',
      longitude: 'decimal?',
      description: 'text?',
      houseRules: 'text?',
      childrenStayFree: 'bool?',
      minimumGuestAge: 'int?',
      defaultCancellationPolicyId: 'id?',
    },
    output: result,
    effects: [
      'read:hospitality_core.Property',
      'write:hospitality_core.Property',
      'write:hospitality_core.ContentChange',
      'read:hospitality_core.CancellationPolicy',
      'read:company.Branch',
      'read:address.Country',
      'read:address.CurrentCatalog',
      'read:address.Division',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, raw) => {
      const current = await record(ctx, 'hospitality_core.Property', raw.id)
      const args = normalized(raw, {
        code: cleanCode(raw.code),
        name: cleanText(raw.name),
        timezone: cleanText(raw.timezone) || 'Asia/Ho_Chi_Minh',
        defaultCheckIn: cleanText(raw.defaultCheckIn) || '14:00',
        defaultCheckOut: cleanText(raw.defaultCheckOut) || '12:00',
        starRating: Number(raw.starRating ?? 0),
        street1: cleanText(raw.street1 ?? raw.street) || null,
        locality: cleanText(raw.locality ?? raw.city) || null,
        postalCode: cleanText(raw.postalCode ?? raw.zip) || null,
        divisionText: cleanText(raw.divisionText ?? raw.state) || null,
        countryCode: countryCodeOf(raw.countryId ?? raw.countryCode ?? raw.country) || null,
        countryId: null as string | null,
        divisionId: raw.divisionId ? String(raw.divisionId) : null,
      })
      const errors: Issue[] = []
      if (!args.code) errors.push(issue('code', 'required'))
      if (!args.name) errors.push(issue('name', 'required'))
      if (!isOneOf(ACCOMMODATION_TYPES, args.accommodationType))
        errors.push(issue('accommodationType', 'accommodation_type'))
      if (!isClock(args.defaultCheckIn)) errors.push(issue('defaultCheckIn', 'clock'))
      if (!isClock(args.defaultCheckOut)) errors.push(issue('defaultCheckOut', 'clock'))
      if (!isTimezone(args.timezone)) errors.push(issue('timezone', 'timezone'))
      if (!Number.isInteger(args.starRating) || args.starRating < 0 || args.starRating > 5)
        errors.push(issue('starRating', 'star_rating'))
      if (raw.minimumGuestAge != null && Number(raw.minimumGuestAge) < 0)
        errors.push(issue('minimumGuestAge', 'non_negative'))
      if (await duplicate(ctx, 'hospitality_core.Property', 'code', args.code, args.id))
        errors.push(issue('code', 'unique'))
      if (
        args.defaultCancellationPolicyId &&
        !(await record(ctx, 'hospitality_core.CancellationPolicy', args.defaultCancellationPolicyId))
      )
        errors.push(issue('defaultCancellationPolicyId', 'policy_missing'))
      if (args.branchId && args.branchId !== current?.branchId) {
        const branch = await record(ctx, 'company.Branch', args.branchId)
        if (!branch || branch.companyId !== ctx.scope.company)
          errors.push(issue('branchId', 'branch_company_mismatch'))
        else if (branch.active !== true) errors.push(issue('branchId', 'branch_archived'))
      }
      if (args.countryCode && !/^[A-Z]{2}$/.test(args.countryCode))
        errors.push(issue('countryId', 'address.error.countryCode'))
      if (args.countryCode) {
        const C = ctx.table('address.Country')
        const installed = await ctx.db.one(from(C).where(eq(C.id, args.countryCode)))
        if (installed) {
          const checked = await validateAddress(ctx, {
            street1: args.street1,
            street2: args.street2,
            locality: args.locality,
            postalCode: args.postalCode,
            countryId: args.countryCode,
            divisionId: args.divisionId,
          })
          if (checked.issues.length) return { ok: false, errors: checked.issues }
          args.countryId = args.countryCode
        } else if (args.divisionId) {
          return { ok: false, errors: [{ field: 'divisionId', code: 'address.error.catalogNotInstalled' }] }
        }
      }
      if (errors.length) return failure(...errors)
      return ctx.tx(async (tx) => {
        const result = await save(tx, 'hospitality_core.Property', args, writable('Property'), {
          enforceTimes: true,
          // Nightly and hourly are what a hotel sells by default. A weekly or
          // monthly stay is a different contract with its own billing cycle, so
          // the property opts into it rather than discovering it was on.
          allowHourly: true,
          allowWeekly: false,
          allowMonthly: false,
          longStayBillOnCheckIn: true,
          childrenStayFree: false,
          active: true,
        })
        if (result.ok)
          await appendContentChange(tx, {
            propertyId: args.id,
            resourceType: 'property',
            resourceId: args.id,
          })
        return result
      })
    },
  }),

  archiveProperty: defineFn({
    input: { id: 'id', active: 'bool' },
    output: { id: 'id', active: 'bool' },
    effects: [
      'read:hospitality_core.Property',
      'write:hospitality_core.Property',
      'write:hospitality_core.ContentChange',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const property = await record(ctx, 'hospitality_core.Property', args.id)
      if (!property) return args
      await ctx.tx(async (tx) => {
        await tx.db.update('hospitality_core.Property', { id: args.id }, { active: args.active } as Row)
        await appendContentChange(tx, {
          propertyId: args.id,
          resourceType: 'property',
          resourceId: args.id,
          kind: args.active ? 'upsert' : 'archive',
        })
      })
      return args
    },
  }),

  listBuildings: defineFn({
    input: { propertyId: 'id', includeArchived: 'bool?' },
    output: {
      id: 'id',
      companyId: 'id',
      propertyId: 'id',
      code: 'text',
      name: 'text',
      sequence: 'int',
      active: 'bool',
      floors: 'json?',
      rooms: 'json?',
    },
    effects: ['read:hospitality_core.Building', 'read:hospitality_core.Floor', 'read:hospitality_core.Room'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const B = ctx.table('hospitality_core.Building')
      let query = from(B).where(eq(B.propertyId, args.propertyId))
      if (args.includeArchived !== true) query = query.where(eq(B.active, true))
      return ctx.db.all(query.orderBy(asc(B.sequence), asc(B.name)).preload('floors', 'rooms'))
    },
  }),

  getBuilding: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      companyId: 'id',
      propertyId: 'id',
      code: 'text',
      name: 'text',
      sequence: 'int',
      active: 'bool',
      property: 'json?',
      floors: 'json?',
      rooms: 'json?',
    },
    effects: [
      'read:hospitality_core.Building',
      'read:hospitality_core.Property',
      'read:hospitality_core.Floor',
      'read:hospitality_core.Room',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const B = ctx.table('hospitality_core.Building')
      const building = await ctx.db.one(from(B).where(eq(B.id, args.id)).preload('property', 'rooms'))
      if (!building) return null
      const F = ctx.table('hospitality_core.Floor')
      const floors = await ctx.db.all(
        from(F)
          .where(eq(F.buildingId, building.id))
          .orderBy(asc(F.sequence), asc(F.name))
          .preload('building', 'rooms'),
      )
      return { ...building, floors }
    },
  }),

  saveBuilding: defineFn({
    input: { id: 'id', propertyId: 'id', code: 'text', name: 'text', sequence: 'int?' },
    output: result,
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.Building',
      'write:hospitality_core.Building',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, raw) => {
      const current = await record(ctx, 'hospitality_core.Building', raw.id)
      const args = normalized(raw, {
        code: cleanCode(raw.code),
        name: cleanText(raw.name),
        sequence: Number(raw.sequence ?? 10),
      })
      const errors: Issue[] = []
      if (!(await record(ctx, 'hospitality_core.Property', args.propertyId)))
        errors.push(issue('propertyId', 'property_missing'))
      if (current && current.propertyId !== args.propertyId)
        errors.push(issue('propertyId', 'property_mismatch'))
      if (!args.code) errors.push(issue('code', 'required'))
      if (!args.name) errors.push(issue('name', 'required'))
      if (
        await duplicate(ctx, 'hospitality_core.Building', 'code', args.code, args.id, [
          'propertyId',
          args.propertyId,
        ])
      )
        errors.push(issue('code', 'unique'))
      if (errors.length) return failure(...errors)
      return save(ctx, 'hospitality_core.Building', args, writable('Building'), { active: true })
    },
  }),

  archiveBuilding: defineFn({
    input: { id: 'id', active: 'bool' },
    output: result,
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.Building',
      'read:hospitality_core.Floor',
      'read:hospitality_core.Room',
      'write:hospitality_core.Building',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      try {
        return await ctx.tx(async (tx) => {
          const building = await record(tx, 'hospitality_core.Building', args.id)
          if (!building) return failure(issue('id', 'building_missing'))
          if (building.active === args.active) return success(args.id)
          if (args.active) {
            const property = await record(tx, 'hospitality_core.Property', building.propertyId)
            if (!property) return failure(issue('propertyId', 'property_missing'))
            if (property.active !== true) return failure(issue('propertyId', 'property_archived'))
          }
          const changed = await tx.db.compareAndSet(
            'hospitality_core.Building',
            { id: args.id },
            { active: building.active },
            { active: args.active },
          )
          if (!('matched' in changed) || !changed.matched) return failure(issue('id', 'transition_conflict'))
          if (!args.active) {
            const F = tx.table('hospitality_core.Floor')
            const activeFloor = await tx.db.one(
              from(F).where(eq(F.buildingId, args.id), eq(F.active, true)).limit(1),
            )
            if (activeFloor) throw new LocationLifecycleGuard(issue('id', 'location_has_active_floors'))
            const R = tx.table('hospitality_core.Room')
            const activeRoom = await tx.db.one(
              from(R).where(eq(R.buildingId, args.id), eq(R.active, true)).limit(1),
            )
            if (activeRoom) throw new LocationLifecycleGuard(issue('id', 'location_has_active_rooms'))
          }
          return success(args.id)
        })
      } catch (error) {
        if (error instanceof LocationLifecycleGuard) return failure(error.problem)
        throw error
      }
    },
  }),

  listFloors: defineFn({
    input: { propertyId: 'id', buildingId: 'id?', includeArchived: 'bool?' },
    output: {
      id: 'id',
      propertyId: 'id',
      buildingId: 'id',
      code: 'text',
      name: 'text',
      sequence: 'int',
      active: 'bool',
      building: 'json?',
      rooms: 'json?',
    },
    effects: ['read:hospitality_core.Floor', 'read:hospitality_core.Building', 'read:hospitality_core.Room'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const F = ctx.table('hospitality_core.Floor')
      let query = from(F).where(eq(F.propertyId, args.propertyId))
      if (args.includeArchived !== true) query = query.where(eq(F.active, true))
      if (args.buildingId) query = query.where(eq(F.buildingId, args.buildingId))
      return ctx.db.all(query.orderBy(asc(F.sequence), asc(F.name)).preload('building', 'rooms'))
    },
  }),

  getFloor: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      propertyId: 'id',
      buildingId: 'id',
      code: 'text',
      name: 'text',
      sequence: 'int',
      active: 'bool',
      property: 'json?',
      building: 'json?',
      rooms: 'json?',
    },
    effects: [
      'read:hospitality_core.Floor',
      'read:hospitality_core.Property',
      'read:hospitality_core.Building',
      'read:hospitality_core.Room',
      'read:hospitality_core.RoomType',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const F = ctx.table('hospitality_core.Floor')
      const floor = await ctx.db.one(from(F).where(eq(F.id, args.id)).preload('property', 'building'))
      if (!floor) return null
      const R = ctx.table('hospitality_core.Room')
      const rooms = await ctx.db.all(
        from(R).where(eq(R.floorId, floor.id)).orderBy(asc(R.name)).preload('roomType', 'building', 'floor'),
      )
      return { ...floor, rooms }
    },
  }),

  saveFloor: defineFn({
    input: { id: 'id', propertyId: 'id', buildingId: 'id', code: 'text', name: 'text', sequence: 'int?' },
    output: result,
    effects: [
      'read:hospitality_core.Building',
      'read:hospitality_core.Floor',
      'write:hospitality_core.Building',
      'write:hospitality_core.Floor',
    ],
    idempotent: true,
    agent: true,
    handler: (ctx: Ctx, raw) =>
      ctx.tx(async (tx) => {
        const current = await record(tx, 'hospitality_core.Floor', raw.id)
        const args = normalized(raw, {
          code: cleanCode(raw.code),
          name: cleanText(raw.name),
          sequence: Number(raw.sequence ?? 10),
        })
        const building = await record(tx, 'hospitality_core.Building', args.buildingId)
        const errors: Issue[] = []
        if (!building) errors.push(issue('buildingId', 'building_missing'))
        else if (building.propertyId !== args.propertyId)
          errors.push(issue('buildingId', 'property_mismatch'))
        else if (!current && building.active !== true) errors.push(issue('buildingId', 'location_archived'))
        if (current && current.propertyId !== args.propertyId)
          errors.push(issue('propertyId', 'property_mismatch'))
        if (current && current.buildingId !== args.buildingId)
          errors.push(issue('buildingId', 'location_immutable'))
        if (!args.code) errors.push(issue('code', 'required'))
        if (!args.name) errors.push(issue('name', 'required'))
        if (
          await duplicate(tx, 'hospitality_core.Floor', 'code', args.code, args.id, [
            'buildingId',
            args.buildingId,
          ])
        )
          errors.push(issue('code', 'unique'))
        if (errors.length) return failure(...errors)
        if (!(await lockActiveFlag(tx, 'hospitality_core.Building', building!)))
          return failure(issue('buildingId', 'transition_conflict'))
        return save(tx, 'hospitality_core.Floor', args, writable('Floor'), { active: true })
      }),
  }),

  archiveFloor: defineFn({
    input: { id: 'id', active: 'bool' },
    output: result,
    effects: [
      'read:hospitality_core.Building',
      'read:hospitality_core.Floor',
      'read:hospitality_core.Room',
      'write:hospitality_core.Building',
      'write:hospitality_core.Floor',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      try {
        return await ctx.tx(async (tx) => {
          const floor = await record(tx, 'hospitality_core.Floor', args.id)
          if (!floor) return failure(issue('id', 'floor_missing'))
          if (floor.active === args.active) return success(args.id)
          const building = await record(tx, 'hospitality_core.Building', floor.buildingId)
          if (!building) return failure(issue('buildingId', 'building_missing'))
          if (!(await lockActiveFlag(tx, 'hospitality_core.Building', building)))
            return failure(issue('buildingId', 'transition_conflict'))
          if (args.active && building.active !== true)
            return failure(issue('buildingId', 'location_archived'))
          const changed = await tx.db.compareAndSet(
            'hospitality_core.Floor',
            { id: args.id },
            { active: floor.active },
            { active: args.active },
          )
          if (!('matched' in changed) || !changed.matched) return failure(issue('id', 'transition_conflict'))
          if (!args.active) {
            const R = tx.table('hospitality_core.Room')
            const activeRoom = await tx.db.one(
              from(R).where(eq(R.floorId, args.id), eq(R.active, true)).limit(1),
            )
            if (activeRoom) throw new LocationLifecycleGuard(issue('id', 'location_has_active_rooms'))
          }
          return success(args.id)
        })
      } catch (error) {
        if (error instanceof LocationLifecycleGuard) return failure(error.problem)
        throw error
      }
    },
  }),

  listRoomTypes: defineFn({
    input: { propertyId: 'id?', includeArchived: 'bool?' },
    output: {
      id: 'id',
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
      allowHourly: 'bool',
      allowWeekly: 'bool',
      allowMonthly: 'bool',
      minHourlyHours: 'int',
      baseRate: 'decimal',
      published: 'bool',
      active: 'bool',
      rooms: 'json?',
      beds: 'json?',
    },
    effects: ['read:hospitality_core.RoomType', 'read:hospitality_core.Room', 'read:hospitality_core.Bed'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const T = ctx.table('hospitality_core.RoomType')
      let query = from(T).orderBy(asc(T.name)).preload('rooms', 'beds')
      if (args.propertyId) query = query.where(eq(T.propertyId, args.propertyId))
      if (args.includeArchived !== true) query = query.where(eq(T.active, true))
      return ctx.db.all(query)
    },
  }),

  getRoomType: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
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
      allowHourly: 'bool',
      allowWeekly: 'bool',
      allowMonthly: 'bool',
      minHourlyHours: 'int',
      baseRate: 'decimal',
      color: 'text?',
      cancellationPolicyId: 'id?',
      published: 'bool',
      active: 'bool',
      property: 'json?',
      rooms: 'json?',
      beds: 'json?',
      ratePlans: 'json?',
      cancellationPolicy: 'json?',
    },
    effects: [
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Property',
      'read:hospitality_core.Room',
      'read:hospitality_core.Bed',
      'read:hospitality_core.RatePlan',
      'read:hospitality_core.CancellationPolicy',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const T = ctx.table('hospitality_core.RoomType')
      return ctx.db.one(
        from(T)
          .where(eq(T.id, args.id))
          .preload('property', 'rooms', 'beds', 'ratePlans', 'cancellationPolicy'),
      )
    },
  }),

  saveRoomType: defineFn({
    input: {
      id: 'id',
      propertyId: 'id',
      code: 'text',
      name: 'text',
      publicName: 'text?',
      description: 'text?',
      defaultCapacity: 'int?',
      maxAdults: 'int?',
      maxChildren: 'int?',
      maxInfants: 'int?',
      maxExtraBeds: 'int?',
      sizeSqm: 'decimal?',
      viewType: 'text?',
      sharedBathroom: 'bool?',
      allowHourly: 'bool?',
      allowWeekly: 'bool?',
      allowMonthly: 'bool?',
      minHourlyHours: 'int?',
      baseRate: 'decimal?',
      color: 'text?',
      cancellationPolicyId: 'id?',
      published: 'bool?',
    },
    output: result,
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.CancellationPolicy',
      'write:hospitality_core.RoomType',
      'write:hospitality_core.ContentChange',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, raw) => {
      const current = await record(ctx, 'hospitality_core.RoomType', raw.id)
      const args = normalized(raw, {
        code: cleanCode(raw.code),
        name: cleanText(raw.name),
        defaultCapacity: Number(raw.defaultCapacity ?? 2),
        maxAdults: Number(raw.maxAdults ?? raw.defaultCapacity ?? 2),
        maxChildren: Number(raw.maxChildren ?? 0),
        maxInfants: Number(raw.maxInfants ?? 0),
        maxExtraBeds: Number(raw.maxExtraBeds ?? 0),
        minHourlyHours: Number(raw.minHourlyHours ?? current?.minHourlyHours ?? 2),
        baseRate: String(raw.baseRate ?? '0'),
      })
      const errors: Issue[] = []
      if (!(await record(ctx, 'hospitality_core.Property', args.propertyId)))
        errors.push(issue('propertyId', 'property_missing'))
      if (current && current.propertyId !== args.propertyId)
        errors.push(issue('propertyId', 'property_mismatch'))
      if (
        args.cancellationPolicyId &&
        !(await record(ctx, 'hospitality_core.CancellationPolicy', args.cancellationPolicyId))
      )
        errors.push(issue('cancellationPolicyId', 'policy_missing'))
      if (!args.code) errors.push(issue('code', 'required'))
      if (!args.name) errors.push(issue('name', 'required'))
      for (const field of [
        'defaultCapacity',
        'maxAdults',
        'maxChildren',
        'maxInfants',
        'maxExtraBeds',
      ] as const)
        if (!Number.isInteger(args[field]) || args[field] < 0) errors.push(issue(field, 'non_negative'))
      if (args.defaultCapacity < 1) errors.push(issue('defaultCapacity', 'capacity'))
      if (args.maxAdults < 1) errors.push(issue('maxAdults', 'capacity'))
      if (args.defaultCapacity > args.maxAdults + args.maxChildren)
        errors.push(issue('defaultCapacity', 'capacity_total'))
      if (Number(args.baseRate) < 0) errors.push(issue('baseRate', 'non_negative'))
      if (args.sizeSqm != null && Number(args.sizeSqm) <= 0) errors.push(issue('sizeSqm', 'positive'))
      if (args.viewType && !isOneOf(ROOM_VIEW_TYPES, args.viewType))
        errors.push(issue('viewType', 'view_type'))
      if (args.color && !/^#[0-9a-f]{6}$/i.test(String(args.color))) errors.push(issue('color', 'color'))
      if (!Number.isInteger(args.minHourlyHours) || args.minHourlyHours < 1)
        errors.push(issue('minHourlyHours', 'positive'))
      if (
        await duplicate(ctx, 'hospitality_core.RoomType', 'code', args.code, args.id, [
          'propertyId',
          args.propertyId,
        ])
      )
        errors.push(issue('code', 'unique'))
      if (errors.length) return failure(...errors)
      return ctx.tx(async (tx) => {
        const result = await save(tx, 'hospitality_core.RoomType', args, writable('RoomType'), {
          sharedBathroom: false,
          allowHourly: true,
          allowWeekly: false,
          allowMonthly: false,
          minHourlyHours: 2,
          published: false,
          active: true,
        })
        if (result.ok)
          await appendContentChange(tx, {
            propertyId: args.propertyId,
            resourceType: 'room_type',
            resourceId: args.id,
          })
        return result
      })
    },
  }),

  listRooms: defineFn({
    input: { propertyId: 'id?', status: 'text?', includeArchived: 'bool?', limit: 'int?' },
    output: {
      id: 'id',
      propertyId: 'id',
      roomTypeId: 'id',
      buildingId: 'id?',
      floorId: 'id?',
      code: 'text',
      name: 'text',
      capacity: 'int',
      status: 'text',
      note: 'text?',
      active: 'bool',
      roomType: 'json?',
      building: 'json?',
      floor: 'json?',
    },
    effects: [
      'read:hospitality_core.Room',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Building',
      'read:hospitality_core.Floor',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const R = ctx.table('hospitality_core.Room')
      let query = from(R).orderBy(asc(R.name)).preload('roomType', 'building', 'floor')
      if (args.propertyId) query = query.where(eq(R.propertyId, args.propertyId))
      if (args.status) query = query.where(eq(R.status, args.status))
      if (args.includeArchived !== true) query = query.where(eq(R.active, true))
      if (args.limit != null) query = query.limit(Math.max(1, Math.min(500, Number(args.limit))))
      return ctx.db.all(query)
    },
  }),

  getRoom: defineFn({
    input: { id: 'id' },
    output: {
      id: 'id',
      propertyId: 'id',
      roomTypeId: 'id',
      buildingId: 'id?',
      floorId: 'id?',
      code: 'text',
      name: 'text',
      capacity: 'int',
      status: 'text',
      note: 'text?',
      active: 'bool',
      property: 'json?',
      roomType: 'json?',
      building: 'json?',
      floor: 'json?',
    },
    effects: [
      'read:hospitality_core.Room',
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Building',
      'read:hospitality_core.Floor',
    ],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const R = ctx.table('hospitality_core.Room')
      return ctx.db.one(from(R).where(eq(R.id, args.id)).preload('property', 'roomType', 'building', 'floor'))
    },
  }),

  saveRoom: defineFn({
    input: {
      id: 'id',
      propertyId: 'id',
      roomTypeId: 'id',
      buildingId: 'id?',
      floorId: 'id?',
      code: 'text',
      name: 'text',
      capacity: 'int?',
      status: 'text?',
      note: 'text?',
    },
    output: result,
    effects: [
      'read:hospitality_core.Room',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Building',
      'read:hospitality_core.Floor',
      'write:hospitality_core.Building',
      'write:hospitality_core.Floor',
      'write:hospitality_core.Room',
      'read:hospitality_core.Property',
      'read:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.InventoryChange',
    ],
    idempotent: true,
    agent: true,
    handler: (ctx: Ctx, raw) =>
      ctx.tx(async (tx) => {
        const current = await record(tx, 'hospitality_core.Room', raw.id)
        const type = await record(tx, 'hospitality_core.RoomType', raw.roomTypeId)
        const floor = raw.floorId ? await record(tx, 'hospitality_core.Floor', raw.floorId) : null
        const buildingId = raw.buildingId || floor?.buildingId || null
        const building = buildingId ? await record(tx, 'hospitality_core.Building', buildingId) : null
        const args = normalized(raw, {
          buildingId,
          floorId: raw.floorId || null,
          code: cleanCode(raw.code),
          name: cleanText(raw.name),
          capacity: Number(raw.capacity ?? type?.defaultCapacity ?? 1),
        })
        const errors: Issue[] = []
        if (!type) errors.push(issue('roomTypeId', 'room_type_missing'))
        else if (type.propertyId !== args.propertyId) errors.push(issue('roomTypeId', 'property_mismatch'))
        if (buildingId && !building) errors.push(issue('buildingId', 'building_missing'))
        else if (building && building.propertyId !== args.propertyId)
          errors.push(issue('buildingId', 'property_mismatch'))
        else if (building && building.active !== true && current?.buildingId !== building.id)
          errors.push(issue('buildingId', 'location_archived'))
        if (raw.floorId && !floor) errors.push(issue('floorId', 'floor_missing'))
        else if (floor && floor.propertyId !== args.propertyId)
          errors.push(issue('floorId', 'property_mismatch'))
        else if (floor && buildingId && floor.buildingId !== buildingId)
          errors.push(issue('floorId', 'building_mismatch'))
        else if (floor && floor.active !== true && current?.floorId !== floor.id)
          errors.push(issue('floorId', 'location_archived'))
        if (current && current.propertyId !== args.propertyId)
          errors.push(issue('propertyId', 'property_mismatch'))
        if (!args.code) errors.push(issue('code', 'required'))
        if (!args.name) errors.push(issue('name', 'required'))
        if (!Number.isInteger(args.capacity) || args.capacity < 1) errors.push(issue('capacity', 'capacity'))
        if (raw.status != null) {
          const requestedStatus = String(raw.status)
          if (!isOneOf(ROOM_STATUSES, requestedStatus)) errors.push(issue('status', 'room_status'))
          else if (requestedStatus !== String(current?.status ?? 'available'))
            errors.push(issue('status', 'room_status_configuration_managed'))
        }
        if (
          await duplicate(tx, 'hospitality_core.Room', 'code', args.code, args.id, [
            'propertyId',
            args.propertyId,
          ])
        )
          errors.push(issue('code', 'unique'))
        if (errors.length) return failure(...errors)
        if (building && !(await lockActiveFlag(tx, 'hospitality_core.Building', building)))
          return failure(issue('buildingId', 'transition_conflict'))
        if (floor && !(await lockActiveFlag(tx, 'hospitality_core.Floor', floor)))
          return failure(issue('floorId', 'transition_conflict'))
        const configuration = { ...args }
        delete configuration.status
        delete configuration.note
        const saved = await save(tx, 'hospitality_core.Room', configuration, writable('Room'), {
          status: 'available',
          note: null,
          active: true,
        })
        if (saved.ok !== true) return saved
        // A new room, or one that moved between types, changes the sellable
        // count on both sides of the move.
        const affected = new Set([String(args.roomTypeId)])
        if (current?.roomTypeId) affected.add(String(current.roomTypeId))
        for (const roomTypeId of affected) await followRoomCapacity(tx, args.propertyId, roomTypeId)
        return saved
      }),
  }),

  archiveRoom: defineFn({
    input: { id: 'id', active: 'bool' },
    output: result,
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Building',
      'read:hospitality_core.Floor',
      'read:hospitality_core.Room',
      'read:hospitality_core.Stay',
      'read:hospitality_core.CleaningTask',
      'write:hospitality_core.Building',
      'write:hospitality_core.Floor',
      'write:hospitality_core.Room',
      'read:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.InventoryChange',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      try {
        return await ctx.tx(async (tx) => {
          const room = await record(tx, 'hospitality_core.Room', args.id)
          if (!room) return failure(issue('id', 'room_missing'))
          if (room.active === args.active) return success(args.id)

          if (args.active) {
            const property = await record(tx, 'hospitality_core.Property', room.propertyId)
            if (!property) return failure(issue('propertyId', 'property_missing'))
            if (property.active !== true) return failure(issue('propertyId', 'property_archived'))
            const roomType = await record(tx, 'hospitality_core.RoomType', room.roomTypeId)
            if (!roomType) return failure(issue('roomTypeId', 'room_type_missing'))
            if (roomType.active !== true) return failure(issue('roomTypeId', 'room_type_archived'))

            const building = room.buildingId
              ? await record(tx, 'hospitality_core.Building', room.buildingId)
              : null
            if (room.buildingId && !building) return failure(issue('buildingId', 'building_missing'))
            if (building && building.active !== true) return failure(issue('buildingId', 'location_archived'))
            if (building && !(await lockActiveFlag(tx, 'hospitality_core.Building', building)))
              return failure(issue('buildingId', 'transition_conflict'))

            const floor = room.floorId ? await record(tx, 'hospitality_core.Floor', room.floorId) : null
            if (room.floorId && !floor) return failure(issue('floorId', 'floor_missing'))
            if (floor && floor.active !== true) return failure(issue('floorId', 'location_archived'))
            if (floor && !(await lockActiveFlag(tx, 'hospitality_core.Floor', floor)))
              return failure(issue('floorId', 'transition_conflict'))

            const restored = await tx.db.compareAndSet(
              'hospitality_core.Room',
              { id: args.id },
              { active: false, status: 'available' },
              { active: true },
            )
            if (!('matched' in restored) || !restored.matched)
              return failure(issue('id', 'transition_conflict'))
            await followRoomCapacity(tx, room.propertyId, room.roomTypeId)
            return success(args.id)
          }

          if (room.status !== 'available') return failure(issue('id', 'room_archive_status'))
          const archived = await tx.db.compareAndSet(
            'hospitality_core.Room',
            { id: args.id },
            { active: true, status: 'available' },
            { active: false },
          )
          if (!('matched' in archived) || !archived.matched)
            return failure(issue('id', 'transition_conflict'))

          const S = tx.table('hospitality_core.Stay')
          const activeStay = await tx.db.one(
            from(S).where(eq(S.currentRoomId, args.id), eq(S.state, 'checked_in')).limit(1),
          )
          if (activeStay) throw new RoomLifecycleGuard(issue('id', 'room_has_active_stay'))
          const T = tx.table('hospitality_core.CleaningTask')
          const activeTask = await tx.db.one(
            from(T)
              .where(eq(T.roomId, args.id), inArray(T.state, ['todo', 'in_progress']))
              .limit(1),
          )
          if (activeTask) throw new RoomLifecycleGuard(issue('id', 'room_has_open_task'))
          // Retiring a room shrinks what the room type can sell. Refusing is the
          // only honest answer while future nights are already committed against it.
          const overcommitted = await followRoomCapacity(tx, room.propertyId, room.roomTypeId)
          const first = overcommitted[0]
          if (first)
            throw new RoomLifecycleGuard(
              issue('id', 'room_archive_would_oversell', {
                date: first.date,
                committed: first.committed,
                total: first.total,
                count: overcommitted.length,
              }),
            )
          return success(args.id)
        })
      } catch (error) {
        if (error instanceof RoomLifecycleGuard) return failure(error.problem)
        throw error
      }
    },
  }),

  setRoomStatus: defineFn({
    input: { id: 'id', expectedStatus: 'text?', status: 'text', note: 'text?' },
    output: { ok: 'bool', id: 'id?', status: 'text?', overcommitted: 'json?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Room',
      'read:hospitality_core.Stay',
      'read:hospitality_core.CleaningTask',
      'write:hospitality_core.Room',
      'read:hospitality_core.Property',
      'read:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.AvailabilityLedger',
      'write:hospitality_core.InventoryChange',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!isOneOf(ROOM_STATUSES, args.status)) return failure(issue('status', 'room_status'))
      if (args.expectedStatus && !isOneOf(ROOM_STATUSES, args.expectedStatus))
        return failure(issue('expectedStatus', 'room_status'))
      if (args.status === 'occupied' || args.status === 'cleaning')
        return failure(issue('status', 'room_status_managed'))
      if (args.status === 'available') return failure(issue('status', 'room_status_available_managed'))
      const note = args.note === undefined ? undefined : cleanText(args.note)

      try {
        return await ctx.tx(async (tx) => {
          const room = await record(tx, 'hospitality_core.Room', args.id)
          if (!room) return failure(issue('id', 'room_missing'))
          if (room.active !== true) return failure(issue('id', 'room_archived'))
          if (args.expectedStatus && room.status !== args.expectedStatus)
            return failure(issue('status', 'transition_conflict'))
          if (room.status === args.status) return { ok: true, id: args.id, status: args.status, errors: [] }
          if ((args.status === 'maintenance' || args.status === 'out_of_order') && !note)
            return failure(issue('note', 'room_status_note_required'))
          if (room.status === 'occupied') return failure(issue('status', 'room_occupied'))
          if (room.status === 'cleaning') return failure(issue('status', 'room_cleaning'))

          const S = tx.table('hospitality_core.Stay')
          const currentStay = await tx.db.one(
            from(S).where(eq(S.currentRoomId, args.id), eq(S.state, 'checked_in')).limit(1),
          )
          if (currentStay) return failure(issue('status', 'room_occupied'))

          const changed = await tx.db.compareAndSet(
            'hospitality_core.Room',
            { id: args.id },
            { status: room.status, active: true },
            {
              status: args.status,
              ...(note !== undefined ? { note: note || null } : {}),
            },
          )
          if (!('matched' in changed) || !changed.matched)
            return failure(issue('status', 'transition_conflict'))

          const T = tx.table('hospitality_core.CleaningTask')
          const activeTask = await tx.db.one(
            from(T)
              .where(eq(T.roomId, args.id), inArray(T.state, ['todo', 'in_progress']))
              .limit(1),
          )
          if (activeTask) throw new RoomStatusGuard(issue('status', 'room_task_open'))
          // A burst pipe does not wait for the booking calendar, so taking a room
          // out of service is never refused. It does shrink capacity, and any date
          // that is now oversold comes back for the front desk to resolve.
          const overcommitted = await followRoomCapacity(tx, room.propertyId, room.roomTypeId)
          return {
            ok: true,
            id: args.id,
            status: args.status,
            overcommitted: overcommitted.map((entry) => entry.date),
            errors: [],
          }
        })
      } catch (error) {
        if (error instanceof RoomStatusGuard) return failure(error.problem)
        throw error
      }
    },
  }),

  listAmenityCategories: defineFn({
    output: { id: 'id', name: 'text', sequence: 'int', active: 'bool' },
    effects: ['read:hospitality_core.AmenityCategory'],
    agent: true,
    handler: async (ctx: Ctx) => {
      const C = ctx.table('hospitality_core.AmenityCategory')
      return ctx.db.all(from(C).where(eq(C.active, true)).orderBy(asc(C.sequence)))
    },
  }),

  saveAmenityCategory: defineFn({
    input: { id: 'id', name: 'text', sequence: 'int?' },
    output: result,
    effects: ['read:hospitality_core.AmenityCategory', 'write:hospitality_core.AmenityCategory'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, raw) => {
      const args = normalized(raw, { name: cleanText(raw.name), sequence: Number(raw.sequence ?? 10) })
      if (!args.name) return failure(issue('name', 'required'))
      return save(ctx, 'hospitality_core.AmenityCategory', args, ['id', 'name', 'sequence'], { active: true })
    },
  }),

  listAmenities: defineFn({
    input: { scope: 'text?' },
    output: {
      id: 'id',
      categoryId: 'id?',
      code: 'text',
      name: 'text',
      scope: 'text',
      sequence: 'int',
      active: 'bool',
    },
    effects: ['read:hospitality_core.Amenity'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const A = ctx.table('hospitality_core.Amenity')
      let query = from(A).where(eq(A.active, true)).orderBy(asc(A.sequence), asc(A.name))
      if (args.scope) query = query.where(eq(A.scope, args.scope))
      return ctx.db.all(query)
    },
  }),

  saveAmenity: defineFn({
    input: { id: 'id', categoryId: 'id?', code: 'text', name: 'text', scope: 'text', sequence: 'int?' },
    output: result,
    effects: [
      'read:hospitality_core.AmenityCategory',
      'read:hospitality_core.Amenity',
      'read:hospitality_core.PropertyAmenity',
      'read:hospitality_core.RoomTypeAmenity',
      'read:hospitality_core.RoomType',
      'write:hospitality_core.Amenity',
      'write:hospitality_core.ContentChange',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, raw) => {
      const args = normalized(raw, {
        code: cleanCode(raw.code),
        name: cleanText(raw.name),
        sequence: Number(raw.sequence ?? 10),
      })
      const errors: Issue[] = []
      if (args.categoryId && !(await record(ctx, 'hospitality_core.AmenityCategory', args.categoryId)))
        errors.push(issue('categoryId', 'amenity_category_missing'))
      if (!args.code) errors.push(issue('code', 'required'))
      if (!args.name) errors.push(issue('name', 'required'))
      if (!isOneOf(AMENITY_SCOPES, args.scope)) errors.push(issue('scope', 'amenity_scope'))
      if (await duplicate(ctx, 'hospitality_core.Amenity', 'code', args.code, args.id))
        errors.push(issue('code', 'unique'))
      if (errors.length) return failure(...errors)
      return ctx.tx(async (tx) => {
        const result = await save(
          tx,
          'hospitality_core.Amenity',
          args,
          ['id', 'categoryId', 'code', 'name', 'scope', 'sequence'],
          { active: true },
        )
        if (result.ok) await signalAmenityUsers(tx, args.id)
        return result
      })
    },
  }),

  assignAmenity: defineFn({
    input: { id: 'id', target: 'text', targetId: 'id', amenityId: 'id' },
    output: result,
    effects: [
      'read:hospitality_core.Amenity',
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'read:hospitality_core.PropertyAmenity',
      'read:hospitality_core.RoomTypeAmenity',
      'write:hospitality_core.PropertyAmenity',
      'write:hospitality_core.RoomTypeAmenity',
      'write:hospitality_core.ContentChange',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const amenity = await record(ctx, 'hospitality_core.Amenity', args.amenityId)
      if (!amenity) return failure(issue('amenityId', 'amenity_missing'))
      const property = args.target === 'property'
      const roomType = args.target === 'room_type'
      if (!property && !roomType) return failure(issue('target', 'amenity_target'))
      if (property && amenity.scope !== 'property')
        return failure(issue('amenityId', 'amenity_scope_mismatch'))
      if (roomType && amenity.scope !== 'room') return failure(issue('amenityId', 'amenity_scope_mismatch'))
      const targetModel = property ? 'hospitality_core.Property' : 'hospitality_core.RoomType'
      const targetRecord = await record(ctx, targetModel, args.targetId)
      if (!targetRecord) return failure(issue('targetId', 'target_missing'))
      const model = property ? 'hospitality_core.PropertyAmenity' : 'hospitality_core.RoomTypeAmenity'
      const targetField = property ? 'propertyId' : 'roomTypeId'
      const table = ctx.table(model)
      const existing = await ctx.db.one(
        from(table).where(eq(table[targetField]!, args.targetId), eq(table.amenityId, args.amenityId)),
      )
      if (existing) return success(existing.id)
      return ctx.tx(async (tx) => {
        await tx.db.insert(model, {
          id: args.id,
          [targetField]: args.targetId,
          amenityId: args.amenityId,
        })
        await appendContentChange(tx, {
          propertyId: property ? args.targetId : targetRecord.propertyId,
          resourceType: property ? 'property' : 'room_type',
          resourceId: args.targetId,
        })
        return success(args.id)
      })
    },
  }),

  saveBed: defineFn({
    input: { id: 'id', roomTypeId: 'id', type: 'text', quantity: 'int', roomName: 'text?' },
    output: result,
    effects: [
      'read:hospitality_core.RoomType',
      'read:hospitality_core.Bed',
      'write:hospitality_core.Bed',
      'write:hospitality_core.ContentChange',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const errors: Issue[] = []
      const roomType = await record(ctx, 'hospitality_core.RoomType', args.roomTypeId)
      if (!roomType) errors.push(issue('roomTypeId', 'room_type_missing'))
      if (!isOneOf(BED_TYPES, args.type)) errors.push(issue('type', 'bed_type'))
      if (!Number.isInteger(Number(args.quantity)) || Number(args.quantity) < 1)
        errors.push(issue('quantity', 'positive'))
      if (errors.length) return failure(...errors)
      return ctx.tx(async (tx) => {
        const result = await save(tx, 'hospitality_core.Bed', args, [
          'id',
          'roomTypeId',
          'type',
          'quantity',
          'roomName',
        ])
        if (result.ok && roomType)
          await appendContentChange(tx, {
            propertyId: roomType.propertyId,
            resourceType: 'room_type',
            resourceId: args.roomTypeId,
          })
        return result
      })
    },
  }),

  listCancellationPolicies: defineFn({
    input: { includeArchived: 'bool?' },
    output: {
      id: 'id',
      code: 'text',
      name: 'text',
      type: 'text',
      description: 'text?',
      freeCancellationHours: 'int',
      penaltyPercent: 'decimal',
      active: 'bool',
    },
    effects: ['read:hospitality_core.CancellationPolicy'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const P = ctx.table('hospitality_core.CancellationPolicy')
      let query = from(P).orderBy(asc(P.name))
      if (args.includeArchived !== true) query = query.where(eq(P.active, true))
      return ctx.db.all(query)
    },
  }),

  saveCancellationPolicy: defineFn({
    input: {
      id: 'id',
      code: 'text',
      name: 'text',
      type: 'text',
      description: 'text?',
      freeCancellationHours: 'int?',
      penaltyPercent: 'decimal?',
    },
    output: result,
    effects: [
      'read:hospitality_core.CancellationPolicy',
      'read:hospitality_core.Property',
      'read:hospitality_core.RoomType',
      'write:hospitality_core.CancellationPolicy',
      'write:hospitality_core.ContentChange',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, raw) => {
      const args = normalized(raw, {
        code: cleanCode(raw.code),
        name: cleanText(raw.name),
        freeCancellationHours: Number(raw.freeCancellationHours ?? 0),
        penaltyPercent: String(raw.penaltyPercent ?? '0'),
      })
      const errors: Issue[] = []
      if (!args.code) errors.push(issue('code', 'required'))
      if (!args.name) errors.push(issue('name', 'required'))
      if (!isOneOf(CANCELLATION_POLICY_TYPES, args.type))
        errors.push(issue('type', 'cancellation_policy_type'))
      if (args.freeCancellationHours < 0) errors.push(issue('freeCancellationHours', 'non_negative'))
      if (Number(args.penaltyPercent) < 0 || Number(args.penaltyPercent) > 100)
        errors.push(issue('penaltyPercent', 'percentage'))
      if (await duplicate(ctx, 'hospitality_core.CancellationPolicy', 'code', args.code, args.id))
        errors.push(issue('code', 'unique'))
      if (errors.length) return failure(...errors)
      return ctx.tx(async (tx) => {
        const result = await save(
          tx,
          'hospitality_core.CancellationPolicy',
          args,
          ['id', 'code', 'name', 'type', 'description', 'freeCancellationHours', 'penaltyPercent'],
          { active: true },
        )
        if (result.ok) await signalPolicyUsers(tx, args.id)
        return result
      })
    },
  }),

  savePropertyContact: defineFn({
    input: { id: 'id', propertyId: 'id', type: 'text', name: 'text', email: 'text?', phone: 'text?' },
    output: result,
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.PropertyContact',
      'write:hospitality_core.PropertyContact',
      'write:hospitality_core.ContentChange',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, raw) => {
      const args = normalized(raw, { name: cleanText(raw.name) })
      const errors: Issue[] = []
      if (!(await record(ctx, 'hospitality_core.Property', args.propertyId)))
        errors.push(issue('propertyId', 'property_missing'))
      if (!args.name) errors.push(issue('name', 'required'))
      if (!isOneOf(CONTACT_TYPES, args.type)) errors.push(issue('type', 'contact_type'))
      if (
        await duplicate(ctx, 'hospitality_core.PropertyContact', 'type', args.type, args.id, [
          'propertyId',
          args.propertyId,
        ])
      )
        errors.push(issue('type', 'unique'))
      if (errors.length) return failure(...errors)
      return ctx.tx(async (tx) => {
        const result = await save(tx, 'hospitality_core.PropertyContact', args, [
          'id',
          'propertyId',
          'type',
          'name',
          'email',
          'phone',
        ])
        if (result.ok)
          await appendContentChange(tx, {
            propertyId: args.propertyId,
            resourceType: 'property',
            resourceId: args.propertyId,
          })
        return result
      })
    },
  }),
}
