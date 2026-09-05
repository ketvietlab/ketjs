import { randomUUID } from 'node:crypto'
import { dateTimeFormatter, text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext, Translator } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { receiveAttachment } from '../storage/routes.ts'
import {
  amenitiesScreen,
  buildingDetailScreen,
  cleaningTaskDetailScreen,
  cleaningTasksScreen,
  folioDetailScreen,
  foliosScreen,
  floorDetailScreen,
  frontDeskScreen,
  housekeepingRoomDetailScreen,
  housekeepingRoomsScreen,
  newPropertyScreen,
  newRoomScreen,
  newRoomTypeScreen,
  policiesScreen,
  propertiesScreen,
  propertyDetailScreen,
  ratePlansScreen,
  type CheckOutReadiness,
  checkOutPrepScreen,
  reservationDetailScreen,
  reservationsScreen,
  inventoryScreen,
  roomsScreen,
  roomDetailScreen,
  roomTypeDetailScreen,
  roomTypesScreen,
  stayDetailScreen,
  staysScreen,
  tapeChartScreen,
  contentScreen,
  servicesScreen,
  nightAuditScreen,
  stayNoticesScreen,
} from './screens/index.ts'
import type {
  AmenityRow,
  BuildingDetail,
  BuildingFormValues,
  BuildingRow,
  BranchChoice,
  CleaningTaskSummary,
  CleaningTaskRow,
  FolioRow,
  GuestDocumentRow,
  FloorRow,
  FloorDetail,
  FloorFormValues,
  PolicyRow,
  PropertyDetail,
  PropertyFormValues,
  PropertyRow,
  RatePlanRow,
  InventoryRow,
  ReservationRow,
  ReservationDetail,
  ReservationQuote,
  ReservationIntakeValues,
  ReservationAmendmentValues,
  RoomRow,
  RoomDetail,
  RoomFormValues,
  RoomStatusSummary,
  RoomTypeDetail,
  RoomTypeFormValues,
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
} from './screens/index.ts'
import { addCalendarDays, calendarRange, dateKeyIn, zonedDateTime } from './calendar.ts'
import { CLEANING_TASK_STATES, ROOM_STATUSES, STAY_NOTICE_STATES } from './types.ts'
import { adminPage } from '../backend/screen.ts'

type OperationResult = {
  ok?: boolean
  inventoryReleased?: number
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
  attempted?: Partial<ReservationAmendmentValues>,
  attemptedDeparture?: string,
) => {
  const reservation = (await ctx.call(
    'hospitality_core.getReservation',
    { id },
    url,
    req,
  )) as ReservationDetail | null
  if (!reservation) return text('Not found', { status: 404 })
  if (url.searchParams.get('action') === 'check-out' && reservation.stayId)
    return renderCheckOutPrep(ctx, url, req, reservation, errors)
  const permissions = {
    amend: await ctx.allows('hospitality_core.amendReservation', url, req),
    checkIn: await ctx.allows('hospitality_core.checkIn', url, req),
    holdRoom: await ctx.allows('hospitality_core.holdRoom', url, req),
    adjustDeparture: await ctx.allows('hospitality_core.adjustStayDeparture', url, req),
    checkOut: await ctx.allows('hospitality_core.checkOut', url, req),
    cancel: await ctx.allows('hospitality_core.cancelReservation', url, req),
    noShow: await ctx.allows('hospitality_core.markNoShow', url, req),
    readStay: await ctx.allows('hospitality_core.getStay', url, req),
  }
  if (reservation.stayId && permissions.readStay) {
    reservation.stay = (await ctx.call(
      'hospitality_core.getStay',
      { id: reservation.stayId },
      url,
      req,
    )) as StayRow | null
  }
  const timezone = await propertyTimezone(ctx, reservation.propertyId, url, req)
  const [allRooms, roomTypes, partners] = (await Promise.all([
    reservation.state === 'confirmed' && permissions.checkIn
      ? ctx.call(
          'hospitality_core.listRooms',
          { propertyId: reservation.propertyId, status: 'available' },
          url,
          req,
        )
      : Promise.resolve([]),
    ctx.call('hospitality_core.listRoomTypes', { propertyId: reservation.propertyId }, url, req),
    ctx.call('partner.listPartners', { kind: 'person', limit: 500 }, url, req),
  ])) as [RoomRow[], Array<{ id: string; code: string; name: string }>, Array<{ id: string; name: string }>]
  const rooms = allRooms.filter((room) => room.roomTypeId === reservation.roomTypeId)
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  const amendment: ReservationAmendmentValues = {
    partnerId: attempted?.partnerId ?? reservation.partnerId,
    roomTypeId: attempted?.roomTypeId ?? reservation.roomTypeId,
    checkIn: attempted?.checkIn ?? localDateTime(new Date(reservation.checkIn), timezone),
    checkOut: attempted?.checkOut ?? localDateTime(new Date(reservation.checkOut), timezone),
    adults: attempted?.adults ?? reservation.adults,
    children: attempted?.children ?? reservation.children,
    rate: attempted?.rate ?? String(reservation.rate),
  }
  return adminPage(ctx, url, req, {
    title: _('hospitality_core.reservation.detail.title', { code: reservation.code }),
    translate: false,
    body: (_, frame) =>
      reservationDetailScreen(
        _,
        reservation,
        rooms,
        roomTypes,
        partners,
        amendment,
        attemptedDeparture ?? localDateTime(new Date(reservation.checkOut), timezone),
        lang,
        timezone,
        frame,
        url.searchParams.get('status'),
        errors,
        permissions,
      ),
  })
}

/**
 * The read the desk used to do by hand across four screens, before a departure.
 *
 * It hangs off the reservation rather than getting a route of its own, because
 * that is where the desk already is and where the command it leads to lives.
 */
const renderCheckOutPrep = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  reservation: ReservationDetail,
  errors: readonly string[] = [],
) => {
  const readiness = (await ctx.call(
    'hospitality_core.checkOutReadiness',
    { stayId: reservation.stayId },
    url,
    req,
  )) as CheckOutReadiness | null
  if (!readiness) return text('Not found', { status: 404 })
  const timezone = await propertyTimezone(ctx, reservation.propertyId, url, req)
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  const permitted = await ctx.allows('hospitality_core.checkOut', url, req)
  return adminPage(ctx, url, req, {
    title: _('hospitality_core.checkOutPrep.title', { code: reservation.code }),
    translate: false,
    body: (_, frame) =>
      checkOutPrepScreen(
        _,
        readiness,
        { id: reservation.id, code: reservation.code },
        lang,
        timezone,
        frame,
        permitted,
        errors,
      ),
  })
}

const renderStayDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
) => {
  const stay = (await ctx.call('hospitality_core.getStay', { id }, url, req)) as StayRow | null
  if (!stay) return text('Not found', { status: 404 })
  const [rooms, partners, documents] = (await Promise.all([
    ctx.call('hospitality_core.listRooms', { propertyId: stay.propertyId, includeArchived: true }, url, req),
    ctx.call('partner.listPartners', { kind: 'person', limit: 500 }, url, req),
    ctx.call('hospitality_core.listGuestDocuments', { stayId: stay.id }, url, req),
  ])) as [RoomRow[], Array<{ id: string; name: string; ref?: string }>, GuestDocumentRow[]]
  const timezone = await propertyTimezone(ctx, stay.propertyId, url, req)
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  return adminPage(ctx, url, req, {
    title: _('hospitality_core.stay.detail.title', { code: stay.code }),
    translate: false,
    body: (_, frame) =>
      stayDetailScreen(
        _,
        stay,
        rooms,
        partners,
        documents,
        randomUUID(),
        lang,
        timezone,
        frame,
        url.searchParams.get('status'),
        errors,
      ),
  })
}

const renderFolioDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
) => {
  const folio = (await ctx.call('hospitality_core.getFolio', { id }, url, req)) as FolioRow | null
  if (!folio) return text('Not found', { status: 404 })
  const timezone = await propertyTimezone(ctx, folio.propertyId, url, req)
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  return adminPage(ctx, url, req, {
    title: _('hospitality_core.folio.detail.title', { code: folio.code }),
    translate: false,
    body: (_, frame) =>
      folioDetailScreen(
        _,
        folio,
        lang,
        timezone,
        frame,
        randomUUID(),
        url.searchParams.get('status'),
        errors,
      ),
  })
}

const renderCleaningTaskDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
) => {
  const task = (await ctx.call(
    'hospitality_core.getCleaningTask',
    { id },
    url,
    req,
  )) as CleaningTaskRow | null
  if (!task) return text('Not found', { status: 404 })
  const timezone = await propertyTimezone(ctx, task.propertyId, url, req)
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  const permissions = {
    start: await ctx.allows('hospitality_core.startCleaningTask', url, req),
    complete: await ctx.allows('hospitality_core.completeCleaningTask', url, req),
    cancel: await ctx.allows('hospitality_core.cancelCleaningTask', url, req),
  }
  return adminPage(ctx, url, req, {
    title: _('hospitality_core.housekeeping.detail.title', { code: task.code }),
    translate: false,
    body: (_, frame) =>
      cleaningTaskDetailScreen(
        _,
        task,
        lang,
        timezone,
        frame,
        url.searchParams.get('status'),
        errors,
        permissions,
      ),
  })
}

const renderHousekeepingRoomDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
) => {
  const room = (await ctx.call('hospitality_core.getHousekeepingRoom', { id }, url, req)) as RoomRow | null
  if (room?.active !== true) return text('Not found', { status: 404 })
  const tasks = (await ctx.call(
    'hospitality_core.listCleaningTasks',
    { roomId: id, limit: 20 },
    url,
    req,
  )) as CleaningTaskRow[]
  const timezone = await propertyTimezone(ctx, room.propertyId, url, req)
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  return adminPage(ctx, url, req, {
    title: _('hospitality_core.housekeeping.rooms.detail.title', { code: room.code }),
    translate: false,
    body: (_, frame) =>
      housekeepingRoomDetailScreen(
        _,
        room,
        tasks,
        lang,
        timezone,
        frame,
        url.searchParams.get('status'),
        errors,
      ),
  })
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
  state: 'saved' | 'quoted' | 'queued' | 'refreshed' | 'submitted' | 'confirmed' | 'created' | 'invalid',
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

const modalHref = (url: URL, open: boolean, remove: readonly string[] = []): string => {
  const params = new URLSearchParams(url.searchParams)
  if (open) params.set('create', '1')
  else params.delete('create')
  params.delete('status')
  if (!open) params.delete('preview')
  for (const key of remove) params.delete(key)
  const query = params.toString()
  return `${url.pathname}${query ? `?${query}` : ''}`
}

const modalAction = (url: URL): string => {
  const params = new URLSearchParams(url.searchParams)
  params.set('create', '1')
  return `${url.pathname}?${params.toString()}`
}

const modalErrors = (url: URL, _: Translator): readonly string[] | undefined =>
  url.searchParams.get('status') === 'invalid' ? [_('hospitality_core.feedback.invalid')] : undefined

const modalValues = (url: URL, keys: readonly string[]): Record<string, string> =>
  Object.fromEntries(
    keys.flatMap((key) => (url.searchParams.has(key) ? [[key, url.searchParams.get(key)!]] : [])),
  )

const modalResultRedirect = (
  url: URL,
  ok: boolean,
  success: 'saved' | 'created',
  values: Record<string, string | undefined> = {},
  removeOnSuccess: readonly string[] = [],
) => {
  const params = new URLSearchParams(url.searchParams)
  if (ok) params.delete('create')
  else params.set('create', '1')
  params.set('status', ok ? success : 'invalid')
  for (const [key, value] of Object.entries(values)) {
    if (value) params.set(key, value)
    else params.delete(key)
  }
  if (ok) for (const key of removeOnSuccess) params.delete(key)
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
    dateTimeFormatter('en', {
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

const defaultPropertyValues = (id: string): PropertyFormValues => ({
  id,
  branchId: null,
  code: '',
  name: '',
  publicName: null,
  accommodationType: 'hotel',
  timezone: 'Asia/Ho_Chi_Minh',
  defaultCheckIn: '14:00',
  defaultCheckOut: '12:00',
  enforceTimes: true,
  allowHourly: true,
  allowWeekly: false,
  allowMonthly: false,
  longStayBillOnCheckIn: true,
  starRating: 0,
  description: null,
  houseRules: null,
  childrenStayFree: false,
  minimumGuestAge: null,
  defaultCancellationPolicyId: null,
})

const propertyFormValues = (
  id: string,
  form: Record<string, string>,
  current: PropertyDetail | null = null,
): PropertyFormValues => ({
  id,
  branchId: form.branchId?.trim() || current?.branchId || null,
  code: form.code?.trim() ?? current?.code ?? '',
  name: form.name?.trim() ?? current?.name ?? '',
  publicName: form.publicName?.trim() || null,
  accommodationType: form.accommodationType?.trim() ?? current?.accommodationType ?? 'hotel',
  timezone: form.timezone?.trim() ?? current?.timezone ?? 'Asia/Ho_Chi_Minh',
  defaultCheckIn: form.defaultCheckIn?.trim() ?? current?.defaultCheckIn ?? '14:00',
  defaultCheckOut: form.defaultCheckOut?.trim() ?? current?.defaultCheckOut ?? '12:00',
  enforceTimes: form.enforceTimes === '1',
  allowHourly: form.allowHourly === '1',
  allowWeekly: form.allowWeekly === '1',
  allowMonthly: form.allowMonthly === '1',
  longStayBillOnCheckIn: form.longStayBillOnCheckIn === '1',
  starRating: integer(form.starRating, current?.starRating ?? 0),
  description: form.description?.trim() || null,
  houseRules: form.houseRules?.trim() || null,
  childrenStayFree: form.childrenStayFree === '1',
  minimumGuestAge: form.minimumGuestAge ? integer(form.minimumGuestAge) : null,
  defaultCancellationPolicyId: form.defaultCancellationPolicyId?.trim() || null,
})

const propertySaveInput = (values: PropertyFormValues, current: PropertyDetail | null = null) => ({
  ...values,
  street1: current?.street1 ?? null,
  street2: current?.street2 ?? null,
  locality: current?.locality ?? null,
  postalCode: current?.postalCode ?? null,
  countryCode: current?.countryCode ?? null,
  divisionId: current?.divisionId ?? null,
  divisionText: current?.divisionText ?? null,
  latitude: current?.latitude ?? null,
  longitude: current?.longitude ?? null,
})

const renderPropertyDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
  attempted?: PropertyFormValues,
) => {
  const scope = await ctx.scopeOf(url, req)
  const [property, policies, branches] = (await Promise.all([
    ctx.call('hospitality_core.getProperty', { id }, url, req),
    ctx.call('hospitality_core.listCancellationPolicies', {}, url, req),
    scope.company
      ? ctx.call('company.listBranches', { companyId: scope.company }, url, req)
      : Promise.resolve([]),
  ])) as [PropertyDetail | null, PolicyRow[], BranchChoice[]]
  if (!property) return text('Not found', { status: 404 })
  const lang = ctx.localeOf(url, req)
  return adminPage(ctx, url, req, {
    title: property.name,
    translate: false,
    body: (_, frame) =>
      propertyDetailScreen(
        ctx.translate(lang),
        property,
        policies,
        branches,
        lang,
        frame,
        url.searchParams.get('status'),
        errors,
        attempted,
      ),
  })
}

const defaultRoomTypeValues = (id: string, propertyId: string): RoomTypeFormValues => ({
  id,
  propertyId,
  code: '',
  name: '',
  publicName: null,
  description: null,
  defaultCapacity: 2,
  maxAdults: 2,
  maxChildren: 0,
  maxInfants: 0,
  maxExtraBeds: 0,
  sizeSqm: null,
  viewType: null,
  sharedBathroom: false,
  allowHourly: true,
  allowWeekly: false,
  allowMonthly: false,
  minHourlyHours: 2,
  baseRate: '0',
  color: '#2563eb',
  cancellationPolicyId: null,
  published: false,
})

const roomTypeFormValues = (
  id: string,
  form: Record<string, string>,
  current: RoomTypeDetail | null = null,
): RoomTypeFormValues => ({
  id,
  propertyId: form.propertyId?.trim() ?? current?.propertyId ?? '',
  code: form.code?.trim() ?? current?.code ?? '',
  name: form.name?.trim() ?? current?.name ?? '',
  publicName: form.publicName?.trim() || null,
  description: form.description?.trim() || null,
  defaultCapacity: integer(form.defaultCapacity, current?.defaultCapacity ?? 2),
  maxAdults: integer(form.maxAdults, current?.maxAdults ?? 2),
  maxChildren: integer(form.maxChildren, current?.maxChildren ?? 0),
  maxInfants: integer(form.maxInfants, current?.maxInfants ?? 0),
  maxExtraBeds: integer(form.maxExtraBeds, current?.maxExtraBeds ?? 0),
  sizeSqm: form.sizeSqm?.trim() || null,
  viewType: form.viewType?.trim() || null,
  sharedBathroom: form.sharedBathroom === '1',
  allowHourly: form.allowHourly === '1',
  allowWeekly: form.allowWeekly === '1',
  allowMonthly: form.allowMonthly === '1',
  minHourlyHours: integer(form.minHourlyHours, current?.minHourlyHours ?? 2),
  baseRate: form.baseRate?.trim() ?? String(current?.baseRate ?? '0'),
  color: form.color?.trim() || null,
  cancellationPolicyId: form.cancellationPolicyId?.trim() || null,
  published: form.published === '1',
})

const roomTypeInputErrors = (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  values: RoomTypeFormValues,
): string[] => {
  const decimal = (value: unknown) =>
    /^-?(?:\d+(?:\.\d*)?|\.\d+)$/.test(String(value ?? '').trim()) && Number.isFinite(Number(value))
  if (decimal(values.baseRate) && (values.sizeSqm == null || decimal(values.sizeSqm))) return []
  return [ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.decimal')]
}

const renderRoomTypeDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
  attempted?: RoomTypeFormValues,
) => {
  const [roomType, properties, policies] = (await Promise.all([
    ctx.call('hospitality_core.getRoomType', { id }, url, req),
    ctx.call('hospitality_core.listProperties', { includeArchived: true }, url, req),
    ctx.call('hospitality_core.listCancellationPolicies', { includeArchived: true }, url, req),
  ])) as [RoomTypeDetail | null, PropertyRow[], PolicyRow[]]
  if (!roomType) return text('Not found', { status: 404 })
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  return adminPage(ctx, url, req, {
    title: roomType.name,
    translate: false,
    body: (_, frame) =>
      roomTypeDetailScreen(
        _,
        roomType,
        properties,
        policies,
        lang,
        frame,
        url.searchParams.get('status'),
        errors,
        attempted,
      ),
  })
}

const buildingFormValues = (
  id: string,
  form: Record<string, string>,
  current: BuildingDetail | null = null,
): BuildingFormValues => ({
  id,
  propertyId: form.propertyId?.trim() ?? current?.propertyId ?? '',
  code: form.code?.trim() ?? current?.code ?? '',
  name: form.name?.trim() ?? current?.name ?? '',
  sequence: integer(form.sequence, current?.sequence ?? 10),
})

const renderBuildingDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
  attempted?: BuildingFormValues,
) => {
  const building = (await ctx.call('hospitality_core.getBuilding', { id }, url, req)) as BuildingDetail | null
  if (!building) return text('Not found', { status: 404 })
  const lang = ctx.localeOf(url, req)
  return adminPage(ctx, url, req, {
    title: building.name,
    translate: false,
    body: (_, frame) =>
      buildingDetailScreen(
        ctx.translate(lang),
        building,
        attempted ?? building,
        lang,
        frame,
        url.searchParams.get('status'),
        errors,
      ),
  })
}

const floorFormValues = (
  id: string,
  form: Record<string, string>,
  current: FloorDetail | null = null,
): FloorFormValues => ({
  id,
  propertyId: form.propertyId?.trim() ?? current?.propertyId ?? '',
  buildingId: form.buildingId?.trim() ?? current?.buildingId ?? '',
  code: form.code?.trim() ?? current?.code ?? '',
  name: form.name?.trim() ?? current?.name ?? '',
  sequence: integer(form.sequence, current?.sequence ?? 10),
})

const renderFloorDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
  attempted?: FloorFormValues,
) => {
  const floor = (await ctx.call('hospitality_core.getFloor', { id }, url, req)) as FloorDetail | null
  if (!floor) return text('Not found', { status: 404 })
  const lang = ctx.localeOf(url, req)
  return adminPage(ctx, url, req, {
    title: floor.name,
    translate: false,
    body: (_, frame) =>
      floorDetailScreen(
        ctx.translate(lang),
        floor,
        attempted ?? floor,
        lang,
        frame,
        url.searchParams.get('status'),
        errors,
      ),
  })
}

const roomFormValues = (
  id: string,
  form: Record<string, string>,
  current: RoomDetail | null = null,
): RoomFormValues => ({
  id,
  propertyId: form.propertyId?.trim() ?? current?.propertyId ?? '',
  roomTypeId: form.roomTypeId?.trim() ?? current?.roomTypeId ?? '',
  buildingId: form.buildingId?.trim() || null,
  floorId: form.floorId?.trim() || null,
  code: form.code?.trim() ?? current?.code ?? '',
  name: form.name?.trim() ?? current?.name ?? '',
  capacity: integer(form.capacity, current?.capacity ?? 1),
})

const defaultRoomValues = (id: string, propertyId: string, roomTypeId: string): RoomFormValues => ({
  id,
  propertyId,
  roomTypeId,
  buildingId: null,
  floorId: null,
  code: '',
  name: '',
  capacity: 2,
})

const roomOptions = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  propertyId: string | undefined,
  includeArchived = false,
): Promise<{
  properties: PropertyRow[]
  propertyId?: string
  roomTypes: RoomTypeRow[]
  buildings: BuildingRow[]
  floors: FloorRow[]
}> => {
  const properties = (await ctx.call(
    'hospitality_core.listProperties',
    includeArchived ? { includeArchived: true } : {},
    url,
    req,
  )) as PropertyRow[]
  const selected = properties.some((row) => row.id === propertyId) ? propertyId : properties[0]?.id
  if (!selected) return { properties, propertyId: undefined, roomTypes: [], buildings: [], floors: [] }
  const [roomTypes, buildings, floors] = (await Promise.all([
    ctx.call(
      'hospitality_core.listRoomTypes',
      { propertyId: selected, includeArchived: includeArchived || undefined },
      url,
      req,
    ),
    ctx.call(
      'hospitality_core.listBuildings',
      { propertyId: selected, includeArchived: includeArchived || undefined },
      url,
      req,
    ),
    ctx.call(
      'hospitality_core.listFloors',
      { propertyId: selected, includeArchived: includeArchived || undefined },
      url,
      req,
    ),
  ])) as [RoomTypeRow[], BuildingRow[], FloorRow[]]
  return { properties, propertyId: selected, roomTypes, buildings, floors }
}

