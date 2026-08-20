import { randomUUID } from 'node:crypto'
import { json, page, text } from 'ketjs'
import type { Route, RouteEntry, ServeContext } from 'ketjs'
import type { Translator } from 'ketjs'
import type { JSXChild } from 'ketjs-view'
import { metric, recordForm, stack, surface } from '../../ui/index.ts'
import { errorsOf, readForm, seeOther } from '../backend/forms.ts'
import { viewerOf } from '../backend/routes.ts'
import { inventoryScreen } from './inventory-screen.tsx'
import { locationsScreen } from './locations-screen.tsx'
import { pickingTypesScreen } from './picking-types-screen.tsx'
import { stockScreen } from './screens.ts'
import type { StockRow } from './screens.ts'
import { transferDetailScreen } from './transfer-screen.tsx'
import { transfersScreen } from './transfers-screen.tsx'
import { warehousesScreen } from './warehouses-screen.tsx'

type Req = Parameters<Route>[1]
type AnyRow = Record<string, unknown>

const frame = async (ctx: ServeContext, url: URL, req: Req) => ({
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(url, req),
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
    'sidebar.foot': await ctx.joint(url, req, 'backend:sidebar.foot', {
      lang: ctx.localeOf(url, req),
    }),
  },
})

const render = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  titleKey: string,
  rows: StockRow[],
  additions: readonly JSXChild[] = [],
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

const completeLocationName = (row: AnyRow, nameById: Map<string, string>) =>
  String(row.parentPath)
    .split('/')
    .filter(Boolean)
    .map((id) => nameById.get(id) ?? id)
    .join(' / ')

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
      const suffix = String(row.id).split(':').at(-1) ?? ''
      const defaults: Record<string, string> = {
        incoming: 'Receipts',
        outgoing: 'Delivery Orders',
        internal: 'Internal Transfers',
        quality: 'Quality Control',
        store: 'Store',
        pick: 'Pick',
        pack: 'Pack',
        adjustment: 'Inventory Adjustments',
      }
      return defaults[suffix] === row.name
        ? { ...row, name: selectionLabel(_, 'record.pickingType', suffix) }
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
  (result as { ok?: boolean }).ok
    ? seeOther(success)
    : seeOther(`${success}${success.includes('?') ? '&' : '?'}invalid=1`)
