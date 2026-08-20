import { randomUUID } from 'node:crypto'
import { page, text } from 'ketjs'
import type { Route, RouteEntry, ServeContext } from 'ketjs'
import { viewerOf } from '../backend/routes.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { PAGE_SIZE, pageOf, pager, searchOf, withParam } from '../backend/paging.ts'
import { newPartnerScreen, partnerDetailScreen, partnersScreen } from './screens.ts'

type AnyRow = Record<string, unknown>
type Req = Parameters<Route>[1]

const inLocale = (url: URL, path: string): string => {
  const target = new URL(path, 'http://ket.local')
  const lang = url.searchParams.get('lang')
  if (lang) target.searchParams.set('lang', lang)
  return `${target.pathname}${target.search}`
}

const frameFor = async (ctx: ServeContext, url: URL, req: Req) => ({
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(url, req),
  menuFilter: url.searchParams.get('menu')?.trim() || null,
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
  },
})

const document = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  title: string,
  body: Parameters<ServeContext['document']>[0]['body'],
) =>
  page({
    body: ctx.document({
      lang: ctx.localeOf(url, req),
      title,
      head: await ctx.styles(req),
      body,
    }),
  })

const partnerOptions = async (ctx: ServeContext, url: URL, req: Req, exclude?: string) =>
  (
    (await ctx.call(
      'partner.listPartners',
      { kind: 'company', includeArchived: false },
      url,
      req,
    )) as AnyRow[]
  )
    .filter((row) => row.id !== exclude)
    .map((row) => ({ value: String(row.id), label: String(row.name) }))

const translatedErrors = (result: unknown, _: ReturnType<ServeContext['translate']>): string[] =>
  ((result as { errors?: Array<{ field?: string; code?: string }> } | null)?.errors ?? []).map(
    (error) => `${error.field ? `${error.field}: ` : ''}${_(error.code ?? 'partner.error.invalid')}`,
  )

