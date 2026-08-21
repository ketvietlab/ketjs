import { randomUUID } from 'node:crypto'
import { text } from 'ketjs'
import type { Route, RouteEntry, ServeContext } from 'ketjs'
import { backendPage } from '../../ui/index.ts'
import { readForm, seeOther } from '../backend/forms.ts'
import { viewerOf } from '../backend/routes.ts'
import {
  contentScreen,
  entryFormScreen,
  formCreateScreen,
  formsScreen,
  mediaFormScreen,
  mediaScreen,
  menuFormScreen,
  menusScreen,
  previewScreen,
  revisionsScreen,
  siteFormScreen,
  sitesScreen,
  submissionsScreen,
  taxonomyScreen,
  taxonomyFormScreen,
} from './screens.tsx'
import type { EntryDetail, EntryKind, EntryRow, MediaRow, MenuRow, SiteRow, TaxonomyRow } from './screens.tsx'

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

const taxonomyOptions = async (ctx: ServeContext, url: URL, req: Req) => {
  const live = await ctx.live(req)
  const _ = ctx.translate(ctx.localeOf(url, req))
  return Object.entries(live.taxonomies)
    .map(([name, taxonomy]) => ({ value: name, label: _(`${taxonomy.by}.${taxonomy.label}`) }))
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
  const issues = (result as { errors?: Array<{ field?: string; message?: string }> } | null)?.errors ?? []
  if (!issues.length) return [_('website_backend.error.invalid')]
  return issues.map((issue) => {
    const message = issue.message ?? 'website_backend.error.invalid'
    const translated = /^[a-z0-9_]+\./i.test(message) ? _(message) : message
    return `${issue.field ? `${issue.field}: ` : ''}${translated}`
  })
}

const entryOf = (ctx: ServeContext, url: URL, req: Req, id: string) =>
  ctx.call('website.getEntry', { id }, url, req) as Promise<EntryDetail | null>