const renderRooms = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  errors: readonly string[] = [],
) => {
  const requestedProperty = url.searchParams.get('property')?.trim() || undefined
  const options = await roomOptions(ctx, url, req, requestedProperty)
  const [rows, buildings, floors] = options.propertyId
    ? ((await Promise.all([
        ctx.call('hospitality_core.listRooms', { propertyId: options.propertyId }, url, req),
        ctx.call(
          'hospitality_core.listBuildings',
          { propertyId: options.propertyId, includeArchived: true },
          url,
          req,
        ),
        ctx.call(
          'hospitality_core.listFloors',
          { propertyId: options.propertyId, includeArchived: true },
          url,
          req,
        ),
      ])) as [RoomRow[], BuildingRow[], FloorRow[]])
    : [[], [], []]
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  return adminPage(ctx, url, req, {
    title: 'hospitality_core.screen.rooms.title',
    body: (_, frame) =>
      roomsScreen(
        _,
        { rows, ...options, buildings, floors },
        lang,
        frame,
        url.searchParams.get('status'),
        errors,
      ),
  })
}

const renderRoomDetail = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  id: string,
  errors: readonly string[] = [],
  attempted?: RoomFormValues,
) => {
  const room = (await ctx.call('hospitality_core.getRoom', { id }, url, req)) as RoomDetail | null
  if (!room) return text('Not found', { status: 404 })
  const options = await roomOptions(ctx, url, req, room.propertyId, true)
  const lang = ctx.localeOf(url, req)
  return adminPage(ctx, url, req, {
    title: room.name,
    translate: false,
    body: (_, frame) =>
      roomDetailScreen(
        ctx.translate(lang),
        room,
        attempted ?? room,
        options.properties,
        options.roomTypes,
        options.buildings,
        options.floors,
        lang,
        frame,
        url.searchParams.get('status'),
        errors,
      ),
  })
}

