import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import type { Translator } from '@ketvietlab/ketjs'
import { actionGroup, backendPage, linkButton } from '../../ui/index.ts'
import { errorsOf, readForm, seeOther } from '../backend/forms.ts'
import { inventoryScreen } from './inventory-screen.tsx'
import { forecastScreen } from './forecast-screen.tsx'
import { locationsScreen } from './locations-screen.tsx'
import { lotDetailScreen } from './lot-screen.tsx'
import { lotsScreen } from './lots-screen.tsx'
import { pickingTypesScreen } from './picking-types-screen.tsx'
import { replenishmentScreen } from './replenishment-screen.tsx'
import { stockRouteDetailScreen } from './stock-route-screen.tsx'
import { stockRoutesScreen } from './stock-routes-screen.tsx'
import { transferDetailScreen } from './transfer-screen.tsx'
import { transfersScreen } from './transfers-screen.tsx'
import { warehousesScreen } from './warehouses-screen.tsx'
import { adminPage, frameOf, inLocale } from '../backend/screen.ts'
import { selectionLabel as resolveSelection } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'

const options = (rows: AnyRow[]) => rows.map((row) => ({ value: String(row.id), label: String(row.name) }))
/** A stable stock code in the reader's language; the code itself survives as data. */
const selectionLabel = (_: Translator, group: string, value: unknown): string =>
  resolveSelection(_, 'stock_backend', group, value)
const localizedGeneratedRouteName = (_: Translator, row: AnyRow): string => {
  const raw = String(row.name)
  const separator = raw.lastIndexOf(': ')
  const suffix = separator >= 0 ? raw.slice(separator + 2) : ''
  const group = String(row.id).endsWith(':receipt-route')
    ? 'receptionSteps'
    : String(row.id).endsWith(':delivery-route')
      ? 'deliverySteps'
      : ''
  const generated =
    (group === 'receptionSteps' && ['one_step', 'two_steps', 'three_steps'].includes(suffix)) ||
    (group === 'deliverySteps' && ['ship_only', 'pick_ship', 'pick_pack_ship'].includes(suffix))
  return generated ? `${raw.slice(0, separator)}: ${selectionLabel(_, group, suffix)}` : raw
}

