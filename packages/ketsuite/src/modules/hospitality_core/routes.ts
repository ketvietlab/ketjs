import { randomUUID } from 'node:crypto'
import { text } from 'ketjs'
import type { Route, RouteEntry, ServeContext } from 'ketjs'
import type { TemplateResult } from 'ketjs-view'
import { viewerOf } from '../backend/routes.ts'
import { backendPage } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { receiveAttachment } from '../storage/routes.ts'
import {
  amenitiesScreen,
  cleaningTasksScreen,
  foliosScreen,
  frontDeskScreen,
  housekeepingRoomsScreen,
  policiesScreen,
  propertiesScreen,
  ratePlansScreen,
  reservationDetailScreen,
  reservationsScreen,
  inventoryScreen,
  roomsScreen,
  roomTypesScreen,
  staysScreen,
  tapeChartScreen,
  contentScreen,
  servicesScreen,
  nightAuditScreen,
  stayNoticesScreen,
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
  ReservationDetail,
  ReservationQuote,
  ReservationIntakeValues,
  RoomRow,
  RoomTypeRow,
  StayRow,
  TapeChart,
  ContentImageRow,
  ExtraLineRow,
  PropertyChargeRow,
  ServiceChargeRow,
  ServiceProductRow,
  NightAuditPreview,
  NightAuditRow,
  StayNoticeRow,
} from './screens.ts'
import { addCalendarDays, calendarRange, dateKeyIn, zonedDateTime } from './calendar.ts'
import { STAY_NOTICE_STATES } from './types.ts'

const frame = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => ({
  navigation: req.headers['x-ket-navigation'] === 'fragment-v1',
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
  return backendPage(ctx, req, { lang, title, body })
}

type OperationResult = {
  ok?: boolean
  errors?: Array<{ messageKey?: string; params?: Record<string, unknown> }>
}

const operationErrors = (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  result: OperationResult,
): string[] => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const errors = result.errors ?? []
  return errors.length
    ? errors.map((error) =>
        error.messageKey ? _(error.messageKey, error.params) : _('hospitality_core.feedback.invalidHint'),
      )
    : [_('hospitality_core.feedback.invalidHint')]
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

const renderReservationDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
) => {
  const reservation = (await ctx.call(
    'hospitality_core.getReservation',
    { id },
    url,
    req,
  )) as ReservationDetail | null
  if (!reservation) return text('Not found', { status: 404 })
  if (reservation.stayId) {
    reservation.stay = (await ctx.call(
      'hospitality_core.getStay',
      { id: reservation.stayId },
      url,
      req,
    )) as StayRow | null
  }
  const timezone = await propertyTimezone(ctx, reservation.propertyId, url, req)
  const rooms =
    reservation.state === 'confirmed'
      ? (
          (await ctx.call(
            'hospitality_core.listRooms',
            { propertyId: reservation.propertyId, status: 'available' },
            url,
            req,
          )) as RoomRow[]
        ).filter((room) => room.roomTypeId === reservation.roomTypeId)
      : []
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  return document(
    ctx,
    url,
    req,
    _('hospitality_core.reservation.detail.title', { code: reservation.code }),
    reservationDetailScreen(
      _,
      reservation,
      rooms,
      lang,
      timezone,
      await frame(ctx, url, req),
      url.searchParams.get('status'),
      errors,
    ),
  )
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
  state: 'saved' | 'quoted' | 'queued' | 'refreshed' | 'submitted' | 'confirmed' | 'invalid',
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

const localDateTime = (value: Date, timezone: string): string => {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en', {
      timeZone: timezone,
      hourCycle: 'h23',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(value)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  )
  return `${dateKeyIn(value, timezone)}T${parts.hour}:${parts.minute}`
}

