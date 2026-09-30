import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { optionalRead } from '../../backend/optional-read.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
import { stockConfigurations } from './configuration.ts'

export const stockConfigurationContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const config = Object.hasOwn(stockConfigurations, params.kind)
      ? stockConfigurations[params.kind]
      : undefined
    if (!config) return text('Not found', { status: 404 })
    const creating = params.id === 'new'
    if (!(await ctx.allows(creating ? config.save : config.read, url, req)))
      return text('Forbidden', { status: 403 })
    const record = creating
      ? {}
      : (
          (await ctx.call(
            config.read,
            config.read === 'stock.listLots' ? { includeArchived: true } : {},
            url,
            req,
          )) as Row[]
        ).find((row) => row.id === params.id)
    if (!record) return text('Not found', { status: 404 })
    const save = await ctx.allows(config.save, url, req)
    const lookup = (fn: string) => optionalRead<Row[]>(ctx, fn, {}, url, req, [])
    const [locations, warehouses, templates, units, routes, rules, pickingTypes] = await Promise.all([
      params.kind === 'route' ||
      params.kind === 'lot' ||
      config.fields.some((field) => field.lookup === 'locations')
        ? lookup('stock.listLocations')
        : [],
      config.fields.some((field) => field.lookup === 'warehouses') ? lookup('stock.listWarehouses') : [],
      config.fields.some((field) => field.lookup === 'products') ? lookup('stock.listStorableProducts') : [],
      config.fields.some((field) => field.lookup === 'units') ? lookup('uom.listUnits') : [],
      config.fields.some((field) => field.lookup === 'routes') ? lookup('stock.listRoutes') : [],
      params.kind === 'route' && !creating
        ? optionalRead<Row[]>(ctx, 'stock.listRules', { routeId: params.id }, url, req, [])
        : [],
      params.kind === 'route' ? lookup('stock.listPickingTypes') : [],
    ])
    const products = templates.flatMap((template) =>
      ((template.variants as Row[]) ?? []).map((variant) => ({
        ...variant,
        name: `${template.name}${variant.defaultCode ? ` · ${variant.defaultCode}` : ''}`,
      })),
    )
    const quants =
      params.kind === 'lot' && !creating
        ? (
            await optionalRead<Row[]>(
              ctx,
              'stock.listQuants',
              { productId: String(record.productId) },
              url,
              req,
              [],
            )
          ).filter((row) => row.lotId === params.id)
        : []
    const rule = params.kind === 'route' && (await ctx.allows('stock.saveRule', url, req))
    const run = params.kind === 'replenishment' && (await ctx.allows('stock.runOrderpoint', url, req))
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const manifest = await ctx.live(req)
    const messages = Object.fromEntries(
      Object.entries(manifest.messages?.[lang] ?? {}).filter(([key]) => key.startsWith('stock_backend.')),
    )
    return json({
      data: {
        record,
        save,
        rule,
        run,
        rules,
        quants,
        draftId: randomUUID(),
        choices: { locations, warehouses, products, units, routes, pickingTypes },
      },
      messages: { ...messages, ...USER_RECORD_MODAL_LABELS[lang] },
    })
  }
