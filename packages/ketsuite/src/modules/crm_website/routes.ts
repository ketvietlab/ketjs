import { randomUUID } from 'node:crypto'
import { page, text } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { readForm, seeOther } from '../backend/forms.ts'
import { websiteLeadScreen } from './screens.tsx'

type AnyRow = Record<string, unknown>
type Req = Parameters<Route>[1]
type Translator = ReturnType<ServeContext['translate']>
const errorsOf = (result: unknown, _: Translator): string[] =>
  ((result as { errors?: Array<{ code?: string; message?: string }> } | null)?.errors ?? []).map((error) =>
    error.code && _.resolves(error.code)
      ? _(error.code)
      : String(error.message ?? error.code ?? _('crm_website.website.validation')),
  )
const document = async (ctx: ServeContext, url: URL, req: Req, body: (_: Translator) => TemplateResult) => {
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  return page({
    body: ctx.document({
      lang,
      title: _('crm_website.website.title'),
      head: await ctx.styles(req),
      body: body(_),
    }),
  })
}

export const routes: Record<string, RouteEntry> = {
  '/contact/sales': {
    anonymous: true,
    handler:
      (ctx): Route =>
      async (url, req) => {
        let errors: string[] = []
        if (req.method === 'POST') {
          const form = await readForm(req)
          const result = await ctx.call(
            'crm_website.website.submitLead',
            {
              id: form.id || randomUUID(),
              name: form.name ?? '',
              ...(form.contactName ? { contactName: form.contactName } : {}),
              ...(form.email ? { email: form.email } : {}),
              ...(form.phone ? { phone: form.phone } : {}),
              ...(form.description ? { description: form.description } : {}),
              locale: ctx.localeOf(url, req),
              ...(url.searchParams.get('utm_source')
                ? { utmSource: url.searchParams.get('utm_source') }
                : {}),
              ...(url.searchParams.get('utm_medium')
                ? { utmMedium: url.searchParams.get('utm_medium') }
                : {}),
              ...(url.searchParams.get('utm_campaign')
                ? { utmCampaign: url.searchParams.get('utm_campaign') }
                : {}),
              idempotencyKey: form.idempotencyKey || randomUUID(),
            },
            url,
            req,
          )
          if ((result as AnyRow).ok) {
            const query = new URLSearchParams({ submitted: '1' })
            if (url.searchParams.get('lang')) query.set('lang', String(url.searchParams.get('lang')))
            return seeOther(`/contact/sales?${query.toString()}`)
          }
          errors = errorsOf(result, ctx.translate(ctx.localeOf(url, req)))
        } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        return document(ctx, url, req, (_) =>
          websiteLeadScreen(
            _,
            [
              { name: 'name', label: _('crm_website.field.subject'), required: true, span: 'full' },
              { name: 'contactName', label: _('crm_website.field.contactName') },
              { name: 'email', label: _('crm_website.field.email') },
              { name: 'phone', label: _('crm_website.field.phone') },
              {
                name: 'description',
                label: _('crm_website.field.description'),
                type: 'textarea',
                span: 'full',
              },
            ],
            errors,
            url.searchParams.get('submitted') === '1',
          ),
        )
      },
  },
}
