import { randomUUID } from 'node:crypto'
import { page, text } from 'ketjs'
import type { Route, RouteEntry, ServeContext } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import { viewerOf } from '../backend/routes.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import {
  amenitiesScreen,
  cleaningTasksScreen,
  foliosScreen,
  frontDeskScreen,
  housekeepingRoomsScreen,
  policiesScreen,
  propertiesScreen,
  ratePlansScreen,
  reservationsScreen,
  inventoryScreen,
  roomsScreen,
  roomTypesScreen,
  staysScreen,
  tapeChartScreen,
} from './screens.ts'
import type {
  AmenityRow,
  CleaningTaskRow,
  FolioRow,
  PolicyRow,
  PropertyRow,
  RatePlanRow,
  InventoryRow,
  ReservationRow,
  RoomRow,
  RoomTypeRow,
  StayRow,
  TapeChart,
} from './screens.ts'
import { addCalendarDays, calendarRange, dateKeyIn } from './calendar.ts'

const frame = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => ({
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(url, req),
  menuFilter: url.searchParams.get('menu')?.trim() || null,
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
  },
})

const document = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  title: string,
  body: TemplateResult,
) => {
  const lang = ctx.localeOf(url, req)
  return page({ body: ctx.document({ lang, title, head: await ctx.styles(req), body }) })
}

const propertyTimezone = async (
  ctx: ServeContext,
  propertyId: string | undefined,
  url: URL,
  req: Parameters<Route>[1],
): Promise<string> => {
  if (!propertyId) return 'UTC'
  const property = (await ctx.call('hospitality_core.getProperty', { id: propertyId }, url, req)) as {
    timezone?: string
  } | null
  return property?.timezone || 'UTC'
}

const selectedProperty = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
): Promise<string | undefined> => {
  const selected = url.searchParams.get('property')?.trim()
  if (selected) return selected
  const properties = (await ctx.call('hospitality_core.listProperties', {}, url, req)) as PropertyRow[]
  return properties[0]?.id
}

const redirected = (
  url: URL,
  state: 'saved' | 'invalid',
  values: Record<string, string | undefined> = {},
) => {
  const params = new URLSearchParams(url.searchParams)
  params.set('status', state)
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value)
    else params.delete(key)
  }
  return seeOther(`${url.pathname}?${params.toString()}`)
}

const integer = (value: string | undefined, fallback = 0): number => {
  const parsed = Number(value ?? fallback)
  return Number.isInteger(parsed) ? parsed : -1
}

const optionalInteger = (value: string | undefined): number | undefined =>
  value ? integer(value) : undefined

