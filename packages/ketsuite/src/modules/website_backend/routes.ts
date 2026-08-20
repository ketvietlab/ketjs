import { randomUUID } from 'node:crypto'
import { text } from 'ketjs'
import type { Route, RouteEntry, ServeContext } from 'ketjs'
import { backendPage } from '../../ui/index.ts'
import { errorsOf, readForm, seeOther } from '../backend/forms.ts'
import { viewerOf } from '../backend/routes.ts'
import {
  contentScreen,
  entryFormScreen,
  formCreateScreen,
  formsScreen,
  mediaScreen,
  menusScreen,
  previewScreen,
  revisionsScreen,
  siteFormScreen,
  sitesScreen,
  submissionsScreen,
  taxonomyScreen,
} from './screens.ts'
import type { EntryDetail, EntryRow, SiteRow } from './screens.ts'

type Req = Parameters<Route>[1]

const localeSuffix = (url: URL): string => {
  const lang = url.searchParams.get('lang')
  return lang ? `?lang=${encodeURIComponent(lang)}` : ''
}

const inLocale = (url: URL, path: string): string => {
  const target = new URL(path, 'http://ket.local')
  const lang = url.searchParams.get('lang')
  if (lang) target.searchParams.set('lang', lang)
  return `${target.pathname}${target.search}`
}

const frameFor = async (ctx: ServeContext, url: URL, req: Req) => ({
  navigation: req.headers['x-ket-navigation'] === 'fragment-v1',
  viewer: await viewerOf(ctx, url, req),
  menu: await ctx.menu(url, req),
  menuFilter: url.searchParams.get('menu')?.trim() || null,
  extras: {
    'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active: url.pathname }),
    'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
    'sidebar.foot':
      req.headers['x-ket-navigation'] === 'fragment-v1'
        ? undefined
        : await ctx.joint(url, req, 'backend:sidebar.foot', { lang: ctx.localeOf(url, req) }),
  },
})

const document = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  title: string,
  body: Parameters<ServeContext['document']>[0]['body'],
) => backendPage(ctx, req, { lang: ctx.localeOf(url, req), title, body })

const sitesOf = (ctx: ServeContext, url: URL, req: Req) =>
  ctx.call('website.listSites', {}, url, req) as Promise<SiteRow[]>

const selectedSite = (url: URL, sites: SiteRow[]): string | null =>
  url.searchParams.get('site') || sites.find((site) => site.active)?.id || sites[0]?.id || null

const siteOptions = (sites: SiteRow[]) => sites.map((site) => ({ value: site.id, label: site.title }))

