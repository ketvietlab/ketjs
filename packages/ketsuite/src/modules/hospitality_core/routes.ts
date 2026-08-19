import { page } from 'ketjs'
import type { Route, RouteEntry, ServeContext } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import { viewerOf } from '../backend/routes.ts'
import { amenitiesScreen, policiesScreen, propertiesScreen, roomsScreen, roomTypesScreen } from './screens.ts'
import type { AmenityRow, PolicyRow, PropertyRow, RoomRow, RoomTypeRow } from './screens.ts'

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

export const routes: Record<string, RouteEntry> = {
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
