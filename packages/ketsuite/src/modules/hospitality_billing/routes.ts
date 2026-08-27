import { createHash } from 'node:crypto'
import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { adminPage } from '../backend/screen.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { billingScreen, chargeRulesScreen } from './screens/index.ts'
import type { ChargeRuleRow, ChoiceRow, FolioBillingRow } from './screens/index.ts'

type Called = { ok?: boolean }
type Row = Record<string, unknown>

const redirected = (url: URL, state: 'saved' | 'invoiced' | 'paid' | 'queued' | 'invalid') => {
  const params = new URLSearchParams(url.searchParams)
  params.set('status', state)
  return seeOther(`${url.pathname}?${params.toString()}`)
}

const ruleModalHref = (url: URL, chargeType?: string): string => {
  const params = new URLSearchParams(url.searchParams)
  params.delete('status')
  for (const key of ['chargeType', 'taxId', 'incomeAccountId', 'taxAccountId']) params.delete(key)
  params.set('create', '1')
  if (chargeType) params.set('rule', chargeType)
  else params.delete('rule')
  return `${url.pathname}?${params.toString()}`
}

const ruleListHref = (url: URL): string => {
  const params = new URLSearchParams(url.searchParams)
  params.delete('create')
  params.delete('rule')
  params.delete('status')
  for (const key of ['chargeType', 'taxId', 'incomeAccountId', 'taxAccountId']) params.delete(key)
  const query = params.toString()
  return `${url.pathname}${query ? `?${query}` : ''}`
}

const ruleResultRedirect = (url: URL, ok: boolean, values: Record<string, string | undefined>) => {
  const params = new URLSearchParams(url.searchParams)
  params.set('status', ok ? 'saved' : 'invalid')
  if (ok) {
    params.delete('create')
    params.delete('rule')
  } else params.set('create', '1')
  for (const [key, value] of Object.entries(values)) {
    if (!ok && value !== undefined) params.set(key, value)
    else params.delete(key)
  }
  return seeOther(`${url.pathname}?${params.toString()}`)
}

/**
 * The id a payment is written under.
 *
 * Derived from the folio and the amount so that a double submit — the form
 * posted twice, a browser retrying — settles the receivable once. Two genuinely
 * separate payments of the same amount against the same folio are the case this
 * gets wrong, and the accounting module refuses the second rather than
 * duplicating it, which is the safer half of the trade.
 */
const paymentId = (folioId: string, amount: string): string =>
  `folio-payment:${createHash('sha256').update(`${folioId}:${amount}`).digest('hex').slice(0, 24)}`

const liquidityJournal = async (
  ctx: ServeContext,
  url: URL,
  req: Parameters<Route>[1],
): Promise<string | null> => {
  const journals = (await ctx.call('account.listJournals', {}, url, req)) as Row[]
  const found = journals.find((row) => ['cash', 'bank'].includes(String(row.type)) && row.defaultAccountId)
  return found ? String(found.id) : null
}

