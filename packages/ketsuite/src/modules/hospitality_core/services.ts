import { asc, defineFn, desc, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { appendContentChange } from './content.ts'
import { occupancyDates } from './inventory.ts'
import { CHARGE_TYPES, EXTRA_RECURRENCES, PROPERTY_CHARGE_TYPES } from './types.ts'

type Issue = { field: string; code: string; messageKey: string; params?: Record<string, unknown> }
const issue = (field: string, code: string, params?: Record<string, unknown>): Issue => ({
  field,
  code,
  messageKey: `hospitality_core.validation.${code}`,
  ...(params ? { params } : {}),
})
const success = (id: unknown, extra: Record<string, unknown> = {}) => ({
  ok: true,
  id: String(id),
  errors: [],
  ...extra,
})
const failure = (...errors: Issue[]) => ({ ok: false, errors })
const text = (value: unknown): string => String(value ?? '').trim()
const one = async (ctx: Ctx, model: string, id: unknown): Promise<Row | null> =>
  (await ctx.db.select(model, { id }))[0] ?? null
const date = (value: unknown): Date | null => {
  const parsed = new Date(String(value ?? ''))
  return Number.isFinite(parsed.getTime()) ? parsed : null
}
const decimal = (value: unknown): number => Number(String(value ?? ''))
const includes = (values: readonly string[], value: unknown): boolean => values.includes(String(value))

class ChargePostingConflict extends Error {}

const productDetails = async (
  ctx: Ctx,
  productId: unknown,
  uomId?: unknown,
): Promise<{ product: Row | null; template: Row | null; uom: Row | null; validUom: boolean }> => {
  const product = await one(ctx, 'product.Product', productId)
  const template = product ? await one(ctx, 'product.Template', product.templateId) : null
  const uom = uomId ? await one(ctx, 'uom.Unit', uomId) : null
  const alternate =
    product && uomId
      ? ((await ctx.db.select('product.ProductUom', { productId: product.id, uomId }))[0] ?? null)
      : null
  return {
    product,
    template,
    uom,
    validUom: !uomId || (!!uom && (template?.uomId === uomId || !!alternate)),
  }
}

/**
 * Atomically post one operational charge and advance the folio total. The
 * source key is the idempotency boundary shared by manual and recurring service
 * materialisation.
 */
export const postCharge = async (
  ctx: Ctx,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  const existing = await one(ctx, 'hospitality_core.Charge', args.id)
  if (existing) return success(existing.id, { amount: existing.amount, existing: true })
  const sourceKey = text(args.sourceKey) || null
  if (sourceKey) {
    const C = ctx.table('hospitality_core.Charge')
    const duplicate = await ctx.db.one(from(C).where(eq(C.sourceKey, sourceKey)))
    if (duplicate) return success(duplicate.id, { amount: duplicate.amount, existing: true })
  }

  const folio = await one(ctx, 'hospitality_core.Folio', args.folioId)
  const stay = args.stayId ? await one(ctx, 'hospitality_core.Stay', args.stayId) : null
  const extraLine = args.extraLineId ? await one(ctx, 'hospitality_core.ExtraLine', args.extraLineId) : null
  const product = args.productId ? await productDetails(ctx, args.productId, args.uomId) : null
  const type = String(args.type ?? 'service')
  const quantity = decimal(args.quantity ?? 1)
  const unitPrice = decimal(args.unitPrice)
  const rawAmount = quantity * unitPrice
  const amount = String(type === 'discount' ? -Math.abs(rawAmount) : rawAmount)
  const errors: Issue[] = []
  if (!folio) errors.push(issue('folioId', 'folio_missing'))
  else if (folio.state !== 'open') errors.push(issue('folioId', 'folio_not_open'))
  if (args.stayId && !stay) errors.push(issue('stayId', 'stay_missing'))
  else if (stay && stay.folioId !== args.folioId) errors.push(issue('stayId', 'folio_mismatch'))
  if (args.extraLineId && !extraLine) errors.push(issue('extraLineId', 'extra_line_missing'))
  else if (extraLine && extraLine.folioId !== args.folioId)
    errors.push(issue('extraLineId', 'folio_mismatch'))
  if (args.productId && !product?.product) errors.push(issue('productId', 'product_missing'))
  else if (product && !product.template) errors.push(issue('productId', 'product_template_missing'))
  if (args.uomId && !product?.validUom) errors.push(issue('uomId', 'product_uom_mismatch'))
  if (!text(args.description)) errors.push(issue('description', 'required'))
  if (!includes(CHARGE_TYPES, type)) errors.push(issue('type', 'charge_type'))
  if (!Number.isFinite(quantity) || quantity < 0) errors.push(issue('quantity', 'non_negative'))
  if (!Number.isFinite(unitPrice) || unitPrice < 0) errors.push(issue('unitPrice', 'non_negative'))
  const occurredAt = date(args.occurredAt)?.toISOString() ?? new Date().toISOString()
  const serviceDate = args.serviceDate == null ? null : text(args.serviceDate)
  if (serviceDate && !/^\d{4}-\d{2}-\d{2}$/u.test(serviceDate)) errors.push(issue('serviceDate', 'date'))
  if (errors.length || !folio) return failure(...errors)

  try {
    return await ctx.tx(async (tx) => {
      const inserted = await tx.db.insertIfAbsent('hospitality_core.Charge', {
        id: args.id,
        folioId: args.folioId,
        stayId: args.stayId,
        extraLineId: args.extraLineId,
        nightAuditRunId: args.nightAuditRunId,
        productId: args.productId,
        uomId: args.uomId,
        description: text(args.description),
        type,
        quantity: String(quantity),
        unitPrice: String(unitPrice),
        amount,
        occurredAt,
        serviceDate,
        sourceKey,
        state: 'active',
      })
      if (!('dryRun' in inserted) && !inserted.inserted) {
        const C = tx.table('hospitality_core.Charge')
        const duplicate = sourceKey
          ? await tx.db.one(from(C).where(eq(C.sourceKey, sourceKey)))
          : await one(tx, 'hospitality_core.Charge', args.id)
        if (!duplicate) throw new ChargePostingConflict()
        return success(duplicate.id, { amount: duplicate.amount, existing: true })
      }

      for (let attempt = 0; attempt < 5; attempt++) {
        const current = await one(tx, 'hospitality_core.Folio', folio.id)
        if (current?.state !== 'open') throw new ChargePostingConflict()
        const next = String(Number(current.amountTotal) + Number(amount))
        const changed = await tx.db.compareAndSet(
          'hospitality_core.Folio',
          { id: folio.id },
          { state: 'open', version: current.version },
          { amountTotal: next, version: Number(current.version) + 1 },
        )
        if ('dryRun' in changed || changed.matched) return success(args.id, { amount, existing: false })
      }
      throw new ChargePostingConflict()
    })
  } catch (error) {
    if (error instanceof ChargePostingConflict) return failure(issue('folioId', 'transition_conflict'))
    throw error
  }
}

const extraOutput = {
  id: 'id',
  reservationId: 'id?',
  stayId: 'id?',
  folioId: 'id',
  propertyId: 'id',
  productId: 'id',
  uomId: 'id?',
  description: 'text',
  quantity: 'decimal',
  unitPrice: 'decimal',
  recurrence: 'text',
  active: 'bool',
  createdAt: 'datetime',
  updatedAt: 'datetime',
  productName: 'text',
  productCode: 'text?',
  reservation: 'json?',
  stay: 'json?',
  folio: 'json?',
  uom: 'json?',
  materializedCount: 'int',
  materializedAmount: 'decimal',
}

const withProductNames = async (ctx: Ctx, rows: Row[]): Promise<Row[]> => {
  const templates = new Map<string, Row>()
  for (const row of rows) {
    const product = row.product as Row | null | undefined
    const templateId = product?.templateId == null ? null : String(product.templateId)
    if (templateId && !templates.has(templateId)) {
      const template = await one(ctx, 'product.Template', templateId)
      if (template) templates.set(templateId, template)
    }
  }
  return rows.map((row) => {
    const product = row.product as Row | null | undefined
    const template = product?.templateId ? templates.get(String(product.templateId)) : null
    const charges = Array.isArray(row.charges) ? (row.charges as Row[]) : []
    return {
      ...row,
      productName: String(template?.name ?? row.productId),
      productCode: product?.defaultCode ?? null,
      materializedCount: charges.filter((charge) => charge.state === 'active').length,
      materializedAmount: String(
        charges
          .filter((charge) => charge.state === 'active')
          .reduce((total, charge) => total + Number(charge.amount ?? 0), 0),
      ),
    }
  })
}

export const services: Record<string, FnSpec> = {
  listServiceProducts: defineFn({
    input: {},
    output: { id: 'id', code: 'text?', name: 'text', unitPrice: 'decimal', uomId: 'id?' },
    effects: ['read:product.Template', 'read:product.Product'],
    agent: true,
    handler: async (ctx) => {
      const T = ctx.table('product.Template')
      const templates = await ctx.db.all(
        from(T).where(eq(T.active, true), eq(T.saleOk, true)).orderBy(asc(T.name)).preload('variants'),
      )
      return templates.flatMap((template) =>
        ((template.variants as Row[] | undefined) ?? [])
          .filter((product) => product.active === true)
          .map((product) => ({
            id: product.id,
            code: product.defaultCode,
            name: template.name,
            unitPrice: template.listPrice,
            uomId: template.uomId,
          })),
      )
    },
  }),

  listPropertyCharges: defineFn({
    input: { propertyId: 'id?' },
    output: {
      id: 'id',
      propertyId: 'id',
      chargeType: 'text',
      name: 'text',
      amount: 'decimal',
      description: 'text?',
      active: 'bool',
    },
    effects: ['read:hospitality_core.PropertyCharge'],
    agent: true,
    handler: (ctx, args) => {
      const C = ctx.table('hospitality_core.PropertyCharge')
      let query = from(C).orderBy(asc(C.chargeType), asc(C.name))
      if (args.propertyId) query = query.where(eq(C.propertyId, args.propertyId))
      return ctx.db.all(query)
    },
  }),

  savePropertyCharge: defineFn({
    input: {
      id: 'id',
      propertyId: 'id',
      chargeType: 'text',
      name: 'text',
      amount: 'decimal',
      description: 'text?',
      active: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Property',
      'read:hospitality_core.PropertyCharge',
      'write:hospitality_core.PropertyCharge',
      'write:hospitality_core.ContentChange',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const property = await one(ctx, 'hospitality_core.Property', args.propertyId)
      const existing = await one(ctx, 'hospitality_core.PropertyCharge', args.id)
      const amount = decimal(args.amount)
      const errors: Issue[] = []
      if (!property) errors.push(issue('propertyId', 'property_missing'))
      if (!includes(PROPERTY_CHARGE_TYPES, args.chargeType))
        errors.push(issue('chargeType', 'property_charge_type'))
      if (!text(args.name)) errors.push(issue('name', 'required'))
      if (!Number.isFinite(amount) || amount < 0) errors.push(issue('amount', 'non_negative'))
      const C = ctx.table('hospitality_core.PropertyCharge')
      const duplicate = (
        await ctx.db.all(from(C).where(eq(C.propertyId, args.propertyId), eq(C.chargeType, args.chargeType)))
      ).find((row) => row.id !== args.id && text(row.name) === text(args.name))
      if (duplicate) errors.push(issue('name', 'unique'))
      if (errors.length || !property) return failure(...errors)
      await ctx.tx(async (tx) => {
        const values = {
          id: args.id,
          propertyId: args.propertyId,
          chargeType: args.chargeType,
          name: text(args.name),
          amount: String(amount),
          description: text(args.description) || null,
          active: args.active ?? true,
        }
        if (existing) {
          const { id: _id, ...patch } = values
          await tx.db.update('hospitality_core.PropertyCharge', { id: args.id }, patch)
        } else await tx.db.insert('hospitality_core.PropertyCharge', values)
        await appendContentChange(tx, {
          propertyId: args.propertyId,
          resourceType: 'property_charge',
          resourceId: args.id,
        })
      })
      return success(args.id)
    },
  }),

  listExtraLines: defineFn({
    input: { propertyId: 'id?', reservationId: 'id?', stayId: 'id?', active: 'bool?' },
    output: extraOutput,
    effects: [
      'read:hospitality_core.ExtraLine',
      'read:hospitality_core.Reservation',
      'read:hospitality_core.Stay',
      'read:hospitality_core.Folio',
      'read:hospitality_core.Charge',
      'read:product.Product',
      'read:product.Template',
      'read:uom.Unit',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const E = ctx.table('hospitality_core.ExtraLine')
      let query = from(E)
        .orderBy(asc(E.createdAt), asc(E.id))
        .preload('reservation', 'stay', 'folio', 'product', 'uom', 'charges')
      if (args.propertyId) query = query.where(eq(E.propertyId, args.propertyId))
      if (args.reservationId) query = query.where(eq(E.reservationId, args.reservationId))
      if (args.stayId) query = query.where(eq(E.stayId, args.stayId))
      if (args.active != null) query = query.where(eq(E.active, args.active))
      return withProductNames(ctx, await ctx.db.all(query))
    },
  }),

  saveExtraLine: defineFn({
    input: {
      id: 'id',
      reservationId: 'id?',
      stayId: 'id?',
      productId: 'id',
      uomId: 'id?',
      description: 'text?',
      quantity: 'decimal?',
      unitPrice: 'decimal?',
      recurrence: 'text?',
      active: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', existing: 'bool?', errors: 'json?' },
    effects: [
      'read:hospitality_core.Reservation',
      'read:hospitality_core.Stay',
      'read:hospitality_core.Folio',
      'read:hospitality_core.ExtraLine',
      'read:hospitality_core.Charge',
      'write:hospitality_core.ExtraLine',
      'read:product.Product',
      'read:product.Template',
      'read:product.ProductUom',
      'read:uom.Unit',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = await one(ctx, 'hospitality_core.ExtraLine', args.id)
      if (existing) {
        const charges = await ctx.db.select('hospitality_core.Charge', { extraLineId: existing.id })
        if (charges.length) {
          const changed =
            (args.reservationId != null && args.reservationId !== existing.reservationId) ||
            (args.stayId != null && args.stayId !== existing.stayId) ||
            (args.productId != null && args.productId !== existing.productId) ||
            (args.uomId != null && args.uomId !== existing.uomId) ||
            (args.description != null && text(args.description) !== existing.description) ||
            (args.quantity != null && decimal(args.quantity) !== Number(existing.quantity)) ||
            (args.unitPrice != null && decimal(args.unitPrice) !== Number(existing.unitPrice)) ||
            (args.recurrence != null && args.recurrence !== existing.recurrence) ||
            (args.active != null && args.active !== existing.active)
          return changed
            ? failure(issue('id', 'extra_line_materialized'))
            : success(existing.id, { existing: true })
        }
      }
      const targetCount = (args.reservationId ? 1 : 0) + (args.stayId ? 1 : 0)
      const reservation = args.reservationId
        ? await one(ctx, 'hospitality_core.Reservation', args.reservationId)
        : null
      const stay = args.stayId ? await one(ctx, 'hospitality_core.Stay', args.stayId) : null
      const target = reservation ?? stay
      const folio = target ? await one(ctx, 'hospitality_core.Folio', target.folioId) : null
      const product = await productDetails(ctx, args.productId, args.uomId)
      const recurrence = String(args.recurrence ?? 'once')
      const quantity = decimal(args.quantity ?? 1)
      const unitPrice = decimal(args.unitPrice ?? product.template?.listPrice)
      const errors: Issue[] = []
      if (targetCount !== 1) errors.push(issue('reservationId', 'extra_line_target'))
      if (args.reservationId && !reservation) errors.push(issue('reservationId', 'reservation_missing'))
      if (args.stayId && !stay) errors.push(issue('stayId', 'stay_missing'))
      if (target?.state === 'cancelled' || target?.state === 'no_show')
        errors.push(issue('reservationId', 'extra_line_target_cancelled'))
      if (!folio) errors.push(issue('folioId', 'folio_missing'))
      else if (folio.state !== 'open') errors.push(issue('folioId', 'folio_not_open'))
      if (!product.product) errors.push(issue('productId', 'product_missing'))
      else if (!product.template) errors.push(issue('productId', 'product_template_missing'))
      else if (
        product.product.active !== true ||
        product.template.active !== true ||
        product.template.saleOk !== true
      )
        errors.push(issue('productId', 'product_not_saleable'))
      if (args.uomId && !product.validUom) errors.push(issue('uomId', 'product_uom_mismatch'))
      if (!includes(EXTRA_RECURRENCES, recurrence)) errors.push(issue('recurrence', 'extra_recurrence'))
      if (!Number.isFinite(quantity) || quantity <= 0) errors.push(issue('quantity', 'positive'))
      if (!Number.isFinite(unitPrice) || unitPrice < 0) errors.push(issue('unitPrice', 'non_negative'))
      if (errors.length || !target || !folio || !product.template) return failure(...errors)
      const timestamp = new Date().toISOString()
      const values = {
        id: args.id,
        reservationId: reservation?.id ?? null,
        stayId: stay?.id ?? null,
        folioId: target.folioId,
        propertyId: target.propertyId,
        productId: args.productId,
        uomId: args.uomId ?? product.template.uomId ?? null,
        description: text(args.description) || String(product.template.name),
        quantity: String(quantity),
        unitPrice: String(unitPrice),
        recurrence,
        active: args.active ?? true,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
      if (existing) {
        const { id: _id, createdAt: _createdAt, ...patch } = values
        await ctx.db.update('hospitality_core.ExtraLine', { id: args.id }, patch)
      } else await ctx.db.insert('hospitality_core.ExtraLine', values)
      return success(args.id, { existing: !!existing })
    },
  }),

  materializeExtraLine: defineFn({
    input: {
      id: 'id',
      serviceDate: 'text?',
      quantity: 'decimal?',
      requestKey: 'id?',
      occurredAt: 'datetime?',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      chargeId: 'id?',
      amount: 'decimal?',
      existing: 'bool?',
      errors: 'json?',
    },
    effects: [
      'read:hospitality_core.ExtraLine',
      'read:hospitality_core.Reservation',
      'read:hospitality_core.Stay',
      'read:hospitality_core.Property',
      'read:hospitality_core.Folio',
      'read:hospitality_core.Charge',
      'write:hospitality_core.Folio',
      'write:hospitality_core.Charge',
      'read:product.Product',
      'read:product.Template',
      'read:product.ProductUom',
      'read:uom.Unit',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const line = await one(ctx, 'hospitality_core.ExtraLine', args.id)
      if (!line) return failure(issue('id', 'extra_line_missing'))
      if (line.active !== true) return failure(issue('id', 'extra_line_inactive'))
      const reservation = line.reservationId
        ? await one(ctx, 'hospitality_core.Reservation', line.reservationId)
        : null
      const selectedStay = line.stayId
        ? await one(ctx, 'hospitality_core.Stay', line.stayId)
        : reservation?.stayId
          ? await one(ctx, 'hospitality_core.Stay', reservation.stayId)
          : null
      if (
        reservation?.state === 'cancelled' ||
        reservation?.state === 'no_show' ||
        selectedStay?.state === 'cancelled' ||
        selectedStay?.state === 'no_show'
      )
        return failure(issue('id', 'extra_line_target_cancelled'))
      const property = await one(ctx, 'hospitality_core.Property', line.propertyId)
      const serviceDate = text(args.serviceDate)
      const errors: Issue[] = []
      let suffix = 'once'
      let quantity = decimal(line.quantity)
      if (line.recurrence === 'per_night') {
        if (!/^\d{4}-\d{2}-\d{2}$/u.test(serviceDate)) errors.push(issue('serviceDate', 'date'))
        const schedule = selectedStay ?? reservation
        if (
          !schedule ||
          !property ||
          !occupancyDates(schedule.checkIn, schedule.checkOut, String(property.timezone)).includes(
            serviceDate,
          )
        )
          errors.push(issue('serviceDate', 'extra_service_date'))
        suffix = `night:${serviceDate}`
      } else if (line.recurrence === 'per_unit') {
        if (!args.requestKey) errors.push(issue('requestKey', 'required'))
        quantity = decimal(args.quantity)
        if (!Number.isFinite(quantity) || quantity <= 0) errors.push(issue('quantity', 'positive'))
        suffix = `unit:${String(args.requestKey ?? '')}`
      } else if (line.recurrence !== 'once') errors.push(issue('recurrence', 'extra_recurrence'))
      if (errors.length) return failure(...errors)

      const sourceKey = `extra:${String(line.id)}:${suffix}`
      const posted = await postCharge(ctx, {
        id: `${String(line.id)}:charge:${suffix}`,
        folioId: line.folioId,
        stayId: selectedStay?.id,
        extraLineId: line.id,
        productId: line.productId,
        uomId: line.uomId,
        description: line.description,
        type: 'service',
        quantity,
        unitPrice: line.unitPrice,
        occurredAt:
          args.occurredAt ?? (line.recurrence === 'per_night' ? `${serviceDate}T12:00:00.000Z` : undefined),
        serviceDate: line.recurrence === 'per_night' ? serviceDate : undefined,
        sourceKey,
      })
      return {
        ...posted,
        ...(posted.ok ? { chargeId: posted.id, id: line.id } : {}),
      }
    },
  }),

  listServiceCharges: defineFn({
    input: { propertyId: 'id?' },
    output: {
      id: 'id',
      folioId: 'id',
      stayId: 'id?',
      extraLineId: 'id',
      productId: 'id?',
      uomId: 'id?',
      description: 'text',
      quantity: 'decimal',
      unitPrice: 'decimal',
      amount: 'decimal',
      occurredAt: 'datetime',
      serviceDate: 'date?',
      state: 'text',
      productName: 'text',
      extraLine: 'json?',
      folio: 'json?',
      stay: 'json?',
    },
    effects: [
      'read:hospitality_core.Charge',
      'read:hospitality_core.ExtraLine',
      'read:hospitality_core.Folio',
      'read:hospitality_core.Stay',
      'read:product.Product',
      'read:product.Template',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const C = ctx.table('hospitality_core.Charge')
      const rows = await ctx.db.all(
        from(C).orderBy(desc(C.occurredAt), desc(C.id)).preload('extraLine', 'folio', 'stay', 'product'),
      )
      return withProductNames(
        ctx,
        rows.filter((row) => {
          const extra = row.extraLine as Row | null | undefined
          return !!extra && (!args.propertyId || extra.propertyId === args.propertyId)
        }),
      )
    },
  }),
}
