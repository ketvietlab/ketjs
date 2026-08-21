import { createHash, randomUUID } from 'node:crypto'
import { asc, defineFn, desc, eq, from, inArray } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { canManageStructure } from '../website/access.ts'

const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })
const page = (limit: unknown, offset: unknown) => ({
  limit: Math.min(Math.max(Number.isInteger(limit) ? Number(limit) : 24, 1), 100),
  offset: Math.min(Math.max(Number.isInteger(offset) ? Number(offset) : 0, 0), 100_000),
})
const hospitalitySite = async (ctx: Ctx, id: unknown): Promise<Row | null> => {
  const site = (await ctx.db.select('website.Site', { id }))[0] ?? null
  return site?.active === true && (site.theme === 'theme_hospitality' || site.siteGroup === 'hospitality')
    ? site
    : null
}
const dateOnly = (value: unknown): Date | null => {
  const raw = String(value ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null
  const date = new Date(`${raw}T00:00:00.000Z`)
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== raw ? null : date
}
const claimRateSlot = async (ctx: Ctx, key: string, now: Date): Promise<boolean> => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const held = (await ctx.db.select('website_hospitality.BookingRateLimit', { id: key }))[0]
    if (!held) {
      const inserted = await ctx.db.insertIfAbsent('website_hospitality.BookingRateLimit', {
        id: key,
        key,
        windowStartedAt: now.toISOString(),
        count: 1,
      })
      if ('dryRun' in inserted || inserted.inserted) return true
      continue
    }
    const inWindow = now.getTime() - new Date(String(held.windowStartedAt)).getTime() < 15 * 60 * 1000
    if (inWindow && Number(held.count) >= 5) return false
    const changed = await ctx.db.compareAndSet(
      'website_hospitality.BookingRateLimit',
      { id: key },
      { windowStartedAt: held.windowStartedAt, count: held.count },
      {
        windowStartedAt: inWindow ? held.windowStartedAt : now.toISOString(),
        count: inWindow ? Number(held.count) + 1 : 1,
      },
    )
    if ('dryRun' in changed || changed.matched) return true
  }
  return false
}