export const routes: Record<string, RouteEntry> = {
  '/admin/hospitality/front-desk':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const propertyId = await selectedProperty(ctx, url, req)
      const timezone = await propertyTimezone(ctx, propertyId, url, req)
      const range = calendarRange(url.searchParams.get('date'), 1, timezone)
      const [stays, openFolios] = (await Promise.all([
        ctx.call('hospitality_core.listStays', { propertyId, from: range.from, to: range.to }, url, req),
        ctx.call('hospitality_core.listFolios', { propertyId, state: 'open' }, url, req),
      ])) as [StayRow[], FolioRow[]]
      const inRange = (value: string) => value >= range.from && value < range.to
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.frontDesk.title'),
        frontDeskScreen(
          _,
          stays,
          {
            arrivals: stays.filter((stay) => stay.state === 'draft' && inRange(stay.checkIn)).length,
            inHouse: stays.filter((stay) => stay.state === 'checked_in').length,
            departures: stays.filter((stay) => stay.state === 'checked_in' && inRange(stay.checkOut)).length,
            openFolios: openFolios.length,
          },
          lang,
          timezone,
          await frame(ctx, url, req),
        ),
      )
    },

  '/admin/hospitality/reservations':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const propertyId = await selectedProperty(ctx, url, req)
      const timezone = await propertyTimezone(ctx, propertyId, url, req)
      const rows = (await ctx.call(
        'hospitality_core.listReservations',
        { propertyId, state: url.searchParams.get('state') || undefined },
        url,
        req,
      )) as ReservationRow[]
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.reservations.title'),
        reservationsScreen(_, rows, lang, timezone, await frame(ctx, url, req)),
      )
    },

  '/admin/hospitality/stays':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const propertyId = await selectedProperty(ctx, url, req)
      const timezone = await propertyTimezone(ctx, propertyId, url, req)
      const rows = (await ctx.call(
        'hospitality_core.listStays',
        { propertyId, state: url.searchParams.get('state') || undefined },
        url,
        req,
      )) as StayRow[]
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.stays.title'),
        staysScreen(_, rows, lang, timezone, await frame(ctx, url, req)),
      )
    },

  '/admin/hospitality/folios':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const propertyId = await selectedProperty(ctx, url, req)
      const timezone = await propertyTimezone(ctx, propertyId, url, req)
      const rows = (await ctx.call(
        'hospitality_core.listFolios',
        { propertyId, state: url.searchParams.get('state') || undefined },
        url,
        req,
      )) as FolioRow[]
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.folios.title'),
        foliosScreen(_, rows, lang, timezone, await frame(ctx, url, req)),
      )
    },

  '/admin/hospitality/tape-chart':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const propertyId = await selectedProperty(ctx, url, req)
      const timezone = await propertyTimezone(ctx, propertyId, url, req)
      const range = calendarRange(url.searchParams.get('from'), 7, timezone)
      const chart = (await ctx.call(
        'hospitality_core.getTapeChart',
        { propertyId: propertyId ?? '__none__', from: range.from, to: range.to },
        url,
        req,
      )) as TapeChart
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.tapeChart.title'),
        tapeChartScreen(_, chart, lang, await frame(ctx, url, req)),
      )
    },

  '/admin/hospitality/properties':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const properties = (await ctx.call('hospitality_core.listProperties', {}, url, req)) as PropertyRow[]
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.properties.title'),
        propertiesScreen(
          _,
          properties,
          {
            rooms: properties.reduce((sum, property) => sum + property.rooms, 0),
            available: properties.reduce((sum, property) => sum + property.availableRooms, 0),
            attention: properties.reduce((sum, property) => sum + property.attentionRooms, 0),
          },
          await frame(ctx, url, req),
        ),
      )
    },

  '/admin/hospitality/rooms':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const selected = url.searchParams.get('property') || undefined
      const rows = (await ctx.call(
        'hospitality_core.listRooms',
        { propertyId: selected },
        url,
        req,
      )) as RoomRow[]
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.rooms.title'),
        roomsScreen(_, rows, await frame(ctx, url, req)),
      )
    },

  '/admin/hospitality/room-types':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const selected = url.searchParams.get('property') || undefined
      const rows = (await ctx.call(
        'hospitality_core.listRoomTypes',
        { propertyId: selected },
        url,
        req,
      )) as RoomTypeRow[]
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.roomTypes.title'),
        roomTypesScreen(_, rows, await frame(ctx, url, req)),
      )
    },

  '/admin/hospitality/rate-plans':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.operation !== 'save-rate-plan') return text('unknown action', { status: 400 })
        const result = (await ctx.call(
          'hospitality_core.saveRatePlan',
          {
            id: randomUUID(),
            propertyId: form.propertyId ?? '',
            roomTypeId: form.roomTypeId ?? '',
            code: form.code ?? '',
            name: form.name ?? '',
            rateType: form.rateType ?? 'nightly',
            amount: form.amount ?? '',
            mealPlan: form.mealPlan || undefined,
            minStay: integer(form.minStay),
            maxStay: integer(form.maxStay),
            isDefault: form.isDefault === '1',
            active: form.active === '1',
          },
          url,
          req,
        )) as { ok?: boolean }
        return redirected(url, result.ok ? 'saved' : 'invalid', { property: form.propertyId })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const properties = (await ctx.call('hospitality_core.listProperties', {}, url, req)) as PropertyRow[]
      const requestedProperty = url.searchParams.get('property')?.trim()
      const propertyId = properties.some((row) => row.id === requestedProperty)
        ? requestedProperty
        : properties[0]?.id
      const [rows, roomTypes] = (await Promise.all([
        ctx.call('hospitality_core.listRatePlans', { propertyId }, url, req),
        ctx.call('hospitality_core.listRoomTypes', { propertyId }, url, req),
      ])) as [RatePlanRow[], RoomTypeRow[]]
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.ratePlans.title'),
        ratePlansScreen(
          _,
          rows,
          properties,
          roomTypes,
          propertyId,
          await frame(ctx, url, req),
          url.searchParams.get('status'),
        ),
      )
    },

  '/admin/hospitality/inventory':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST') {
        const form = await readForm(req)
        let result: { ok?: boolean }
        if (form.operation === 'set-inventory')
          result = (await ctx.call(
            'hospitality_core.setInventoryRange',
            {
              propertyId: form.propertyId ?? '',
              roomTypeId: form.roomTypeId ?? '',
              from: form.from ?? '',
              to: form.to ?? '',
              total: optionalInteger(form.total),
              blocked: optionalInteger(form.blocked),
            },
            url,
            req,
          )) as { ok?: boolean }
        else if (form.operation === 'set-restrictions')
          result = (await ctx.call(
            'hospitality_core.setRestrictionRange',
            {
              propertyId: form.propertyId ?? '',
              roomTypeId: form.roomTypeId ?? '',
              from: form.from ?? '',
              to: form.to ?? '',
              minLos: integer(form.minLos),
              maxLos: integer(form.maxLos),
              stopSell: form.stopSell === '1',
              closedToArrival: form.closedToArrival === '1',
              closedToDeparture: form.closedToDeparture === '1',
            },
            url,
            req,
          )) as { ok?: boolean }
        else return text('unknown action', { status: 400 })
        return redirected(url, result.ok ? 'saved' : 'invalid', {
          property: form.propertyId,
          roomType: form.roomTypeId,
          from: form.from,
          to: form.to,
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const properties = (await ctx.call('hospitality_core.listProperties', {}, url, req)) as PropertyRow[]
      const requestedProperty = url.searchParams.get('property')?.trim()
      const propertyId = properties.some((row) => row.id === requestedProperty)
        ? requestedProperty
        : properties[0]?.id
      const roomTypes = (await ctx.call(
        'hospitality_core.listRoomTypes',
        { propertyId },
        url,
        req,
      )) as RoomTypeRow[]
      const requestedRoomType = url.searchParams.get('roomType')?.trim()
      const roomTypeId = roomTypes.some((row) => row.id === requestedRoomType)
        ? requestedRoomType
        : roomTypes[0]?.id
      const timezone = await propertyTimezone(ctx, propertyId, url, req)
      const today = dateKeyIn(new Date(), timezone)
      const from = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('from') ?? '')
        ? url.searchParams.get('from')!
        : today
      const to = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get('to') ?? '')
        ? url.searchParams.get('to')!
        : addCalendarDays(from, 13)
      const rows = roomTypeId
        ? ((await ctx.call(
            'hospitality_core.listInventory',
            { propertyId, roomTypeId, from, to },
            url,
            req,
          )) as InventoryRow[])
        : []
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.inventory.title'),
        inventoryScreen(
          _,
          rows,
          properties,
          roomTypes,
          { propertyId, roomTypeId, from, to },
          await frame(ctx, url, req),
          url.searchParams.get('status'),
        ),
      )
    },

  '/admin/hospitality/housekeeping':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const propertyId = await selectedProperty(ctx, url, req)
      const rows = (await ctx.call(
        'hospitality_core.listCleaningTasks',
        { propertyId, state: url.searchParams.get('state') || undefined },
        url,
        req,
      )) as CleaningTaskRow[]
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.cleaningTasks.title'),
        cleaningTasksScreen(_, rows, lang, await frame(ctx, url, req)),
      )
    },

  '/admin/hospitality/housekeeping/rooms':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const propertyId = await selectedProperty(ctx, url, req)
      const rows = (await ctx.call('hospitality_core.listRooms', { propertyId }, url, req)) as RoomRow[]
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.housekeepingRooms.title'),
        housekeepingRoomsScreen(_, rows, await frame(ctx, url, req)),
      )
    },

  '/admin/hospitality/amenities':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const rows = (await ctx.call('hospitality_core.listAmenities', {}, url, req)) as AmenityRow[]
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.amenities.title'),
        amenitiesScreen(_, rows, await frame(ctx, url, req)),
      )
    },

  '/admin/hospitality/policies':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const rows = (await ctx.call('hospitality_core.listCancellationPolicies', {}, url, req)) as PolicyRow[]
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.policies.title'),
        policiesScreen(_, rows, await frame(ctx, url, req)),
      )
    },
}
