import { text, withHeaders } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { bodyOf, CONSENT_GIVEN, sameOrigin } from '../../website_form/routes.ts'
import { renderStudioPublic } from './public.ts'
import { publicSiteOf } from './public-site.ts'
import type { PublicSite } from './public-site.ts'

type Req = Parameters<Route>[1]
type PublicForm = {
  id: string
  title: string
  schemaVersion: number
  fields: Array<{ name: string; type: string }>
  consentText: string | null
  successMessage: string | null
  submissionKey: string
}
type Drawn = PublicForm & {
  errors?: Record<string, string>
  values?: Record<string, unknown>
  notice?: string
}

const redirect = (location: string) => withHeaders(text('', { status: 303 }), { location })
const noindex = (title: string) => ({ title, description: '', canonical: '', indexing: 'noindex' })
/** A receipt code is a submission id: a UUID or a hex digest, never anything a path could abuse. */
const RECEIPT = /^[A-Za-z0-9-]{8,128}$/

const publicFormOf = async (
  ctx: ServeContext,
  found: PublicSite,
  id: string,
  url: URL,
  req: Req,
): Promise<PublicForm | null> =>
  (await ctx.call(
    'website_form.publicForm',
    { siteId: found.site.id, settings: { formId: id } },
    url,
    req,
  )) as PublicForm | null

/** One form, served as a page of its site: the form section alone, titled by the form. */
const formPage = (found: PublicSite, form: Drawn, status = 200) =>
  renderStudioPublic({
    site: found.site,
    locale: found.locale,
    menu: found.menu,
    page: { id: `form:${form.id}`, path: `/forms/${form.id}`, title: form.title, type: 'website.form' },
    fields: { seo: noindex(form.title) },
    appearance: found.appearance,
    meta: {},
    sections: [{ id: 'form', type: 'website_form.form', settings: { formId: form.id } }],
    sectionData: { form: { ...form, standalone: true } },
    status,
  }) ?? text('', { status: 404 })

const receiptPage = (
  found: PublicSite,
  title: string,
  receipt: { message: string; code?: string; createdAt?: string; createdLabel?: string },
) =>
  renderStudioPublic({
    site: found.site,
    locale: found.locale,
    menu: found.menu,
    page: { id: 'form-receipt', path: '/forms/receipt', title, type: 'website.formReceipt' },
    fields: { seo: noindex(title), receipt },
    appearance: found.appearance,
    meta: {},
    sections: [],
  }) ?? text('', { status: 404 })

const thanks = (found: PublicSite, message: unknown) =>
  typeof message === 'string' && message.trim()
    ? message
    : found.locale === 'vi'
      ? 'Cảm ơn bạn. Chúng tôi đã nhận được thông tin.'
      : 'Thank you. We have received your message.'

/**
 * A visitor's post, without JavaScript: the form section posts here, and a refused post comes
 * back as the form's own page with every answer kept and every problem beside its field.
 *
 * The checks are `website_form.submitForm`'s - the same rate limit, consent and contract version
 * as the JSON endpoint - so this route only translates between a browser form and that function.
 */
