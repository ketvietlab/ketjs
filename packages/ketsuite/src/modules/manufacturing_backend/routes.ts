import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import type { Translator } from '@ketvietlab/ketjs'
import { modalWorkspace } from '../../ui/index.ts'
import type { FormField, Frame } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { adminPage, choices, inLocale, resultErrors } from '../backend/screen.ts'
import type { AnyRow } from '../backend/screen.ts'
import {
  bomCreateModal,
  bomsListScreen,
  orderCreateScreen,
  orderScreen,
  ordersListScreen,
} from './screens/index.ts'
import { workCentersScreen } from './screens.tsx'

const crossSite = (req: Parameters<Route>[1]): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

const options = (rows: AnyRow[], empty = false) => choices(rows, empty)
const optionsKeeping = (rows: AnyRow[], value: string | undefined) => {
  const listed = options(rows)
  return value && !listed.some((option) => option.value === value)
    ? [{ value, label: value }, ...listed]
    : listed
}

const common = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1]) => {
  const [boms, variants, units, locations, workCenters] = await Promise.all([
    ctx.call('manufacturing.listBoms', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('product.listVariants', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('uom.listUnits', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('stock.listLocations', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('manufacturing.listWorkCenters', {}, url, req) as Promise<AnyRow[]>,
  ])
  return { boms, variants, units, locations, workCenters }
}

type CommonData = Awaited<ReturnType<typeof common>>
type ProductionFormValues = Record<string, string>
type BomFormValues = Record<string, string>

const productionFields = (
  _: Translator,
  data: CommonData,
  values: ProductionFormValues = {},
): FormField[] => [
  {
    name: 'name',
    label: _('manufacturing_backend.field.name'),
    value: values.name,
    required: true,
  },
  {
    name: 'bomId',
    label: _('manufacturing_backend.field.bom'),
    type: 'select',
    value: values.bomId,
    options: optionsKeeping(data.boms, values.bomId),
    required: true,
  },
  {
    name: 'productQty',
    label: _('manufacturing_backend.field.quantity'),
    type: 'decimal',
    value: values.productQty || 1,
    required: true,
  },
  {
    name: 'productUomId',
    label: _('manufacturing_backend.field.uom'),
    type: 'select',
    value: values.productUomId,
    options: optionsKeeping(data.units, values.productUomId),
    required: true,
  },
  {
    name: 'sourceLocationId',
    label: _('manufacturing_backend.field.source'),
    type: 'select',
    value: values.sourceLocationId,
    options: optionsKeeping(
      data.locations.filter((row) => ['internal', 'transit'].includes(String(row.usage))),
      values.sourceLocationId,
    ),
    required: true,
  },
  {
    name: 'productionLocationId',
    label: _('manufacturing_backend.field.production'),
    type: 'select',
    value: values.productionLocationId,
    options: optionsKeeping(
      data.locations.filter((row) => row.usage === 'production'),
      values.productionLocationId,
    ),
    required: true,
  },
  {
    name: 'destinationLocationId',
    label: _('manufacturing_backend.field.destination'),
    type: 'select',
    value: values.destinationLocationId,
    options: optionsKeeping(
      data.locations.filter((row) => ['internal', 'transit'].includes(String(row.usage))),
      values.destinationLocationId,
    ),
    required: true,
  },
  {
    name: 'scheduledStart',
    label: _('manufacturing_backend.field.scheduledStart'),
    type: 'datetime-local',
    value: values.scheduledStart,
    required: true,
  },
]

const productionValues = (form: ProductionFormValues): ProductionFormValues => ({
  id: form.id ?? '',
  name: form.name ?? '',
  bomId: form.bomId ?? '',
  productQty: form.productQty || '1',
  productUomId: form.productUomId ?? '',
  sourceLocationId: form.sourceLocationId ?? '',
  productionLocationId: form.productionLocationId ?? '',
  destinationLocationId: form.destinationLocationId ?? '',
  scheduledStart: form.scheduledStart || new Date().toISOString(),
})

const bomValues = (form: BomFormValues): BomFormValues => ({
  id: form.id ?? '',
  code: form.code ?? '',
  productId: form.productId ?? '',
  productQty: form.productQty || '1',
  productUomId: form.productUomId ?? '',
  componentId: form.componentId ?? '',
  componentQty: form.componentQty || '1',
  componentUomId: form.componentUomId ?? '',
  operationName: form.operationName ?? '',
  workCenterId: form.workCenterId ?? '',
  durationExpected: form.durationExpected || '0',
})

const bomFields = (_: Translator, data: CommonData, values: BomFormValues = {}): FormField[] => [
  {
    name: 'code',
    label: _('manufacturing_backend.field.code'),
    value: values.code,
  },
  {
    name: 'productId',
    label: _('manufacturing_backend.field.product'),
    type: 'select',
    value: values.productId,
    options: optionsKeeping(data.variants, values.productId),
    required: true,
  },
  {
    name: 'productQty',
    label: _('manufacturing_backend.field.quantity'),
    type: 'decimal',
    value: values.productQty || 1,
    required: true,
  },
  {
    name: 'productUomId',
    label: _('manufacturing_backend.field.uom'),
    type: 'select',
    value: values.productUomId,
    options: optionsKeeping(data.units, values.productUomId),
    required: true,
  },
  {
    name: 'componentId',
    label: _('manufacturing_backend.field.component'),
    type: 'select',
    value: values.componentId,
    options: optionsKeeping(data.variants, values.componentId),
    required: true,
  },
  {
    name: 'componentQty',
    label: _('manufacturing_backend.field.quantity'),
    type: 'decimal',
    value: values.componentQty || 1,
    required: true,
  },
  {
    name: 'componentUomId',
    label: _('manufacturing_backend.field.uom'),
    type: 'select',
    value: values.componentUomId,
    options: optionsKeeping(data.units, values.componentUomId),
    required: true,
  },
  {
    name: 'operationName',
    label: _('manufacturing_backend.field.operation'),
    value: values.operationName,
  },
  {
    name: 'workCenterId',
    label: _('manufacturing_backend.field.workCenter'),
    type: 'select',
    value: values.workCenterId,
    options: [{ value: '', label: '—' }, ...optionsKeeping(data.workCenters, values.workCenterId)],
  },
  {
    name: 'durationExpected',
    label: _('manufacturing_backend.field.duration'),
    type: 'number',
    value: values.durationExpected || 0,
  },
]

const saveBom = async (ctx: ServeContext, url: URL, req: Parameters<Route>[1], values: BomFormValues) => {
  const id = values.id || crypto.randomUUID()
  const operations = values.operationName
    ? [
        {
          id: `${id}:operation:1`,
          name: values.operationName,
          workCenterId: values.workCenterId,
          durationExpected: Number(values.durationExpected || 0),
        },
      ]
    : []
  return ctx.call(
    'manufacturing.saveBom',
    {
      id,
      code: values.code || null,
      productId: values.productId,
      productQty: values.productQty || '1',
      productUomId: values.productUomId,
      lines: values.componentId
        ? [
            {
              id: `${id}:line:1`,
              productId: values.componentId,
              productQty: values.componentQty || '1',
              productUomId: values.componentUomId,
              operationId: operations[0]?.id ?? null,
            },
          ]
        : [],
      operations,
    },
    url,
    req,
  )
}

const bomsPage = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  data: CommonData,
  values?: BomFormValues,
  errors: readonly string[] = [],
) =>
  adminPage(ctx, url, req, {
    title: 'manufacturing_backend.boms.title',
    active: '/admin/manufacturing/boms',
    body: (_: Translator, frame: Frame) => {
      const collection = inLocale(url, '/admin/manufacturing/boms')
      const productsById = new Map(
        data.variants.map((row) => [String(row.id), String(row.templateName ?? row.name ?? row.id)]),
      )
      const list = bomsListScreen(
        _,
        {
          createHref: inLocale(url, '/admin/manufacturing/boms?create=1'),
          rows: data.boms.map((row) => ({
            id: String(row.id),
            code: String(row.code ?? row.id),
            product: productsById.get(String(row.productId)) ?? String(row.productId),
            quantity: String(row.productQty),
          })),
        },
        frame,
      )
      if (url.searchParams.get('create') !== '1' && !errors.length) return list
      return modalWorkspace(
        list,
        bomCreateModal(_, {
          fields: bomFields(_, data, values),
          action: inLocale(url, '/admin/manufacturing/boms/new'),
          cancelHref: collection,
          errors,
        }),
      )
    },
  })

const saveProduction = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  values: ProductionFormValues,
) =>
  ctx.call(
    'manufacturing.saveProduction',
    {
      ...values,
      id: values.id || crypto.randomUUID(),
    },
    url,
    req,
  )

const productionCreatePage = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
  action: string,
  values: ProductionFormValues = {},
  errors: readonly string[] = [],
) => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const data = await common(ctx, url, req)
  return adminPage(ctx, url, req, {
    title: 'manufacturing_backend.orders.create',
    body: (_, frame) =>
      orderCreateScreen(
        _,
        {
          fields: productionFields(_, data, values),
          action,
          cancelHref: inLocale(url, '/admin/manufacturing'),
          errors,
        },
        frame,
      ),
  })
}

