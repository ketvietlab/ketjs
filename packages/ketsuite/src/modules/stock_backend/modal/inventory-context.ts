import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { optionalRead } from '../../backend/optional-read.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
export const inventoryCountContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('stock.listQuants', url, req))) return text('Forbidden', { status: 403 })
    const quants = (await ctx.call('stock.listQuants', {}, url, req)) as Row[]
    const record = params.id === 'new' ? {} : quants.find((row) => row.id === params.id)
    if (!record) return text('Not found', { status: 404 })
    const save =
      (await ctx.allows('stock.adjustInventory', url, req)) &&
      (await ctx.allows('stock.previewInventoryCount', url, req))
    if (params.id === 'new' && !save) return text('Forbidden', { status: 403 })
    const [templates, locations, lots] = await Promise.all([
      optionalRead<Row[]>(ctx, 'stock.listStorableProducts', {}, url, req, []),
      optionalRead<Row[]>(ctx, 'stock.listLocations', {}, url, req, []),
      optionalRead<Row[]>(ctx, 'stock.listLots', {}, url, req, []),
    ])
    const products = templates.flatMap((template) =>
      ((template.variants as Row[]) ?? []).map((variant) => ({
        id: variant.id,
        name: `${template.name}${variant.defaultCode ? ` · ${variant.defaultCode}` : ''}`,
      })),
    )
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const manifest = await ctx.live(req)
    return json({
      data: { record, save, draftId: randomUUID(), products, locations, lots },
      messages: {
        ...Object.fromEntries(
          Object.entries(manifest.messages?.[lang] ?? {}).filter(
            ([key]) => key.startsWith('stock_backend.') || key.startsWith('stock.'),
          ),
        ),
        ...USER_RECORD_MODAL_LABELS[lang],
      },
    })
  }
