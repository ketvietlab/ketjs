import type { Route, ServeContext } from '@ketvietlab/ketjs'
import { channelError, defineChannelRoute, readJson, routesOf, sha256 } from '../channel_api/core.ts'
import { customerIdentity } from '../channel_api/customer.ts'

type Req = Parameters<Route>[1]
type Issue = { field?: string; code?: string; messageKey?: string; params?: Record<string, unknown> }
type Link = { propertyId: string; slug: string }
const object = { type: 'object' }
const envelope = { type: 'object', properties: { data: {}, error: {}, meta: object } }
const positive = (value: string | null, fallback: number, maximum: number): number => {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? Math.min(number, maximum) : fallback
}
const offsetOf = (cursor: string | null): number => {
  if (!cursor) return 0
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: unknown }
    return Number.isInteger(parsed.offset) && Number(parsed.offset) >= 0 ? Number(parsed.offset) : 0
  } catch {
    return 0
  }
}
const cursorOf = (offset: number): string => Buffer.from(JSON.stringify({ offset })).toString('base64url')
const linksFor = async (ctx: ServeContext, url: URL, req: Req, siteId: string | null): Promise<Link[]> =>
  siteId
    ? ((await ctx.callUnchecked('website_hospitality.listChannelProperties', { siteId }, url, req)) as Link[])
    : []
const media = (image: unknown) => {
  if (!image || typeof image !== 'object') return null
  const held = image as Record<string, unknown>
  return {
    url: held.attachmentId ? `/files/${encodeURIComponent(String(held.attachmentId))}` : null,
    category: held.category ?? null,
    caption: held.caption ?? null,
  }
}
const propertyView = (property: Record<string, unknown>, slug: string) => ({
  id: String(property.id),
  slug,
  code: property.code,
  name: property.publicName ?? property.name,
  accommodationType: property.accommodationType,
  timezone: property.timezone,
  starRating: property.starRating,
  address: {
    line: property.addressLine ?? null,
    locality: property.locality ?? null,
    countryCode: property.countryCode ?? null,
    latitude: property.latitude ?? null,
    longitude: property.longitude ?? null,
  },
  description: property.description ?? null,
  houseRules: property.houseRules ?? null,
  childrenStayFree: property.childrenStayFree,
  minimumGuestAge: property.minimumGuestAge ?? null,
  primaryImage: media(property.primaryImage),
  amenities: property.amenities ?? [],
})
const roomTypeView = (room: Record<string, unknown>) => ({
  id: String(room.id),
  propertyId: String(room.propertyId),
  code: room.code,
  name: room.publicName ?? room.name,
  description: room.description ?? null,
  capacity: {
    default: room.defaultCapacity,
    adults: room.maxAdults,
    children: room.maxChildren,
    infants: room.maxInfants,
    extraBeds: room.maxExtraBeds,
  },
  sizeSqm: room.sizeSqm ?? null,
  viewType: room.viewType ?? null,
  sharedBathroom: room.sharedBathroom,
  baseRate: String(room.baseRate),
  primaryImage: media(room.primaryImage),
  images: Array.isArray(room.images) ? room.images.map(media) : [],
  amenities: room.amenities ?? [],
  beds: room.beds ?? [],
})
const domainFailure = (ctx: ServeContext, url: URL, req: Req, result: unknown, status = 422) => {
  const issues = Array.isArray((result as { errors?: unknown })?.errors)
    ? ((result as { errors: Issue[] }).errors ?? [])
    : []
  const first = issues[0] ?? {}
  const messageKey = first.messageKey ?? 'channel_api.error.internal'
  const code = first.code ? `hospitality_core.${first.code}` : 'hospitality_core.invalidRequest'
  return {
    status,
    error: channelError(ctx, url, req, code, {
      messageKey,
      params: first.params ?? {},
      fieldErrors: Object.fromEntries(
        issues
          .filter((issue) => issue.field)
          .map((issue) => [
            String(issue.field),
            {
              code: issue.code ? `hospitality_core.${issue.code}` : code,
              messageKey: issue.messageKey ?? messageKey,
              params: issue.params ?? {},
            },
          ]),
      ),
    }),
  }
}
const contextOf = async (ctx: ServeContext, url: URL, req: Req) => {
  const identity = await customerIdentity(ctx, url, req)
  if (identity?.siteId) return { siteId: identity.siteId, identity }
  const bootstrap = (await ctx.callUnchecked(
    'website.resolveSite',
    { host: String(req.headers.host ?? '').split(':')[0] },
    url,
    req,
  )) as {
    id?: string
  } | null
  return { siteId: bootstrap?.id ? String(bootstrap.id) : null, identity }
}
const missing = (ctx: ServeContext, url: URL, req: Req) => ({
  status: 404,
  error: channelError(ctx, url, req, 'hospitality_core.propertyNotFound', {
    messageKey: 'hospitality_core.error.propertyNotFound',
  }),
})

