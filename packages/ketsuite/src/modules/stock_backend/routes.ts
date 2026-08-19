import { randomUUID } from 'node:crypto'
import { page, text } from 'ketjs'
import type { Route, RouteEntry, ServeContext } from 'ketjs'
import type { Translator } from 'ketjs'
import { metric, recordForm, section, stack, surface } from '../../ui/index.ts'
import type { FormField } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { viewerOf } from '../backend/routes.ts'
import { stockScreen } from './screens.ts'
import type { StockRow } from './screens.ts'

type Req = Parameters<Route>[1]
type AnyRow = Record<string, unknown>

const frame = async (ctx: ServeContext, url: URL, req: Req) => ({
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(url, req),
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
  },
})

const render = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  titleKey: string,
  rows: StockRow[],
  additions: readonly unknown[] = [],
  showEmpty = true,
) => {
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  return page({
    body: ctx.document({
      lang,
      title: _(titleKey),
      head: await ctx.styles(req),
      body: stockScreen(_, _(titleKey), rows, await frame(ctx, url, req), additions, showEmpty),
    }),
  })
}

const options = (rows: AnyRow[]) => rows.map((row) => ({ value: String(row.id), label: String(row.name) }))
const selectionLabel = (_: Translator, group: string, value: unknown): string => {
  const raw = String(value)
  const key = `stock_backend.${group}.${raw}`
  return _.resolves(key) ? _(key) : raw
}
const selectionOptions = (_: Translator, group: string, values: readonly string[]) =>
  values.map((value) => ({ value, label: selectionLabel(_, group, value) }))

const generatedNames: Record<string, string> = {
  stock: 'Stock',
  input: 'Input',
  quality: 'Quality',
  output: 'Output',
  pick: 'Pick',
  pack: 'Pack',
  supplier: 'Supplier',
  customer: 'Customer',
}

const localizeGeneratedRecords = (_: Translator, rows: AnyRow[], group: 'location' | 'pickingType') =>
  rows.map((row) => {
    if (group === 'pickingType') {
      const code = String(row.code ?? '')
      const defaults: Record<string, string> = {
        incoming: 'Receipts',
        outgoing: 'Delivery Orders',
        internal: 'Internal Transfers',
      }
      return defaults[code] === row.name
        ? { ...row, name: selectionLabel(_, 'record.pickingType', code) }
        : row
    }
    const suffix = String(row.id).split(':').at(-1) ?? ''
    return generatedNames[suffix] === row.name
      ? { ...row, name: selectionLabel(_, 'record.location', suffix) }
      : row
  })
const invalid = (url: URL, _: Translator) =>
  url.searchParams.has('invalid') ? [_('stock_backend.error.invalid')] : undefined
const resultRedirect = (result: unknown, success: string) =>
  (result as { ok?: boolean }).ok ? seeOther(success) : seeOther(`${success}?invalid=1`)

const common = async (ctx: ServeContext, url: URL, req: Req) => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  const [warehouses, locations, pickingTypes, lots, routes, units] = (await Promise.all([
    ctx.call('stock.listWarehouses', {}, url, req),
    ctx.call('stock.listLocations', {}, url, req),
    ctx.call('stock.listPickingTypes', {}, url, req),
    ctx.call('stock.listLots', {}, url, req),
    ctx.call('stock.listRoutes', {}, url, req),
    ctx.call('uom.listUnits', {}, url, req),
  ])) as [AnyRow[], AnyRow[], AnyRow[], AnyRow[], AnyRow[], AnyRow[]]
  return {
    warehouses,
    locations: localizeGeneratedRecords(_, locations, 'location'),
    pickingTypes: localizeGeneratedRecords(_, pickingTypes, 'pickingType'),
    lots,
    routes,
    units,
  }
}