export const routes: Record<string, RouteEntry> = {
  '/admin/hospitality/front-desk':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const propertyId = await selectedProperty(ctx, url, req)
      const timezone = await propertyTimezone(ctx, propertyId, url, req)
      const requested = url.searchParams.get('date')?.slice(0, 10)
      const day =
        requested && /^\d{4}-\d{2}-\d{2}$/u.test(requested) ? requested : dateKeyIn(new Date(), timezone)
      const range = calendarRange(day, 1, timezone)
      // The landing screen is where a new deployment starts. Five zeroes and
      // "nothing needs attention" is a true statement and useless advice when
      // the property itself has not been created yet.
      const configured = ((await ctx.call('hospitality_core.listProperties', {}, url, req)) as unknown[])
        .length
      const [stays, inHouseStays] = (await Promise.all([
        ctx.call('hospitality_core.listStays', { propertyId, from: range.from, to: range.to }, url, req),
        ctx.call('hospitality_core.listStays', { propertyId, state: 'checked_in' }, url, req),
      ])) as [StayRow[], StayRow[]]
      // An auditor and a night auditor read this screen without doing desk
      // work; the row action is for the people who do it.
      const may = {
        checkIn: await ctx.allows('hospitality_core.checkIn', url, req),
        checkOut: await ctx.allows('hospitality_core.checkOut', url, req),
      }
      const inRange = (value: string) => value >= range.from && value < range.to
      const now = new Date().toISOString()
      const overdue = inHouseStays
        .filter((stay) => stay.checkOut < now)
        .sort((left, right) => left.checkOut.localeCompare(right.checkOut))
      const overdueIds = new Set(overdue.map((stay) => stay.id))
      // The desk works two queues today: who is coming in, and who is going
      // out. A guest already late is in neither — they are the first thing the
      // screen says, above both.
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.screen.frontDesk.title',
        body: (_, frame) =>
          frontDeskScreen(
            _,
            {
              day,
              arrivals: stays
                .filter((stay) => stay.state === 'draft' && inRange(stay.checkIn))
                .sort((left, right) => left.checkIn.localeCompare(right.checkIn)),
              departures: stays
                .filter(
                  (stay) => stay.state === 'checked_in' && inRange(stay.checkOut) && !overdueIds.has(stay.id),
                )
                .sort((left, right) => left.checkOut.localeCompare(right.checkOut)),
              overdue,
              inHouse: inHouseStays,
            },
            may,
            lang,
            timezone,
            frame,
            configured > 0,
          ),
      })
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
          create: '1',
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
        return modalResultRedirect(
          url,
          Boolean(result.ok),
          'saved',
          result.ok ? { lang: form.lang, property: propertyId, preview: undefined } : values,
          [
            'id',
            'code',
            'partnerId',
            'roomTypeId',
            'bookingType',
            'checkIn',
            'checkOut',
            'adults',
            'children',
            'rate',
          ],
        )
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
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.screen.reservations.title',
        body: (_, frame) =>
          reservationsScreen(
            _,
            { rows, properties, roomTypes, partners, values, quote },
            lang,
            timezone,
            frame,
            url.searchParams.get('status'),
            {
              open: url.searchParams.get('create') === '1',
              createHref: modalHref(url, true, [
                'preview',
                'id',
                'code',
                'partnerId',
                'roomTypeId',
                'bookingType',
                'checkIn',
                'checkOut',
                'adults',
                'children',
                'rate',
              ]),
              closeHref: modalHref(url, false, [
                'id',
                'code',
                'partnerId',
                'roomTypeId',
                'bookingType',
                'checkIn',
                'checkOut',
                'adults',
                'children',
                'rate',
              ]),
              action: modalAction(url),
            },
          ),
      })
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
      let status:
        | 'checked-in'
        | 'checked-out'
        | 'checked-out-early'
        | 'cancelled'
        | 'amended'
        | 'no-show'
        | 'departure-adjusted'
        | 'room-held'
        | 'room-hold-released'
      if (form.operation === 'amend') {
        const timezone = await propertyTimezone(ctx, reservation.propertyId, url, req)
        const checkIn = instantFromLocal(form.checkIn, timezone)
        const checkOut = instantFromLocal(form.checkOut, timezone)
        const attempted: ReservationAmendmentValues = {
          partnerId: form.partnerId?.trim() || '',
          roomTypeId: form.roomTypeId?.trim() || '',
          checkIn: form.checkIn?.trim() || '',
          checkOut: form.checkOut?.trim() || '',
          adults: integer(form.adults, 1),
          children: integer(form.children),
          rate: form.rate?.trim() || '',
        }
        if (!checkIn || !checkOut)
          return renderReservationDetail(
            ctx,
            url,
            req,
            params.id,
            [ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.datetime')],
            attempted,
          )
        result = (await ctx.call(
          'hospitality_core.amendReservation',
          {
            id: reservation.id,
            partnerId: attempted.partnerId,
            roomTypeId: attempted.roomTypeId,
            checkIn,
            checkOut,
            adults: attempted.adults,
            children: attempted.children,
            rate: attempted.rate,
          },
          url,
          req,
        )) as OperationResult
        if (!result.ok)
          return renderReservationDetail(
            ctx,
            url,
            req,
            params.id,
            operationErrors(ctx, url, req, result),
            attempted,
          )
        status = 'amended'
      } else if (form.operation === 'check-in') {
        if (!reservation.stayId || !form.roomId)
          return renderReservationDetail(ctx, url, req, params.id, [
            ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.no_available_room'),
          ])
        result = (await ctx.call(
          'hospitality_core.checkIn',
          { stayId: reservation.stayId, roomId: form.roomId },
          url,
          req,
        )) as OperationResult
        status = 'checked-in'
      } else if (form.operation === 'hold-room') {
        if (!reservation.stayId || !form.roomId)
          return renderReservationDetail(ctx, url, req, params.id, [
            ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.no_available_room'),
          ])
        result = (await ctx.call(
          'hospitality_core.holdRoom',
          { stayId: reservation.stayId, roomId: form.roomId },
          url,
          req,
        )) as OperationResult
        status = 'room-held'
      } else if (form.operation === 'release-room-hold') {
        if (!reservation.stayId)
          return renderReservationDetail(ctx, url, req, params.id, [
            ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.stay_missing'),
          ])
        result = (await ctx.call(
          'hospitality_core.releaseRoomHold',
          { stayId: reservation.stayId },
          url,
          req,
        )) as OperationResult
        status = 'room-hold-released'
      } else if (form.operation === 'adjust-departure') {
        if (!reservation.stayId)
          return renderReservationDetail(ctx, url, req, params.id, [
            ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.stay_missing'),
          ])
        const timezone = await propertyTimezone(ctx, reservation.propertyId, url, req)
        const attemptedDeparture = form.checkOut?.trim() || ''
        const checkOut = instantFromLocal(attemptedDeparture, timezone)
        if (!checkOut)
          return renderReservationDetail(
            ctx,
            url,
            req,
            params.id,
            [ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.datetime')],
            undefined,
            attemptedDeparture,
          )
        result = (await ctx.call(
          'hospitality_core.adjustStayDeparture',
          { stayId: reservation.stayId, checkOut },
          url,
          req,
        )) as OperationResult
        if (!result.ok)
          return renderReservationDetail(
            ctx,
            url,
            req,
            params.id,
            operationErrors(ctx, url, req, result),
            undefined,
            attemptedDeparture,
          )
        status = 'departure-adjusted'
      } else if (form.operation === 'check-out') {
        if (!reservation.stayId)
          return renderReservationDetail(ctx, url, req, params.id, [
            ctx.translate(ctx.localeOf(url, req))('hospitality_core.validation.stay_missing'),
          ])
        result = (await ctx.call(
          'hospitality_core.checkOut',
          { stayId: reservation.stayId, lateReason: form.lateReason?.trim() || undefined },
          url,
          req,
        )) as OperationResult
        status = Number(result.inventoryReleased ?? 0) > 0 ? 'checked-out-early' : 'checked-out'
      } else if (form.operation === 'cancel') {
        result = (await ctx.call(
          'hospitality_core.cancelReservation',
          { id: reservation.id, reason: form.reason?.trim() || undefined },
          url,
          req,
        )) as OperationResult
        status = 'cancelled'
      } else if (form.operation === 'no-show') {
        result = (await ctx.call(
          'hospitality_core.markNoShow',
          { id: reservation.id, reason: form.reason?.trim() || '' },
          url,
          req,
        )) as OperationResult
        status = 'no-show'
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
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.screen.stays.title',
        body: (_, frame) => staysScreen(_, rows, lang, timezone, frame),
      })
    },

  '/admin/hospitality/stays/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return renderStayDetail(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const form = await readForm(req)
      const stay = (await ctx.call('hospitality_core.getStay', { id: params.id }, url, req)) as StayRow | null
      if (!stay) return text('Not found', { status: 404 })

      let result: OperationResult
      let status: 'guest-added' | 'room-moved' | 'document-saved'
      if (form.operation === 'add-guest') {
        result = (await ctx.call(
          'hospitality_core.addStayGuest',
          {
            id: randomUUID(),
            stayId: stay.id,
            partnerId: form.partnerId?.trim() || undefined,
            displayName: form.displayName?.trim() || '',
          },
          url,
          req,
        )) as OperationResult
        status = 'guest-added'
      } else if (form.operation === 'move-room') {
        if (!form.roomId?.trim() || !form.reason?.trim())
          return renderStayDetail(ctx, url, req, params.id, [
            ctx.translate(ctx.localeOf(url, req))('hospitality_core.stay.validation.moveRequired'),
          ])
        result = (await ctx.call(
          'hospitality_core.moveRoom',
          {
            stayId: stay.id,
            roomId: form.roomId,
            assignmentId: randomUUID(),
            reason: form.reason.trim(),
          },
          url,
          req,
        )) as OperationResult
        status = 'room-moved'
      } else if (form.operation === 'save-document') {
        result = (await ctx.call(
          'hospitality_core.saveGuestDocument',
          {
            id: form.documentId?.trim() || randomUUID(),
            stayId: stay.id,
            partnerId: form.partnerId?.trim() || '',
            type: form.type?.trim() || 'cccd',
            number: form.number?.trim() || undefined,
            fullName: form.fullName?.trim() || '',
            dateOfBirth: form.dateOfBirth?.trim() || undefined,
            gender: form.gender?.trim() || undefined,
            nationality: form.nationality?.trim() || undefined,
            permanentAddress: form.permanentAddress?.trim() || undefined,
            issueDate: form.issueDate?.trim() || undefined,
            issuePlace: form.issuePlace?.trim() || undefined,
            ocrState: 'pending',
          },
          url,
          req,
        )) as OperationResult
        status = 'document-saved'
      } else return text('unknown action', { status: 400 })

      if (!result.ok)
        return renderStayDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result))
      const query = new URLSearchParams()
      query.set('status', status)
      const lang = url.searchParams.get('lang')?.trim() || form.lang?.trim()
      if (lang) query.set('lang', lang)
      return seeOther(`${url.pathname}?${query.toString()}`)
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
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.screen.folios.title',
        body: (_, frame) => foliosScreen(_, rows, lang, timezone, frame),
      })
    },

  '/admin/hospitality/folios/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return renderFolioDetail(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const form = await readForm(req)
      let result: OperationResult
      let status: 'charge-posted' | 'charge-voided'

      if (form.operation === 'post-charge') {
        const id = form.id?.trim() || randomUUID()
        result = (await ctx.call(
          'hospitality_core.addCharge',
          {
            id,
            folioId: params.id,
            stayId: form.stayId?.trim() || undefined,
            description: form.description?.trim() || '',
            type: form.type?.trim() || 'service',
            quantity: form.quantity?.trim() || '1',
            unitPrice: form.unitPrice?.trim() || '',
            sourceKey: `manual-charge:${id}`,
          },
          url,
          req,
        )) as OperationResult
        status = 'charge-posted'
      } else if (form.operation === 'void-charge') {
        result = (await ctx.call(
          'hospitality_core.voidCharge',
          {
            id: form.chargeId?.trim() || '',
            folioId: params.id,
            reason: form.reason?.trim() || '',
          },
          url,
          req,
        )) as OperationResult
        status = 'charge-voided'
      } else return text('unknown action', { status: 400 })

      if (!result.ok)
        return renderFolioDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result))
      const query = new URLSearchParams()
      query.set('status', status)
      const lang = url.searchParams.get('lang')?.trim() || form.lang?.trim()
      if (lang) query.set('lang', lang)
      return seeOther(`${url.pathname}?${query.toString()}`)
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
      // The board is for looking at; the one thing it offers to start is a
      // booking, and only to somebody who may make one.
      const may = { book: await ctx.allows('hospitality_core.createReservation', url, req) }
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.screen.tapeChart.title',
        body: (_, frame) => tapeChartScreen(_, chart, may, lang, frame),
      })
    },

  '/admin/hospitality/properties':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const properties = (await ctx.call('hospitality_core.listProperties', {}, url, req)) as PropertyRow[]
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.screen.properties.title',
        body: (_, frame) =>
          propertiesScreen(
            _,
            properties,
            {
              rooms: properties.reduce((sum, property) => sum + property.rooms, 0),
              available: properties.reduce((sum, property) => sum + property.availableRooms, 0),
              attention: properties.reduce((sum, property) => sum + property.attentionRooms, 0),
            },
            lang,
            frame,
          ),
      })
    },

  '/admin/hospitality/properties/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const policies = (await ctx.call(
        'hospitality_core.listCancellationPolicies',
        {},
        url,
        req,
      )) as PolicyRow[]
      const scope = await ctx.scopeOf(url, req)
      const branches = scope.company
        ? ((await ctx.call('company.listBranches', { companyId: scope.company }, url, req)) as BranchChoice[])
        : []
      if (req.method === 'GET') {
        const values = defaultPropertyValues(randomUUID())
        return adminPage(ctx, url, req, {
          title: 'hospitality_core.property.create.title',
          body: (_, frame) => newPropertyScreen(_, values, policies, branches, lang, frame),
        })
      }
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const form = await readForm(req)
      const values = propertyFormValues(randomUUID(), form)
      const result = (await ctx.call(
        'hospitality_core.saveProperty',
        propertySaveInput(values),
        url,
        req,
      )) as OperationResult
      if (!result.ok)
        return adminPage(ctx, url, req, {
          title: 'hospitality_core.property.create.title',
          body: (_, frame) =>
            newPropertyScreen(
              _,
              values,
              policies,
              branches,
              lang,
              frame,
              operationErrors(ctx, url, req, result),
            ),
        })
      const query = new URLSearchParams({ status: 'created', lang })
      return seeOther(`/admin/hospitality/properties/${encodeURIComponent(values.id)}?${query.toString()}`)
    },

  '/admin/hospitality/properties/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return renderPropertyDetail(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const current = (await ctx.call(
        'hospitality_core.getProperty',
        { id: params.id },
        url,
        req,
      )) as PropertyDetail | null
      if (!current) return text('Not found', { status: 404 })
      const form = await readForm(req)
      const values = propertyFormValues(params.id, form, current)
      const result = (await ctx.call(
        'hospitality_core.saveProperty',
        propertySaveInput(values, current),
        url,
        req,
      )) as OperationResult
      if (!result.ok)
        return renderPropertyDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result), values)
      const query = new URLSearchParams({ status: 'saved', lang: ctx.localeOf(url, req) })
      return seeOther(`${url.pathname}?${query.toString()}`)
    },

  '/admin/hospitality/buildings/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return renderBuildingDetail(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const current = (await ctx.call(
        'hospitality_core.getBuilding',
        { id: params.id },
        url,
        req,
      )) as BuildingDetail | null
      if (!current) return text('Not found', { status: 404 })
      const values = buildingFormValues(params.id, await readForm(req), current)
      const result = (await ctx.call('hospitality_core.saveBuilding', values, url, req)) as OperationResult
      if (!result.ok)
        return renderBuildingDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result), values)
      const query = new URLSearchParams({ status: 'saved', lang: ctx.localeOf(url, req) })
      return seeOther(`${url.pathname}?${query.toString()}`)
    },

  '/admin/hospitality/buildings/{id}/archive':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      const active = form.action === 'restore'
      const result = (await ctx.call(
        'hospitality_core.archiveBuilding',
        { id: params.id, active },
        url,
        req,
      )) as OperationResult
      if (!result.ok)
        return renderBuildingDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result))
      const query = new URLSearchParams({
        status: active ? 'restored' : 'archived',
        lang: ctx.localeOf(url, req),
      })
      return seeOther(`/admin/hospitality/buildings/${encodeURIComponent(params.id)}?${query.toString()}`)
    },

  '/admin/hospitality/levels/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return renderFloorDetail(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const current = (await ctx.call(
        'hospitality_core.getFloor',
        { id: params.id },
        url,
        req,
      )) as FloorDetail | null
      if (!current) return text('Not found', { status: 404 })
      const values = floorFormValues(params.id, await readForm(req), current)
      const result = (await ctx.call('hospitality_core.saveFloor', values, url, req)) as OperationResult
      if (!result.ok)
        return renderFloorDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result), values)
      const query = new URLSearchParams({ status: 'saved', lang: ctx.localeOf(url, req) })
      return seeOther(`${url.pathname}?${query.toString()}`)
    },

  '/admin/hospitality/levels/{id}/archive':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      const active = form.action === 'restore'
      const result = (await ctx.call(
        'hospitality_core.archiveFloor',
        { id: params.id, active },
        url,
        req,
      )) as OperationResult
      if (!result.ok)
        return renderFloorDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result))
      const query = new URLSearchParams({
        status: active ? 'restored' : 'archived',
        lang: ctx.localeOf(url, req),
      })
      return seeOther(`/admin/hospitality/levels/${encodeURIComponent(params.id)}?${query.toString()}`)
    },

  '/admin/hospitality/rooms':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'GET') return renderRooms(ctx, url, req)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const form = await readForm(req)
      const operation = form.operation?.trim()
      const propertyId = form.propertyId?.trim() || ''
      let result: OperationResult
      let status: string
      if (operation === 'save-building') {
        result = (await ctx.call(
          'hospitality_core.saveBuilding',
          {
            id: randomUUID(),
            propertyId,
            code: form.code?.trim() || '',
            name: form.name?.trim() || '',
            sequence: integer(form.sequence, 10),
          },
          url,
          req,
        )) as OperationResult
        status = 'building-created'
      } else if (operation === 'save-floor') {
        result = (await ctx.call(
          'hospitality_core.saveFloor',
          {
            id: randomUUID(),
            propertyId,
            buildingId: form.buildingId?.trim() || '',
            code: form.code?.trim() || '',
            name: form.name?.trim() || '',
            sequence: integer(form.sequence, 10),
          },
          url,
          req,
        )) as OperationResult
        status = 'floor-created'
      } else return text('unknown action', { status: 400 })
      if (!result.ok) return renderRooms(ctx, url, req, operationErrors(ctx, url, req, result))
      const query = new URLSearchParams({ property: propertyId, status, lang: ctx.localeOf(url, req) })
      return seeOther(`/admin/hospitality/rooms?${query.toString()}`)
    },

  '/admin/hospitality/rooms/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const requestedProperty = url.searchParams.get('property')?.trim() || undefined
      const initial = await roomOptions(ctx, url, req, requestedProperty)
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (!initial.propertyId || !initial.roomTypes.length)
        return seeOther(`/admin/hospitality/rooms?lang=${encodeURIComponent(lang)}`)
      if (req.method === 'GET') {
        const values = defaultRoomValues(randomUUID(), initial.propertyId, initial.roomTypes[0]!.id)
        return adminPage(ctx, url, req, {
          title: 'hospitality_core.room.create.title',
          body: (_, frame) =>
            newRoomScreen(
              _,
              values,
              initial.properties,
              initial.roomTypes,
              initial.buildings,
              initial.floors,
              lang,
              frame,
            ),
        })
      }
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const form = await readForm(req)
      const values = roomFormValues(randomUUID(), form)
      const options = await roomOptions(ctx, url, req, values.propertyId)
      const result = (await ctx.call('hospitality_core.saveRoom', values, url, req)) as OperationResult
      if (!result.ok)
        return adminPage(ctx, url, req, {
          title: 'hospitality_core.room.create.title',
          body: (_, frame) =>
            newRoomScreen(
              _,
              values,
              options.properties,
              options.roomTypes,
              options.buildings,
              options.floors,
              lang,
              frame,
              operationErrors(ctx, url, req, result),
            ),
        })
      const query = new URLSearchParams({ status: 'created', lang })
      return seeOther(`/admin/hospitality/rooms/${encodeURIComponent(values.id)}?${query.toString()}`)
    },

  '/admin/hospitality/rooms/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return renderRoomDetail(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const current = (await ctx.call(
        'hospitality_core.getRoom',
        { id: params.id },
        url,
        req,
      )) as RoomDetail | null
      if (!current) return text('Not found', { status: 404 })
      const form = await readForm(req)
      const values = roomFormValues(params.id, form, current)
      const result = (await ctx.call('hospitality_core.saveRoom', values, url, req)) as OperationResult
      if (!result.ok)
        return renderRoomDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result), values)
      const query = new URLSearchParams({ status: 'saved', lang: ctx.localeOf(url, req) })
      return seeOther(`${url.pathname}?${query.toString()}`)
    },

  '/admin/hospitality/rooms/{id}/archive':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      const active = form.action === 'restore'
      const result = (await ctx.call(
        'hospitality_core.archiveRoom',
        { id: params.id, active },
        url,
        req,
      )) as OperationResult
      if (!result.ok)
        return renderRoomDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result))
      const query = new URLSearchParams({
        status: active ? 'restored' : 'archived',
        lang: ctx.localeOf(url, req),
      })
      return seeOther(`/admin/hospitality/rooms/${encodeURIComponent(params.id)}?${query.toString()}`)
    },

  '/admin/hospitality/room-types':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const properties = (await ctx.call('hospitality_core.listProperties', {}, url, req)) as PropertyRow[]
      const requestedProperty = url.searchParams.get('property')?.trim()
      const propertyId = properties.some((row) => row.id === requestedProperty)
        ? requestedProperty
        : properties[0]?.id
      const rows = (await ctx.call(
        'hospitality_core.listRoomTypes',
        { propertyId },
        url,
        req,
      )) as RoomTypeRow[]
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.screen.roomTypes.title',
        body: (_, frame) => roomTypesScreen(_, rows, properties, propertyId, lang, frame),
      })
    },

  '/admin/hospitality/room-types/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const [properties, policies] = (await Promise.all([
        ctx.call('hospitality_core.listProperties', {}, url, req),
        ctx.call('hospitality_core.listCancellationPolicies', {}, url, req),
      ])) as [PropertyRow[], PolicyRow[]]
      const requestedProperty = url.searchParams.get('property')?.trim()
      const propertyId = properties.find((row) => row.id === requestedProperty)?.id ?? properties[0]?.id ?? ''
      if (req.method === 'GET') {
        const values = defaultRoomTypeValues(randomUUID(), propertyId)
        return adminPage(ctx, url, req, {
          title: 'hospitality_core.roomType.create.title',
          body: (_, frame) => newRoomTypeScreen(_, values, properties, policies, lang, frame),
        })
      }
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const form = await readForm(req)
      const values = roomTypeFormValues(randomUUID(), form)
      const inputErrors = roomTypeInputErrors(ctx, url, req, values)
      if (inputErrors.length)
        return adminPage(ctx, url, req, {
          title: 'hospitality_core.roomType.create.title',
          body: (_, frame) => newRoomTypeScreen(_, values, properties, policies, lang, frame, inputErrors),
        })
      const result = (await ctx.call('hospitality_core.saveRoomType', values, url, req)) as OperationResult
      if (!result.ok)
        return adminPage(ctx, url, req, {
          title: 'hospitality_core.roomType.create.title',
          body: (_, frame) =>
            newRoomTypeScreen(
              _,
              values,
              properties,
              policies,
              lang,
              frame,
              operationErrors(ctx, url, req, result),
            ),
        })
      const query = new URLSearchParams({ status: 'created', lang })
      return seeOther(`/admin/hospitality/room-types/${encodeURIComponent(values.id)}?${query.toString()}`)
    },

  '/admin/hospitality/room-types/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return renderRoomTypeDetail(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const current = (await ctx.call(
        'hospitality_core.getRoomType',
        { id: params.id },
        url,
        req,
      )) as RoomTypeDetail | null
      if (!current) return text('Not found', { status: 404 })
      const form = await readForm(req)
      const values = roomTypeFormValues(params.id, form, current)
      const inputErrors = roomTypeInputErrors(ctx, url, req, values)
      if (inputErrors.length) return renderRoomTypeDetail(ctx, url, req, params.id, inputErrors, values)
      const result = (await ctx.call('hospitality_core.saveRoomType', values, url, req)) as OperationResult
      if (!result.ok)
        return renderRoomTypeDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result), values)
      const query = new URLSearchParams({ status: 'saved', lang: ctx.localeOf(url, req) })
      return seeOther(`${url.pathname}?${query.toString()}`)
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
        const values = {
          property: form.propertyId,
          roomTypeId: form.roomTypeId,
          code: form.code,
          name: form.name,
          rateType: form.rateType,
          amount: form.amount,
          mealPlan: form.mealPlan,
          minStay: form.minStay,
          maxStay: form.maxStay,
          isDefault: form.isDefault,
          active: form.active,
        }
        return modalResultRedirect(
          url,
          Boolean(result.ok),
          'saved',
          values,
          Object.keys(values).filter((key) => key !== 'property'),
        )
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
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.screen.ratePlans.title',
        body: (_, frame) =>
          ratePlansScreen(_, rows, properties, roomTypes, propertyId, frame, url.searchParams.get('status'), {
            open: url.searchParams.get('create') === '1',
            createHref: modalHref(url, true, [
              'roomTypeId',
              'code',
              'name',
              'rateType',
              'amount',
              'mealPlan',
              'minStay',
              'maxStay',
              'isDefault',
              'active',
            ]),
            closeHref: modalHref(url, false, [
              'roomTypeId',
              'code',
              'name',
              'rateType',
              'amount',
              'mealPlan',
              'minStay',
              'maxStay',
              'isDefault',
              'active',
            ]),
            action: modalAction(url),
            errors: modalErrors(url, _),
            values: modalValues(url, [
              'roomTypeId',
              'code',
              'name',
              'rateType',
              'amount',
              'mealPlan',
              'minStay',
              'maxStay',
              'isDefault',
              'active',
            ]),
          }),
      })
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
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.screen.inventory.title',
        body: (_, frame) =>
          inventoryScreen(
            _,
            rows,
            properties,
            roomTypes,
            { propertyId, roomTypeId, from, to },
            frame,
            url.searchParams.get('status'),
          ),
      })
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
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.screen.services.title',
        body: (_, frame) =>
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
            frame,
            url.searchParams.get('status'),
          ),
      })
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
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.screen.nightAudit.title',
        body: (_, frame) =>
          nightAuditScreen(
            _,
            { properties, propertyId, auditDate, today, preview, runs },
            lang,
            frame,
            url.searchParams.get('status'),
          ),
      })
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
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.screen.stayNotices.title',
        body: (_, frame) =>
          stayNoticesScreen(
            _,
            { properties, propertyId, state, rows, selected },
            lang,
            timezone,
            frame,
            url.searchParams.get('status'),
          ),
      })
    },

  '/admin/hospitality/housekeeping':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.operation !== 'create') return text('unknown action', { status: 400 })
        const id = form.id?.trim() || randomUUID()
        const result = (await ctx.call(
          'hospitality_core.createCleaningTask',
          {
            id,
            code: form.code?.trim() || `HK-${id.slice(0, 12).toUpperCase()}`,
            roomId: form.roomId?.trim() || '',
            taskType: form.taskType?.trim() || 'daily_clean',
            priority: form.priority?.trim() || 'normal',
            assigneeId: form.assigneeId?.trim() || undefined,
            notes: form.notes?.trim() || undefined,
          },
          url,
          req,
        )) as OperationResult
        return modalResultRedirect(
          url,
          Boolean(result.ok),
          'created',
          {
            property: form.propertyId,
            state: form.state === 'all' ? undefined : form.state,
            lang: form.lang,
            room: result.ok ? undefined : form.roomId,
            roomId: form.roomId,
            taskType: form.taskType,
            priority: form.priority,
            assigneeId: form.assigneeId,
            notes: form.notes,
          },
          ['roomId', 'taskType', 'priority', 'assigneeId', 'notes'],
        )
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
      const state = CLEANING_TASK_STATES.includes(requestedState as (typeof CLEANING_TASK_STATES)[number])
        ? requestedState!
        : 'all'
      const canCreate = await ctx.allows('hospitality_core.createCleaningTask', url, req)
      const [rows, rooms, summary] = propertyId
        ? ((await Promise.all([
            ctx.call(
              'hospitality_core.listCleaningTasks',
              { propertyId, state: state === 'all' ? undefined : state, limit: 500 },
              url,
              req,
            ),
            canCreate
              ? ctx.call('hospitality_core.listRooms', { propertyId }, url, req)
              : Promise.resolve([]),
            ctx.call('hospitality_core.cleaningTaskSummary', { propertyId }, url, req),
          ])) as [CleaningTaskRow[], RoomRow[], CleaningTaskSummary])
        : [[], [], { todo: 0, inProgress: 0, done: 0, cancelled: 0 }]
      const timezone = await propertyTimezone(ctx, propertyId, url, req)
      const taskId = randomUUID()
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.screen.cleaningTasks.title',
        body: (_, frame) =>
          cleaningTasksScreen(
            _,
            {
              rows,
              properties,
              propertyId,
              state,
              rooms,
              summary,
              id: taskId,
              code: `HK-${taskId.slice(0, 12).toUpperCase()}`,
              selectedRoomId: rooms.some((room) => room.id === url.searchParams.get('room'))
                ? url.searchParams.get('room')!
                : undefined,
            },
            lang,
            timezone,
            frame,
            url.searchParams.get('status'),
            canCreate
              ? {
                  open: url.searchParams.get('create') === '1',
                  createHref: modalHref(url, true),
                  closeHref: modalHref(url, false, ['room']),
                  action: modalAction(url),
                  errors: modalErrors(url, _),
                  values: modalValues(url, ['roomId', 'taskType', 'priority', 'assigneeId', 'notes']),
                }
              : undefined,
            canCreate,
          ),
      })
    },

  '/admin/hospitality/housekeeping/tasks/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return renderCleaningTaskDetail(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const form = await readForm(req)
      let result: OperationResult
      let status: 'started' | 'completed' | 'cancelled'
      if (form.operation === 'start') {
        result = (await ctx.call(
          'hospitality_core.startCleaningTask',
          { id: params.id, assigneeId: form.assigneeId?.trim() || undefined },
          url,
          req,
        )) as OperationResult
        status = 'started'
      } else if (form.operation === 'complete') {
        result = (await ctx.call(
          'hospitality_core.completeCleaningTask',
          { id: params.id },
          url,
          req,
        )) as OperationResult
        status = 'completed'
      } else if (form.operation === 'cancel') {
        result = (await ctx.call(
          'hospitality_core.cancelCleaningTask',
          { id: params.id },
          url,
          req,
        )) as OperationResult
        status = 'cancelled'
      } else return text('unknown action', { status: 400 })

      if (!result.ok)
        return renderCleaningTaskDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result))
      const query = new URLSearchParams({ status })
      const lang = url.searchParams.get('lang')?.trim() || form.lang?.trim()
      if (lang) query.set('lang', lang)
      return seeOther(`${url.pathname}?${query.toString()}`)
    },

  '/admin/hospitality/housekeeping/rooms':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const properties = (await ctx.call('hospitality_core.listProperties', {}, url, req)) as PropertyRow[]
      const requestedProperty = url.searchParams.get('property')?.trim()
      const propertyId = properties.some((row) => row.id === requestedProperty)
        ? requestedProperty
        : properties[0]?.id
      const requestedState = url.searchParams.get('state')?.trim()
      const state = ROOM_STATUSES.includes(requestedState as (typeof ROOM_STATUSES)[number])
        ? requestedState!
        : 'all'
      const [rows, summary] = propertyId
        ? ((await Promise.all([
            ctx.call(
              'hospitality_core.listRooms',
              { propertyId, status: state === 'all' ? undefined : state, limit: 500 },
              url,
              req,
            ),
            ctx.call('hospitality_core.roomStatusSummary', { propertyId }, url, req),
          ])) as [RoomRow[], RoomStatusSummary])
        : [[], { available: 0, occupied: 0, dirty: 0, cleaning: 0, maintenance: 0, outOfOrder: 0 }]
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.screen.housekeepingRooms.title',
        body: (_, frame) =>
          housekeepingRoomsScreen(_, { rows, properties, propertyId, state, summary }, lang, frame),
      })
    },

  '/admin/hospitality/housekeeping/rooms/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return renderHousekeepingRoomDetail(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const form = await readForm(req)
      if (form.operation !== 'set-status') return text('unknown action', { status: 400 })
      const result = (await ctx.call(
        'hospitality_core.setRoomStatus',
        {
          id: params.id,
          expectedStatus: form.expectedStatus?.trim() || undefined,
          status: form.status?.trim() || '',
          note: form.note?.trim() || undefined,
        },
        url,
        req,
      )) as OperationResult
      if (!result.ok)
        return renderHousekeepingRoomDetail(ctx, url, req, params.id, operationErrors(ctx, url, req, result))
      const query = new URLSearchParams({ status: 'updated' })
      const lang = url.searchParams.get('lang')?.trim() || form.lang?.trim()
      if (lang) query.set('lang', lang)
      return seeOther(`${url.pathname}?${query.toString()}`)
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
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.screen.content.title',
        body: (_, frame) =>
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
            frame,
            url.searchParams.get('status'),
          ),
      })
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
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.operation !== 'save-amenity') return text('unknown action', { status: 400 })
        const result = (await ctx.call(
          'hospitality_core.saveAmenity',
          {
            id: randomUUID(),
            code: form.code ?? '',
            name: form.name ?? '',
            scope: form.scope ?? 'property',
            categoryId: form.categoryId || undefined,
            sequence: integer(form.sequence),
          },
          url,
          req,
        )) as { ok?: boolean }
        const values = {
          code: form.code,
          name: form.name,
          scope: form.scope,
          categoryId: form.categoryId,
          sequence: form.sequence,
        }
        return modalResultRedirect(url, Boolean(result.ok), 'saved', values, Object.keys(values))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [rows, categories] = (await Promise.all([
        ctx.call('hospitality_core.listAmenities', {}, url, req),
        ctx.call('hospitality_core.listAmenityCategories', {}, url, req),
      ])) as [AmenityRow[], Array<{ id: string; name: string }>]
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.screen.amenities.title',
        body: (_, frame) =>
          amenitiesScreen(_, rows, categories, frame, url.searchParams.get('status'), {
            open: url.searchParams.get('create') === '1',
            createHref: modalHref(url, true, ['code', 'name', 'scope', 'categoryId', 'sequence']),
            closeHref: modalHref(url, false, ['code', 'name', 'scope', 'categoryId', 'sequence']),
            action: modalAction(url),
            errors: modalErrors(url, _),
            values: modalValues(url, ['code', 'name', 'scope', 'categoryId', 'sequence']),
          }),
      })
    },

  '/admin/hospitality/policies':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.operation !== 'save-policy') return text('unknown action', { status: 400 })
        const result = (await ctx.call(
          'hospitality_core.saveCancellationPolicy',
          {
            id: randomUUID(),
            code: form.code ?? '',
            name: form.name ?? '',
            type: form.type ?? 'flexible',
            description: form.description || undefined,
            freeCancellationHours: integer(form.freeCancellationHours),
            penaltyPercent: form.penaltyPercent ?? '0',
          },
          url,
          req,
        )) as { ok?: boolean }
        const values = {
          code: form.code,
          name: form.name,
          type: form.type,
          description: form.description,
          freeCancellationHours: form.freeCancellationHours,
          penaltyPercent: form.penaltyPercent,
        }
        return modalResultRedirect(url, Boolean(result.ok), 'saved', values, Object.keys(values))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows = (await ctx.call('hospitality_core.listCancellationPolicies', {}, url, req)) as PolicyRow[]
      return adminPage(ctx, url, req, {
        title: 'hospitality_core.screen.policies.title',
        body: (_, frame) =>
          policiesScreen(_, rows, frame, url.searchParams.get('status'), {
            open: url.searchParams.get('create') === '1',
            createHref: modalHref(url, true, [
              'code',
              'name',
              'type',
              'description',
              'freeCancellationHours',
              'penaltyPercent',
            ]),
            closeHref: modalHref(url, false, [
              'code',
              'name',
              'type',
              'description',
              'freeCancellationHours',
              'penaltyPercent',
            ]),
            action: modalAction(url),
            errors: modalErrors(url, _),
            values: modalValues(url, [
              'code',
              'name',
              'type',
              'description',
              'freeCancellationHours',
              'penaltyPercent',
            ]),
          }),
      })
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
