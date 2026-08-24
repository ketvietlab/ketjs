import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import type { FormField } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { adminPage, choices, resultErrors } from '../backend/screen.ts'
import type { AnyRow } from '../backend/screen.ts'
import { bomsScreen, orderScreen, ordersScreen, workCentersScreen } from './screens.tsx'

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

export const routes: Record<string, RouteEntry> = {
  '/admin/manufacturing':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      let result: unknown = { ok: true }
      const data = await common(ctx, url, req)
      if (req.method === 'POST') {
        const form = await readForm(req)
        result = await ctx.call(
          'manufacturing.saveProduction',
          {
            id: form.id || crypto.randomUUID(),
            name: form.name,
            bomId: form.bomId,
            productQty: form.productQty || '1',
            productUomId: form.productUomId,
            sourceLocationId: form.sourceLocationId,
            productionLocationId: form.productionLocationId,
            destinationLocationId: form.destinationLocationId,
            scheduledStart: form.scheduledStart || new Date().toISOString(),
          },
          url,
          req,
        )
        if ((result as AnyRow).ok) return seeOther('/admin/manufacturing')
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const fields: FormField[] = [
        { name: 'name', label: _('manufacturing_backend.field.name'), required: true },
        {
          name: 'bomId',
          label: _('manufacturing_backend.field.bom'),
          type: 'select',
          options: options(data.boms),
          required: true,
        },
        {
          name: 'productQty',
          label: _('manufacturing_backend.field.quantity'),
          type: 'decimal',
          value: 1,
          required: true,
        },
        {
          name: 'productUomId',
          label: _('manufacturing_backend.field.uom'),
          type: 'select',
          options: options(data.units),
          required: true,
        },
        {
          name: 'sourceLocationId',
          label: _('manufacturing_backend.field.source'),
          type: 'select',
          options: options(
            data.locations.filter((row) => ['internal', 'transit'].includes(String(row.usage))),
          ),
          required: true,
        },
        {
          name: 'productionLocationId',
          label: _('manufacturing_backend.field.production'),
          type: 'select',
          options: options(data.locations.filter((row) => row.usage === 'production')),
          required: true,
        },
        {
          name: 'destinationLocationId',
          label: _('manufacturing_backend.field.destination'),
          type: 'select',
          options: options(
            data.locations.filter((row) => ['internal', 'transit'].includes(String(row.usage))),
          ),
          required: true,
        },
        {
          name: 'scheduledStart',
          label: _('manufacturing_backend.field.scheduledStart'),
          type: 'datetime-local',
          required: true,
        },
      ]
      const rows = (await ctx.call('manufacturing.listProductions', {}, url, req)) as AnyRow[]
      return adminPage(ctx, url, req, {
        title: 'manufacturing_backend.orders.title',
        body: (_, frame) =>
          ordersScreen(
            _,
            frame,
            rows,
            fields,
            resultErrors(result, _, 'manufacturing_backend.error.invalid'),
          ),
      })
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
          return seeOther(`/admin/manufacturing/orders/${encodeURIComponent(String(row.id))}`)
        row = (await ctx.call('manufacturing.getProduction', { id: params.id }, url, req)) as AnyRow
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return adminPage(ctx, url, req, {
        title: String(row.name),
        translate: false,
        active: '/admin/manufacturing',
        body: (_, frame) =>
          orderScreen(_, frame, row!, resultErrors(result, _, 'manufacturing_backend.error.invalid')),
      })
    },

  '/admin/manufacturing/boms':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const data = await common(ctx, url, req)
      let result: unknown = { ok: true }
      if (req.method === 'POST') {
        const form = await readForm(req)
        const id = form.id || crypto.randomUUID()
        const operations = form.operationName
          ? [
              {
                id: `${id}:operation:1`,
                name: form.operationName,
                workCenterId: form.workCenterId,
                durationExpected: Number(form.durationExpected || 0),
              },
            ]
          : []
        result = await ctx.call(
          'manufacturing.saveBom',
          {
            id,
            code: form.code || null,
            productId: form.productId,
            productQty: form.productQty || '1',
            productUomId: form.productUomId,
            lines: form.componentId
              ? [
                  {
                    id: `${id}:line:1`,
                    productId: form.componentId,
                    productQty: form.componentQty || '1',
                    productUomId: form.componentUomId,
                    operationId: operations[0]?.id ?? null,
                  },
                ]
              : [],
            operations,
          },
          url,
          req,
        )
        if ((result as AnyRow).ok) return seeOther('/admin/manufacturing/boms')
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const fields: FormField[] = [
        { name: 'code', label: _('manufacturing_backend.field.code') },
        {
          name: 'productId',
          label: _('manufacturing_backend.field.product'),
          type: 'select',
          options: options(data.variants),
          required: true,
        },
        {
          name: 'productQty',
          label: _('manufacturing_backend.field.quantity'),
          type: 'decimal',
          value: 1,
          required: true,
        },
        {
          name: 'productUomId',
          label: _('manufacturing_backend.field.uom'),
          type: 'select',
          options: options(data.units),
          required: true,
        },
        {
          name: 'componentId',
          label: _('manufacturing_backend.field.component'),
          type: 'select',
          options: options(data.variants),
          required: true,
        },
        {
          name: 'componentQty',
          label: _('manufacturing_backend.field.quantity'),
          type: 'decimal',
          value: 1,
          required: true,
        },
        {
          name: 'componentUomId',
          label: _('manufacturing_backend.field.uom'),
          type: 'select',
          options: options(data.units),
          required: true,
        },
        { name: 'operationName', label: _('manufacturing_backend.field.operation') },
        {
          name: 'workCenterId',
          label: _('manufacturing_backend.field.workCenter'),
          type: 'select',
          options: options(data.workCenters, true),
        },
        {
          name: 'durationExpected',
          label: _('manufacturing_backend.field.duration'),
          type: 'number',
          value: 0,
        },
      ]
      const rows = (await ctx.call('manufacturing.listBoms', {}, url, req)) as AnyRow[]
      return adminPage(ctx, url, req, {
        title: 'manufacturing_backend.boms.title',
        body: (_, frame) =>
          bomsScreen(_, frame, rows, fields, resultErrors(result, _, 'manufacturing_backend.error.invalid')),
      })
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
