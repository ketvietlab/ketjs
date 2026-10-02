import { formatMoney, formatDateTime } from '../../../ui/format.ts'
import { timezoneOf } from '../../backend/screen.ts'
import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { optionalRead } from '../../backend/optional-read.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'

/** Read through public functions so live company, branch and grant checks remain authoritative. */
export const saleOrderContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const creating = params.id === 'new'
    if (!(await ctx.allows(creating ? 'sale.createOrder' : 'sale.getOrder', url, req)))
      return text('Forbidden', { status: 403 })
    const record = creating
      ? { id: '', name: '', state: 'draft', lines: [], pickings: [], invoices: [] }
      : ((await ctx.call('sale.getOrder', { id: params.id }, url, req)) as Row | null)
    if (!record) return text('Not found', { status: 404 })
    const names = [
      'createOrder',
      'addLine',
      'updateLine',
      'removeLine',
      'sendQuotation',
      'confirmOrder',
      'resetOrder',
      'syncDeliveries',
      'lockOrder',
      'cancelOrder',
      'createInvoice',
    ]
    const permissions = Object.fromEntries(
      await Promise.all(names.map(async (name) => [name, await ctx.allows(`sale.${name}`, url, req)])),
    )
    const lookup = (fn: string, input: Record<string, unknown> = {}) =>
      optionalRead<Row[]>(ctx, fn, input, url, req, [])
    const [partners, templates, units, warehouses, pricelists, terms, journals, accounts, taxes] =
      await Promise.all([
        lookup('partner.listPartners', { limit: 200 }),
        permissions.addLine ? lookup('product.listTemplates', { withVariants: true, limit: 200 }) : [],
        permissions.addLine ? lookup('uom.listUnits') : [],
        creating ? lookup('stock.listWarehouses') : [],
        creating ? lookup('pricing.listPricelists') : [],
        creating ? lookup('account.listPaymentTerms') : [],
        permissions.createInvoice ? lookup('account.listJournals', { type: 'sale' }) : [],
        permissions.createInvoice ? lookup('account.listAccounts') : [],
        permissions.addLine ? lookup('account.listTaxes', { typeTaxUse: 'sale' }) : [],
      ])
    const variants = templates
      .filter((row) => row.saleOk)
      .flatMap((template) =>
        ((template.variants as Row[]) ?? []).map((variant) => ({
          ...variant,
          name: `${template.name}${variant.defaultCode ? ` · ${variant.defaultCode}` : ''}`,
        })),
      )
    const lang = ctx.localeOf(url, req) === 'en' ? 'en' : 'vi'
    const timezone = await timezoneOf(ctx, url, req)
    const translator = ctx.translate(lang)
    const date = (value: unknown) =>
      value && !Number.isNaN(Date.parse(String(value)))
        ? formatDateTime(lang, new Date(String(value)), { dateStyle: 'medium', timeZone: timezone })
        : '—'
    const display = {
      dateOrder: date(record.dateOrder),
      datePlanned: date(record.datePlanned),
      validityDate: date(record.validityDate),
      amountTotal: formatMoney(translator, record.amountTotal, record.currency),
    }
    const manifest = await ctx.live(req)
    const messages = Object.fromEntries(
      Object.entries(manifest.messages?.[lang] ?? {}).filter(
        ([key]) => key.startsWith('sale_backend.') || key.startsWith('sale.'),
      ),
    )
    return json({
      data: {
        draftId: randomUUID(),
        record: {
          ...record,
          display,
          lines: ((record.lines as Row[]) ?? []).map((row) => ({
            ...row,
            priceUnitLabel: formatMoney(translator, row.priceUnit, record.currency),
          })),
          partnerName: partners.find((row) => row.id === record.partnerId)?.name ?? record.partnerId,
        },
        permissions,
        choices: {
          partners,
          variants,
          units,
          warehouses,
          pricelists,
          terms,
          journals,
          accounts,
          taxes,
        },
        lang,
      },
      messages: { ...messages, ...USER_RECORD_MODAL_LABELS[lang] },
    })
  }