export const functions: Record<string, FnSpec> = {
  listStays: defineFn({
    anonymous: true,
    input: { siteId: 'id', limit: 'int?', offset: 'int?' },
    output: {
      id: 'id',
      propertyId: 'id',
      name: 'text',
      publicName: 'text?',
      description: 'text?',
      capacity: 'int',
      maxAdults: 'int',
      maxChildren: 'int',
      sizeSqm: 'decimal?',
      baseRate: 'decimal',
    },
    effects: ['read:website.Site', 'read:website_hospitality.SiteProperty', 'read:hospitality_core.RoomType'],
    handler: async (ctx: Ctx, args) => {
      if (!(await hospitalitySite(ctx, args.siteId))) return []
      const links = await ctx.db.select('website_hospitality.SiteProperty', {
        siteId: args.siteId,
        active: true,
      })
      const properties = new Set(links.map((link) => link.propertyId))
      if (!properties.size) return []
      const RoomType = ctx.table('hospitality_core.RoomType')
      const paging = page(args.limit, args.offset)
      const query = from(RoomType)
        .where(
          eq(RoomType.active, true),
          eq(RoomType.published, true),
          inArray(RoomType.propertyId, [...properties]),
        )
        .orderBy(asc(RoomType.name))
        .limit(paging.limit)
        .offset(paging.offset)
      return (await ctx.db.all(query)).map((row) => ({
        id: row.id,
        propertyId: row.propertyId,
        name: row.name,
        publicName: row.publicName ?? null,
        description: row.description ?? null,
        capacity: row.defaultCapacity,
        maxAdults: row.maxAdults,
        maxChildren: row.maxChildren,
        sizeSqm: row.sizeSqm ?? null,
        baseRate: row.baseRate,
      }))
    },
  }),

  saveSiteProperty: defineFn({
    input: { id: 'id', siteId: 'id', propertyId: 'id', active: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website.SiteMember',
      'read:website_hospitality.SiteProperty',
      'write:website_hospitality.SiteProperty',
      'read:hospitality_core.Property',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!(await hospitalitySite(ctx, args.siteId)))
        return invalid('siteId', 'website_hospitality.error.invalidSite')
      if (!(await canManageStructure(ctx, args.siteId))) return invalid('siteId', 'website.error.forbidden')
      if (!(await ctx.db.select('hospitality_core.Property', { id: args.propertyId }))[0])
        return invalid('propertyId', 'website_hospitality.error.propertyNotFound')
      const existing = (await ctx.db.select('website_hospitality.SiteProperty', { id: args.id }))[0]
      if (existing && existing.siteId !== args.siteId)
        return invalid('id', 'website.error.immutableOwnership')
      const duplicate = (
        await ctx.db.select('website_hospitality.SiteProperty', {
          siteId: args.siteId,
          propertyId: args.propertyId,
        })
      ).find((link) => link.id !== args.id)
      if (duplicate) return invalid('propertyId', 'website_hospitality.error.duplicateProperty')
      const row = {
        id: args.id,
        siteId: args.siteId,
        propertyId: args.propertyId,
        active: args.active !== false,
      }
      if (existing) await ctx.db.update('website_hospitality.SiteProperty', { id: args.id }, row)
      else await ctx.db.insert('website_hospitality.SiteProperty', row)
      return { ok: true, id: args.id }
    },
  }),

  requestBooking: defineFn({
    anonymous: true,
    input: {
      siteId: 'id',
      roomTypeId: 'id?',
      guestName: 'text',
      email: 'text',
      phone: 'text?',
      checkIn: 'date',
      checkOut: 'date',
      adults: 'int?',
      children: 'int?',
      note: 'text?',
      requestKey: 'text?',
      rateKey: 'text?',
      honeypot: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:website.Site',
      'read:website_hospitality.SiteProperty',
      'read:website_hospitality.BookingLead',
      'read:website_hospitality.BookingRateLimit',
      'write:website_hospitality.BookingRateLimit',
      'read:hospitality_core.RoomType',
      'write:website_hospitality.BookingLead',
    ],
    exposure: 'internal',
    idempotent: true,
    handler: async (ctx: Ctx, args) => {
      if (String(args.honeypot ?? '').trim()) return { ok: true }
      if (!(await hospitalitySite(ctx, args.siteId)))
        return invalid('siteId', 'website_hospitality.error.invalidSite')
      const roomType = args.roomTypeId
        ? (await ctx.db.select('hospitality_core.RoomType', { id: args.roomTypeId }))[0]
        : null
      if (args.roomTypeId && (roomType?.active !== true || roomType.published !== true))
        return invalid('roomTypeId', 'website_hospitality.error.roomTypeNotFound')
      if (roomType) {
        const linked = (
          await ctx.db.select('website_hospitality.SiteProperty', {
            siteId: args.siteId,
            propertyId: roomType.propertyId,
            active: true,
          })
        )[0]
        if (!linked) return invalid('roomTypeId', 'website_hospitality.error.roomTypeNotFound')
      }
      const checkIn = dateOnly(args.checkIn)
      const checkOut = dateOnly(args.checkOut)
      const today = dateOnly(new Date().toISOString().slice(0, 10))!
      if (!checkIn || !checkOut || checkOut <= checkIn)
        return invalid('checkOut', 'website_hospitality.error.invalidStayDates')
      const nights = (checkOut.getTime() - checkIn.getTime()) / 86_400_000
      if (checkIn < today || nights > 90 || checkIn.getTime() > today.getTime() + 2 * 365 * 86_400_000)
        return invalid('checkIn', 'website_hospitality.error.invalidStayDates')
      const guestName = String(args.guestName).trim()
      const email = String(args.email).trim().toLowerCase()
      const phone = args.phone ? String(args.phone).trim() : null
      const note = args.note ? String(args.note).trim() : null
      if (!guestName || guestName.length > 200)
        return invalid('guestName', 'website_hospitality.error.invalidName')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320)
        return invalid('email', 'website_hospitality.error.invalidEmail')
      if (phone && (phone.length > 50 || !/^[+()\d\s.-]+$/.test(phone)))
        return invalid('phone', 'website_hospitality.error.invalidPhone')
      if (note && note.length > 5_000) return invalid('note', 'website_hospitality.error.noteTooLong')
      const adults = Number(args.adults ?? 1)
      const children = Number(args.children ?? 0)
      if (!Number.isInteger(adults) || adults < 1 || adults > 50)
        return invalid('adults', 'website_hospitality.error.invalidGuests')
      if (!Number.isInteger(children) || children < 0 || children > 50)
        return invalid('children', 'website_hospitality.error.invalidGuests')
      if (roomType && adults + children > Number(roomType.defaultCapacity))
        return invalid('adults', 'website_hospitality.error.capacityExceeded')
      const dedupeKey = args.requestKey
        ? createHash('sha256')
            .update(`${String(args.siteId)}:${String(args.requestKey).slice(0, 500)}`)
            .digest('hex')
        : null
      if (dedupeKey) {
        const replay = (
          await ctx.db.select('website_hospitality.BookingLead', { siteId: args.siteId, dedupeKey })
        )[0]
        if (replay) return { ok: true, id: replay.id }
      }
      const id = dedupeKey
        ? createHash('sha256')
            .update(`booking:${String(args.siteId)}:${dedupeKey}`)
            .digest('hex')
        : randomUUID()
      const now = new Date()
      const rateKey = createHash('sha256')
        .update(`${String(args.siteId)}:${String(args.rateKey ?? 'anonymous').slice(0, 500)}`)
        .digest('hex')
      const accepted = await ctx.tx(async (tx) => {
        if (!(await claimRateSlot(tx, rateKey, now))) return false
        const inserted = await tx.db.insertIfAbsent('website_hospitality.BookingLead', {
          id,
          siteId: args.siteId,
          roomTypeId: args.roomTypeId ?? null,
          guestName,
          email,
          phone,
          checkIn: args.checkIn,
          checkOut: args.checkOut,
          adults,
          children,
          note,
          status: 'new',
          dedupeKey,
          createdAt: now.toISOString(),
        })
        return 'dryRun' in inserted || inserted.inserted
      })
      if (!accepted) {
        const replay = dedupeKey
          ? (
              await ctx.db.select('website_hospitality.BookingLead', {
                siteId: args.siteId,
                dedupeKey,
              })
            )[0]
          : null
        if (replay) return { ok: true, id: replay.id }
        return invalid('rateKey', 'website_hospitality.error.rateLimit')
      }
      return { ok: true, id }
    },
  }),

  listBookingLeads: defineFn({
    input: { siteId: 'id', status: 'text?', limit: 'int?', offset: 'int?' },
    output: {
      id: 'id',
      siteId: 'id',
      roomTypeId: 'id?',
      guestName: 'text',
      email: 'text',
      checkIn: 'date',
      checkOut: 'date',
      adults: 'int',
      children: 'int',
      status: 'text',
      createdAt: 'datetime',
    },
    effects: ['read:website.SiteMember', 'read:website_hospitality.BookingLead'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      if (!(await canManageStructure(ctx, args.siteId))) return []
      const Lead = ctx.table('website_hospitality.BookingLead')
      const paging = page(args.limit, args.offset)
      let query = from(Lead).where(eq(Lead.siteId, args.siteId)).orderBy(desc(Lead.createdAt))
      if (args.status) query = query.where(eq(Lead.status, args.status))
      return ctx.db.all(query.limit(paging.limit).offset(paging.offset))
    },
  }),
}