const isStockPartial = (req: Req): boolean => req.headers['x-ket-partial'] === 'stock-transfer'
const dateTimeLabel = (value: unknown, lang: string): string => {
  const raw = String(value ?? '')
  if (!raw) return ''
  const date = new Date(raw)
  return Number.isNaN(date.getTime())
    ? raw
    : new Intl.DateTimeFormat(lang === 'vi' ? 'vi-VN' : 'en-US', {
        dateStyle: 'short',
        timeStyle: 'short',
      }).format(date)
}
const inLocale = (url: URL, path: string): string => {
  const target = new URL(path, 'http://ket.local')
  const lang = url.searchParams.get('lang')
  if (lang) target.searchParams.set('lang', lang)
  return `${target.pathname}${target.search}`
}

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
        return (result as { ok?: boolean }).ok
          ? seeOther(inLocale(url, '/admin/inventory?applied=1'))
          : seeOther(inLocale(url, '/admin/inventory?invalid=1'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [quants, data, templates] = (await Promise.all([
        ctx.call('stock.listQuants', {}, url, req),
        common(ctx, url, req),
        ctx.call('stock.listStorableProducts', {}, url, req),
      ])) as [AnyRow[], Awaited<ReturnType<typeof common>>, AnyRow[]]
      const products = templates.flatMap((template) =>
        (Array.isArray(template.variants) ? (template.variants as AnyRow[]) : [])
          .filter((variant) => variant.active !== false)
          .map((variant) => ({
            value: String(variant.id),
            name: String(template.name),
            label: variant.defaultCode
              ? `${String(template.name)} · ${String(variant.defaultCode)}`
              : String(template.name),
            reference: String(variant.defaultCode ?? ''),
          })),
      )
      const productById = new Map(products.map((product) => [product.value, product]))
      const locationById = new Map(data.locations.map((location) => [String(location.id), location]))
      const lotById = new Map(data.lots.map((lot) => [String(lot.id), lot]))
      const rows = quants
        .filter((quant) =>
          ['internal', 'transit'].includes(String(locationById.get(String(quant.locationId))?.usage)),
        )
        .map((quant) => {
          const product = productById.get(String(quant.productId))
          const quantity = String(quant.quantity)
          const reserved = String(quant.reservedQuantity)
          return {
            id: String(quant.id),
            product: product?.name ?? String(quant.productId),
            reference: product?.reference ?? '',
            location: String(locationById.get(String(quant.locationId))?.name ?? quant.locationId),
            lot: String(lotById.get(String(quant.lotId))?.name ?? ''),
            quantity,
            reserved,
            available: String(Number(quantity) - Number(reserved)),
          }
        })
      return page({
        body: ctx.document({
          lang,
          title: _('stock_backend.inventory'),
          head: await ctx.styles(req),
          body: inventoryScreen(
            _,
            {
              rows,
              products: products.map(({ value, label }) => ({ value, label })),
              locations: options(data.locations.filter((row) => row.usage === 'internal')),
              inventoryLocations: options(data.locations.filter((row) => row.usage === 'inventory')),
              units: options(data.units),
              lots: options(data.lots),
              action: inLocale(url, '/admin/inventory'),
              locationsHref: inLocale(url, '/admin/locations'),
              applied: url.searchParams.has('applied'),
              errors: invalid(url, _),
            },
            await frame(ctx, url, req),
          ),
        }),
      })
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
          ? seeOther(inLocale(url, `/admin/transfers/${id}`))
          : seeOther(inLocale(url, '/admin/transfers?invalid=1'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [pickings, data] = (await Promise.all([
        ctx.call('stock.listPickings', {}, url, req),
        common(ctx, url, req),
      ])) as [AnyRow[], Awaited<ReturnType<typeof common>>]
      const locationsById = new Map(data.locations.map((row) => [String(row.id), String(row.name)]))
      const pickingTypesById = new Map(data.pickingTypes.map((row) => [String(row.id), String(row.name)]))
      return page({
        body: ctx.document({
          lang,
          title: _('stock_backend.transfers'),
          head: await ctx.styles(req),
          body: transfersScreen(
            _,
            {
              rows: pickings.map((row) => ({
                id: String(row.id),
                name: String(row.name),
                operationType: pickingTypesById.get(String(row.pickingTypeId)) ?? String(row.pickingTypeId),
                source: locationsById.get(String(row.locationId)) ?? String(row.locationId),
                destination: locationsById.get(String(row.locationDestId)) ?? String(row.locationDestId),
                scheduledDate: dateTimeLabel(row.scheduledDate, lang),
                state: String(row.state),
                href: inLocale(url, `/admin/transfers/${String(row.id)}`),
              })),
              pickingTypes: options(data.pickingTypes),
              action: inLocale(url, '/admin/transfers'),
              errors: invalid(url, _),
            },
            await frame(ctx, url, req),
          ),
        }),
      })
    },

  '/admin/transfers/{id}':
    (ctx): Route =>
    async (url, req, params) => {
      const here = `${url.pathname}${url.search}`
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      let current = (await ctx.call('stock.getPicking', { id: params.id }, url, req)) as AnyRow | null
      if (!current) return text('Transfer not found', { status: 404 })
      let moves = Array.isArray(current.moves) ? (current.moves as AnyRow[]) : []
      let savedPartial = false
      if (req.method === 'POST') {
        const partial = isStockPartial(req)
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
        else if (form.action === 'pick') {
          const operationId = String(form.operationId ?? '')
          const existingLine = moves
            .flatMap((move) => (Array.isArray(move.lines) ? (move.lines as AnyRow[]) : []))
            .find((line) => `line:${String(line.id)}` === operationId)
          const move = existingLine
            ? moves.find((candidate) => candidate.id === existingLine.moveId)
            : moves.find((candidate) => `move:${String(candidate.id)}` === operationId)
          result = move
            ? await ctx.call(
                'stock.saveMoveLine',
                {
                  id: existingLine?.id ?? randomUUID(),
                  moveId: move.id,
                  quantity: form.quantity || existingLine?.quantity || '0',
                  picked: true,
                  ...(form.lotId || existingLine?.lotId ? { lotId: form.lotId || existingLine?.lotId } : {}),
                },
                url,
                req,
              )
            : { ok: false }
        } else if (form.action === 'validate')
          result = await ctx.call(
            'stock.validatePicking',
            { id: params.id, ...(form.backorder ? { backorder: form.backorder } : {}) },
            url,
            req,
          )
        else if (form.action === 'cancel')
          result = await ctx.call('stock.cancelPicking', { id: params.id }, url, req)
        else return text('Unknown transfer action', { status: 400 })
        if (!(result as { ok?: boolean }).ok) {
          if (partial)
            return json(
              { ok: false, message: _('stock_backend.error.invalid'), errors: errorsOf(result) },
              { status: 422 },
            )
          return resultRedirect(result, here)
        }
        if (!partial) return seeOther(here)
        savedPartial = true
        current = (await ctx.call('stock.getPicking', { id: params.id }, url, req)) as AnyRow | null
        if (!current) return text('Transfer not found', { status: 404 })
        moves = Array.isArray(current.moves) ? (current.moves as AnyRow[]) : []
      }
      if (req.method !== 'GET' && !savedPartial) return text('GET or POST', { status: 405 })
      const data = await common(ctx, url, req)
      const operationOptions = moves.flatMap((move) => {
        const lines = Array.isArray(move.lines) ? (move.lines as AnyRow[]) : []
        return lines.length
          ? lines.map((line) => ({
              value: `line:${String(line.id)}`,
              label: `${String(move.name)} · ${String(line.lotId ?? '—')} · ${String(line.quantity)}`,
            }))
          : [{ value: `move:${String(move.id)}`, label: String(move.name) }]
      })
      const pickingType = data.pickingTypes.find((row) => row.id === current.pickingTypeId)
      const backorderPolicy = String(pickingType?.createBackorder ?? 'ask')
      const state = String(current.state)
      const moveRows = moves.flatMap((move) => [
        {
          id: String(move.id),
          name: String(move.name),
          kind: 'move',
          state: String(move.state),
          detail: `${String(move.quantity)} / ${String(move.productUomQty)} ${String(move.productUomId)}`,
        },
        ...(Array.isArray(move.lines) ? (move.lines as AnyRow[]) : []).map((line) => ({
          id: String(line.id),
          name: `${String(move.name)} · ${String(line.lotId ?? '—')}`,
          kind: 'move-line',
          state: line.picked ? 'done' : 'reserved',
          detail: `${String(line.quantity)} ${String(line.productUomId)}`,
        })),
      ])
      return page({
        body: ctx.document({
          lang,
          title: _('stock_backend.transferDetail'),
          head: await ctx.styles(req),
          body: transferDetailScreen(
            _,
            {
              transfer: {
                id: String(current.id),
                name: String(current.name),
                state,
                scheduledDate: dateTimeLabel(current.scheduledDate, lang),
                pickingTypeName: String(pickingType?.name ?? current.pickingTypeId ?? ''),
              },
              rows: moveRows,
              units: options(data.units),
              lots: options(data.lots),
              operationOptions,
              backorderPolicy,
              action: here,
              collaboration: await ctx.joint(url, req, 'stock_backend:picking.collaboration', {
                resModel: 'stock.Picking',
                resId: String(current.id),
                lang,
              }),
              editor: await ctx.joint(url, req, 'stock_backend:picking.editor', {
                pickingId: String(current.id),
                lang,
              }),
              errors: invalid(url, _),
            },
            await frame(ctx, url, req),
          ),
        }),
      })
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
        return resultRedirect(result, inLocale(url, '/admin/warehouses'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows = (await ctx.call('stock.listWarehouses', {}, url, req)) as AnyRow[]
      return page({
        body: ctx.document({
          lang,
          title: _('stock_backend.warehouses'),
          head: await ctx.styles(req),
          body: warehousesScreen(
            _,
            {
              rows: rows.map((row) => ({
                id: String(row.id),
                name: String(row.name),
                code: String(row.code),
                receptionSteps: String(row.receptionSteps),
                deliverySteps: String(row.deliverySteps),
              })),
              action: inLocale(url, '/admin/warehouses'),
              errors: invalid(url, _),
            },
            await frame(ctx, url, req),
          ),
        }),
      })
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
        return resultRedirect(result, inLocale(url, '/admin/locations'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const data = await common(ctx, url, req)
      const nameById = new Map(data.locations.map((row) => [String(row.id), String(row.name)]))
      const warehouseById = new Map(data.warehouses.map((row) => [String(row.id), String(row.name)]))
      return page({
        body: ctx.document({
          lang,
          title: _('stock_backend.locations'),
          head: await ctx.styles(req),
          body: locationsScreen(
            _,
            {
              rows: data.locations.map((row) => ({
                id: String(row.id),
                completeName: completeLocationName(row, nameById),
                usage: String(row.usage),
                warehouse: warehouseById.get(String(row.warehouseId)) ?? '',
              })),
              warehouses: options(data.warehouses),
              parents: data.locations.map((row) => ({
                value: String(row.id),
                label: completeLocationName(row, nameById),
              })),
              action: inLocale(url, '/admin/locations'),
              errors: invalid(url, _),
            },
            await frame(ctx, url, req),
          ),
        }),
      })
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
        return resultRedirect(result, inLocale(url, '/admin/picking-types'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const data = await common(ctx, url, req)
      const rawLocationNameById = new Map(data.locations.map((row) => [String(row.id), String(row.name)]))
      const completeLocationNameById = new Map(
        data.locations.map((row) => [String(row.id), completeLocationName(row, rawLocationNameById)]),
      )
      const warehouseById = new Map(data.warehouses.map((row) => [String(row.id), String(row.name)]))
      return page({
        body: ctx.document({
          lang,
          title: _('stock_backend.pickingTypes'),
          head: await ctx.styles(req),
          body: pickingTypesScreen(
            _,
            {
              rows: data.pickingTypes.map((row) => ({
                id: String(row.id),
                name: String(row.name),
                code: String(row.code),
                warehouse: warehouseById.get(String(row.warehouseId)) ?? '',
                source: completeLocationNameById.get(String(row.defaultLocationSrcId)) ?? '',
                destination: completeLocationNameById.get(String(row.defaultLocationDestId)) ?? '',
                createBackorder: String(row.createBackorder ?? 'ask'),
              })),
              warehouses: options(data.warehouses),
              locations: data.locations.map((row) => ({
                value: String(row.id),
                label: completeLocationNameById.get(String(row.id)) ?? String(row.name),
              })),
              action: inLocale(url, '/admin/picking-types'),
              errors: invalid(url, _),
            },
            await frame(ctx, url, req),
          ),
        }),
      })
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
        return resultRedirect(result, inLocale(url, '/admin/lots'))
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
              action: inLocale(url, '/admin/lots'),
              submit: _('stock_backend.action.create'),
              submitVariant: 'primary',
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
          ? seeOther(inLocale(url, `/admin/stock-routes/${id}`))
          : seeOther(inLocale(url, '/admin/stock-routes?invalid=1'))
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
          href: inLocale(url, `/admin/stock-routes/${String(row.id)}`),
        })),
        [
          surface({
            body: recordForm({
              action: inLocale(url, '/admin/stock-routes'),
              submit: _('stock_backend.action.create'),
              submitVariant: 'primary',
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
        return resultRedirect(result, inLocale(url, `/admin/stock-routes/${params.id}`))
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
              action: inLocale(url, `/admin/stock-routes/${params.id}`),
              submit: _('stock_backend.action.addRule'),
              submitVariant: 'secondary',
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
        return resultRedirect(result, inLocale(url, '/admin/replenishment'))
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
              action: inLocale(url, '/admin/replenishment'),
              submit: _('stock_backend.action.create'),
              submitVariant: 'primary',
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
              action: inLocale(url, `/admin/replenishment/${String(row.id)}/run`),
              submit: `${_('stock_backend.action.run')}: ${String(row.productId)}`,
              submitVariant: 'secondary',
              layout: 'inline',
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
      return resultRedirect(result, inLocale(url, '/admin/replenishment'))
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
              action: inLocale(url, '/admin/forecast'),
              method: 'get',
              submit: _('stock_backend.action.calculate'),
              submitVariant: 'secondary',
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