const submit = async (ctx: ServeContext, url: URL, req: Req, id: string) => {
  if (!sameOrigin(req)) return text('', { status: 403 })
  const found = await publicSiteOf(ctx, url, req)
  const form = found ? await publicFormOf(ctx, found, id, url, req) : null
  if (!found || !form) return text('', { status: 404 })
  let body: Record<string, unknown>
  try {
    const raw = await bodyOf(req)
    body = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    return text('', {
      status: code === 'payload_too_large' ? 413 : code === 'unsupported_media_type' ? 415 : 400,
    })
  }
  const ticked = (value: unknown) => CONSENT_GIVEN.has(String(value ?? '').toLowerCase())
  // Only the fields the form declares are answers. An unticked box posts nothing, which is a no.
  const payload: Record<string, unknown> = {}
  for (const field of form.fields) {
    const value = body[field.name]
    if (field.type === 'checkbox') payload[field.name] = ticked(value)
    else if (typeof value === 'string' && value !== '') payload[field.name] = value
  }
  const declared = Number(body._schemaVersion)
  const result = (await ctx.call(
    'website_form.submitForm',
    {
      formId: form.id,
      payload,
      consent: ticked(body.consent),
      honeypot: String(body.honeypot ?? ''),
      source: String(req.headers.referer ?? url.pathname).slice(0, 2_048),
      rateKey: `${req.socket.remoteAddress ?? 'unknown'}:${String(req.headers['user-agent'] ?? '').slice(0, 200)}`,
      submissionKey: typeof body.submissionKey === 'string' && body.submissionKey ? body.submissionKey : null,
      schemaVersion: Number.isInteger(declared) && declared > 0 ? declared : null,
    },
    url,
    req,
  )) as { ok?: boolean; id?: string; message?: string; errors?: Array<{ field?: string; message?: string }> }
  if (result.ok)
    return result.id
      ? redirect(`/forms/receipt/${encodeURIComponent(result.id)}`)
      : // The honeypot was filled: thanked as a person would be, recorded as nothing.
        receiptPage(found, form.title, { message: thanks(found, form.successMessage) })

  const _ = ctx.translate(found.locale)
  const errors: Record<string, string> = {}
  let notice: string | undefined
  let status = 422
  for (const error of result.errors ?? []) {
    const key = String(error.message ?? '')
    const message = _(key) || key
    if (key === 'website_form.error.rateLimit') {
      notice = message
      status = 429
    } else if (
      key === 'website_form.error.staleForm' ||
      key === 'website_form.error.consentVersionRequired'
    ) {
      // The form changed under the visitor: the page below is the new one, answers kept.
      notice = message
      status = 409
    } else if (
      error.field &&
      (error.field === 'consent' || form.fields.some((field) => field.name === error.field))
    )
      errors[error.field] ??= message
    else notice ??= message
  }
  notice ??=
    found.locale === 'vi' ? 'Vui lòng kiểm tra lại các ô được đánh dấu.' : 'Please check the marked fields.'
  return formPage(
    found,
    { ...form, errors, values: { ...payload, consent: ticked(body.consent) }, notice },
    status,
  )
}

const formRoute =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    const id = String(params?.id ?? '')
    if (req.method === 'POST') return submit(ctx, url, req, id)
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return withHeaders(text('', { status: 405 }), { allow: 'GET, HEAD, POST' })
    const found = await publicSiteOf(ctx, url, req)
    const form = found ? await publicFormOf(ctx, found, id, url, req) : null
    return found && form ? formPage(found, form) : text('', { status: 404 })
  }

/** What a visitor is shown after posting: the form's thanks, the receipt code and the time. */
const receiptRoute =
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return withHeaders(text('', { status: 405 }), { allow: 'GET, HEAD' })
    const id = String(params?.id ?? '')
    const found = RECEIPT.test(id) ? await publicSiteOf(ctx, url, req) : null
    const receipt = found
      ? ((await ctx.call('website_form.submissionReceipt', { id }, url, req)) as {
          id: string
          siteId: string
          title: string
          successMessage: string | null
          createdAt: string
        } | null)
      : null
    // A receipt is answered only on the site that took the post.
    if (!found || !receipt || receipt.siteId !== found.site.id) return text('', { status: 404 })
    const at = new Date(receipt.createdAt)
    return receiptPage(found, receipt.title, {
      message: thanks(found, receipt.successMessage),
      code: receipt.id,
      createdAt: at.toISOString(),
      // A site carries no zone of its own yet; the product's default is the visitor's likeliest.
      createdLabel: new Intl.DateTimeFormat(found.locale === 'vi' ? 'vi-VN' : 'en-GB', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Ho_Chi_Minh',
      }).format(at),
    })
  }

export const formRoutes: Record<string, RouteEntry> = {
  '/forms/{id}': { anonymous: true, handler: formRoute },
  '/forms/receipt/{id}': { anonymous: true, handler: receiptRoute },
}