const instantFromLocal = (value: string | undefined, timezone: string): string | null => {
  const matched = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/.exec(String(value ?? ''))
  if (!matched) return null
  const hour = Number(matched[2])
  const minute = Number(matched[3])
  if (hour > 23 || minute > 59) return null
  const instant = zonedDateTime(matched[1]!, hour, minute, timezone)
  if (!Number.isFinite(instant.getTime()) || localDateTime(instant, timezone) !== value) return null
  return instant.toISOString()
}

type ContentSelection = {
  properties: PropertyRow[]
  roomTypes: RoomTypeRow[]
  propertyId: string | undefined
  roomTypeId: string | null
  target: string
}

type ReservationProperty = {
  id: string
  timezone: string
  defaultCheckIn: string
  defaultCheckOut: string
}

const contentSelection = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
): Promise<ContentSelection> => {
  const properties = (await ctx.call('hospitality_core.listProperties', {}, url, req)) as PropertyRow[]
  const requestedProperty = url.searchParams.get('property')?.trim()
  const propertyId = properties.some((row) => row.id === requestedProperty)
    ? requestedProperty
    : properties[0]?.id
  const roomTypes = propertyId
    ? ((await ctx.call('hospitality_core.listRoomTypes', { propertyId }, url, req)) as RoomTypeRow[])
    : []
  const requestedTarget = url.searchParams.get('target')?.trim() || 'property'
  const requestedRoomType = requestedTarget.startsWith('room_type:')
    ? requestedTarget.slice('room_type:'.length)
    : null
  const roomTypeId = roomTypes.some((row) => row.id === requestedRoomType) ? requestedRoomType : null
  return {
    properties,
    roomTypes,
    propertyId,
    roomTypeId,
    target: roomTypeId ? `room_type:${roomTypeId}` : 'property',
  }
}

const contentQuery = (url: URL, selection: ContentSelection): string => {
  const query = new URLSearchParams()
  if (selection.propertyId) query.set('property', selection.propertyId)
  query.set('target', selection.target)
  const lang = url.searchParams.get('lang')?.trim()
  if (lang) query.set('lang', lang)
  return query.toString()
}

const contentRedirect = (url: URL, selection: ContentSelection, status: 'saved' | 'invalid') => {
  const query = new URLSearchParams(contentQuery(url, selection))
  query.set('status', status)
  return seeOther(`/admin/hospitality/content?${query.toString()}`)
}