const saveEntry = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  id: string,
  form: Record<string, string>,
  type: 'website.page' | 'website.post',
) => {
  const layout = parseJson(form.layout)
  const fields = parseJson(form.fields || '{}')
  if (!layout.ok || !fields.ok) return null
  return ctx.call(
    'website.saveEntry',
    {
      id,
      siteId: form.siteId,
      type,
      slug: form.slug,
      path: form.path,
      title: form.title,
      excerpt: form.excerpt || null,
      layout: layout.value,
      fields: fields.value,
      expectedRevisionId: form.expectedRevisionId || null,
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
  kind: EntryKind,
  options: { values?: Record<string, string>; errors?: string[] } = {},
) => {
  const _ = ctx.translate(ctx.localeOf(url, req))
  return document(
    ctx,
    url,
    req,
    detail?.entry.title ?? _(`website_backend.${kind.titleKey}.newTitle`),
    entryFormScreen(_, detail, siteId, kind, await frameFor(ctx, url, req), {
      ...options,
      locale: localeSuffix(url),
    }),
  )
}

const entryRoutes = (kind: EntryKind, type: 'website.page' | 'website.post'): Record<string, RouteEntry> => ({
  [kind.basePath]:
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const siteId = selectedSite(url, sites)
      const rows = siteId
        ? ((await ctx.call('website.listEntries', { siteId, type }, url, req)) as EntryRow[])
        : []
      return document(
        ctx,
        url,
        req,
        _(`website_backend.${kind.titleKey}.title`),
        contentScreen(
          _,
          rows,
          siteOptions(sites),
          siteId,
          await frameFor(ctx, url, req),
          localeSuffix(url),
          kind,
        ),
      )
    },

  [`${kind.basePath}/new`]:
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
          return renderEntry(ctx, url, req, null, siteId, kind, { values: form, errors: jsonErrors })
        const id = randomUUID()
        const result = await saveEntry(ctx, url, req, id, form, type)
        if ((result as { ok?: boolean } | null)?.ok) return seeOther(inLocale(url, `${kind.basePath}/${id}`))
        return renderEntry(ctx, url, req, null, siteId, kind, {
          values: form,
          errors: resultErrors(result, _),
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return renderEntry(ctx, url, req, null, siteId, kind)
    },

  [`${kind.basePath}/{id}`]:
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const detail = await entryOf(ctx, url, req, params.id)
      const _ = ctx.translate(ctx.localeOf(url, req))
      if (!detail || detail.entry.type !== type)
        return text(_('website_backend.error.notFound'), { status: 404 })
      if (req.method === 'GET') return renderEntry(ctx, url, req, detail, detail.entry.siteId, kind)
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const form = await readForm(req)
      const jsonErrors = invalidJsonErrors(form, _)
      if (jsonErrors.length)
        return renderEntry(ctx, url, req, detail, detail.entry.siteId, kind, {
          values: form,
          errors: jsonErrors,
        })
      const result = await saveEntry(ctx, url, req, params.id, form, type)
      if ((result as { ok?: boolean } | null)?.ok)
        return seeOther(inLocale(url, `${kind.basePath}/${params.id}`))
      return renderEntry(ctx, url, req, detail, detail.entry.siteId, kind, {
        values: form,
        errors: resultErrors(result, _),
      })
    },

  [`${kind.basePath}/{id}/publish`]:
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const detail = await entryOf(ctx, url, req, params.id)
      const _ = ctx.translate(ctx.localeOf(url, req))
      if (!detail || detail.entry.type !== type)
        return text(_('website_backend.error.notFound'), { status: 404 })
      const form = await readForm(req)
      const result = await ctx.call(
        'website.publishEntry',
        { id: params.id, expectedRevisionId: form.expectedRevisionId || null },
        url,
        req,
      )
      if (!(result as { ok?: boolean }).ok)
        return renderEntry(ctx, url, req, detail, detail.entry.siteId, kind, {
          errors: resultErrors(result, _),
        })
      return seeOther(inLocale(url, `${kind.basePath}/${params.id}`))
    },

  [`${kind.basePath}/{id}/revisions`]:
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const detail = await entryOf(ctx, url, req, params.id)
      if (!detail || detail.entry.type !== type)
        return text(_('website_backend.error.notFound'), { status: 404 })
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
        revisionsScreen(
          _,
          detail.entry,
          rows,
          await frameFor(ctx, url, req),
          localeSuffix(url),
          kind.basePath,
        ),
      )
    },

  [`${kind.basePath}/{id}/preview`]:
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const detail = await entryOf(ctx, url, req, params.id)
      if (!detail || detail.entry.type !== type)
        return text(_('website_backend.error.notFound'), { status: 404 })
      const preview = (await ctx.call('website.createPreviewToken', { entryId: params.id }, url, req)) as {
        token: string
        expiresAt: string
      }
      return document(
        ctx,
        url,
        req,
        _('website_backend.preview.title'),
        previewScreen(
          _,
          detail.entry,
          preview.token,
          preview.expiresAt,
          await frameFor(ctx, url, req),
          kind.basePath,
        ),
      )
    },
})

const PAGES: EntryKind = { basePath: '/admin/website/pages', titleKey: 'pages' }
const POSTS: EntryKind = { basePath: '/admin/website/posts', titleKey: 'posts' }