const themeOptions = async (ctx: ServeContext, req: Req) => {
  const live = await ctx.live(req)
  return Object.entries(live.modules)
    .filter(([, module]) => module.kind === 'theme')
    .map(([name, module]) => ({ value: name, label: module.title || name }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

const contentTypeOptions = async (ctx: ServeContext, url: URL, req: Req) => {
  const live = await ctx.live(req)
  const _ = ctx.translate(ctx.localeOf(url, req))
  return Object.entries(live.contentTypes)
    .map(([name, type]) => ({ value: name, label: _(`${type.by}.${type.label}`) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

const parseJson = (value: string | undefined): { ok: true; value: unknown } | { ok: false } => {
  try {
    return { ok: true, value: JSON.parse(value ?? '') }
  } catch {
    return { ok: false }
  }
}

const invalidJsonErrors = (form: Record<string, string>, _: ReturnType<ServeContext['translate']>) => {
  const errors: string[] = []
  if (!parseJson(form.layout).ok)
    errors.push(`${_('website_backend.field.layout')}: ${_('website_backend.error.invalidJson')}`)
  if (!parseJson(form.fields || '{}').ok)
    errors.push(`${_('website_backend.field.fields')}: ${_('website_backend.error.invalidJson')}`)
  return errors
}

const resultErrors = (result: unknown, _: ReturnType<ServeContext['translate']>) => {
  const errors = errorsOf(result)
  return errors.length ? errors : [_('website_backend.error.invalid')]
}

const entryOf = (ctx: ServeContext, url: URL, req: Req, id: string) =>
  ctx.call('website.getEntry', { id }, url, req) as Promise<EntryDetail | null>

const saveEntry = async (ctx: ServeContext, url: URL, req: Req, id: string, form: Record<string, string>) => {
  const layout = parseJson(form.layout)
  const fields = parseJson(form.fields || '{}')
  if (!layout.ok || !fields.ok) return null
  return ctx.call(
    'website.saveEntry',
    {
      id,
      siteId: form.siteId,
      type: form.type,
      slug: form.slug,
      path: form.path,
      title: form.title,
      excerpt: form.excerpt || null,
      layout: layout.value,
      fields: fields.value,
    },
    url,
    req,
  )
}

const renderEntry = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  detail: EntryDetail | null,
  siteId: string,
  options: { values?: Record<string, string>; errors?: string[] } = {},
) => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  return document(
    ctx,
    url,
    req,
    detail?.entry.title ?? _('website_backend.content.newTitle'),
    entryFormScreen(
      _,
      detail,
      siteId,
      await contentTypeOptions(ctx, url, req),
      await frameFor(ctx, url, req),
      {
        ...options,
        locale: localeSuffix(url),
      },
    ),
  )
}

export const routes: Record<string, RouteEntry> = {
  '/admin/sites':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      return document(
        ctx,
        url,
        req,
        _('website_backend.sites.title'),
        sitesScreen(_, await sitesOf(ctx, url, req), await frameFor(ctx, url, req), localeSuffix(url)),
      )
    },

  '/admin/sites/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      const themes = await themeOptions(ctx, req)
      if (req.method === 'POST') {
        const form = await readForm(req)
        const id = randomUUID()
        const result = await ctx.call(
          'website.saveSite',
          {
            id,
            name: form.name,
            title: form.title,
            defaultLocale: form.defaultLocale,
            theme: form.theme,
            active: form.active === '1',
          },
          url,
          req,
        )
        if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/sites/${id}`))
        return document(
          ctx,
          url,
          req,
          _('website_backend.sites.newTitle'),
          siteFormScreen(_, form as never, themes, await frameFor(ctx, url, req), {
            errors: resultErrors(result, _),
            locale: localeSuffix(url),
          }),
        )
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return document(
        ctx,
        url,
        req,
        _('website_backend.sites.newTitle'),
        siteFormScreen(
          _,
          { theme: themes[0]?.value, defaultLocale: 'vi', active: true },
          themes,
          await frameFor(ctx, url, req),
          { locale: localeSuffix(url) },
        ),
      )
    },

  '/admin/sites/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      const themes = await themeOptions(ctx, req)
      const site = (await sitesOf(ctx, url, req)).find((row) => row.id === params.id)
      if (!site) return text(_('website_backend.error.notFound'), { status: 404 })
      if (req.method === 'POST') {
        const form = await readForm(req)
        const result = await ctx.call(
          'website.saveSite',
          {
            id: params.id,
            name: form.name,
            title: form.title,
            defaultLocale: form.defaultLocale,
            theme: form.theme,
            active: form.active === '1',
          },
          url,
          req,
        )
        if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/sites/${params.id}`))
        return document(
          ctx,
          url,
          req,
          site.title,
          siteFormScreen(
            _,
            { ...site, ...form, active: form.active === '1' },
            themes,
            await frameFor(ctx, url, req),
            { errors: resultErrors(result, _), locale: localeSuffix(url) },
          ),
        )
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return document(
        ctx,
        url,
        req,
        site.title,
        siteFormScreen(_, site, themes, await frameFor(ctx, url, req), { locale: localeSuffix(url) }),
      )
    },

  '/admin/content':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const siteId = selectedSite(url, sites)
      const rows = siteId ? ((await ctx.call('website.listEntries', { siteId }, url, req)) as EntryRow[]) : []
      return document(
        ctx,
        url,
        req,
        _('website_backend.content.title'),
        contentScreen(_, rows, siteOptions(sites), siteId, await frameFor(ctx, url, req), localeSuffix(url)),
      )
    },

  '/admin/content/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const posted = req.method === 'POST' ? await readForm(req) : null
      const siteId = url.searchParams.get('site') || posted?.siteId || selectedSite(url, sites)
      if (!siteId) return text(_('website_backend.content.noSite'), { status: 400 })
      if (req.method === 'POST') {
        const form = posted ?? {}
        const jsonErrors = invalidJsonErrors(form, _)
        if (jsonErrors.length)
          return renderEntry(ctx, url, req, null, siteId, { values: form, errors: jsonErrors })
        const id = randomUUID()
        const result = await saveEntry(ctx, url, req, id, form)
        if ((result as { ok?: boolean } | null)?.ok) return seeOther(inLocale(url, `/admin/content/${id}`))
        return renderEntry(ctx, url, req, null, siteId, { values: form, errors: resultErrors(result, _) })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return renderEntry(ctx, url, req, null, siteId)
    },

  '/admin/content/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const detail = await entryOf(ctx, url, req, params.id)
      if (!detail)
        return text(ctx.translate(ctx.localeOf(url, req))('website_backend.error.notFound'), { status: 404 })
      if (req.method === 'GET') return renderEntry(ctx, url, req, detail, detail.entry.siteId)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const form = await readForm(req)
      const jsonErrors = invalidJsonErrors(form, _)
      if (jsonErrors.length)
        return renderEntry(ctx, url, req, detail, detail.entry.siteId, { values: form, errors: jsonErrors })
      const result = await saveEntry(ctx, url, req, params.id, form)
      if ((result as { ok?: boolean } | null)?.ok)
        return seeOther(inLocale(url, `/admin/content/${params.id}`))
      return renderEntry(ctx, url, req, detail, detail.entry.siteId, {
        values: form,
        errors: resultErrors(result, _),
      })
    },

  '/admin/content/{id}/publish':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      await ctx.call('website.publishEntry', { id: params.id }, url, req)
      return seeOther(inLocale(url, `/admin/content/${params.id}`))
    },

  '/admin/content/{id}/revisions':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const detail = await entryOf(ctx, url, req, params.id)
      if (!detail) return text(_('website_backend.error.notFound'), { status: 404 })
      const rows = (await ctx.call('website.listRevisions', { entryId: params.id }, url, req)) as Array<{
        id: string
        version: number
        kind: string
        authorId?: string | null
        createdAt: string
      }>
      return document(
        ctx,
        url,
        req,
        _('website_backend.revisions.title'),
        revisionsScreen(_, detail.entry, rows, await frameFor(ctx, url, req), localeSuffix(url)),
      )
    },

  '/admin/content/{id}/preview':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const detail = await entryOf(ctx, url, req, params.id)
      if (!detail) return text(_('website_backend.error.notFound'), { status: 404 })
      const preview = (await ctx.call('website.createPreviewToken', { entryId: params.id }, url, req)) as {
        token: string
        expiresAt: string
      }
      return document(
        ctx,
        url,
        req,
        _('website_backend.preview.title'),
        previewScreen(_, detail.entry, preview.token, preview.expiresAt, await frameFor(ctx, url, req)),
      )
    },

  '/admin/taxonomies':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const siteId = selectedSite(url, sites)
      const rows = siteId
        ? ((await ctx.call('website.listTaxonomyTerms', { siteId }, url, req)) as never[])
        : []
      return document(
        ctx,
        url,
        req,
        _('website_backend.taxonomies.title'),
        taxonomyScreen(_, rows, await frameFor(ctx, url, req)),
      )
    },

  '/admin/media':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const siteId = selectedSite(url, sites)
      const rows = siteId ? ((await ctx.call('website.listMedia', { siteId }, url, req)) as never[]) : []
      return document(
        ctx,
        url,
        req,
        _('website_backend.media.title'),
        mediaScreen(_, rows, await frameFor(ctx, url, req)),
      )
    },

  '/admin/menus':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const siteId = selectedSite(url, sites)
      const rows = (await ctx.call('website_menu.listMenu', { siteId }, url, req)) as never[]
      return document(
        ctx,
        url,
        req,
        _('website_backend.menus.title'),
        menusScreen(_, rows, await frameFor(ctx, url, req)),
      )
    },

  '/admin/forms':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const siteId = selectedSite(url, sites)
      const rows = siteId ? ((await ctx.call('website_form.listForms', { siteId }, url, req)) as never[]) : []
      return document(
        ctx,
        url,
        req,
        _('website_backend.forms.title'),
        formsScreen(_, rows, siteId, await frameFor(ctx, url, req), localeSuffix(url)),
      )
    },

  '/admin/forms/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const posted = req.method === 'POST' ? await readForm(req) : null
      const siteId = url.searchParams.get('site') || posted?.siteId || selectedSite(url, sites)
      if (!siteId) return text(_('website_backend.content.noSite'), { status: 400 })
      if (req.method === 'POST') {
        const form = posted ?? {}
        const schema = parseJson(form.schema)
        if (!schema.ok)
          return document(
            ctx,
            url,
            req,
            _('website_backend.forms.newTitle'),
            formCreateScreen(_, siteId, await frameFor(ctx, url, req), {
              values: form,
              errors: [_('website_backend.error.invalidJson')],
              locale: localeSuffix(url),
            }),
          )
        const result = await ctx.call(
          'website_form.saveForm',
          {
            id: randomUUID(),
            siteId,
            name: form.name,
            schema: schema.value,
            successMessage: form.successMessage,
            notifyTo: form.notifyTo || null,
            active: true,
          },
          url,
          req,
        )
        if ((result as { ok?: boolean }).ok)
          return seeOther(inLocale(url, `/admin/forms?site=${encodeURIComponent(siteId)}`))
        return document(
          ctx,
          url,
          req,
          _('website_backend.forms.newTitle'),
          formCreateScreen(_, siteId, await frameFor(ctx, url, req), {
            values: form,
            errors: resultErrors(result, _),
            locale: localeSuffix(url),
          }),
        )
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return document(
        ctx,
        url,
        req,
        _('website_backend.forms.newTitle'),
        formCreateScreen(_, siteId, await frameFor(ctx, url, req), { locale: localeSuffix(url) }),
      )
    },

  '/admin/forms/{id}/submissions':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const rows = (await ctx.call(
        'website_form.listSubmissions',
        { formId: params.id },
        url,
        req,
      )) as never[]
      return document(
        ctx,
        url,
        req,
        _('website_backend.submissions.title'),
        submissionsScreen(_, rows, await frameFor(ctx, url, req)),
      )
    },
}