const contentImages = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  selection: ContentSelection,
): Promise<ContentImageRow[]> => {
  if (!selection.propertyId) return []
  return (await ctx.call(
    'hospitality_core.listContentImages',
    selection.roomTypeId ? { roomTypeId: selection.roomTypeId } : { propertyId: selection.propertyId },
    url,
    req,
  )) as ContentImageRow[]
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
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.operation !== 'quote' && form.operation !== 'create')
          return text('unknown action', { status: 400 })
        const propertyId = form.property?.trim() || ''
        const property = propertyId
          ? ((await ctx.call(
              'hospitality_core.getProperty',
              { id: propertyId },
              url,
              req,
            )) as ReservationProperty | null)
          : null
        const timezone = property?.timezone || 'UTC'
        const checkIn = instantFromLocal(form.checkIn, timezone)
        const checkOut = instantFromLocal(form.checkOut, timezone)
        const values = {
          lang: form.lang,
          property: propertyId,
          preview: '1',
          id: form.id,
          code: form.code,
          partnerId: form.partnerId,
          roomTypeId: form.roomTypeId,
          bookingType: form.bookingType,
          checkIn: form.checkIn,
          checkOut: form.checkOut,
          adults: form.adults,
          children: form.children,
          rate: form.rate,
        }
        if (!property || !checkIn || !checkOut || !form.partnerId) return redirected(url, 'invalid', values)

        if (form.operation === 'quote') {
          const result = (await ctx.call(
            'hospitality_core.quoteReservation',
            {
              propertyId,
              roomTypeId: form.roomTypeId ?? '',
              bookingType: form.bookingType ?? 'nightly',
              checkIn,
              checkOut,
              adults: integer(form.adults, 1),
              children: integer(form.children),
              rate: form.rate || undefined,
            },
            url,
            req,
          )) as ReservationQuote
          return redirected(url, result.ok ? 'quoted' : 'invalid', values)
        }

        const result = (await ctx.call(
          'hospitality_core.createReservation',
          {
            id: form.id ?? '',
            code: form.code || undefined,
            propertyId,
            partnerId: form.partnerId,
            roomTypeId: form.roomTypeId ?? '',
            provider: 'direct',
            bookingType: form.bookingType ?? 'nightly',
            checkIn,
            checkOut,
            adults: integer(form.adults, 1),
            children: integer(form.children),
            rate: form.rate || undefined,
          },
          url,
          req,
        )) as { ok?: boolean }
        return result.ok
          ? redirected(url, 'saved', { lang: form.lang, property: propertyId })
          : redirected(url, 'invalid', values)
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const properties = (await ctx.call('hospitality_core.listProperties', {}, url, req)) as PropertyRow[]
      const requestedProperty = url.searchParams.get('property')?.trim()
      const propertyId = properties.find((row) => row.id === requestedProperty)?.id ?? properties[0]?.id ?? ''
      const property = propertyId
        ? ((await ctx.call(
            'hospitality_core.getProperty',
            { id: propertyId },
            url,
            req,
          )) as ReservationProperty | null)
        : null
      const timezone = property?.timezone || 'UTC'
      const today = dateKeyIn(new Date(), timezone)
      const checkInClock = /^(\d{2}):(\d{2})$/.exec(property?.defaultCheckIn ?? '')
      const checkOutClock = /^(\d{2}):(\d{2})$/.exec(property?.defaultCheckOut ?? '')
      const defaultCheckIn = zonedDateTime(
        today,
        Number(checkInClock?.[1] ?? 14),
        Number(checkInClock?.[2] ?? 0),
        timezone,
      )
      const defaultCheckOut = zonedDateTime(
        addCalendarDays(today, 1),
        Number(checkOutClock?.[1] ?? 12),
        Number(checkOutClock?.[2] ?? 0),
        timezone,
      )
      const [rows, roomTypes, partners] = (await Promise.all([
        ctx.call(
          'hospitality_core.listReservations',
          { propertyId: propertyId || undefined, state: url.searchParams.get('state') || undefined },
          url,
          req,
        ),
        propertyId
          ? ctx.call('hospitality_core.listRoomTypes', { propertyId }, url, req)
          : Promise.resolve([]),
        ctx.call('partner.listPartners', { kind: 'person', limit: 500 }, url, req),
      ])) as [ReservationRow[], RoomTypeRow[], Array<{ id: string; name: string; ref?: string }>]
      const reservationId = url.searchParams.get('id')?.trim() || randomUUID()
      const values: ReservationIntakeValues = {
        id: reservationId,
        code: url.searchParams.get('code')?.trim() || `R-${reservationId.slice(0, 8).toUpperCase()}`,
        propertyId,
        roomTypeId:
          roomTypes.find((row) => row.id === url.searchParams.get('roomTypeId'))?.id ??
          roomTypes[0]?.id ??
          '',
        partnerId:
          partners.find((row) => row.id === url.searchParams.get('partnerId'))?.id ?? partners[0]?.id ?? '',
        bookingType: ['nightly', 'weekly', 'monthly'].includes(url.searchParams.get('bookingType') ?? '')
          ? url.searchParams.get('bookingType')!
          : 'nightly',
        checkIn: url.searchParams.get('checkIn') || localDateTime(defaultCheckIn, timezone),
        checkOut: url.searchParams.get('checkOut') || localDateTime(defaultCheckOut, timezone),
        adults: Math.max(1, integer(url.searchParams.get('adults') ?? undefined, 1)),
        children: Math.max(0, integer(url.searchParams.get('children') ?? undefined)),
        rate: url.searchParams.get('rate')?.trim() || '',
      }
      let quote: ReservationQuote | null = null
      if (url.searchParams.get('preview') === '1') {
        const checkIn = instantFromLocal(values.checkIn, timezone)
        const checkOut = instantFromLocal(values.checkOut, timezone)
        quote =
          checkIn && checkOut
            ? ((await ctx.call(
                'hospitality_core.quoteReservation',
                {
                  propertyId,
                  roomTypeId: values.roomTypeId,
                  bookingType: values.bookingType,
                  checkIn,
                  checkOut,
                  adults: values.adults,
                  children: values.children,
                  rate: values.rate || undefined,
                },
                url,
                req,
              )) as ReservationQuote)
            : {
                ok: false,
                errors: [{ messageKey: 'hospitality_core.validation.datetime' }],
              }
      }
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.reservations.title'),
        reservationsScreen(
          _,
          { rows, properties, roomTypes, partners, values, quote },
          lang,
          timezone,
          await frame(ctx, url, req),
          url.searchParams.get('status'),
        ),
      )
    },

  '/admin/hospitality/reservations/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return renderReservationDetail(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const form = await readForm(req)
      const reservation = (await ctx.call(
        'hospitality_core.getReservation',
        { id: params.id },
        url,
        req,
      )) as ReservationDetail | null
      if (!reservation) return text('Not found', { status: 404 })

      let result: OperationResult
      let status: 'checked-in' | 'checked-out' | 'cancelled'
      if (form.operation === 'check-in') {
        if (!reservation.stayId || !form.roomId)
          return renderReservationDetail(ctx, url, req, params.id, [
            ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.no_available_room'),
          ])
        result = (await ctx.call(
          'hospitality_core.checkIn',
          { stayId: reservation.stayId, roomId: form.roomId, assignmentId: randomUUID() },
          url,
          req,
        )) as OperationResult
        status = 'checked-in'
      } else if (form.operation === 'check-out') {
        if (!reservation.stayId)
          return renderReservationDetail(ctx, url, req, params.id, [
            ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.stay_missing'),
          ])
        result = (await ctx.call(
          'hospitality_core.checkOut',
          { stayId: reservation.stayId },
          url,
          req,
        )) as OperationResult
        status = 'checked-out'
      } else if (form.operation === 'cancel') {
        result = (await ctx.call(
          'hospitality_core.cancelReservation',
          { id: reservation.id, reason: form.reason?.trim() || undefined },
          url,
          req,
        )) as OperationResult
        status = 'cancelled'
      } else return text('unknown action', { status: 400 })

      if (!result.ok)
        return renderReservationDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result))
      const query = new URLSearchParams()
      query.set('status', status)
      const lang = url.searchParams.get('lang')?.trim() || form.lang?.trim()
      if (lang) query.set('lang', lang)
      return seeOther(`${url.pathname}?${query.toString()}`)
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

  '/admin/hospitality/services':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST') {
        const form = await readForm(req)
        let result: { ok?: boolean }
        if (form.operation === 'save-property-charge')
          result = (await ctx.call(
            'hospitality_core.savePropertyCharge',
            {
              id: form.id ?? '',
              propertyId: form.propertyId ?? '',
              chargeType: form.chargeType ?? '',
              name: form.name ?? '',
              amount: form.amount ?? '',
              description: form.description || undefined,
              active: form.active === '1',
            },
            url,
            req,
          )) as { ok?: boolean }
        else if (form.operation === 'save-extra-line') {
          const target = form.target ?? ''
          const separator = target.indexOf(':')
          const targetType = separator > 0 ? target.slice(0, separator) : ''
          const targetId = separator > 0 ? target.slice(separator + 1) : ''
          result = (await ctx.call(
            'hospitality_core.saveExtraLine',
            {
              id: form.id ?? '',
              ...(targetType === 'reservation' ? { reservationId: targetId } : {}),
              ...(targetType === 'stay' ? { stayId: targetId } : {}),
              productId: form.productId ?? '',
              description: form.description || undefined,
              quantity: form.quantity || undefined,
              unitPrice: form.unitPrice || undefined,
              recurrence: form.recurrence || undefined,
              active: form.active === '1',
            },
            url,
            req,
          )) as { ok?: boolean }
        } else if (form.operation === 'materialize-extra')
          result = (await ctx.call(
            'hospitality_core.materializeExtraLine',
            {
              id: form.id ?? '',
              serviceDate: form.serviceDate || undefined,
              quantity: form.quantity || undefined,
              requestKey: form.requestKey || undefined,
            },
            url,
            req,
          )) as { ok?: boolean }
        else return text('unknown action', { status: 400 })
        return redirected(url, result.ok ? 'saved' : 'invalid', {
          property: form.propertyId || url.searchParams.get('property') || undefined,
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
      const [propertyCharges, extraLines, charges, products, reservations, stays] = (await Promise.all([
        ctx.call('hospitality_core.listPropertyCharges', { propertyId }, url, req),
        ctx.call('hospitality_core.listExtraLines', { propertyId }, url, req),
        ctx.call('hospitality_core.listServiceCharges', { propertyId }, url, req),
        ctx.call('hospitality_core.listServiceProducts', {}, url, req),
        ctx.call('hospitality_core.listReservations', { propertyId }, url, req),
        ctx.call('hospitality_core.listStays', { propertyId }, url, req),
      ])) as [
        PropertyChargeRow[],
        ExtraLineRow[],
        ServiceChargeRow[],
        ServiceProductRow[],
        ReservationRow[],
        StayRow[],
      ]
      const targets = [
        ...reservations
          .filter((row) => row.state === 'draft' || row.state === 'confirmed')
          .map((row) => ({
            id: row.id,
            code: row.code,
            name: row.partner?.name ?? row.partnerId,
            type: 'reservation' as const,
          })),
        ...stays
          .filter((row) => row.state === 'checked_in')
          .map((row) => ({
            id: row.id,
            code: row.code,
            name: row.partner?.name ?? row.partnerId,
            type: 'stay' as const,
          })),
      ]
      const timezone = await propertyTimezone(ctx, propertyId, url, req)
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.services.title'),
        servicesScreen(
          _,
          {
            properties,
            propertyId,
            products,
            targets,
            propertyCharges,
            extraLines,
            charges,
            ids: { propertyCharge: randomUUID(), extraLine: randomUUID(), requestKey: randomUUID() },
          },
          lang,
          timezone,
          await frame(ctx, url, req),
          url.searchParams.get('status'),
        ),
      )
    },

  '/admin/hospitality/night-audit':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.operation !== 'request-night-audit') return text('unknown action', { status: 400 })
        const result = (await ctx.call(
          'hospitality_core.requestNightAudit',
          { propertyId: form.propertyId ?? '', auditDate: form.auditDate ?? '' },
          url,
          req,
        )) as { ok?: boolean }
        return redirected(url, result.ok ? 'queued' : 'invalid', {
          property: form.propertyId,
          auditDate: form.auditDate,
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
      const timezone = await propertyTimezone(ctx, propertyId, url, req)
      const today = dateKeyIn(new Date(), timezone)
      const requestedDate = url.searchParams.get('auditDate')?.trim()
      const auditDate =
        /^\d{4}-\d{2}-\d{2}$/u.test(requestedDate ?? '') && requestedDate! <= today ? requestedDate! : today
      const [preview, runs] = propertyId
        ? ((await Promise.all([
            ctx.call('hospitality_core.previewNightAudit', { propertyId, auditDate }, url, req),
            ctx.call('hospitality_core.listNightAudits', { propertyId, limit: 30 }, url, req),
          ])) as [NightAuditPreview, NightAuditRow[]])
        : [undefined, []]
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.nightAudit.title'),
        nightAuditScreen(
          _,
          { properties, propertyId, auditDate, today, preview, runs },
          lang,
          await frame(ctx, url, req),
          url.searchParams.get('status'),
        ),
      )
    },

  '/admin/hospitality/stay-notices':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST') {
        const form = await readForm(req)
        let result: { ok?: boolean } = { ok: false }
        let state: 'refreshed' | 'submitted' | 'confirmed' = 'refreshed'
        if (form.operation === 'refresh') {
          result = (await ctx.call(
            'hospitality_core.requestStayNoticeRefresh',
            { stayId: form.stayId ?? '' },
            url,
            req,
          )) as { ok?: boolean }
        } else if (form.operation === 'record-submission') {
          state = 'submitted'
          result = (await ctx.call(
            'hospitality_core.recordStayNoticeSubmission',
            {
              id: form.id ?? '',
              reason: form.reason ?? '',
              channel: form.channel ?? '',
              evidenceRef: form.evidenceRef ?? '',
            },
            url,
            req,
          )) as { ok?: boolean }
        } else if (form.operation === 'confirm') {
          state = 'confirmed'
          result = (await ctx.call(
            'hospitality_core.confirmStayNotice',
            { id: form.id ?? '', receiptRef: form.receiptRef ?? '' },
            url,
            req,
          )) as { ok?: boolean }
        } else return text('unknown action', { status: 400 })
        return redirected(url, result.ok ? state : 'invalid', {
          property: form.property,
          state: form.state === 'all' ? undefined : form.state,
          notice: form.id,
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
      const requestedState = url.searchParams.get('state')?.trim()
      const state = STAY_NOTICE_STATES.includes(requestedState as (typeof STAY_NOTICE_STATES)[number])
        ? requestedState!
        : 'all'
      const rows = propertyId
        ? ((await ctx.call(
            'hospitality_core.listStayNotices',
            { propertyId, limit: 500 },
            url,
            req,
          )) as StayNoticeRow[])
        : []
      const selectedId = url.searchParams.get('notice')?.trim()
      const selected = rows.find((row) => row.id === selectedId)
      const timezone = await propertyTimezone(ctx, propertyId, url, req)
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.stayNotices.title'),
        stayNoticesScreen(
          _,
          { properties, propertyId, state, rows, selected },
          lang,
          timezone,
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

  '/admin/hospitality/content':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const selection = await contentSelection(ctx, url, req)
      const images = await contentImages(ctx, url, req, selection)
      const property = selection.propertyId
        ? ((await ctx.call('hospitality_core.getProperty', { id: selection.propertyId }, url, req)) as Record<
            string,
            unknown
          > | null)
        : null
      const roomType = selection.roomTypes.find((row) => row.id === selection.roomTypeId)
      const checks = selection.roomTypeId
        ? [
            Boolean(roomType?.publicName || roomType?.name),
            Boolean(roomType?.description),
            Number(roomType?.defaultCapacity ?? 0) > 0,
            Number(roomType?.maxAdults ?? 0) > 0,
            images.length > 0,
          ]
        : [
            Boolean(property?.publicName || property?.name),
            Boolean(property?.addressLine),
            Boolean(property?.description),
            Number(property?.starRating ?? 0) > 0,
            images.length > 0,
          ]
      const completed = checks.filter(Boolean).length
      return document(
        ctx,
        url,
        req,
        _('hospitality_core.screen.content.title'),
        contentScreen(
          _,
          selection.properties,
          selection.roomTypes,
          selection.propertyId,
          selection.target,
          images,
          {
            completed,
            total: checks.length,
            percent: checks.length ? Math.round((completed / checks.length) * 100) : 0,
          },
          lang,
          contentQuery(url, selection),
          await frame(ctx, url, req),
          url.searchParams.get('status'),
        ),
      )
    },

  '/admin/hospitality/content/upload':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'POST') return text('POST multipart/form-data', { status: 405 })
      const selection = await contentSelection(ctx, url, req)
      if (!selection.propertyId) return text('Property not found', { status: 404 })
      const resourceId = selection.roomTypeId ?? selection.propertyId
      const attachment = await receiveAttachment(ctx, url, req, {
        resModel: selection.roomTypeId ? 'hospitality_core.RoomType' : 'hospitality_core.Property',
        resId: resourceId,
        resField: 'contentImages',
        public: true,
      })
      try {
        await ctx.call(
          'hospitality_core.attachContentImage',
          {
            id: attachment.id,
            attachmentId: attachment.id,
            ...(selection.roomTypeId
              ? { roomTypeId: selection.roomTypeId }
              : { propertyId: selection.propertyId }),
            category: selection.roomTypeId ? 'room' : 'exterior',
            caption: attachment.name,
          },
          url,
          req,
        )
      } catch (error) {
        await ctx.call('storage.removeAttachment', { id: attachment.id }, url, req).catch(() => undefined)
        await ctx.call('storage.requestSweep', { minAgeMs: 0 }, url, req).catch(() => undefined)
        throw error
      }
      return contentRedirect(url, selection, 'saved')
    },

  '/admin/hospitality/content/images/{id}/metadata':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const selection = await contentSelection(ctx, url, req)
      const images = await contentImages(ctx, url, req, selection)
      if (!images.some((image) => image.id === params.id)) return text('Image not found', { status: 404 })
      const form = await readForm(req)
      try {
        await ctx.call(
          'hospitality_core.updateContentImage',
          { id: params.id, category: form.category ?? '', caption: form.caption || undefined },
          url,
          req,
        )
        return contentRedirect(url, selection, 'saved')
      } catch (error) {
        if ((error as { code?: string }).code === 'E_HOSPITALITY_CONTENT_INVALID')
          return contentRedirect(url, selection, 'invalid')
        throw error
      }
    },

  '/admin/hospitality/content/images/{id}/primary':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const selection = await contentSelection(ctx, url, req)
      const images = await contentImages(ctx, url, req, selection)
      if (!images.some((image) => image.id === params.id)) return text('Image not found', { status: 404 })
      await ctx.call('hospitality_core.setPrimaryContentImage', { id: params.id }, url, req)
      return contentRedirect(url, selection, 'saved')
    },

  '/admin/hospitality/content/images/{id}/remove':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const selection = await contentSelection(ctx, url, req)
      const images = await contentImages(ctx, url, req, selection)
      if (!images.some((image) => image.id === params.id)) return text('Image not found', { status: 404 })
      await ctx.call('hospitality_core.removeContentImage', { id: params.id }, url, req)
      return contentRedirect(url, selection, 'saved')
    },

  '/admin/hospitality/content/images/{id}/move-up':
    (ctx: ServeContext): Route =>
    async (url, req, params) =>
      moveContentImage(ctx, url, req, params.id, -1),

  '/admin/hospitality/content/images/{id}/move-down':
    (ctx: ServeContext): Route =>
    async (url, req, params) =>
      moveContentImage(ctx, url, req, params.id, 1),

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

const moveContentImage = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  imageId: string,
  delta: number,
) => {
  if (req.method !== 'POST') return text('POST', { status: 405 })
  const selection = await contentSelection(ctx, url, req)
  const images = await contentImages(ctx, url, req, selection)
  const index = images.findIndex((image) => image.id === imageId)
  if (index < 0) return text('Image not found', { status: 404 })
  const destination = index + delta
  if (destination >= 0 && destination < images.length) {
    const ids = images.map((image) => image.id)
    ;[ids[index], ids[destination]] = [ids[destination]!, ids[index]!]
    await ctx.call(
      'hospitality_core.reorderContentImages',
      {
        ...(selection.roomTypeId
          ? { roomTypeId: selection.roomTypeId }
          : { propertyId: selection.propertyId }),
        ids,
      },
      url,
      req,
    )
  }
  return contentRedirect(url, selection, 'saved')
}
