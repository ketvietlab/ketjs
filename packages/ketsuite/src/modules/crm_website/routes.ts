import { createHash, randomUUID } from 'node:crypto'
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

/**
 * Who is submitting, as far as the edge can tell.
 *
 * Hashed rather than stored, because it exists to count submissions, not to
 * identify a visitor. An unknown caller falls into one shared bucket, which is
 * the conservative reading: better to throttle a proxy than to hand a script an
 * unlimited endpoint.
 */
const fingerprintOf = (req: Req): string => {
  const forwarded = String((req.headers as Record<string, unknown>)['x-forwarded-for'] ?? '')
    .split(',')[0]
    ?.trim()
  const source = forwarded || String((req.headers as Record<string, unknown>)['x-real-ip'] ?? '').trim()
  return source ? createHash('sha256').update(source).digest('hex').slice(0, 32) : ''
}

/** The redirect target after a submission, in the language the visitor is reading. */
const submitted = (url: URL): string => {
  const query = new URLSearchParams({ submitted: '1' })
  const lang = url.searchParams.get('lang')
  if (lang) query.set('lang', lang)
  return query.toString()
}

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
        // Minted on render and carried through the form, so refreshing the POST
        // replays one submission instead of filing a second lead.
        let token: string = randomUUID()
        if (req.method === 'POST') {
          const form = await readForm(req)
          token = (form.idempotencyKey ?? '').trim() || token
          // A hidden field a browser leaves empty. A script that fills every
          // input it finds is answered like a success, so it learns nothing
          // from the difference; the rate limit below is what holds back the
          // ones that are careful.
          if ((form.website ?? '').trim()) return seeOther(`/contact/sales?${submitted(url)}`)
          const fingerprint = fingerprintOf(req)
          const result = await ctx.call(
            'crm_website.website.submitLead',
            {
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
              ...(fingerprint ? { sourceFingerprint: fingerprint } : {}),
              idempotencyKey: token,
            },
            url,
            req,
          )
          if ((result as AnyRow).ok) return seeOther(`/contact/sales?${submitted(url)}`)
          errors = errorsOf(result, ctx.translate(ctx.localeOf(url, req)))
          if (!errors.length)
            errors = [ctx.translate(ctx.localeOf(url, req))('crm_website.website.validation')]
        } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
        return document(ctx, url, req, (_) =>
          websiteLeadScreen(
            _,
            [
              { name: 'name', label: _('crm_website.field.subject'), required: true, span: 'full' },
              { name: 'contactName', label: _('crm_website.field.contactName') },
              { name: 'email', label: _('crm_website.field.email'), type: 'email' },
              { name: 'phone', label: _('crm_website.field.phone'), type: 'tel' },
              {
                name: 'description',
                label: _('crm_website.field.description'),
                type: 'textarea',
                span: 'full',
              },
            ],
            errors,
            url.searchParams.get('submitted') === '1',
            token,
            `/contact/sales${url.searchParams.get('lang') ? `?lang=${encodeURIComponent(String(url.searchParams.get('lang')))}` : ''}`,
          ),
        )
      },
  },
}
