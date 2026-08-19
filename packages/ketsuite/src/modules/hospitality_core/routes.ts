import { page } from 'ketjs'
import type { Route, RouteEntry, ServeContext } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import { viewerOf } from '../backend/routes.ts'
import {
  amenitiesScreen,
  foliosScreen,
  frontDeskScreen,
  policiesScreen,
  propertiesScreen,
  reservationsScreen,
  roomsScreen,
  roomTypesScreen,
  staysScreen,
  tapeChartScreen,
} from './screens.ts'
import type {
  AmenityRow,
  FolioRow,
  PolicyRow,
  PropertyRow,
  ReservationRow,
  RoomRow,
  RoomTypeRow,
  StayRow,
  TapeChart,
} from './screens.ts'
import { calendarRange } from './calendar.ts'

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
