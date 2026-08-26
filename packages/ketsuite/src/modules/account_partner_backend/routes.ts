import { randomUUID } from 'node:crypto'
import { text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { accountingTermsScreen } from './screens/index.ts'
import { adminPage, inLocale } from '../backend/screen.ts'
import type { AnyRow, Req } from '../backend/screen.ts'

const crossSite = (req: Req): boolean => {
  const origin = req.headers.origin as string | undefined
  if (!origin) return false
  try {
    return new URL(origin).host !== String(req.headers.host ?? '')
  } catch {
    return true
  }
}

const render = async (ctx: ServeContext, url: URL, req: Req, partnerId: string, errors?: string[]) => {
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  const [partner, terms, paymentTerms, accounts] = await Promise.all([
    ctx.call('partner.getPartner', { id: partnerId }, url, req) as Promise<AnyRow | null>,
    ctx.call('account_partner.getAccountingTerms', { partnerId }, url, req) as Promise<AnyRow | null>,
    ctx.call('account.listPaymentTerms', {}, url, req) as Promise<AnyRow[]>,
    ctx.call('account.listAccounts', {}, url, req) as Promise<AnyRow[]>,
  ])
  if (!partner) return text(_('account_partner_backend.error.notFound'), { status: 404 })
  const options = {
    paymentTerms: paymentTerms.map((row) => ({ value: String(row.id), label: String(row.name) })),
    receivable: accounts
      .filter((row) => row.accountType === 'asset_receivable')
      .map((row) => ({ value: String(row.id), label: `${row.code} · ${row.name}` })),
    payable: accounts
      .filter((row) => row.accountType === 'liability_payable')
      .map((row) => ({ value: String(row.id), label: `${row.code} · ${row.name}` })),
  }
  return adminPage(ctx, url, req, {
    title: _('account_partner_backend.screen.title', { name: String(partner.name) }),
    translate: false,
    body: (_, frame) =>
      accountingTermsScreen(
        _,
        partner as never,
        terms as never,
        options,
        frame,
        inLocale(url, `/admin/partner/partners/${partnerId}/accounting`),
        inLocale(url, `/admin/partner/partners/${partnerId}`),
        errors,
      ),
  })
}

export const routes: Record<string, RouteEntry> = {
  '/admin/partner/partners/{id}/accounting':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return render(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      if (crossSite(req)) return text('Forbidden', { status: 403 })
      const form = await readForm(req)
      const result = await ctx.call(
        'account_partner.saveAccountingTerms',
        {
          id: randomUUID(),
          partnerId: params.id,
          paymentTermId: form.paymentTermId || null,
          receivableAccountId: form.receivableAccountId || null,
          payableAccountId: form.payableAccountId || null,
        },
        url,
        req,
      )
      if ((result as { ok?: boolean }).ok)
        return seeOther(inLocale(url, `/admin/partner/partners/${params.id}`))
      const errors = ((result as { errors?: Array<{ field?: string; code?: string }> }).errors ?? []).map(
        (error) =>
          `${error.field ? `${error.field}: ` : ''}${ctx.translate(ctx.localeOf(url, req))(error.code ?? 'account_partner.error.accountMissing')}`,
      )
      return render(ctx, url, req, params.id, errors)
    },
}