export const routes: Record<string, RouteEntry> = {
  '/admin/inventory':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        const form = await readForm(req)
        const result = await ctx.call(
          'stock.adjustInventory',
          {
            id: randomUUID(),
            productId: form.productId ?? '',
            locationId: form.locationId ?? '',
            inventoryLocationId: form.inventoryLocationId ?? '',
            countedQuantity: form.countedQuantity || '0',
            productUomId: form.productUomId ?? '',
            ...(form.lotId ? { lotId: form.lotId } : {}),
          },
          url,
          req,
        )
        return resultRedirect(result, '/admin/inventory')
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [quants, data] = (await Promise.all([
        ctx.call('stock.listQuants', {}, url, req),
        common(ctx, url, req),
      ])) as [AnyRow[], Awaited<ReturnType<typeof common>>]
      const fields: FormField[] = [
        { name: 'productId', label: _('stock_backend.field.productId'), required: true },
        {
          name: 'locationId',
          label: _('stock_backend.field.location'),
          type: 'select',
          options: options(data.locations.filter((row) => row.usage === 'internal')),
          required: true,
        },
        {
          name: 'inventoryLocationId',
          label: _('stock_backend.field.inventoryLocation'),
          type: 'select',
          options: options(data.locations.filter((row) => row.usage === 'inventory')),
          required: true,
        },
        {
          name: 'productUomId',
          label: _('stock_backend.field.uom'),
          type: 'select',
          options: options(data.units),
          required: true,
        },
        {
          name: 'lotId',
          label: _('stock_backend.field.lot'),
          type: 'select',
          options: [{ value: '', label: '—' }, ...options(data.lots)],
        },
        { name: 'countedQuantity', label: _('stock_backend.field.counted'), type: 'decimal', required: true },
      ]
      return render(
        ctx,
        url,
        req,
        'stock_backend.inventory',
        quants.map((row) => ({
          id: String(row.id),
          name: String(row.productId),
          kind: 'quant',
          detail: `${String(row.quantity)} / ${String(row.reservedQuantity)} · ${String(row.locationId)}`,
        })),
        [
          section({
            title: _('stock_backend.adjustment.title'),
            body: surface({
              body: recordForm({
                action: '/admin/inventory',
                submit: _('stock_backend.action.apply'),
                errors: invalid(url, _),
                fields,
              }),
            }),
          }),
        ],
      )
    },

  '/admin/transfers':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        const form = await readForm(req)
        const id = randomUUID()
        const result = await ctx.call(
          'stock.createPicking',
          {
            id,
            name: form.name || id,
            pickingTypeId: form.pickingTypeId ?? '',
            ...(form.scheduledDate ? { scheduledDate: form.scheduledDate } : {}),
          },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeOther(`/admin/transfers/${id}`)
          : seeOther('/admin/transfers?invalid=1')
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [pickings, data] = (await Promise.all([
        ctx.call('stock.listPickings', {}, url, req),
        common(ctx, url, req),
      ])) as [AnyRow[], Awaited<ReturnType<typeof common>>]
      return render(
        ctx,
        url,
        req,
        'stock_backend.transfers',
        pickings.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          kind: 'transfer',
          state: String(row.state),
          detail: String(row.scheduledDate),
          href: `/admin/transfers/${String(row.id)}`,
        })),
        [
          surface({
            body: recordForm({
              action: '/admin/transfers',
              submit: _('stock_backend.action.create'),
              errors: invalid(url, _),
              fields: [
                { name: 'name', label: _('stock_backend.field.reference'), required: true },
                {
                  name: 'pickingTypeId',
                  label: _('stock_backend.field.operationType'),
                  type: 'select',
                  options: options(data.pickingTypes),
                  required: true,
                },
                {
                  name: 'scheduledDate',
                  label: _('stock_backend.field.scheduledDate'),
                  type: 'datetime-local',
                },
              ],
            }),
          }),
        ],
      )
    },

  '/admin/transfers/{id}':
    (ctx): Route =>
    async (url, req, params) => {
      const current = (await ctx.call('stock.getPicking', { id: params.id }, url, req)) as AnyRow | null
      if (!current) return text('Transfer not found', { status: 404 })
      if (req.method === 'POST') {
        const form = await readForm(req)
        let result: unknown
        if (form.action === 'add-move')
          result = await ctx.call(
            'stock.addMove',
            {
              id: randomUUID(),
              name: form.name || form.productId || '',
              pickingId: params.id,
              productId: form.productId ?? '',
              productUomId: form.productUomId ?? '',
              productUomQty: form.productUomQty || '0',
            },
            url,
            req,
          )
        else if (form.action === 'confirm')
          result = await ctx.call('stock.confirmPicking', { id: params.id }, url, req)
        else if (form.action === 'assign')
          result = await ctx.call('stock.assignPicking', { id: params.id }, url, req)
        else if (form.action === 'validate')
          result = await ctx.call('stock.validatePicking', { id: params.id }, url, req)
        else if (form.action === 'cancel')
          result = await ctx.call('stock.cancelPicking', { id: params.id }, url, req)
        else return text('Unknown transfer action', { status: 400 })
        return resultRedirect(result, `/admin/transfers/${params.id}`)
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const data = await common(ctx, url, req)
      const moves = Array.isArray(current.moves) ? (current.moves as AnyRow[]) : []
      const actionForm = (action: string, label: string) =>
        recordForm({
          action: `/admin/transfers/${params.id}`,
          submit: label,
          hidden: { action },
          fields: [],
        })
      return render(
        ctx,
        url,
        req,
        'stock_backend.transferDetail',
        moves.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          kind: 'move',
          state: String(row.state),
          detail: `${String(row.quantity)} / ${String(row.productUomQty)} ${String(row.productUomId)}`,
        })),
        [
          stack([
            metric({ label: _('stock_backend.field.reference'), value: String(current.name) }),
            metric({
              label: _('stock_backend.col.state'),
              value: selectionLabel(_, 'state', current.state),
            }),
          ]),
          surface({
            body: recordForm({
              action: `/admin/transfers/${params.id}`,
              submit: _('stock_backend.action.addMove'),
              hidden: { action: 'add-move' },
              errors: invalid(url, _),
              fields: [
                { name: 'name', label: _('stock_backend.col.name') },
                { name: 'productId', label: _('stock_backend.field.productId'), required: true },
                {
                  name: 'productUomId',
                  label: _('stock_backend.field.uom'),
                  type: 'select',
                  options: options(data.units),
                  required: true,
                },
                {
                  name: 'productUomQty',
                  label: _('stock_backend.field.demand'),
                  type: 'decimal',
                  required: true,
                },
              ],
            }),
          }),
          stack([
            actionForm('confirm', _('stock_backend.action.confirm')),
            actionForm('assign', _('stock_backend.action.assign')),
            actionForm('validate', _('stock_backend.action.validate')),
            actionForm('cancel', _('stock_backend.action.cancel')),
          ]),
        ],
      )
    },

  '/admin/warehouses':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        const form = await readForm(req)
        const result = await ctx.call(
          'stock.saveWarehouse',
          {
            id: randomUUID(),
            name: form.name ?? '',
            code: form.code ?? '',
            receptionSteps: form.receptionSteps || 'one_step',
            deliverySteps: form.deliverySteps || 'ship_only',
          },
          url,
          req,
        )
        return resultRedirect(result, '/admin/warehouses')
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows = (await ctx.call('stock.listWarehouses', {}, url, req)) as AnyRow[]
      return render(
        ctx,
        url,
        req,
        'stock_backend.warehouses',
        rows.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          kind: 'warehouse',
          detail: `${String(row.code)} · ${selectionLabel(_, 'receptionSteps', row.receptionSteps)} / ${selectionLabel(_, 'deliverySteps', row.deliverySteps)}`,
        })),
        [
          surface({
            body: recordForm({
              action: '/admin/warehouses',
              submit: _('stock_backend.action.create'),
              errors: invalid(url, _),
              fields: [
                { name: 'name', label: _('stock_backend.col.name'), required: true },
                { name: 'code', label: _('stock_backend.field.code'), required: true },
                {
                  name: 'receptionSteps',
                  label: _('stock_backend.field.receptionSteps'),
                  type: 'select',
                  options: selectionOptions(_, 'receptionSteps', ['one_step', 'two_steps', 'three_steps']),
                },
                {
                  name: 'deliverySteps',
                  label: _('stock_backend.field.deliverySteps'),
                  type: 'select',
                  options: selectionOptions(_, 'deliverySteps', ['ship_only', 'pick_ship', 'pick_pack_ship']),
                },
              ],
            }),
          }),
        ],
      )
    },

  '/admin/locations':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        const form = await readForm(req)
        const result = await ctx.call(
          'stock.saveLocation',
          {
            id: randomUUID(),
            name: form.name ?? '',
            usage: form.usage || 'internal',
            ...(form.parentId ? { parentId: form.parentId } : {}),
            ...(form.warehouseId ? { warehouseId: form.warehouseId } : {}),
          },
          url,
          req,
        )
        return resultRedirect(result, '/admin/locations')
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const data = await common(ctx, url, req)
      return render(
        ctx,
        url,
        req,
        'stock_backend.locations',
        data.locations.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          kind: String(row.usage),
          detail: String(row.parentPath),
        })),
        [
          surface({
            body: recordForm({
              action: '/admin/locations',
              submit: _('stock_backend.action.create'),
              errors: invalid(url, _),
              fields: [
                { name: 'name', label: _('stock_backend.col.name'), required: true },
                {
                  name: 'usage',
                  label: _('stock_backend.field.usage'),
                  type: 'select',
                  options: selectionOptions(_, 'usage', [
                    'internal',
                    'view',
                    'supplier',
                    'customer',
                    'inventory',
                    'production',
                    'transit',
                  ]),
                },
                {
                  name: 'warehouseId',
                  label: _('stock_backend.field.warehouse'),
                  type: 'select',
                  options: [{ value: '', label: '—' }, ...options(data.warehouses)],
                },
                {
                  name: 'parentId',
                  label: _('stock_backend.field.parentLocation'),
                  type: 'select',
                  options: [{ value: '', label: '—' }, ...options(data.locations)],
                },
              ],
            }),
          }),
        ],
      )
    },

  '/admin/picking-types':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        const form = await readForm(req)
        const result = await ctx.call(
          'stock.savePickingType',
          {
            id: randomUUID(),
            name: form.name ?? '',
            code: form.code || 'internal',
            ...(form.warehouseId ? { warehouseId: form.warehouseId } : {}),
            ...(form.defaultLocationSrcId ? { defaultLocationSrcId: form.defaultLocationSrcId } : {}),
            ...(form.defaultLocationDestId ? { defaultLocationDestId: form.defaultLocationDestId } : {}),
            createBackorder: form.createBackorder || 'ask',
          },
          url,
          req,
        )
        return resultRedirect(result, '/admin/picking-types')
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const data = await common(ctx, url, req)
      return render(
        ctx,
        url,
        req,
        'stock_backend.pickingTypes',
        data.pickingTypes.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          kind: String(row.code),
          detail: `${String(row.defaultLocationSrcId)} → ${String(row.defaultLocationDestId)}`,
        })),
        [
          surface({
            body: recordForm({
              action: '/admin/picking-types',
              submit: _('stock_backend.action.create'),
              fields: [
                { name: 'name', label: _('stock_backend.col.name'), required: true },
                {
                  name: 'code',
                  label: _('stock_backend.field.code'),
                  type: 'select',
                  options: selectionOptions(_, 'pickingType', ['incoming', 'outgoing', 'internal']),
                },
                {
                  name: 'warehouseId',
                  label: _('stock_backend.field.warehouse'),
                  type: 'select',
                  options: options(data.warehouses),
                },
                {
                  name: 'defaultLocationSrcId',
                  label: _('stock_backend.field.sourceLocation'),
                  type: 'select',
                  options: options(data.locations),
                },
                {
                  name: 'defaultLocationDestId',
                  label: _('stock_backend.field.destinationLocation'),
                  type: 'select',
                  options: options(data.locations),
                },
                {
                  name: 'createBackorder',
                  label: _('stock_backend.field.backorder'),
                  type: 'select',
                  options: selectionOptions(_, 'backorder', ['ask', 'always', 'never']),
                },
              ],
            }),
          }),
        ],
      )
    },

  '/admin/lots':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        const form = await readForm(req)
        const result = await ctx.call(
          'stock.createLot',
          {
            id: randomUUID(),
            productId: form.productId ?? '',
            name: form.name ?? '',
            ref: form.ref || null,
            note: form.note || null,
          },
          url,
          req,
        )
        return resultRedirect(result, '/admin/lots')
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const lots = (await ctx.call('stock.listLots', {}, url, req)) as AnyRow[]
      return render(
        ctx,
        url,
        req,
        'stock_backend.lots',
        lots.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          kind: 'lot',
          detail: `${String(row.productId)} · ${String(row.ref ?? '')}`,
        })),
        [
          surface({
            body: recordForm({
              action: '/admin/lots',
              submit: _('stock_backend.action.create'),
              errors: invalid(url, _),
              fields: [
                { name: 'productId', label: _('stock_backend.field.productId'), required: true },
                { name: 'name', label: _('stock_backend.field.lotSerial'), required: true },
                { name: 'ref', label: _('stock_backend.field.reference') },
                { name: 'note', label: _('stock_backend.field.note'), type: 'textarea', span: 'full' },
              ],
            }),
          }),
        ],
      )
    },

  '/admin/stock-routes':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        const form = await readForm(req)
        const id = randomUUID()
        const result = await ctx.call(
          'stock.saveRoute',
          { id, name: form.name ?? '', sequence: Number(form.sequence || 10) },
          url,
          req,
        )
        return (result as { ok?: boolean }).ok
          ? seeOther(`/admin/stock-routes/${id}`)
          : seeOther('/admin/stock-routes?invalid=1')
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows = (await ctx.call('stock.listRoutes', {}, url, req)) as AnyRow[]
      return render(
        ctx,
        url,
        req,
        'stock_backend.routes',
        rows.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          kind: 'route',
          detail: String(row.sequence),
          href: `/admin/stock-routes/${String(row.id)}`,
        })),
        [
          surface({
            body: recordForm({
              action: '/admin/stock-routes',
              submit: _('stock_backend.action.create'),
              fields: [
                { name: 'name', label: _('stock_backend.col.name'), required: true },
                { name: 'sequence', label: _('stock_backend.field.sequence'), type: 'number', value: 10 },
              ],
            }),
          }),
        ],
      )
    },

  '/admin/stock-routes/{id}':
    (ctx): Route =>
    async (url, req, params) => {
      const routes = (await ctx.call('stock.listRoutes', {}, url, req)) as AnyRow[]
      const route = routes.find((row) => row.id === params.id)
      if (!route) return text('Route not found', { status: 404 })
      if (req.method === 'POST') {
        const form = await readForm(req)
        const result = await ctx.call(
          'stock.saveRule',
          {
            id: randomUUID(),
            name: form.name ?? '',
            routeId: params.id,
            action: form.action || 'pull',
            sequence: Number(form.sequence || 20),
            ...(form.locationSrcId ? { locationSrcId: form.locationSrcId } : {}),
            locationDestId: form.locationDestId ?? '',
            pickingTypeId: form.pickingTypeId ?? '',
            procureMethod: form.procureMethod || 'make_to_stock',
          },
          url,
          req,
        )
        return resultRedirect(result, `/admin/stock-routes/${params.id}`)
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const [rules, data] = (await Promise.all([
        ctx.call('stock.listRules', { routeId: params.id }, url, req),
        common(ctx, url, req),
      ])) as [AnyRow[], Awaited<ReturnType<typeof common>>]
      return render(
        ctx,
        url,
        req,
        'stock_backend.routeDetail',
        rules.map((row) => ({
          id: String(row.id),
          name: String(row.name),
          kind: String(row.action),
          detail: `${String(row.locationSrcId ?? '—')} → ${String(row.locationDestId)} · ${selectionLabel(_, 'procureMethod', row.procureMethod)}`,
        })),
        [
          surface({
            body: recordForm({
              action: `/admin/stock-routes/${params.id}`,
              submit: _('stock_backend.action.addRule'),
              errors: invalid(url, _),
              fields: [
                { name: 'name', label: _('stock_backend.col.name'), required: true },
                {
                  name: 'action',
                  label: _('stock_backend.field.ruleAction'),
                  type: 'select',
                  options: selectionOptions(_, 'ruleAction', ['pull', 'push', 'pull_push']),
                },
                { name: 'sequence', label: _('stock_backend.field.sequence'), type: 'number', value: 20 },
                {
                  name: 'locationSrcId',
                  label: _('stock_backend.field.sourceLocation'),
                  type: 'select',
                  options: [{ value: '', label: '—' }, ...options(data.locations)],
                },
                {
                  name: 'locationDestId',
                  label: _('stock_backend.field.destinationLocation'),
                  type: 'select',
                  options: options(data.locations),
                  required: true,
                },
                {
                  name: 'pickingTypeId',
                  label: _('stock_backend.field.operationType'),
                  type: 'select',
                  options: options(data.pickingTypes),
                  required: true,
                },
                {
                  name: 'procureMethod',
                  label: _('stock_backend.field.procureMethod'),
                  type: 'select',
                  options: selectionOptions(_, 'procureMethod', [
                    'make_to_stock',
                    'make_to_order',
                    'mts_else_mto',
                  ]),
                },
              ],
            }),
          }),
        ],
      )
    },

  '/admin/replenishment':
    (ctx): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        const form = await readForm(req)
        const result = await ctx.call(
          'stock.saveOrderpoint',
          {
            id: randomUUID(),
            productId: form.productId ?? '',
            warehouseId: form.warehouseId ?? '',
            locationId: form.locationId ?? '',
            trigger: form.trigger || 'auto',
            minQuantity: form.minQuantity || '0',
            maxQuantity: form.maxQuantity || '0',
            ...(form.replenishmentUomId ? { replenishmentUomId: form.replenishmentUomId } : {}),
            ...(form.routeId ? { routeId: form.routeId } : {}),
          },
          url,
          req,
        )
        return resultRedirect(result, '/admin/replenishment')
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [points, data] = (await Promise.all([
        ctx.call('stock.listOrderpoints', {}, url, req),
        common(ctx, url, req),
      ])) as [AnyRow[], Awaited<ReturnType<typeof common>>]
      return render(
        ctx,
        url,
        req,
        'stock_backend.replenishment',
        points.map((row) => ({
          id: String(row.id),
          name: String(row.productId),
          kind: String(row.trigger),
          detail: `${String(row.minQuantity)} / ${String(row.maxQuantity)} · ${String(row.locationId)}`,
        })),
        [
          surface({
            body: recordForm({
              action: '/admin/replenishment',
              submit: _('stock_backend.action.create'),
              errors: invalid(url, _),
              fields: [
                { name: 'productId', label: _('stock_backend.field.productId'), required: true },
                {
                  name: 'warehouseId',
                  label: _('stock_backend.field.warehouse'),
                  type: 'select',
                  options: options(data.warehouses),
                  required: true,
                },
                {
                  name: 'locationId',
                  label: _('stock_backend.field.location'),
                  type: 'select',
                  options: options(data.locations),
                  required: true,
                },
                {
                  name: 'trigger',
                  label: _('stock_backend.field.trigger'),
                  type: 'select',
                  options: selectionOptions(_, 'trigger', ['auto', 'manual']),
                },
                {
                  name: 'minQuantity',
                  label: _('stock_backend.field.minQuantity'),
                  type: 'decimal',
                  value: 0,
                },
                {
                  name: 'maxQuantity',
                  label: _('stock_backend.field.maxQuantity'),
                  type: 'decimal',
                  value: 0,
                },
                {
                  name: 'replenishmentUomId',
                  label: _('stock_backend.field.replenishmentUom'),
                  type: 'select',
                  options: options(data.units),
                },
                {
                  name: 'routeId',
                  label: _('stock_backend.field.route'),
                  type: 'select',
                  options: [{ value: '', label: '—' }, ...options(data.routes)],
                },
              ],
            }),
          }),
          ...points.map((row) =>
            recordForm({
              action: `/admin/replenishment/${String(row.id)}/run`,
              submit: `${_('stock_backend.action.run')}: ${String(row.productId)}`,
              fields: [],
            }),
          ),
        ],
      )
    },

  '/admin/replenishment/{id}/run':
    (ctx): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const result = await ctx.call(
        'stock.runOrderpoint',
        { id: params.id, moveId: `${params.id}:${randomUUID()}` },
        url,
        req,
      )
      return resultRedirect(result, '/admin/replenishment')
    },

  '/admin/forecast':
    (ctx): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const productId = url.searchParams.get('productId') ?? ''
      const locationId = url.searchParams.get('locationId') ?? ''
      const warehouseId = url.searchParams.get('warehouseId') ?? ''
      const data = await common(ctx, url, req)
      const forecast = productId
        ? ((await ctx.call(
            'stock.forecast',
            { productId, ...(locationId ? { locationId } : {}), ...(warehouseId ? { warehouseId } : {}) },
            url,
            req,
          )) as AnyRow)
        : null
      return render(
        ctx,
        url,
        req,
        'stock_backend.forecast',
        [],
        [
          surface({
            body: recordForm({
              action: '/admin/forecast',
              method: 'get',
              submit: _('stock_backend.action.calculate'),
              fields: [
                {
                  name: 'productId',
                  label: _('stock_backend.field.productId'),
                  value: productId,
                  required: true,
                },
                {
                  name: 'warehouseId',
                  label: _('stock_backend.field.warehouse'),
                  type: 'select',
                  value: warehouseId,
                  options: [{ value: '', label: '—' }, ...options(data.warehouses)],
                },
                {
                  name: 'locationId',
                  label: _('stock_backend.field.location'),
                  type: 'select',
                  value: locationId,
                  options: [{ value: '', label: '—' }, ...options(data.locations)],
                },
              ],
            }),
          }),
          ...(forecast
            ? [
                stack([
                  metric({ label: _('stock_backend.forecast.onHand'), value: String(forecast.onHand) }),
                  metric({ label: _('stock_backend.forecast.incoming'), value: String(forecast.incoming) }),
                  metric({ label: _('stock_backend.forecast.outgoing'), value: String(forecast.outgoing) }),
                  metric({ label: _('stock_backend.forecast.value'), value: String(forecast.forecast) }),
                ]),
              ]
            : []),
        ],
        false,
      )
    },
}
