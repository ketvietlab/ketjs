import { formatMoney, formatDateTime } from '../../../ui/format.ts'
import { timezoneOf } from '../../backend/screen.ts'
import { randomUUID } from 'node:crypto'
import { json, text } from '@ketvietlab/ketjs'
import type { Route, Row, ServeContext } from '@ketvietlab/ketjs'
import { optionalRead } from '../../backend/optional-read.ts'
import { USER_RECORD_MODAL_LABELS } from '../../user/modal-labels.ts'

/** Read through public functions so live company, branch and grant checks remain authoritative. */
export const purchaseOrderContext =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET') return text('GET', { status: 405 })
    const creating = params.id === 'new'
    if (!(await ctx.allows(creating ? 'purchase.createOrder' : 'purchase.getOrder', url, req)))
      return text('Forbidden', { status: 403 })
    const record = creating
      ? { id: '', name: '', state: 'draft', lines: [], pickings: [], bills: [] }
      : ((await ctx.call('purchase.getOrder', { id: params.id }, url, req)) as Row | null)
    if (!record) return text('Not found', { status: 404 })
    const names = [
      'createOrder',
      'addLine',
      'updateLine',
      'removeLine',
      'sendRfq',
      'confirmOrder',
      'approveOrder',
      'resetToDraft',
      'syncReceipts',
      'receiveOrderReceipt',
      'lockOrder',
      'cancelOrder',
      'createVendorBill',
    ]
    const permissions = Object.fromEntries(
      await Promise.all(names.map(async (name) => [name, await ctx.allows(`purchase.${name}`, url, req)])),
    )
    const lookup = (fn: string, input: Record<string, unknown> = {}) =>
      optionalRead<Row[]>(ctx, fn, input, url, req, [])
    const [partners, templates, units, pickingTypes, journals, accounts, taxes] = await Promise.all([
      lookup('partner.listPartners', { limit: 200 }),
      permissions.addLine ? lookup('product.listTemplates', { withVariants: true, limit: 200 }) : [],
      permissions.addLine ? lookup('uom.listUnits') : [],
      creating ? lookup('stock.listPickingTypes') : [],
      permissions.createVendorBill ? lookup('account.listJournals', { type: 'purchase' }) : [],
      permissions.createVendorBill ? lookup('account.listAccounts') : [],
      permissions.addLine || permissions.updateLine
        ? lookup('account.listTaxes', { typeTaxUse: 'purchase' })
        : [],
    ])
    const variants = templates
      .filter((row) => row.purchaseOk)
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
        ([key]) => key.startsWith('purchase_backend.') || key.startsWith('purchase.'),
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
          pickingTypes: pickingTypes.filter((row) => row.code === 'incoming'),
          journals,
          accounts,
          taxes,
        },
        lang,
      },
      messages: { ...messages, ...USER_RECORD_MODAL_LABELS[lang] },
    })
  }