export const routes: Record<string, RouteEntry> = {
  '/admin/manufacturing':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const values = productionValues(form)
        const result = await saveProduction(ctx, url, req, values)
        if ((result as AnyRow).ok) return seeOther(inLocale(url, '/admin/manufacturing'))
        const _ = ctx.translate(ctx.localeOf(url, req))
        return productionCreatePage(
          ctx,
          url,
          req,
          inLocale(url, '/admin/manufacturing'),
          values,
          resultErrors(result, _, 'manufacturing_backend.error.invalid'),
        )
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [data, rows] = await Promise.all([
        common(ctx, url, req),
        ctx.call('manufacturing.listProductions', {}, url, req) as Promise<AnyRow[]>,
      ])
      const productsById = new Map(
        data.variants.map((row) => [String(row.id), String(row.templateName ?? row.name ?? row.id)]),
      )
      return adminPage(ctx, url, req, {
        title: 'manufacturing_backend.orders.title',
        body: (_, frame) =>
          ordersListScreen(
            _,
            {
              rows: rows.map((row) => ({
                id: String(row.id),
                name: String(row.name),
                product: productsById.get(String(row.productId)) ?? String(row.productId),
                quantity: String(row.productQty),
                state: String(row.state),
                href: inLocale(url, `/admin/manufacturing/orders/${encodeURIComponent(String(row.id))}`),
              })),
              createHref: inLocale(url, '/admin/manufacturing/new'),
            },
            frame,
          ),
      })
    },

  '/admin/manufacturing/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const here = inLocale(url, '/admin/manufacturing/new')
      if (req.method === 'POST') {
        if (crossSite(req)) return text('Forbidden', { status: 403 })
        const form = await readForm(req)
        const values = productionValues(form)
        const result = await saveProduction(ctx, url, req, values)
        if ((result as AnyRow).ok) return seeOther(inLocale(url, '/admin/manufacturing'))
        const _ = ctx.translate(ctx.localeOf(url, req))
        return productionCreatePage(
          ctx,
          url,
          req,
          here,
          values,
          resultErrors(result, _, 'manufacturing_backend.error.invalid'),
        )
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return productionCreatePage(ctx, url, req, here)
    },

  '/admin/manufacturing/orders/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      let result: unknown = { ok: true }
      let row = (await ctx.call('manufacturing.getProduction', { id: params.id }, url, req)) as AnyRow | null
      if (!row) return text('not found', { status: 404 })
      if (req.method === 'POST') {
        const form = await readForm(req)
        const workOrderId = url.searchParams.get('workOrderId')
        const workOrderVersion = Number(url.searchParams.get('workOrderVersion'))
        if (form.action === 'confirm')
          result = await ctx.call(
            'manufacturing.confirmProduction',
            { id: row.id, version: Number(row.version) },
            url,
            req,
          )
        else if (form.action === 'start')
          result = await ctx.call(
            'manufacturing.startProduction',
            { id: row.id, version: Number(row.version) },
            url,
            req,
          )
        else if (form.action === 'complete')
          result = await ctx.call(
            'manufacturing.completeProduction',
            { id: row.id, version: Number(row.version) },
            url,
            req,
          )
        else if (form.action === 'cancel')
          result = await ctx.call(
            'manufacturing.cancelProduction',
            { id: row.id, version: Number(row.version) },
            url,
            req,
          )
        else if (form.action === 'start-work' && workOrderId)
          result = await ctx.call(
            'manufacturing.startWorkOrder',
            { id: workOrderId, version: workOrderVersion },
            url,
            req,
          )
        else if (form.action === 'pause-work' && workOrderId)
          result = await ctx.call(
            'manufacturing.pauseWorkOrder',
            { id: workOrderId, version: workOrderVersion },
            url,
            req,
          )
        else if (form.action === 'finish-work' && workOrderId)
          result = await ctx.call(
            'manufacturing.finishWorkOrder',
            { id: workOrderId, version: workOrderVersion },
            url,
            req,
          )
        else return text('unknown action', { status: 400 })
        if ((result as AnyRow).ok)
          return seeOther(inLocale(url, `/admin/manufacturing/orders/${encodeURIComponent(String(row.id))}`))
        row = (await ctx.call('manufacturing.getProduction', { id: params.id }, url, req)) as AnyRow
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return adminPage(ctx, url, req, {
        title: String(row.name),
        translate: false,
        active: '/admin/manufacturing',
        body: (_, frame) =>
          orderScreen(
            _,
            frame,
            row!,
            resultErrors(result, _, 'manufacturing_backend.error.invalid'),
            inLocale(url, `/admin/manufacturing/orders/${encodeURIComponent(String(row!.id))}`),
          ),
      })
    },

  '/admin/manufacturing/boms':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const data = await common(ctx, url, req)
      if (req.method === 'POST') {
        const values = bomValues(await readForm(req))
        const result = await saveBom(ctx, url, req, values)
        if ((result as AnyRow).ok) return seeOther(inLocale(url, '/admin/manufacturing/boms'))
        const _ = ctx.translate(ctx.localeOf(url, req))
        return bomsPage(
          ctx,
          url,
          req,
          data,
          values,
          resultErrors(result, _, 'manufacturing_backend.error.invalid'),
        )
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return bomsPage(ctx, url, req, data)
    },

  '/admin/manufacturing/boms/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      if (req.method === 'GET') return seeOther(inLocale(url, '/admin/manufacturing/boms?create=1'))
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const data = await common(ctx, url, req)
      const values = bomValues(await readForm(req))
      const result = await saveBom(ctx, url, req, values)
      if ((result as AnyRow).ok) return seeOther(inLocale(url, '/admin/manufacturing/boms'))
      const _ = ctx.translate(ctx.localeOf(url, req))
      return bomsPage(
        ctx,
        url,
        req,
        data,
        values,
        resultErrors(result, _, 'manufacturing_backend.error.invalid'),
      )
    },

  '/admin/manufacturing/work-centers':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      let result: unknown = { ok: true }
      if (req.method === 'POST') {
        const form = await readForm(req)
        result = await ctx.call(
          'manufacturing.saveWorkCenter',
          {
            id: form.id || crypto.randomUUID(),
            code: form.code,
            name: form.name,
            capacity: form.capacity || '1',
            timeEfficiency: form.timeEfficiency || '100',
            costPerHour: form.costPerHour || '0',
          },
          url,
          req,
        )
        if ((result as AnyRow).ok) return seeOther('/admin/manufacturing/work-centers')
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows = (await ctx.call('manufacturing.listWorkCenters', {}, url, req)) as AnyRow[]
      return adminPage(ctx, url, req, {
        title: 'manufacturing_backend.workCenters.title',
        body: (_, frame) =>
          workCentersScreen(_, frame, rows, resultErrors(result, _, 'manufacturing_backend.error.invalid')),
      })
    },
}