export const channelRoutes = routesOf(
  defineChannelRoute({
    profile: 'customer',
    method: 'GET',
    path: 'hospitality/properties',
    operationId: 'customer.hospitality.properties.list',
    summary: 'List the properties published by the resolved customer site.',
    capability: { key: 'website_hospitality.properties', action: 'read' },
    responses: { '200': envelope },
    handler: async (ctx, url, req) => {
      const { siteId } = await contextOf(ctx, url, req)
      const links = await linksFor(ctx, url, req, siteId)
      const limit = positive(url.searchParams.get('limit'), 24, 100)
      const offset = offsetOf(url.searchParams.get('cursor'))
      const selected = links.slice(offset, offset + limit)
      const properties = selected.length
        ? ((await ctx.callUnchecked(
            'hospitality_core.listPropertyCatalog',
            { propertyIds: selected.map((link) => link.propertyId), active: true, limit, offset: 0 },
            url,
            req,
          )) as Array<Record<string, unknown>>)
        : []
      const slugs = new Map(selected.map((link) => [link.propertyId, link.slug]))
      return {
        data: properties.map((property) =>
          propertyView(property, slugs.get(String(property.id)) ?? String(property.id)),
        ),
        nextCursor: offset + limit < links.length ? cursorOf(offset + limit) : null,
      }
    },
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'GET',
    path: 'hospitality/properties/{slug}',
    operationId: 'customer.hospitality.properties.get',
    capability: { key: 'website_hospitality.properties', action: 'read' },
    request: { params: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] } },
    responses: { '200': envelope },
    handler: async (ctx, url, req, params) => {
      const { siteId } = await contextOf(ctx, url, req)
      const link = (await linksFor(ctx, url, req, siteId)).find((item) => item.slug === params.slug)
      if (!link) return missing(ctx, url, req)
      const property = (await ctx.callUnchecked(
        'hospitality_core.getPropertyCatalog',
        { id: link.propertyId },
        url,
        req,
      )) as Record<string, unknown> | null
      return property ? { data: propertyView(property, link.slug) } : missing(ctx, url, req)
    },
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'GET',
    path: 'hospitality/properties/{id}/room-types',
    operationId: 'customer.hospitality.room_types.list',
    capability: { key: 'website_hospitality.room_types', action: 'read' },
    responses: { '200': envelope },
    handler: async (ctx, url, req, params) => {
      const { siteId } = await contextOf(ctx, url, req)
      if (!(await linksFor(ctx, url, req, siteId)).some((link) => link.propertyId === params.id))
        return missing(ctx, url, req)
      const rooms = (await ctx.callUnchecked(
        'hospitality_core.listRoomTypeCatalog',
        {
          propertyId: params.id,
          active: true,
          published: true,
          limit: positive(url.searchParams.get('limit'), 50, 100),
          offset: 0,
        },
        url,
        req,
      )) as Array<Record<string, unknown>>
      return { data: rooms.map(roomTypeView) }
    },
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'POST',
    path: 'hospitality/availability/search',
    operationId: 'customer.hospitality.availability.search',
    capability: { key: 'website_hospitality.availability', action: 'read' },
    request: { body: object },
    responses: { '200': envelope },
    handler: async (ctx, url, req) => {
      const body = await readJson(req)
      const { siteId } = await contextOf(ctx, url, req)
      if (!(await linksFor(ctx, url, req, siteId)).some((link) => link.propertyId === body.propertyId))
        return missing(ctx, url, req)
      const result = (await ctx.callUnchecked(
        'hospitality_core.quoteAvailability',
        {
          propertyId: body.propertyId,
          roomTypeId: body.roomTypeId || null,
          checkIn: body.checkIn,
          checkOut: body.checkOut,
          adults: body.adults,
          children: body.children ?? null,
          infants: body.infants ?? null,
          quantity: body.quantity ?? null,
          ratePlanId: body.ratePlanId || null,
        },
        url,
        req,
      )) as { ok?: boolean }
      return result.ok ? { data: result } : domainFailure(ctx, url, req, result)
    },
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'POST',
    path: 'hospitality/bookings',
    operationId: 'customer.hospitality.bookings.create',
    auth: 'customer',
    capability: { key: 'website_hospitality.bookings', action: 'create' },
    request: { body: object },
    responses: { '201': envelope },
    idempotent: true,
    handler: async (ctx, url, req) => {
      const identity = await customerIdentity(ctx, url, req)
      if (!identity)
        return {
          status: 401,
          error: channelError(ctx, url, req, 'channel_api.unauthenticated', {
            messageKey: 'channel_api.error.unauthenticated',
          }),
        }
      const key = String(req.headers['idempotency-key'] ?? '').trim()
      if (!key)
        return {
          status: 400,
          error: channelError(ctx, url, req, 'channel_api.idempotencyRequired', {
            messageKey: 'channel_api.error.idempotencyRequired',
          }),
        }
      const body = await readJson(req)
      if (
        !(await linksFor(ctx, url, req, identity.siteId)).some((link) => link.propertyId === body.propertyId)
      )
        return missing(ctx, url, req)
      const id = `channel_${sha256(`${identity.realmId}\n${identity.accountId}\n${key}`).slice(0, 32)}`
      const input = {
        id,
        requestKey: key,
        propertyId: body.propertyId,
        roomTypeId: body.roomTypeId,
        ratePlanId: body.ratePlanId || null,
        partnerId: identity.account.partnerId,
        checkIn: body.checkIn,
        checkOut: body.checkOut,
        adults: body.adults,
        children: body.children ?? null,
        infants: body.infants ?? null,
        quantity: body.quantity ?? null,
        channelRef: `customer:${identity.accountId}`,
      }
      const result = (await ctx.callUnchecked('hospitality_core.createOnlineReservation', input, url, req, {
        idempotencyKey: key,
        idempotencyNamespace: `customer:${identity.realmId}:${identity.accountId}:hospitality-booking`,
      })) as { ok?: boolean }
      return result.ok ? { status: 201, data: result } : domainFailure(ctx, url, req, result, 409)
    },
  }),
  defineChannelRoute({
    profile: 'customer',
    method: 'GET',
    path: 'hospitality/bookings/{id}',
    operationId: 'customer.hospitality.bookings.get',
    auth: 'customer',
    capability: { key: 'website_hospitality.bookings', action: 'read' },
    responses: { '200': envelope },
    handler: async (ctx, url, req, params) => {
      const identity = await customerIdentity(ctx, url, req)
      if (!identity)
        return {
          status: 401,
          error: channelError(ctx, url, req, 'channel_api.unauthenticated', {
            messageKey: 'channel_api.error.unauthenticated',
          }),
        }
      const result = (await ctx.callUnchecked(
        'hospitality_core.getPartnerReservation',
        { id: params.id, partnerId: identity.account.partnerId },
        url,
        req,
      )) as { ok?: boolean }
      return result.ok ? { data: result } : domainFailure(ctx, url, req, result, 404)
    },
  }),
)
