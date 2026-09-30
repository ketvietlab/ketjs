import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'
export const invoicingPolicyContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    if (!(await ctx.allows('sale.listInvoicePolicies', url, req))) return text('Forbidden', { status: 403 })
    const rows = (await ctx.call('sale.listInvoicePolicies', {}, url, req)) as Row[]
    const creating = params.id === 'new'
    const save = await ctx.allows('sale.setInvoicePolicy', url, req)
    if (creating && !save) return text('Forbidden', { status: 403 })
    const record = creating ? {} : rows.find((row) => row.id === params.id)
    if (!record) return text('Not found', { status: 404 })
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const manifest = await ctx.live(req)
    return json({
      data: { record, rows, save },
      messages: {
        ...Object.fromEntries(
          Object.entries(manifest.messages?.[lang] ?? {}).filter(([key]) => key.startsWith('sale_backend.')),
        ),
        ...USER_RECORD_MODAL_LABELS[lang],
      },
    })
  }
