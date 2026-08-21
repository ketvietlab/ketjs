import { randomUUID } from 'node:crypto'
import { text } from 'ketjs'
import type { Route, RouteEntry, ServeContext } from 'ketjs'
import { viewerOf } from '../backend/routes.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { accountingTermsScreen } from './screens.ts'
import { backendPage } from '../../ui/index.ts'

type AnyRow = Record<string, unknown>
type Req = Parameters<Route>[1]

const inLocale = (url: URL, path: string): string => {
  const target = new URL(path, 'http://ket.local')
  const lang = url.searchParams.get('lang')
  if (lang) target.searchParams.set('lang', lang)
  return `${target.pathname}${target.search}`
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
  const title = _('account_partner_backend.screen.title', { name: String(partner.name) })
  return backendPage(ctx, req, {
    lang,
    title,
    body: accountingTermsScreen(
      _,
      partner as never,
      terms as never,
      options,
      {
        navigation: req.headers['x-ket-navigation'] === 'fragment-v1',
        viewer: await viewerOf(ctx, url, req),
        menu: await ctx.menu(url, req),
        extras: {
          'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
          'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
        },
      },
      inLocale(url, `/admin/partners/${partnerId}/accounting`),
      inLocale(url, `/admin/partners/${partnerId}`),
      errors,
    ),
  })
}

export const routes: Record<string, RouteEntry> = {
  '/admin/partners/{id}/accounting':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return render(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
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
      if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/partners/${params.id}`))
      const errors = ((result as { errors?: Array<{ field?: string; code?: string }> }).errors ?? []).map(
        (error) =>
          `${error.field ? `${error.field}: ` : ''}${ctx.translate(ctx.localeOf(url, req))(error.code ?? 'account_partner.error.accountMissing')}`,
      )
      return render(ctx, url, req, params.id, errors)
    },
}