const renderDetail = async (ctx: ServeContext, url: URL, req: Req, id: string, errors?: string[]) => {
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  const [row, parents, terms, integration] = await Promise.all([
    ctx.call('partner.getPartner', { id }, url, req) as Promise<AnyRow | null>,
    partnerOptions(ctx, url, req, id),
    ctx.call('partner.getTerms', { partnerId: id }, url, req) as Promise<AnyRow | null>,
    ctx.joint(url, req, 'partner_backend:record.actions', {
      partnerId: id,
      locale: url.searchParams.get('lang')
        ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}`
        : '',
    }),
  ])
  if (!row) return text(_('partner_backend.error.notFound'), { status: 404 })
  return document(
    ctx,
    url,
    req,
    String(row.name),
    partnerDetailScreen(
      _,
      row as never,
      { parents, terms: terms as never, errors, integration },
      await frameFor(ctx, url, req),
      url.searchParams.get('lang') ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}` : '',
    ),
  )
}

const savePartner = (ctx: ServeContext, url: URL, req: Req, id: string, form: Record<string, string>) =>
  ctx.call(
    'partner.savePartner',
    {
      id,
      kind: form.kind || 'company',
      name: form.name ?? '',
      parentId: form.parentId || null,
      vat: form.vat || null,
      ref: form.ref || null,
      email: form.email || null,
      phone: form.phone || null,
      lang: form.lang || null,
    },
    url,
    req,
  )

export const routes: Record<string, RouteEntry> = {
  '/admin/partners':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      const current = pageOf(url)
      const search = searchOf(url)
      const role = url.searchParams.get('role') || undefined
      const includeArchived = url.searchParams.get('archived') === '1'
      const filter = { search, role, includeArchived }
      const [rows, total] = await Promise.all([
        ctx.call(
          'partner.listPartners',
          { ...filter, limit: PAGE_SIZE, offset: (current - 1) * PAGE_SIZE },
          url,
          req,
        ) as Promise<AnyRow[]>,
        ctx.call('partner.countPartners', filter, url, req) as Promise<{ count: number }>,
      ])
      const frame = await frameFor(ctx, url, req)
      return document(
        ctx,
        url,
        req,
        _('partner_backend.screen.title'),
        partnersScreen(
          _,
          rows as never,
          {
            ...frame,
            chrome: {
              search: {
                name: 'q',
                value: search ?? '',
                placeholder: _('partner_backend.chrome.search'),
                facets: role
                  ? [{ label: _(`partner.role.${role}`), without: withParam(url, 'role', null) }]
                  : [],
              },
              pager: pager(url, current, rows.length, total.count),
            },
          },
          {},
          url.searchParams.get('lang') ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}` : '',
          includeArchived,
        ),
      )
    },

  '/admin/partners/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const lang = ctx.localeOf(url, req)
      const _ = ctx.translate(lang)
      if (req.method === 'POST') {
        const form = await readForm(req)
        const id = randomUUID()
        const result = await savePartner(ctx, url, req, id, form)
        if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/partners/${id}`))
        return document(
          ctx,
          url,
          req,
          _('partner_backend.create.title'),
          newPartnerScreen(
            _,
            await partnerOptions(ctx, url, req),
            await frameFor(ctx, url, req),
            translatedErrors(result, _),
            url.searchParams.get('lang') ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}` : '',
          ),
        )
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return document(
        ctx,
        url,
        req,
        _('partner_backend.create.title'),
        newPartnerScreen(
          _,
          await partnerOptions(ctx, url, req),
          await frameFor(ctx, url, req),
          undefined,
          url.searchParams.get('lang') ? `?lang=${encodeURIComponent(url.searchParams.get('lang')!)}` : '',
        ),
      )
    },

  '/admin/partners/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method === 'GET') return renderDetail(ctx, url, req, params.id)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const result = await savePartner(ctx, url, req, params.id, await readForm(req))
      if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/partners/${params.id}`))
      return renderDetail(
        ctx,
        url,
        req,
        params.id,
        translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
      )
    },

  '/admin/partners/{id}/roles':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      for (const role of ['customer', 'supplier', 'employee']) {
        if (form[role] === '1')
          await ctx.call('partner.grantRole', { id: randomUUID(), partnerId: params.id, role }, url, req)
        else await ctx.call('partner.revokeRole', { partnerId: params.id, role }, url, req)
      }
      return seeOther(inLocale(url, `/admin/partners/${params.id}`))
    },

  '/admin/partners/{id}/archive':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      await ctx.call('partner.archivePartner', { id: params.id, active: form.action === 'restore' }, url, req)
      return seeOther(inLocale(url, `/admin/partners/${params.id}`))
    },

  '/admin/partners/{id}/addresses':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      const result = await ctx.call(
        'partner.saveAddress',
        {
          id: randomUUID(),
          partnerId: params.id,
          use: form.use || 'contact',
          street: form.street ?? '',
          street2: form.street2 || null,
          city: form.city ?? '',
          zip: form.zip || null,
          state: form.state || null,
          country: form.country ?? '',
          isDefault: form.isDefault === '1',
        },
        url,
        req,
      )
      return (result as { ok?: boolean }).ok
        ? seeOther(inLocale(url, `/admin/partners/${params.id}`))
        : renderDetail(
            ctx,
            url,
            req,
            params.id,
            translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
          )
    },

  '/admin/partners/{id}/addresses/{addressId}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      const result = await ctx.call(
        'partner.saveAddress',
        {
          id: params.addressId,
          partnerId: params.id,
          use: form.use || 'contact',
          street: form.street ?? '',
          street2: form.street2 || null,
          city: form.city ?? '',
          zip: form.zip || null,
          state: form.state || null,
          country: form.country ?? '',
          isDefault: form.isDefault === '1',
        },
        url,
        req,
      )
      return (result as { ok?: boolean }).ok
        ? seeOther(inLocale(url, `/admin/partners/${params.id}`))
        : renderDetail(
            ctx,
            url,
            req,
            params.id,
            translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
          )
    },

  '/admin/partners/{id}/terms':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      const result = await ctx.call(
        'partner.saveTerms',
        {
          id: randomUUID(),
          partnerId: params.id,
          creditLimit: form.creditLimit || null,
          note: form.note || null,
        },
        url,
        req,
      )
      return (result as { ok?: boolean }).ok
        ? seeOther(inLocale(url, `/admin/partners/${params.id}`))
        : renderDetail(
            ctx,
            url,
            req,
            params.id,
            translatedErrors(result, ctx.translate(ctx.localeOf(url, req))),
          )
    },
}
