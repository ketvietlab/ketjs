import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { optionalRead } from '../../backend/optional-read.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
export const transferContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const creating = params.id === 'new'
    if (!(await ctx.allows(creating ? 'stock.createPicking' : 'stock.getPicking', url, req)))
      return text('Forbidden', { status: 403 })
    const record = creating
      ? { id: '', name: '', state: 'draft', moves: [] }
      : ((await ctx.call('stock.getPicking', { id: params.id }, url, req)) as Row | null)
    if (!record) return text('Not found', { status: 404 })
    const permissions = Object.fromEntries(
      await Promise.all(
        [
          'createPicking',
          'savePicking',
          'addMove',
          'saveMoveLine',
          'confirmPicking',
          'assignPicking',
          'validatePicking',
          'cancelPicking',
        ].map(async (name) => [name, await ctx.allows(`stock.${name}`, url, req)]),
      ),
    )
    const lookup = (fn: string) => optionalRead<Row[]>(ctx, fn, {}, url, req, [])
    const [pickingTypes, locations, templates, units, lots] = await Promise.all([
      lookup('stock.listPickingTypes'),
      lookup('stock.listLocations'),
      permissions.addMove ? lookup('stock.listStorableProducts') : [],
      permissions.addMove ? lookup('uom.listUnits') : [],
      permissions.saveMoveLine ? lookup('stock.listLots') : [],
    ])
    const products = templates.flatMap((template) =>
      ((template.variants as Row[]) ?? []).map((variant) => ({
        ...variant,
        name: `${template.name}${variant.defaultCode ? ` · ${variant.defaultCode}` : ''}`,
      })),
    )
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const manifest = await ctx.live(req)
    return json({
      data: {
        record,
        detailsHref: `/admin/stock/transfers/${encodeURIComponent(params.id)}?${new URLSearchParams([...url.searchParams].filter(([key]) => ['lang', 'company', 'branch'].includes(key)))}`,
        permissions,
        draftId: randomUUID(),
        choices: { pickingTypes, locations, products, units, lots },
      },
      messages: {
        ...Object.fromEntries(
          Object.entries(manifest.messages?.[lang] ?? {}).filter(([key]) => key.startsWith('stock_backend.')),
        ),
        ...USER_RECORD_MODAL_LABELS[lang],
      },
    })
  }
