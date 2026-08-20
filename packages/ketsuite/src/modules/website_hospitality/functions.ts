import { randomUUID } from 'node:crypto'
import { asc, defineFn, desc, eq, from } from 'ketjs'
import type { Ctx, FnSpec } from 'ketjs'

const invalid = (field: string, message: string) => ({ ok: false, errors: [{ field, message }] })

export const functions: Record<string, FnSpec> = {
  listStays: defineFn({
    anonymous: true,
    input: { propertyId: 'id?' },
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
    effects: ['read:hospitality_core.RoomType'],
    handler: async (ctx: Ctx, args) => {
      const RoomType = ctx.table('hospitality_core.RoomType')
      let query = from(RoomType)
        .where(eq(RoomType.active, true), eq(RoomType.published, true))
        .orderBy(asc(RoomType.name))
      if (args.propertyId) query = query.where(eq(RoomType.propertyId, args.propertyId))
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
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:website.Site', 'read:hospitality_core.RoomType', 'write:website_hospitality.BookingLead'],
    handler: async (ctx: Ctx, args) => {
      if (!(await ctx.db.select('website.Site', { id: args.siteId }))[0])
        return invalid('siteId', 'site does not exist')
      if (args.roomTypeId && !(await ctx.db.select('hospitality_core.RoomType', { id: args.roomTypeId }))[0])
        return invalid('roomTypeId', 'room type does not exist')
      const checkIn = new Date(String(args.checkIn))
      const checkOut = new Date(String(args.checkOut))
      if (Number.isNaN(checkIn.getTime()) || Number.isNaN(checkOut.getTime()) || checkOut <= checkIn)
        return invalid('checkOut', 'check-out must be after check-in')
      if (!String(args.guestName).trim()) return invalid('guestName', 'required')
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(args.email))) return invalid('email', 'invalid email')
      const id = randomUUID()
      await ctx.db.insert('website_hospitality.BookingLead', {
        id,
        siteId: args.siteId,
        roomTypeId: args.roomTypeId ?? null,
        guestName: String(args.guestName).trim(),
        email: String(args.email).trim().toLowerCase(),
        phone: args.phone ?? null,
        checkIn: args.checkIn,
        checkOut: args.checkOut,
        adults: Math.max(1, Number(args.adults ?? 1)),
        children: Math.max(0, Number(args.children ?? 0)),
        note: args.note ?? null,
        status: 'new',
        createdAt: new Date().toISOString(),
      })
      return { ok: true, id }
    },
  }),

  listBookingLeads: defineFn({
    input: { siteId: 'id', status: 'text?' },
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
    effects: ['read:website_hospitality.BookingLead'],
    agent: true,
    handler: async (ctx: Ctx, args) => {
      const Lead = ctx.table('website_hospitality.BookingLead')
      let query = from(Lead).where(eq(Lead.siteId, args.siteId)).orderBy(desc(Lead.createdAt))
      if (args.status) query = query.where(eq(Lead.status, args.status))
      return ctx.db.all(query)
    },
  }),
}
