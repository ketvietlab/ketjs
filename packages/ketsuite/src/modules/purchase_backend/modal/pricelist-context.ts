import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { optionalRead } from '../../backend/optional-read.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'

export const vendorPricelistContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const creating = params.id === 'new'
    if (!(await ctx.allows(creating ? 'purchase.saveSupplierInfo' : 'purchase.listSupplierInfo', url, req)))
      return text('Forbidden', { status: 403 })
    const record = creating
      ? {}
      : ((await ctx.call('purchase.listSupplierInfo', {}, url, req)) as Row[]).find(
          (row) => row.id === params.id,
        )
    if (!record) return text('Not found', { status: 404 })
    const save = await ctx.allows('purchase.saveSupplierInfo', url, req)
    const [partners, templates, units] = await Promise.all([
      optionalRead<Row[]>(ctx, 'partner.listPartners', { limit: 200 }, url, req, []),
      optionalRead<Row[]>(ctx, 'product.listTemplates', { limit: 200, withVariants: true }, url, req, []),
      optionalRead<Row[]>(ctx, 'uom.listUnits', {}, url, req, []),
    ])
    const variants = templates.flatMap((template) =>
      ((template.variants as Row[]) ?? []).map((variant) => ({
        ...variant,
        name: `${template.name}${variant.defaultCode ? ` · ${variant.defaultCode}` : ''}`,
      })),
    )
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const manifest = await ctx.live(req)
    return json({
      data: { record, save, draftId: randomUUID(), choices: { partners, templates, variants, units } },
      messages: {
        ...Object.fromEntries(
          Object.entries(manifest.messages?.[lang] ?? {}).filter(([key]) =>
            key.startsWith('purchase_backend.'),
          ),
        ),
        ...USER_RECORD_MODAL_LABELS[lang],
      },
    })
  }