const optionalNumber = (value: string | undefined): number | null => {
  if (!value?.trim()) return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const mediaArgs = (id: string, siteId: string, form: Record<string, string>) => ({
  id,
  siteId,
  attachmentId: form.attachmentId,
  alt: form.alt || null,
  caption: form.caption || null,
  width: optionalNumber(form.width),
  height: optionalNumber(form.height),
})

const menuEditRoute =
  (): RouteEntry =>
  (ctx: ServeContext): Route =>
  async (url, req, params) => {
    const _ = ctx.translate(ctx.localeOf(url, req))
    const sites = await sitesOf(ctx, url, req)
    const form = req.method === 'POST' ? await readForm(req) : null
    const siteId = url.searchParams.get('site') || form?.siteId || selectedSite(url, sites)
    if (!siteId) return text(_('website_backend.content.noSite'), { status: 400 })
    const rows = (await ctx.call('website_menu.listMenu', { siteId }, url, req)) as MenuRow[]
    const existing = params.id ? rows.find((row) => row.id === params.id) : null
    if (params.id && !existing) return text(_('website_backend.error.notFound'), { status: 404 })
    const parents = rows
      .filter((row) => row.id !== params.id)
      .map((row) => ({ value: row.id, label: row.label }))
    if (req.method === 'POST') {
      const id = params.id || randomUUID()
      const result = await ctx.call(
        'website_menu.addMenuItem',
        {
          id,
          siteId,
          label: form?.label,
          href: form?.href,
          position: optionalNumber(form?.position) ?? 0,
          parentId: form?.parentId || null,
        },
        url,
        req,
      )
      if ((result as { ok?: boolean }).ok)
        return seeOther(inLocale(url, `/admin/menus/${id}?site=${encodeURIComponent(siteId)}`))
      return document(
        ctx,
        url,
        req,
        existing?.label ?? _('website_backend.menus.newTitle'),
        menuFormScreen(
          _,
          { ...existing, ...form, id: params.id, siteId } as never,
          parents,
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
      existing?.label ?? _('website_backend.menus.newTitle'),
      menuFormScreen(_, existing ?? { siteId, position: 0 }, parents, await frameFor(ctx, url, req), {
        locale: localeSuffix(url),
      }),
    )
  }

export const routes: Record<string, RouteEntry> = {
  ...entryRoutes(PAGES, 'website.page'),
  ...entryRoutes(POSTS, 'website.post'),
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
    (_ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      return seeOther(`/admin/website/pages${url.search}`)
    },

  '/admin/content/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const posted = req.method === 'POST' ? await readForm(req) : null
      const siteId = url.searchParams.get('site') || posted?.siteId || selectedSite(url, sites)
      if (!siteId) return text(_('website_backend.content.noSite'), { status: 400 })
      if (req.method === 'GET') return seeOther(`/admin/website/pages/new${url.search}`)
      if (req.method === 'POST') {
        const form = posted ?? {}
        const jsonErrors = invalidJsonErrors(form, _)
        if (jsonErrors.length)
          return renderEntry(ctx, url, req, null, siteId, PAGES, { values: form, errors: jsonErrors })
        const id = randomUUID()
        const result = await saveEntry(ctx, url, req, id, form, 'website.page')
        if ((result as { ok?: boolean } | null)?.ok) return seeOther(inLocale(url, `/admin/content/${id}`))
        return renderEntry(ctx, url, req, null, siteId, PAGES, {
          values: form,
          errors: resultErrors(result, _),
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return renderEntry(ctx, url, req, null, siteId, PAGES)
    },

  '/admin/content/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const detail = await entryOf(ctx, url, req, params.id)
      if (!detail)
        return text(ctx.translate(ctx.localeOf(url, req))('website_backend.error.notFound'), { status: 404 })
      if (req.method === 'GET')
        return seeOther(
          `${detail.entry.type === 'website.post' ? POSTS.basePath : PAGES.basePath}/${params.id}${url.search}`,
        )
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const form = await readForm(req)
      const jsonErrors = invalidJsonErrors(form, _)
      if (jsonErrors.length)
        return renderEntry(
          ctx,
          url,
          req,
          detail,
          detail.entry.siteId,
          detail.entry.type === 'website.post' ? POSTS : PAGES,
          { values: form, errors: jsonErrors },
        )
      const result = await saveEntry(
        ctx,
        url,
        req,
        params.id,
        form,
        detail.entry.type === 'website.post' ? 'website.post' : 'website.page',
      )
      if ((result as { ok?: boolean } | null)?.ok)
        return seeOther(inLocale(url, `/admin/content/${params.id}`))
      return renderEntry(
        ctx,
        url,
        req,
        detail,
        detail.entry.siteId,
        detail.entry.type === 'website.post' ? POSTS : PAGES,
        {
          values: form,
          errors: resultErrors(result, _),
        },
      )
    },

  '/admin/content/{id}/publish':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      const result = await ctx.call(
        'website.publishEntry',
        { id: params.id, expectedRevisionId: form.expectedRevisionId || null },
        url,
        req,
      )
      if (!(result as { ok?: boolean }).ok) {
        const detail = await entryOf(ctx, url, req, params.id)
        const _ = ctx.translate(ctx.localeOf(url, req))
        if (!detail) return text(_('website_backend.error.notFound'), { status: 404 })
        return renderEntry(
          ctx,
          url,
          req,
          detail,
          detail.entry.siteId,
          detail.entry.type === 'website.post' ? POSTS : PAGES,
          {
            errors: resultErrors(result, _),
          },
        )
      }
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
        taxonomyScreen(_, rows, siteOptions(sites), siteId, await frameFor(ctx, url, req), localeSuffix(url)),
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
        mediaScreen(_, rows, siteOptions(sites), siteId, await frameFor(ctx, url, req), localeSuffix(url)),
      )
    },

  '/admin/menus':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const siteId = selectedSite(url, sites)
      const rows = siteId
        ? ((await ctx.call('website_menu.listMenu', { siteId }, url, req)) as MenuRow[])
        : []
      return document(
        ctx,
        url,
        req,
        _('website_backend.menus.title'),
        menusScreen(_, rows, siteOptions(sites), siteId, await frameFor(ctx, url, req), localeSuffix(url)),
      )
    },

  '/admin/taxonomies/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const form = req.method === 'POST' ? await readForm(req) : null
      const siteId = url.searchParams.get('site') || form?.siteId || selectedSite(url, sites)
      if (!siteId) return text(_('website_backend.content.noSite'), { status: 400 })
      const taxonomies = await taxonomyOptions(ctx, url, req)
      const parents = (
        (await ctx.call(
          'website.listTaxonomyTerms',
          { siteId, taxonomy: form?.taxonomy || taxonomies[0]?.value },
          url,
          req,
        )) as TaxonomyRow[]
      ).map((item) => ({ value: item.id, label: item.name }))
      if (req.method === 'POST') {
        const id = randomUUID()
        const result = await ctx.call(
          'website.saveTerm',
          {
            id,
            siteId,
            taxonomy: form?.taxonomy,
            slug: form?.slug,
            name: form?.name,
            description: form?.description || null,
            parentId: form?.parentId || null,
          },
          url,
          req,
        )
        if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/taxonomies/${id}`))
        return document(
          ctx,
          url,
          req,
          _('website_backend.taxonomies.newTitle'),
          taxonomyFormScreen(
            _,
            { ...form, siteId } as never,
            taxonomies,
            parents,
            await frameFor(ctx, url, req),
            {
              errors: resultErrors(result, _),
              locale: localeSuffix(url),
            },
          ),
        )
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return document(
        ctx,
        url,
        req,
        _('website_backend.taxonomies.newTitle'),
        taxonomyFormScreen(
          _,
          { siteId, taxonomy: taxonomies[0]?.value },
          taxonomies,
          parents,
          await frameFor(ctx, url, req),
          { locale: localeSuffix(url) },
        ),
      )
    },

  '/admin/taxonomies/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      const row = (await ctx.call(
        'website.getTaxonomyTerm',
        { id: params.id },
        url,
        req,
      )) as TaxonomyRow | null
      if (!row) return text(_('website_backend.error.notFound'), { status: 404 })
      const taxonomies = await taxonomyOptions(ctx, url, req)
      const all = (await ctx.call(
        'website.listTaxonomyTerms',
        { siteId: row.siteId, taxonomy: row.taxonomy },
        url,
        req,
      )) as TaxonomyRow[]
      const parents = all
        .filter((item) => item.id !== row.id)
        .map((item) => ({ value: item.id, label: item.name }))
      if (req.method === 'POST') {
        const form = await readForm(req)
        const result = await ctx.call(
          'website.saveTerm',
          {
            id: row.id,
            siteId: row.siteId,
            taxonomy: row.taxonomy,
            slug: form.slug,
            name: form.name,
            description: form.description || null,
            parentId: form.parentId || null,
          },
          url,
          req,
        )
        if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/taxonomies/${row.id}`))
        return document(
          ctx,
          url,
          req,
          row.name,
          taxonomyFormScreen(_, { ...row, ...form }, taxonomies, parents, await frameFor(ctx, url, req), {
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
        row.name,
        taxonomyFormScreen(_, row, taxonomies, parents, await frameFor(ctx, url, req), {
          locale: localeSuffix(url),
        }),
      )
    },

  '/admin/taxonomies/{id}/delete':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const row = (await ctx.call(
        'website.getTaxonomyTerm',
        { id: params.id },
        url,
        req,
      )) as TaxonomyRow | null
      if (!row) return text(_('website_backend.error.notFound'), { status: 404 })
      const result = await ctx.call('website.deleteTerm', { id: params.id }, url, req)
      if (
        !(result as { ok?: boolean; changes?: number }).ok &&
        (result as { changes?: number }).changes == null
      )
        return text(resultErrors(result, _).join('\n'), { status: 409 })
      return seeOther(inLocale(url, `/admin/taxonomies?site=${encodeURIComponent(row.siteId)}`))
    },

  '/admin/media/new':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const form = req.method === 'POST' ? await readForm(req) : null
      const siteId = url.searchParams.get('site') || form?.siteId || selectedSite(url, sites)
      if (!siteId) return text(_('website_backend.content.noSite'), { status: 400 })
      if (req.method === 'POST') {
        const id = randomUUID()
        const result = await ctx.call(
          'website.saveMediaMetadata',
          mediaArgs(id, siteId, form ?? {}),
          url,
          req,
        )
        if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/media/${id}`))
        return document(
          ctx,
          url,
          req,
          _('website_backend.media.newTitle'),
          mediaFormScreen(_, { ...form, siteId } as never, await frameFor(ctx, url, req), {
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
        _('website_backend.media.newTitle'),
        mediaFormScreen(_, { siteId }, await frameFor(ctx, url, req), { locale: localeSuffix(url) }),
      )
    },

  '/admin/media/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      const row = (await ctx.call('website.getMediaMetadata', { id: params.id }, url, req)) as MediaRow | null
      if (!row) return text(_('website_backend.error.notFound'), { status: 404 })
      if (req.method === 'POST') {
        const form = await readForm(req)
        const result = await ctx.call(
          'website.saveMediaMetadata',
          mediaArgs(row.id, row.siteId, form),
          url,
          req,
        )
        if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/media/${row.id}`))
        return document(
          ctx,
          url,
          req,
          row.attachmentId,
          mediaFormScreen(_, { ...row, ...form } as never, await frameFor(ctx, url, req), {
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
        row.attachmentId,
        mediaFormScreen(_, row, await frameFor(ctx, url, req), { locale: localeSuffix(url) }),
      )
    },

  '/admin/media/{id}/delete':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const row = (await ctx.call('website.getMediaMetadata', { id: params.id }, url, req)) as MediaRow | null
      if (!row) return text(_('website_backend.error.notFound'), { status: 404 })
      const result = await ctx.call('website.deleteMediaMetadata', { id: params.id }, url, req)
      if (!(result as { ok?: boolean }).ok) return text(resultErrors(result, _).join('\n'), { status: 409 })
      return seeOther(inLocale(url, `/admin/media?site=${encodeURIComponent(row.siteId)}`))
    },

  '/admin/menus/new': menuEditRoute(),
  '/admin/menus/{id}': menuEditRoute(),
  '/admin/menus/{id}/delete':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const form = await readForm(req)
      const siteId = form.siteId || url.searchParams.get('site') || ''
      const result = await ctx.call('website_menu.removeMenuItem', { id: params.id }, url, req)
      if ((result as { ok?: boolean; errors?: unknown[] }).ok === false) {
        const _ = ctx.translate(ctx.localeOf(url, req))
        return text(resultErrors(result, _).join('\n'), { status: 409 })
      }
      return seeOther(inLocale(url, `/admin/menus?site=${encodeURIComponent(siteId)}`))
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