const localizedGeneratedRuleName = (_: Translator, row: AnyRow): string => {
  const parts = String(row.id).split(':')
  const flow = parts.at(-2)
  const suffix = parts.at(-1) ?? ''
  const group = flow === 'receipt' ? 'record.receiptRule' : flow === 'delivery' ? 'record.deliveryRule' : ''
  const key = group ? `stock_backend.${group}.${suffix}` : ''
  return key && _.resolves(key) ? _(key) : String(row.name)
}

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
  '/admin/stock/inventory':
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
          ? seeOther(inLocale(url, '/admin/stock/inventory?applied=1'))
          : seeOther(inLocale(url, '/admin/stock/inventory?invalid=1'))
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
      return adminPage(ctx, url, req, {
        title: 'stock_backend.inventory',
        body: (_, frame) =>
          inventoryScreen(
            _,
            {
              rows,
              products: products.map(({ value, label }) => ({ value, label })),
              locations: options(data.locations.filter((row) => row.usage === 'internal')),
              inventoryLocations: options(data.locations.filter((row) => row.usage === 'inventory')),
              units: options(data.units),
              lots: options(data.lots),
              action: inLocale(url, '/admin/stock/inventory'),
              locationsHref: inLocale(url, '/admin/stock/locations'),
              applied: url.searchParams.has('applied'),
              errors: invalid(url, _),
            },
            frame,
          ),
      })
    },

  '/admin/stock/transfers':
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
          ? seeOther(inLocale(url, `/admin/stock/transfers/${id}`))
          : seeOther(inLocale(url, '/admin/stock/transfers?invalid=1'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [pickings, data] = (await Promise.all([
        ctx.call('stock.listPickings', {}, url, req),
        common(ctx, url, req),
      ])) as [AnyRow[], Awaited<ReturnType<typeof common>>]
      const locationsById = new Map(data.locations.map((row) => [String(row.id), String(row.name)]))
      const pickingTypesById = new Map(data.pickingTypes.map((row) => [String(row.id), String(row.name)]))
      return adminPage(ctx, url, req, {
        title: 'stock_backend.transfers',
        body: (_, frame) =>
          transfersScreen(
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
                href: inLocale(url, `/admin/stock/transfers/${String(row.id)}`),
              })),
              pickingTypes: options(data.pickingTypes),
              action: inLocale(url, '/admin/stock/transfers'),
              errors: invalid(url, _),
            },
            frame,
          ),
      })
    },

  '/admin/stock/transfers/{id}':
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
      const [data, templates] = await Promise.all([
        common(ctx, url, req),
        ctx.call('stock.listStorableProducts', {}, url, req) as Promise<AnyRow[]>,
      ])
      const products = templates.flatMap((template) =>
        (Array.isArray(template.variants) ? (template.variants as AnyRow[]) : [])
          .filter((variant) => variant.active !== false)
          .map((variant) => ({
            value: String(variant.id),
            label: variant.defaultCode
              ? `${String(template.name)} · ${String(variant.defaultCode)}`
              : String(template.name),
          })),
      )
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
      const reportId = {
        incoming: 'stock.receipt',
        outgoing: 'stock.delivery',
        internal: 'stock.internalTransfer',
      }[String(pickingType?.code)]
      const printable = (await ctx.reportsOf(url, req, 'stock.Picking')).filter(
        (report) => report.id === reportId,
      )
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
      return adminPage(ctx, url, req, {
        title: 'stock_backend.transferDetail',
        body: async (_, frame) =>
          transferDetailScreen(
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
              products,
              units: options(data.units),
              lots: options(data.lots),
              operationOptions,
              backorderPolicy,
              printActions: printable.length
                ? actionGroup({
                    label: 'Print',
                    actions: printable.map((report) =>
                      linkButton({
                        label: _(report.title),
                        href: `/reports/${encodeURIComponent(report.id)}/${encodeURIComponent(String(current.id))}${url.search}`,
                      }),
                    ),
                  })
                : undefined,
              action: here,
              collaboration: await ctx.joint(url, req, 'stock_backend:picking.collaboration', {
                resModel: 'stock.Picking',
                resId: String(current.id),
                lang,
              }),
              editor: await ctx.joint(url, req, 'stock_backend:picking.editor', {
                identity: `picking:${String(current.id)}`,
                pickingId: String(current.id),
                lang,
              }),
              errors: invalid(url, _),
            },
            frame,
          ),
      })
    },

  '/admin/stock/warehouses':
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
        return resultRedirect(result, inLocale(url, '/admin/stock/warehouses'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const rows = (await ctx.call('stock.listWarehouses', {}, url, req)) as AnyRow[]
      return adminPage(ctx, url, req, {
        title: 'stock_backend.warehouses',
        body: (_, frame) =>
          warehousesScreen(
            _,
            {
              rows: rows.map((row) => ({
                id: String(row.id),
                name: String(row.name),
                code: String(row.code),
                receptionSteps: String(row.receptionSteps),
                deliverySteps: String(row.deliverySteps),
              })),
              action: inLocale(url, '/admin/stock/warehouses'),
              errors: invalid(url, _),
            },
            frame,
          ),
      })
    },

  '/admin/stock/locations':
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
        return resultRedirect(result, inLocale(url, '/admin/stock/locations'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const data = await common(ctx, url, req)
      const nameById = new Map(data.locations.map((row) => [String(row.id), String(row.name)]))
      const warehouseById = new Map(data.warehouses.map((row) => [String(row.id), String(row.name)]))
      return adminPage(ctx, url, req, {
        title: 'stock_backend.locations',
        body: (_, frame) =>
          locationsScreen(
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
              action: inLocale(url, '/admin/stock/locations'),
              errors: invalid(url, _),
            },
            frame,
          ),
      })
    },

  '/admin/stock/picking-types':
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
        return resultRedirect(result, inLocale(url, '/admin/stock/picking-types'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const data = await common(ctx, url, req)
      const rawLocationNameById = new Map(data.locations.map((row) => [String(row.id), String(row.name)]))
      const completeLocationNameById = new Map(
        data.locations.map((row) => [String(row.id), completeLocationName(row, rawLocationNameById)]),
      )
      const warehouseById = new Map(data.warehouses.map((row) => [String(row.id), String(row.name)]))
      return adminPage(ctx, url, req, {
        title: 'stock_backend.pickingTypes',
        body: (_, frame) =>
          pickingTypesScreen(
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
              action: inLocale(url, '/admin/stock/picking-types'),
              errors: invalid(url, _),
            },
            frame,
          ),
      })
    },

  '/admin/stock/lots':
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
        return resultRedirect(result, inLocale(url, '/admin/stock/lots'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [lots, products, locations, quants] = (await Promise.all([
        ctx.call('stock.listLots', {}, url, req),
        ctx.call('stock.listStorableProducts', {}, url, req),
        ctx.call('stock.listLocations', {}, url, req),
        ctx.call('stock.listQuants', {}, url, req),
      ])) as [AnyRow[], AnyRow[], AnyRow[], AnyRow[]]
      const productOptions = products.flatMap((template) =>
        (Array.isArray(template.variants) ? (template.variants as AnyRow[]) : [])
          .filter((variant) => variant.active !== false)
          .map((variant) => ({
            value: String(variant.id),
            label: variant.defaultCode
              ? `${String(template.name)} · ${String(variant.defaultCode)}`
              : String(template.name),
          })),
      )
      const productById = new Map(productOptions.map((product) => [product.value, product.label]))
      const stockLocationIds = new Set(
        locations
          .filter((location) => ['internal', 'transit'].includes(String(location.usage)))
          .map((location) => String(location.id)),
      )
      const onHandByLot = new Map<string, number>()
      for (const quant of quants) {
        const lotId = String(quant.lotId ?? '')
        if (!lotId || !stockLocationIds.has(String(quant.locationId))) continue
        onHandByLot.set(lotId, (onHandByLot.get(lotId) ?? 0) + Number(quant.quantity ?? 0))
      }
      const number = new Intl.NumberFormat(lang === 'vi' ? 'vi-VN' : 'en-US', {
        maximumFractionDigits: 6,
      })
      return adminPage(ctx, url, req, {
        title: 'stock_backend.lots',
        body: (_, frame) =>
          lotsScreen(
            _,
            {
              rows: lots.map((row) => ({
                id: String(row.id),
                name: String(row.name),
                product: productById.get(String(row.productId)) ?? String(row.productId),
                reference: String(row.ref ?? ''),
                onHand: number.format(onHandByLot.get(String(row.id)) ?? 0),
                onHandValue: onHandByLot.get(String(row.id)) ?? 0,
                active: row.active !== false,
                href: inLocale(url, `/admin/stock/lots/${String(row.id)}`),
              })),
              products: productOptions,
              action: inLocale(url, '/admin/stock/lots'),
              errors: invalid(url, _),
            },
            frame,
          ),
      })
    },

  '/admin/stock/lots/{id}':
    (ctx): Route =>
    async (url, req, params) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const here = inLocale(url, `/admin/stock/lots/${params.id}`)
      if (req.method !== 'GET' && req.method !== 'POST') return text('GET or POST', { status: 405 })
      const lots = (await ctx.call('stock.listLots', {}, url, req)) as AnyRow[]
      let current = lots.find((row) => String(row.id) === params.id)
      if (!current) return text(_('stock_backend.lot.error.notFound'), { status: 404 })
      if (req.method === 'POST') {
        const partial = req.headers['x-ket-partial'] === 'stock-lot'
        const form = await readForm(req)
        const values = {
          productId: form.productId ?? '',
          name: form.name ?? '',
          ref: form.ref || null,
          note: form.note || null,
        }
        const result = await ctx.call(
          'stock.saveLot',
          {
            id: params.id,
            ...values,
          },
          url,
          req,
        )
        if (!(result as { ok?: boolean }).ok) {
          if (partial)
            return json(
              { ok: false, message: _('stock_backend.error.invalid'), errors: errorsOf(result) },
              { status: 422 },
            )
          return seeOther(`${here}${here.includes('?') ? '&' : '?'}invalid=1`)
        }
        if (!partial) return seeOther(here)
        current = { ...current, ...values }
      }
      const [products, rawLocations, quants] = (await Promise.all([
        ctx.call('stock.listStorableProducts', {}, url, req),
        ctx.call('stock.listLocations', {}, url, req),
        ctx.call('stock.listQuants', { productId: String(current.productId) }, url, req),
      ])) as [AnyRow[], AnyRow[], AnyRow[]]
      const locations = localizeGeneratedRecords(_, rawLocations, 'location')
      const listedProductOptions = products.flatMap((template) =>
        (Array.isArray(template.variants) ? (template.variants as AnyRow[]) : [])
          .filter((variant) => variant.active !== false)
          .map((variant) => ({
            value: String(variant.id),
            label: variant.defaultCode
              ? `${String(template.name)} · ${String(variant.defaultCode)}`
              : String(template.name),
          })),
      )
      const productOptions = listedProductOptions.some(
        (product) => product.value === String(current.productId),
      )
        ? listedProductOptions
        : [{ value: String(current.productId), label: String(current.productId) }, ...listedProductOptions]
      const productLabel =
        productOptions.find((product) => product.value === String(current.productId))?.label ??
        String(current.productId)
      const rawLocationNameById = new Map(
        locations.map((location) => [String(location.id), String(location.name)]),
      )
      const locationById = new Map(locations.map((location) => [String(location.id), location]))
      const locationNameById = new Map(
        locations.map((location) => [
          String(location.id),
          completeLocationName(location, rawLocationNameById),
        ]),
      )
      const inventoryRows = quants
        .filter((quant) => String(quant.lotId ?? '') === params.id)
        .map((quant) => {
          const quantity = String(quant.quantity)
          const reserved = String(quant.reservedQuantity)
          return {
            id: String(quant.id),
            location: locationNameById.get(String(quant.locationId)) ?? String(quant.locationId),
            quantity,
            reserved,
            available: String(Number(quantity) - Number(reserved)),
            countsAsOnHand: ['internal', 'transit'].includes(
              String(locationById.get(String(quant.locationId))?.usage),
            ),
          }
        })
      const body = lotDetailScreen(
        _,
        {
          lot: {
            id: String(current.id),
            name: String(current.name),
            productId: String(current.productId),
            productLabel,
            ref: String(current.ref ?? ''),
            note: String(current.note ?? ''),
            active: current.active !== false,
          },
          rows: inventoryRows,
          products: productOptions,
          action: here,
          collaboration: await ctx.joint(url, req, 'stock_backend:lot.collaboration', {
            resModel: 'stock.Lot',
            resId: String(current.id),
            lang,
          }),
          editor: await ctx.joint(url, req, 'stock_backend:lot.editor', {
            identity: `lot:${String(current.id)}`,
            lotId: String(current.id),
            lang,
          }),
          errors: invalid(url, _),
        },
        await frameOf(ctx, url, req),
      )
      return backendPage(ctx, req, {
        lang,
        title: String(current.name),
        body,
      })
    },

  '/admin/stock/routes':
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
          ? seeOther(inLocale(url, `/admin/stock/routes/${id}`))
          : seeOther(inLocale(url, '/admin/stock/routes?invalid=1'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [rows, rules] = (await Promise.all([
        ctx.call('stock.listRoutes', {}, url, req),
        ctx.call('stock.listRules', {}, url, req),
      ])) as [AnyRow[], AnyRow[]]
      const ruleCountByRoute = new Map<string, number>()
      for (const rule of rules) {
        const routeId = String(rule.routeId)
        ruleCountByRoute.set(routeId, (ruleCountByRoute.get(routeId) ?? 0) + 1)
      }
      return adminPage(ctx, url, req, {
        title: 'stock_backend.routes',
        body: (_, frame) =>
          stockRoutesScreen(
            _,
            {
              rows: rows.map((row) => ({
                id: String(row.id),
                name: localizedGeneratedRouteName(_, row),
                sequence: Number(row.sequence),
                ruleCount: ruleCountByRoute.get(String(row.id)) ?? 0,
                href: inLocale(url, `/admin/stock/routes/${String(row.id)}`),
              })),
              action: inLocale(url, '/admin/stock/routes'),
              errors: invalid(url, _),
            },
            frame,
          ),
      })
    },

  '/admin/stock/routes/{id}':
    (ctx): Route =>
    async (url, req, params) => {
      const routes = (await ctx.call('stock.listRoutes', {}, url, req)) as AnyRow[]
      const route = routes.find((row) => row.id === params.id)
      if (!route) return text('Route not found', { status: 404 })
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.intent === 'route') {
          const displayName = localizedGeneratedRouteName(ctx.translate(ctx.localeOf(url, req)), route)
          const submittedName = form.name ?? ''
          const result = await ctx.call(
            'stock.saveRoute',
            {
              id: params.id,
              name: submittedName === displayName ? String(route.name) : submittedName,
              sequence: Number(form.sequence || 10),
            },
            url,
            req,
          )
          const target = inLocale(url, `/admin/stock/routes/${params.id}`)
          return (result as { ok?: boolean }).ok
            ? seeOther(target)
            : seeOther(`${target}${target.includes('?') ? '&' : '?'}invalid=route`)
        }
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
        const target = inLocale(url, `/admin/stock/routes/${params.id}`)
        return (result as { ok?: boolean }).ok
          ? seeOther(target)
          : seeOther(`${target}${target.includes('?') ? '&' : '?'}invalid=rule`)
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const [rules, data] = (await Promise.all([
        ctx.call('stock.listRules', { routeId: params.id }, url, req),
        common(ctx, url, req),
      ])) as [AnyRow[], Awaited<ReturnType<typeof common>>]
      const locationById = new Map(data.locations.map((row) => [String(row.id), String(row.name)]))
      const pickingTypeById = new Map(data.pickingTypes.map((row) => [String(row.id), String(row.name)]))
      return adminPage(ctx, url, req, {
        title: 'stock_backend.routeDetail',
        body: (_, frame) =>
          stockRouteDetailScreen(
            _,
            {
              route: {
                id: String(route.id),
                name: localizedGeneratedRouteName(_, route),
                sequence: Number(route.sequence),
                active: route.active !== false,
              },
              rows: rules.map((row) => ({
                id: String(row.id),
                name: localizedGeneratedRuleName(_, row),
                action: String(row.action),
                actionLabel: selectionLabel(_, 'ruleAction', row.action),
                sequence: Number(row.sequence),
                source: row.locationSrcId
                  ? (locationById.get(String(row.locationSrcId)) ?? String(row.locationSrcId))
                  : '—',
                destination: locationById.get(String(row.locationDestId)) ?? String(row.locationDestId),
                operationType: pickingTypeById.get(String(row.pickingTypeId)) ?? String(row.pickingTypeId),
                procureMethod: selectionLabel(_, 'procureMethod', row.procureMethod),
              })),
              locations: options(data.locations),
              pickingTypes: options(data.pickingTypes),
              action: inLocale(url, `/admin/stock/routes/${params.id}`),
              routeErrors:
                url.searchParams.get('invalid') === 'route' ? [_('stock_backend.error.invalid')] : undefined,
              ruleErrors:
                url.searchParams.get('invalid') === 'rule' ? [_('stock_backend.error.invalid')] : undefined,
            },
            frame,
          ),
      })
    },

  '/admin/stock/replenishment':
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
        return resultRedirect(result, inLocale(url, '/admin/stock/replenishment'))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const [points, data, templates] = (await Promise.all([
        ctx.call('stock.listOrderpoints', {}, url, req),
        common(ctx, url, req),
        ctx.call('stock.listStorableProducts', {}, url, req),
      ])) as [AnyRow[], Awaited<ReturnType<typeof common>>, AnyRow[]]
      const products = templates.flatMap((template) =>
        (Array.isArray(template.variants) ? (template.variants as AnyRow[]) : [])
          .filter((variant) => variant.active !== false)
          .map((variant) => ({
            value: String(variant.id),
            label: variant.defaultCode
              ? `${String(template.name)} · ${String(variant.defaultCode)}`
              : String(template.name),
          })),
      )
      const forecasts = (await Promise.all(
        points.map((point) =>
          ctx.call('stock.forecast', { productId: point.productId, locationId: point.locationId }, url, req),
        ),
      )) as AnyRow[]
      const productUomById = new Map(
        templates.flatMap((template) =>
          (Array.isArray(template.variants) ? (template.variants as AnyRow[]) : []).map(
            (variant) => [String(variant.id), String(template.uomId ?? '')] as const,
          ),
        ),
      )
      const productById = new Map(products.map((product) => [product.value, product.label]))
      const warehouseById = new Map(data.warehouses.map((row) => [String(row.id), String(row.name)]))
      const locationById = new Map(data.locations.map((row) => [String(row.id), String(row.name)]))
      const unitById = new Map(data.units.map((row) => [String(row.id), String(row.name)]))
      const unitRecordById = new Map(data.units.map((row) => [String(row.id), row]))
      return adminPage(ctx, url, req, {
        title: 'stock_backend.replenishment',
        body: (_, frame) =>
          replenishmentScreen(
            _,
            {
              rows: points.map((row, index) => {
                const forecasted = String(forecasts[index]?.forecasted ?? '0')
                const baseUom = unitRecordById.get(productUomById.get(String(row.productId)) ?? '')
                const replenishmentUom = unitRecordById.get(
                  String(row.replenishmentUomId ?? productUomById.get(String(row.productId)) ?? ''),
                )
                const baseQuantity = Math.max(0, Number(row.maxQuantity) - Number(forecasted))
                const rawQuantity =
                  baseUom && replenishmentUom
                    ? (baseQuantity * Number(baseUom.absoluteFactor)) /
                      Number(replenishmentUom.absoluteFactor)
                    : baseQuantity
                const rounding = Math.max(Number(replenishmentUom?.rounding ?? 1), 1e-12)
                const quantity =
                  Number(forecasted) < Number(row.minQuantity)
                    ? Math.ceil(rawQuantity / rounding - 1e-12) * rounding
                    : 0
                return {
                  id: String(row.id),
                  product: productById.get(String(row.productId)) ?? String(row.productId),
                  warehouse: warehouseById.get(String(row.warehouseId)) ?? String(row.warehouseId),
                  location: locationById.get(String(row.locationId)) ?? String(row.locationId),
                  trigger: String(row.trigger),
                  triggerLabel: selectionLabel(_, 'trigger', row.trigger),
                  minQuantity: String(row.minQuantity),
                  maxQuantity: String(row.maxQuantity),
                  forecasted,
                  toOrder: String(quantity),
                  replenishmentUom:
                    unitById.get(String(row.replenishmentUomId)) ?? String(row.replenishmentUomId ?? '—'),
                  runAction: inLocale(url, `/admin/stock/replenishment/${String(row.id)}/run`),
                }
              }),
              products,
              warehouses: options(data.warehouses),
              locations: options(data.locations),
              units: options(data.units),
              routes: data.routes.map((row) => ({
                value: String(row.id),
                label: localizedGeneratedRouteName(_, row),
              })),
              action: inLocale(url, '/admin/stock/replenishment'),
              errors: invalid(url, _),
            },
            frame,
          ),
      })
    },

  '/admin/stock/replenishment/{id}/run':
    (ctx): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const result = await ctx.call(
        'stock.runOrderpoint',
        { id: params.id, moveId: `${params.id}:${randomUUID()}` },
        url,
        req,
      )
      return resultRedirect(result, inLocale(url, '/admin/stock/replenishment'))
    },

  '/admin/stock/forecast':
    (ctx): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const productId = url.searchParams.get('productId') ?? ''
      const locationId = url.searchParams.get('locationId') ?? ''
      const warehouseId = url.searchParams.get('warehouseId') ?? ''
      const [data, templates] = await Promise.all([
        common(ctx, url, req),
        ctx.call('stock.listStorableProducts', {}, url, req) as Promise<AnyRow[]>,
      ])
      const products = templates.flatMap((template) =>
        (Array.isArray(template.variants) ? (template.variants as AnyRow[]) : [])
          .filter((variant) => variant.active !== false)
          .map((variant) => ({
            value: String(variant.id),
            label: variant.defaultCode
              ? `${String(template.name)} · ${String(variant.defaultCode)}`
              : String(template.name),
          })),
      )
      const productById = new Map(products.map((product) => [product.value, product.label]))
      const productUomById = new Map(
        templates.flatMap((template) =>
          (Array.isArray(template.variants) ? (template.variants as AnyRow[]) : []).map(
            (variant) => [String(variant.id), String(template.uomId ?? '')] as const,
          ),
        ),
      )
      const warehouseById = new Map(data.warehouses.map((row) => [String(row.id), String(row.name)]))
      const locationById = new Map(data.locations.map((row) => [String(row.id), String(row.name)]))
      const unitById = new Map(data.units.map((row) => [String(row.id), String(row.name)]))
      const forecast = productId
        ? ((await ctx.call(
            'stock.forecast',
            { productId, ...(locationId ? { locationId } : warehouseId ? { warehouseId } : {}) },
            url,
            req,
          )) as AnyRow)
        : null
      const scopeLabel = locationId
        ? _('stock_backend.forecast.scope.location', {
            name: locationById.get(locationId) ?? locationId,
          })
        : warehouseId
          ? _('stock_backend.forecast.scope.warehouse', {
              name: warehouseById.get(warehouseId) ?? warehouseId,
            })
          : _('stock_backend.forecast.scope.all')
      return adminPage(ctx, url, req, {
        title: 'stock_backend.forecast',
        body: (_, frame) =>
          forecastScreen(
            _,
            {
              products,
              warehouses: options(data.warehouses),
              locations: options(data.locations),
              productId,
              warehouseId,
              locationId,
              productLabel: productById.get(productId),
              scopeLabel,
              ...(forecast
                ? {
                    row: {
                      id: productId,
                      onHand: String(forecast.onHand),
                      reserved: String(forecast.reserved),
                      available: String(forecast.available),
                      incoming: String(forecast.incoming),
                      outgoing: String(forecast.outgoing),
                      forecasted: String(forecast.forecasted),
                      uom: unitById.get(productUomById.get(productId) ?? '') ?? '—',
                    },
                  }
                : {}),
              action: inLocale(url, '/admin/stock/forecast'),
              lang,
            },
            frame,
          ),
      })
    },
}