export const routes: Record<string, RouteEntry> = {
  '/admin/hospitality/billing/rules':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.operation !== 'save-rule') return text('unknown action', { status: 400 })
        const result = (await ctx.call(
          'hospitality_billing.saveChargeRule',
          {
            chargeType: form.chargeType ?? '',
            taxId: form.taxId || undefined,
            taxExempt: !form.taxId,
            incomeAccountId: form.incomeAccountId || undefined,
            taxAccountId: form.taxAccountId || undefined,
          },
          url,
          req,
        )) as Called
        return ruleResultRedirect(url, Boolean(result.ok), {
          chargeType: form.chargeType,
          taxId: form.taxId,
          incomeAccountId: form.incomeAccountId,
          taxAccountId: form.taxAccountId,
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })

      const [rules, taxes, accounts] = (await Promise.all([
        ctx.call('hospitality_billing.listChargeRules', {}, url, req),
        ctx.call('account.listTaxes', {}, url, req),
        ctx.call('account.listAccounts', {}, url, req),
      ])) as [ChargeRuleRow[], Row[], Row[]]

      const choices = (rows: Row[]): ChoiceRow[] =>
        rows.map((row) => ({ id: String(row.id), name: `${String(row.code)} · ${String(row.name)}` }))

      return adminPage(ctx, url, req, {
        title: 'hospitality_billing.chargeRules.title',
        body: (_, frame) => {
          const selected = rules.find((row) => row.chargeType === url.searchParams.get('rule'))
          return chargeRulesScreen(
            _,
            rules,
            taxes
              .filter((row) => ['sale', 'none'].includes(String(row.typeTaxUse)))
              .map((row) => ({ id: String(row.id), name: String(row.name) })),
            choices(accounts.filter((row) => String(row.accountType).startsWith('income'))),
            choices(accounts.filter((row) => String(row.accountType).startsWith('liability'))),
            frame,
            url.searchParams.get('status'),
            {
              open: url.searchParams.get('create') === '1',
              createHref: ruleModalHref(url),
              closeHref: ruleListHref(url),
              action: ruleModalHref(url, selected?.chargeType),
              selected,
              rowHref: (row) => ruleModalHref(url, row.chargeType),
              errors:
                url.searchParams.get('status') === 'invalid'
                  ? [_('hospitality_billing.feedback.invalid')]
                  : undefined,
              values: Object.fromEntries(
                ['chargeType', 'taxId', 'incomeAccountId', 'taxAccountId'].flatMap((key) =>
                  url.searchParams.has(key) ? [[key, url.searchParams.get(key)!]] : [],
                ),
              ),
            },
          )
        },
      })
    },

  '/admin/hospitality/billing':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method === 'POST') {
        const form = await readForm(req)
        if (form.operation === 'invoice-folio') {
          const result = (await ctx.call(
            'hospitality_billing.invoiceFolio',
            { folioId: form.folioId ?? '' },
            url,
            req,
          )) as Called
          return redirected(url, result.ok ? 'invoiced' : 'invalid')
        }
        if (form.operation === 'queue-closed') {
          const result = (await ctx.call('hospitality_billing.queueClosedFolios', {}, url, req)) as Called
          return redirected(url, result.ok ? 'queued' : 'invalid')
        }
        if (form.operation === 'record-payment') {
          const journalId = await liquidityJournal(ctx, url, req)
          if (!journalId) return redirected(url, 'invalid')
          const folioId = form.folioId ?? ''
          const amount = form.amount ?? '0'
          const result = (await ctx.call(
            'hospitality_billing.recordFolioPayment',
            { id: paymentId(folioId, amount), folioId, amount, journalId },
            url,
            req,
          )) as Called
          return redirected(url, result.ok ? 'paid' : 'invalid')
        }
        return text('unknown action', { status: 400 })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })

      const folios = (await ctx.call('hospitality_core.listFolios', { state: 'closed' }, url, req)) as Row[]
      const rows: FolioBillingRow[] = []
      for (const folio of folios) {
        const billing = (await ctx.call(
          'hospitality_billing.getFolioBilling',
          { folioId: folio.id },
          url,
          req,
        )) as Row | null
        if (!billing) continue
        rows.push({
          folioId: String(folio.id),
          folioCode: String(folio.code ?? folio.id),
          guest: (folio.partner as { name?: unknown } | null)?.name
            ? String((folio.partner as { name?: unknown }).name)
            : null,
          closedAt: folio.closedAt ? String(folio.closedAt) : null,
          folioTotal: String(billing.folioTotal),
          chargeCount: Number(billing.chargeCount),
          missingRules: (billing.missingRules as string[]) ?? [],
          moveId: billing.moveId ? String(billing.moveId) : null,
          moveName: billing.moveName ? String(billing.moveName) : null,
          amountTotal: billing.amountTotal ? String(billing.amountTotal) : null,
          amountDue: billing.amountDue ? String(billing.amountDue) : null,
          paymentState: billing.paymentState ? String(billing.paymentState) : null,
        })
      }

      return adminPage(ctx, url, req, {
        title: 'hospitality_billing.screen.title',
        body: (_, frame) => billingScreen(_, rows, frame, url.searchParams.get('status')),
      })
    },
}
