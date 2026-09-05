import { randomUUID } from 'node:crypto'
import { text, withHeaders } from '@ketvietlab/ketjs'
import type { Route, RouteEntry, ServeContext } from '@ketvietlab/ketjs'
import { readForm, seeOther } from '../backend/forms.ts'
import { PAGE_SIZE, pageOf, pager } from '../backend/paging.ts'
import {
  contentScreen,
  entryFormScreen,
  formEditorScreen,
  entrySeoSection,
  preflightScreen,
  publicationsScreen,
  redirectsScreen,
  searchIndexScreen,
  siteDomainsScreen,
  siteMembersScreen,
  submissionRecordScreen,
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
} from './screens/index.tsx'
import type {
  EntryDetail,
  EntryKind,
  EntryRow,
  EntryTermRow,
  MediaRow,
  DanglingLink,
  DomainRow,
  FormRow,
  IndexState,
  MemberRow,
  PublicationRow,
  RedirectRow,
  SeoValues,
  PreflightResult,
  MenuRow,
  RevisionDiff,
  RevisionRow,
  SubmissionAuditRow,
  SubmissionRecord,
  SiteRow,
  SubmissionRow,
  TaxonomyRow,
} from './screens/index.tsx'
import { csvOf, safeFilename } from './csv.ts'
import { adminPage, inLocale, localeQuery } from '../backend/screen.ts'
import type { Req } from '../backend/screen.ts'

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

/**
 * The contract fields the editor owns, read back out of a posted form.
 *
 * Blank means blank, not "leave it alone": `saveForm` treats an absent field
 * as "keep what is there" so that a writer without the field cannot wipe it,
 * but this screen *shows* all three, so the operator saw the box and left it
 * empty on purpose.
 */
const formContractFields = (form: Record<string, string>) => {
  const notice = (form.consentText ?? '').trim()
  const preview = (form.summaryFields ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
  const days = (form.retentionDays ?? '').trim()
  return {
    consentText: notice || null,
    summaryFields: preview.length ? preview : null,
    // A number field in a browser will not submit letters, but a refusal that
    // names the field beats a five hundred if one ever arrives: -1 fails the
    // domain check, where E_INVALID_INPUT on NaN would throw past the screen.
    retentionDays: days === '' ? null : Number.isInteger(Number(days)) ? Number(days) : -1,
  }
}

const formValuesOf = (row: {
  name?: unknown
  notifyTo?: unknown
  successMessage?: unknown
  consentText?: unknown
  summaryFields?: unknown
  retentionDays?: unknown
  schema?: unknown
}): Record<string, string> => ({
  name: String(row.name ?? ''),
  notifyTo: String(row.notifyTo ?? ''),
  successMessage: String(row.successMessage ?? ''),
  consentText: String(row.consentText ?? ''),
  summaryFields: Array.isArray(row.summaryFields) ? row.summaryFields.join(', ') : '',
  retentionDays: row.retentionDays == null ? '' : String(row.retentionDays),
  schema: JSON.stringify(row.schema ?? {}, null, 2),
})

/**
 * The two revisions being compared, and what changed between them.
 *
 * Defaults to the newest two rather than waiting to be asked: "what changed?"
 * is the question people arrive at this screen holding, and answering it
 * without a click is the difference between a feature and a form.
 */
const revisionDiffOf = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  entryId: string,
  rows: RevisionRow[],
): Promise<RevisionDiff | null> => {
  if (rows.length < 2) return null
  const known = new Set(rows.map((row) => row.id))
  const asked = (name: string) => {
    const value = url.searchParams.get(name)
    return value && known.has(value) ? value : null
  }
  const to = asked('to') ?? rows[0]?.id
  const from = asked('from') ?? rows[1]?.id
  if (!to || !from || to === from) return null
  const result = (await ctx.call(
    'website.diffRevisions',
    { entryId, fromRevisionId: from, toRevisionId: to },
    url,
    req,
  )) as (RevisionDiff & { ok?: boolean }) | null
  return result?.ok ? result : null
}

const entryOf = (ctx: ServeContext, url: URL, req: Req, id: string) =>
  ctx.call('website.getEntry', { id }, url, req) as Promise<EntryDetail | null>

/**
 * Where an entry's own screen lives.
 *
 * A route shared by pages and posts still has to send the browser to one of
 * them, and `/admin/website/pages/{id}` answers 404 for a post.
 */
const entryHref = async (ctx: ServeContext, url: URL, req: Req, id: string): Promise<string> => {
  const detail = await entryOf(ctx, url, req, id)
  return `${detail?.entry.type === 'website.post' ? '/admin/website/posts' : '/admin/website/pages'}/${id}`
}

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
  // Read beside the entry rather than folded into getEntry: the head tags
  // belong to website_seo, and the CMS does not get to decide what is public
  // about a page on that module's behalf.
  const [seo, assigned, available] = detail
    ? await Promise.all([
        ctx.call(
          'website_seo.getEntrySeo',
          { entryId: detail.entry.id },
          url,
          req,
        ) as Promise<SeoValues | null>,
        ctx.call('website.listEntryTerms', { entryId: detail.entry.id }, url, req) as Promise<EntryTermRow[]>,
        ctx.call('website.listTaxonomyTerms', { siteId }, url, req) as Promise<TaxonomyRow[]>,
      ])
    : [null, [], []]
  return adminPage(ctx, url, req, {
    title: detail?.entry.title ?? _(`website_backend.${kind.titleKey}.newTitle`),
    translate: false,
    body: (_, frame) =>
      entryFormScreen(_, detail, siteId, kind, frame, {
        ...options,
        seo,
        terms: detail ? { assigned, available } : null,
        locale: localeQuery(url),
      }),
  })
}

const entryRoutes = (kind: EntryKind, type: 'website.page' | 'website.post'): Record<string, RouteEntry> => ({
  [kind.basePath]:
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const siteId = selectedSite(url, sites)
      const current = pageOf(url)
      const [rows, total] = siteId
        ? await Promise.all([
            ctx.call(
              'website.listEntries',
              { siteId, type, limit: PAGE_SIZE, offset: (current - 1) * PAGE_SIZE },
              url,
              req,
            ) as Promise<EntryRow[]>,
            ctx.call('website.countEntries', { siteId, type }, url, req) as Promise<{ count: number }>,
          ])
        : [[] as EntryRow[], { count: 0 }]
      return adminPage(ctx, url, req, {
        title: _(`website_backend.${kind.titleKey}.title`),
        translate: false,
        body: (_, frame) =>
          contentScreen(
            _,
            rows,
            siteOptions(sites),
            siteId,
            frame,
            localeQuery(url),
            kind,
            pager(url, current, rows.length, total.count),
          ),
      })
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
      const rows = (await ctx.call(
        'website.listRevisions',
        { entryId: params.id },
        url,
        req,
      )) as RevisionRow[]
      const diff = await revisionDiffOf(ctx, url, req, params.id, rows)
      return adminPage(ctx, url, req, {
        title: 'website_backend.revisions.title',
        body: (_, frame) =>
          revisionsScreen(_, detail.entry, rows, frame, localeQuery(url), kind.basePath, diff),
      })
    },

  [`${kind.basePath}/{id}/revisions/{revisionId}/restore`]:
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const result = await ctx.call(
        'website.restoreRevision',
        { entryId: params.id, revisionId: params.revisionId },
        url,
        req,
      )
      if (!(result as { ok?: boolean }).ok) return text(resultErrors(result, _).join('; '), { status: 400 })
      // Back to the entry, not to the list: a restore made a draft, and the
      // draft is the thing the person now wants to look at.
      return seeOther(inLocale(url, `${kind.basePath}/${params.id}`))
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
      return adminPage(ctx, url, req, {
        title: 'website_backend.preview.title',
        body: (_, frame) =>
          previewScreen(
            _,
            detail.entry,
            preview.token,
            preview.expiresAt,
            frame,
            kind.basePath,
            localeQuery(url),
          ),
      })
    },

  /**
   * Withdraw every preview link this entry has.
   *
   * Each visit to the preview screen mints another token, so they accumulate,
   * and a link pasted into a chat outlives the reason it was shared.
   * revokePreviewTokens has always been able to call them all back; nothing
   * asked it to. Back to the entry rather than the preview screen, because
   * landing on the preview screen would immediately mint a fresh one.
   */
  [`${kind.basePath}/{id}/preview/revoke`]:
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const result = await ctx.call('website.revokePreviewTokens', { entryId: params.id }, url, req)
      if (!(result as { ok?: boolean }).ok) return text(resultErrors(result, _).join('; '), { status: 400 })
      return seeOther(inLocale(url, `${kind.basePath}/${params.id}`))
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
        return seeOther(inLocale(url, `/admin/website/menus/${id}?site=${encodeURIComponent(siteId)}`))
      return adminPage(ctx, url, req, {
        title: existing?.label ?? _('website_backend.menus.newTitle'),
        translate: false,
        body: (_, frame) =>
          menuFormScreen(_, { ...existing, ...form, id: params.id, siteId } as never, parents, frame, {
            errors: resultErrors(result, _),
            locale: localeQuery(url),
          }),
      })
    }
    if (req.method !== 'GET') return text('GET or POST', { status: 405 })
    return adminPage(ctx, url, req, {
      title: existing?.label ?? _('website_backend.menus.newTitle'),
      translate: false,
      body: (_, frame) =>
        menuFormScreen(_, existing ?? { siteId, position: 0 }, parents, frame, {
          locale: localeQuery(url),
        }),
    })
  }

export const routes: Record<string, RouteEntry> = {
  ...entryRoutes(PAGES, 'website.page'),
  ...entryRoutes(POSTS, 'website.post'),
  '/admin/website/sites':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      return adminPage(ctx, url, req, {
        title: 'website_backend.sites.title',
        body: async (_, frame) => sitesScreen(_, await sitesOf(ctx, url, req), frame, localeQuery(url)),
      })
    },

  '/admin/website/sites/new':
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
        if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/website/sites/${id}`))
        return adminPage(ctx, url, req, {
          title: 'website_backend.sites.newTitle',
          body: (_, frame) =>
            siteFormScreen(_, form as never, themes, frame, {
              errors: resultErrors(result, _),
              locale: localeQuery(url),
            }),
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return adminPage(ctx, url, req, {
        title: 'website_backend.sites.newTitle',
        body: (_, frame) =>
          siteFormScreen(_, { theme: themes[0]?.value, defaultLocale: 'vi', active: true }, themes, frame, {
            locale: localeQuery(url),
          }),
      })
    },

  '/admin/website/sites/{id}':
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
        if ((result as { ok?: boolean }).ok)
          return seeOther(inLocale(url, `/admin/website/sites/${params.id}`))
        return adminPage(ctx, url, req, {
          title: site.title,
          translate: false,
          body: (_, frame) =>
            siteFormScreen(_, { ...site, ...form, active: form.active === '1' }, themes, frame, {
              errors: resultErrors(result, _),
              locale: localeQuery(url),
            }),
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return adminPage(ctx, url, req, {
        title: site.title,
        translate: false,
        body: (_, frame) => siteFormScreen(_, site, themes, frame, { locale: localeQuery(url) }),
      })
    },

  '/admin/website/content':
    (_ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      return seeOther(`/admin/website/pages${url.search}`)
    },

  '/admin/website/content/new':
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
        if ((result as { ok?: boolean } | null)?.ok)
          return seeOther(inLocale(url, `/admin/website/content/${id}`))
        return renderEntry(ctx, url, req, null, siteId, PAGES, {
          values: form,
          errors: resultErrors(result, _),
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return renderEntry(ctx, url, req, null, siteId, PAGES)
    },

  '/admin/website/content/{id}':
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
        return seeOther(inLocale(url, `/admin/website/content/${params.id}`))
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

  '/admin/website/content/{id}/publish':
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
      return seeOther(inLocale(url, `/admin/website/content/${params.id}`))
    },

  '/admin/website/content/{id}/revisions':
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
      return adminPage(ctx, url, req, {
        title: 'website_backend.revisions.title',
        body: (_, frame) => revisionsScreen(_, detail.entry, rows, frame, localeQuery(url)),
      })
    },

  '/admin/website/content/{id}/preview':
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
      return adminPage(ctx, url, req, {
        title: 'website_backend.preview.title',
        body: (_, frame) => previewScreen(_, detail.entry, preview.token, preview.expiresAt, frame),
      })
    },

  '/admin/website/taxonomies':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const siteId = selectedSite(url, sites)
      const rows = siteId
        ? ((await ctx.call('website.listTaxonomyTerms', { siteId }, url, req)) as never[])
        : []
      return adminPage(ctx, url, req, {
        title: 'website_backend.taxonomies.title',
        body: (_, frame) => taxonomyScreen(_, rows, siteOptions(sites), siteId, frame, localeQuery(url)),
      })
    },

  '/admin/website/media':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const siteId = selectedSite(url, sites)
      const rows = siteId ? ((await ctx.call('website.listMedia', { siteId }, url, req)) as never[]) : []
      return adminPage(ctx, url, req, {
        title: 'website_backend.media.title',
        body: (_, frame) => mediaScreen(_, rows, siteOptions(sites), siteId, frame, localeQuery(url)),
      })
    },

  /**
   * The publish check, run because someone asked.
   *
   * preflightPublication reads a revision per page, so it is a button rather
   * than something the content list pays for on every render.
   */
  /**
   * The taxonomy terms one entry carries.
   *
   * assignTerm shipped with the taxonomy module and no screen ever called it,
   * so the categories and tags a site declares could only be put on a page by
   * an agent - and `listEntryTerms` and `unassignTerm` did not exist at all,
   * which made an assignment invisible and permanent once made.
   */
  '/admin/website/content/{id}/terms':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const form = await readForm(req)
      if (!form.termId) return text(_('website_backend.terms.noTerm'), { status: 400 })
      const result = await ctx.call(
        'website.assignTerm',
        { id: randomUUID(), entryId: params.id, termId: form.termId },
        url,
        req,
      )
      if (!(result as { ok?: boolean }).ok) return text(resultErrors(result, _).join('; '), { status: 400 })
      return seeOther(inLocale(url, await entryHref(ctx, url, req, params.id)))
    },

  '/admin/website/content/{id}/terms/{termId}/remove':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const result = await ctx.call(
        'website.unassignTerm',
        { entryId: params.id, termId: params.termId },
        url,
        req,
      )
      if (!(result as { ok?: boolean }).ok) return text(resultErrors(result, _).join('; '), { status: 400 })
      return seeOther(inLocale(url, await entryHref(ctx, url, req, params.id)))
    },

  /**
   * The head tags for one page.
   *
   * saveEntrySeo has existed since the SEO module and no screen wrote to it,
   * so a page's description, canonical and social image could only be set by
   * an agent - and `noindex`, the one field that delists a page immediately,
   * could not be reached at all.
   */
  '/admin/website/content/{id}/seo':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const form = await readForm(req)
      const result = await ctx.call(
        'website_seo.saveEntrySeo',
        {
          entryId: params.id,
          metaDescription: (form.metaDescription ?? '').trim() || null,
          canonical: (form.canonical ?? '').trim() || null,
          ogImage: (form.ogImage ?? '').trim() || null,
          noindex: !!form.noindex,
        },
        url,
        req,
      )
      if (!(result as { ok?: boolean }).ok) return text(resultErrors(result, _).join('; '), { status: 400 })
      return seeOther(inLocale(url, await entryHref(ctx, url, req, params.id)))
    },

  /**
   * Publishing a set, from a screen.
   *
   * preparePublication freezes which revision of which page goes out and
   * activatePublication moves all of them or none - the machinery that stops a
   * menu link reaching visitors before the page it points at. It was reachable
   * only by an agent, so the atomic path existed and the one-page-at-a-time
   * path was the only one a person could take.
   */
  '/admin/website/publications':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const posted = req.method === 'POST' ? await readForm(req) : null
      const siteId = posted?.siteId || selectedSite(url, sites)
      const render = async (errors?: string[], notice?: string | null) => {
        const [rows, entries] = siteId
          ? await Promise.all([
              ctx.call('website.listPublications', { siteId }, url, req) as Promise<PublicationRow[]>,
              ctx.call('website.listEntries', { siteId, status: 'published' }, url, req) as Promise<
                EntryRow[]
              >,
            ])
          : [[], []]
        return adminPage(ctx, url, req, {
          title: 'website_backend.publications.title',
          body: (_, frame) =>
            publicationsScreen(_, rows, entries, siteOptions(sites), siteId, frame, {
              errors,
              notice,
              locale: localeQuery(url),
            }),
        })
      }
      if (req.method === 'GET') return render(undefined, url.searchParams.get('done'))
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      if (!siteId) return text(_('website_backend.content.noSite'), { status: 400 })
      const entryIds = (posted?.entryIds ?? '')
        .split(/[\s,]+/)
        .map((id) => id.trim())
        .filter(Boolean)
      // The menu is frozen alongside the pages, so navigation and the pages it
      // points at reach visitors together rather than on separate schedules.
      const menu = await ctx.call('website_menu.snapshotMenu', { siteId }, url, req)
      const result = await ctx.call(
        'website.preparePublication',
        { id: randomUUID(), siteId, entryIds, attachments: { website_menu: menu } },
        url,
        req,
      )
      if ((result as { ok?: boolean }).ok)
        return seeOther(inLocale(url, `/admin/website/publications?site=${encodeURIComponent(siteId)}`))
      return render(resultErrors(result, _))
    },

  '/admin/website/publications/{id}/activate':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const result = (await ctx.call('website.activatePublication', { id: params.id }, url, req)) as {
        ok?: boolean
        missingSections?: string[]
      }
      if (!result.ok) {
        const missing = result.missingSections?.length
          ? `${_('website_backend.publications.missing')}: ${result.missingSections.join(', ')}`
          : resultErrors(result, _).join('; ')
        return text(missing, { status: 400 })
      }
      return seeOther(inLocale(url, '/admin/website/publications'))
    },

  '/admin/website/publications/{id}/rollback':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const siteId = selectedSite(url, sites)
      if (!siteId) return text(_('website_backend.content.noSite'), { status: 400 })
      // A rollback prepares a new publication from the previous set; it does
      // not activate it. Someone still presses activate, which is the same
      // gate every other publication goes through.
      const result = await ctx.call('website.rollbackPublication', { id: randomUUID(), siteId }, url, req)
      if (!(result as { ok?: boolean }).ok) return text(resultErrors(result, _).join('; '), { status: 400 })
      return seeOther(inLocale(url, `/admin/website/publications?site=${encodeURIComponent(siteId)}`))
    },

  '/admin/website/preflight':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const siteId = selectedSite(url, sites)
      if (!siteId) return text(_('website_backend.content.noSite'), { status: 400 })
      const result = (await ctx.call('website.preflightPublication', { siteId }, url, req)) as PreflightResult
      return adminPage(ctx, url, req, {
        title: 'website_backend.preflight.title',
        body: (_, frame) => preflightScreen(_, result, siteId, frame, localeQuery(url)),
      })
    },

  '/admin/website/menus':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const siteId = selectedSite(url, sites)
      const rows = siteId
        ? ((await ctx.call('website_menu.listMenu', { siteId }, url, req)) as MenuRow[])
        : []
      // One extra query on a screen that already lists the menu, and the only
      // place a broken link is visible at all: the item and the page it names
      // are edited on different screens on different days.
      const check = siteId
        ? ((await ctx.call('website_menu.preflightMenu', { siteId }, url, req)) as {
            dangling?: DanglingLink[]
          })
        : null
      return adminPage(ctx, url, req, {
        title: 'website_backend.menus.title',
        body: (_, frame) =>
          menusScreen(_, rows, siteOptions(sites), siteId, frame, localeQuery(url), check?.dangling ?? []),
      })
    },

  /**
   * Who may work on this site.
   *
   * Membership decided every authorization decision in the module and could
   * only be changed by calling the function directly. A permission that can be
   * granted and never reviewed is the kind that outlives its reason.
   */
  '/admin/website/sites/{id}/members':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      const site = (await sitesOf(ctx, url, req)).find((row) => row.id === params.id)
      if (!site) return text(_('website_backend.error.notFound'), { status: 404 })
      const render = async (values?: Record<string, string>, errors?: string[]) => {
        const rows = (await ctx.call(
          'website.listSiteMembers',
          { siteId: params.id },
          url,
          req,
        )) as MemberRow[]
        return adminPage(ctx, url, req, {
          title: 'website_backend.members.title',
          body: (_, frame) =>
            siteMembersScreen(_, site, rows, frame, { values, errors, locale: localeQuery(url) }),
        })
      }
      if (req.method === 'GET') return render()
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const form = await readForm(req)
      const result = await ctx.call(
        'website.saveSiteMember',
        { id: randomUUID(), siteId: params.id, userId: form.userId, role: form.role },
        url,
        req,
      )
      if ((result as { ok?: boolean }).ok)
        return seeOther(inLocale(url, `/admin/website/sites/${params.id}/members`))
      return render(form, resultErrors(result, _))
    },

  '/admin/website/sites/{id}/members/{memberId}/remove':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const result = await ctx.call('website.removeSiteMember', { id: params.memberId }, url, req)
      if (!(result as { ok?: boolean }).ok) return text(resultErrors(result, _).join('; '), { status: 400 })
      return seeOther(inLocale(url, `/admin/website/sites/${params.id}/members`))
    },

  /**
   * Which hosts answer for this site, and which one the others defer to.
   *
   * The primary is not decoration: canonical URLs and the sitemap are built
   * from it, so the wrong primary publishes the wrong address to every crawler
   * that asks.
   */
  '/admin/website/sites/{id}/domains':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      const site = (await sitesOf(ctx, url, req)).find((row) => row.id === params.id)
      if (!site) return text(_('website_backend.error.notFound'), { status: 404 })
      const render = async (values?: Record<string, string>, errors?: string[]) => {
        const rows = (await ctx.call('website.listDomains', { siteId: params.id }, url, req)) as DomainRow[]
        const wanted = url.searchParams.get('edit')
        return adminPage(ctx, url, req, {
          title: 'website_backend.domains.title',
          body: (_, frame) =>
            siteDomainsScreen(_, site, rows, frame, {
              values,
              errors,
              locale: localeQuery(url),
              editing: wanted ? (rows.find((row) => row.id === wanted) ?? null) : null,
            }),
        })
      }
      if (req.method === 'GET') return render()
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const form = await readForm(req)
      const result = await ctx.call(
        'website.saveDomain',
        {
          id: randomUUID(),
          siteId: params.id,
          host: form.host,
          primary: !!form.primary,
          redirectToPrimary: !!form.redirectToPrimary,
        },
        url,
        req,
      )
      if ((result as { ok?: boolean }).ok)
        return seeOther(inLocale(url, `/admin/website/sites/${params.id}/domains`))
      return render(form, resultErrors(result, _))
    },

  /**
   * Correcting a host that is already attached.
   *
   * `saveDomain` is an upsert that promotes a new primary and demotes the old
   * one in the same transaction, and the create route minted a fresh id every
   * time - so re-submitting an existing host only collided with the unique
   * index, and neither the primary nor `redirectToPrimary` could be changed
   * once set.
   */
  '/admin/website/sites/{id}/domains/{domainId}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const form = await readForm(req)
      const result = await ctx.call(
        'website.saveDomain',
        {
          id: params.domainId,
          siteId: params.id,
          host: form.host,
          primary: !!form.primary,
          redirectToPrimary: !!form.redirectToPrimary,
        },
        url,
        req,
      )
      if (!(result as { ok?: boolean }).ok) return text(resultErrors(result, _).join('; '), { status: 400 })
      return seeOther(inLocale(url, `/admin/website/sites/${params.id}/domains`))
    },

  '/admin/website/sites/{id}/domains/{domainId}/remove':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const result = await ctx.call('website.deleteDomain', { id: params.domainId }, url, req)
      if (!(result as { ok?: boolean }).ok) return text(resultErrors(result, _).join('; '), { status: 400 })
      return seeOther(inLocale(url, `/admin/website/sites/${params.id}/domains`))
    },

  /**
   * Whether search answers from the content that is actually live.
   *
   * The index rebuilds itself when a reader notices it is behind, so nobody
   * has to press this. It is here because "the site found nothing" and "the
   * index has not caught up" look identical from outside, and only one of them
   * is a content problem.
   */
  '/admin/website/sites/{id}/index':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      const site = (await sitesOf(ctx, url, req)).find((row) => row.id === params.id)
      if (!site) return text(_('website_backend.error.notFound'), { status: 404 })
      let built: { written: number; done: boolean } | null = null
      if (req.method === 'POST') {
        built = (await ctx.call('website_search.reindexSite', { siteId: params.id }, url, req)) as {
          written: number
          done: boolean
        }
      } else if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const status = (await ctx.call(
        'website_search.indexStatus',
        { siteId: params.id },
        url,
        req,
      )) as IndexState
      return adminPage(ctx, url, req, {
        title: 'website_backend.index.title',
        body: (_, frame) => searchIndexScreen(_, site, status, frame, { built, locale: localeQuery(url) }),
      })
    },

  /**
   * Where an address that used to work now goes.
   *
   * The cycle guard and the path rules were written and no screen used them,
   * so the one operation that keeps old links alive after a restructure could
   * only be performed by an agent.
   */
  '/admin/website/redirects':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const posted = req.method === 'POST' ? await readForm(req) : null
      const siteId = posted?.siteId || selectedSite(url, sites)
      const render = async (values?: Record<string, string>, errors?: string[]) => {
        // `listRedirects` has always taken this filter and nothing passed it,
        // which was of a piece with the route writing `active: true` every
        // time: there were no inactive rows to look at.
        const state = url.searchParams.get('state')
        const rows = siteId
          ? ((await ctx.call(
              'website.listRedirects',
              {
                siteId,
                ...(state === 'active' || state === 'inactive' ? { active: state === 'active' } : {}),
              },
              url,
              req,
            )) as RedirectRow[])
          : []
        const wanted = url.searchParams.get('edit')
        return adminPage(ctx, url, req, {
          title: 'website_backend.redirects.title',
          body: (_, frame) =>
            redirectsScreen(_, rows, siteOptions(sites), siteId, frame, {
              values,
              errors,
              locale: localeQuery(url),
              editing: wanted ? (rows.find((row) => row.id === wanted) ?? null) : null,
            }),
        })
      }
      if (req.method === 'GET') return render()
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      if (!siteId) return text(_('website_backend.content.noSite'), { status: 400 })
      const form = posted ?? {}
      const result = await ctx.call(
        'website.saveRedirect',
        {
          id: randomUUID(),
          siteId,
          fromPath: form.fromPath,
          toPath: form.toPath,
          permanent: !!form.permanent,
          active: true,
        },
        url,
        req,
      )
      if ((result as { ok?: boolean }).ok)
        return seeOther(inLocale(url, `/admin/website/redirects?site=${encodeURIComponent(siteId)}`))
      return render(form, resultErrors(result, _))
    },

  /**
   * Correcting one that is already there.
   *
   * `saveRedirect` is an upsert and the create route minted a fresh id every
   * time, so a typo could not be fixed: the correction collided with the
   * unique index on `fromPath` and the wrong row kept the address.
   */
  '/admin/website/redirects/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const form = await readForm(req)
      const siteId = form.siteId
      if (!siteId) return text(_('website_backend.content.noSite'), { status: 400 })
      const current = ((await ctx.call('website.listRedirects', { siteId }, url, req)) as RedirectRow[]).find(
        (row) => row.id === params.id,
      )
      if (!current) return text(_('website_backend.error.notFound'), { status: 404 })
      const result = await ctx.call(
        'website.saveRedirect',
        {
          id: params.id,
          siteId,
          fromPath: form.fromPath,
          toPath: form.toPath,
          permanent: !!form.permanent,
          // An edit is about where the address goes, not whether it is on.
          active: current.active,
        },
        url,
        req,
      )
      if (!(result as { ok?: boolean }).ok) return text(resultErrors(result, _).join('; '), { status: 400 })
      return seeOther(inLocale(url, `/admin/website/redirects?site=${encodeURIComponent(siteId)}`))
    },

  '/admin/website/redirects/{id}/state':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const form = await readForm(req)
      const sites = await sitesOf(ctx, url, req)
      const siteId = selectedSite(url, sites)
      if (!siteId) return text(_('website_backend.content.noSite'), { status: 400 })
      const current = ((await ctx.call('website.listRedirects', { siteId }, url, req)) as RedirectRow[]).find(
        (row) => row.id === params.id,
      )
      if (!current) return text(_('website_backend.error.notFound'), { status: 404 })
      const result = await ctx.call(
        'website.saveRedirect',
        { ...current, active: form.action === 'activate' },
        url,
        req,
      )
      if (!(result as { ok?: boolean }).ok) return text(resultErrors(result, _).join('; '), { status: 400 })
      return seeOther(inLocale(url, `/admin/website/redirects?site=${encodeURIComponent(siteId)}`))
    },

  '/admin/website/taxonomies/new':
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
        if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/website/taxonomies/${id}`))
        return adminPage(ctx, url, req, {
          title: 'website_backend.taxonomies.newTitle',
          body: (_, frame) =>
            taxonomyFormScreen(_, { ...form, siteId } as never, taxonomies, parents, frame, {
              errors: resultErrors(result, _),
              locale: localeQuery(url),
            }),
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return adminPage(ctx, url, req, {
        title: 'website_backend.taxonomies.newTitle',
        body: (_, frame) =>
          taxonomyFormScreen(_, { siteId, taxonomy: taxonomies[0]?.value }, taxonomies, parents, frame, {
            locale: localeQuery(url),
          }),
      })
    },

  '/admin/website/taxonomies/{id}':
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
        if ((result as { ok?: boolean }).ok)
          return seeOther(inLocale(url, `/admin/website/taxonomies/${row.id}`))
        return adminPage(ctx, url, req, {
          title: row.name,
          translate: false,
          body: (_, frame) =>
            taxonomyFormScreen(_, { ...row, ...form }, taxonomies, parents, frame, {
              errors: resultErrors(result, _),
              locale: localeQuery(url),
            }),
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return adminPage(ctx, url, req, {
        title: row.name,
        translate: false,
        body: (_, frame) =>
          taxonomyFormScreen(_, row, taxonomies, parents, frame, {
            locale: localeQuery(url),
          }),
      })
    },

  '/admin/website/taxonomies/{id}/delete':
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
      return seeOther(inLocale(url, `/admin/website/taxonomies?site=${encodeURIComponent(row.siteId)}`))
    },

  '/admin/website/media/new':
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
        if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/website/media/${id}`))
        return adminPage(ctx, url, req, {
          title: 'website_backend.media.newTitle',
          body: (_, frame) =>
            mediaFormScreen(_, { ...form, siteId } as never, frame, {
              errors: resultErrors(result, _),
              locale: localeQuery(url),
            }),
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return adminPage(ctx, url, req, {
        title: 'website_backend.media.newTitle',
        body: (_, frame) => mediaFormScreen(_, { siteId }, frame, { locale: localeQuery(url) }),
      })
    },

  '/admin/website/media/{id}':
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
        if ((result as { ok?: boolean }).ok) return seeOther(inLocale(url, `/admin/website/media/${row.id}`))
        return adminPage(ctx, url, req, {
          title: row.attachmentId,
          translate: false,
          body: (_, frame) =>
            mediaFormScreen(_, { ...row, ...form } as never, frame, {
              errors: resultErrors(result, _),
              locale: localeQuery(url),
            }),
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return adminPage(ctx, url, req, {
        title: row.attachmentId,
        translate: false,
        body: (_, frame) => mediaFormScreen(_, row, frame, { locale: localeQuery(url) }),
      })
    },

  '/admin/website/media/{id}/delete':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const row = (await ctx.call('website.getMediaMetadata', { id: params.id }, url, req)) as MediaRow | null
      if (!row) return text(_('website_backend.error.notFound'), { status: 404 })
      const result = await ctx.call('website.deleteMediaMetadata', { id: params.id }, url, req)
      if (!(result as { ok?: boolean }).ok) return text(resultErrors(result, _).join('\n'), { status: 409 })
      return seeOther(inLocale(url, `/admin/website/media?site=${encodeURIComponent(row.siteId)}`))
    },

  '/admin/website/menus/new': menuEditRoute(),
  '/admin/website/menus/{id}': menuEditRoute(),
  '/admin/website/menus/{id}/delete':
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
      return seeOther(inLocale(url, `/admin/website/menus?site=${encodeURIComponent(siteId)}`))
    },

  '/admin/website/forms':
    (ctx: ServeContext): Route =>
    async (url, req) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const siteId = selectedSite(url, sites)
      const rows = siteId ? ((await ctx.call('website_form.listForms', { siteId }, url, req)) as never[]) : []
      return adminPage(ctx, url, req, {
        title: 'website_backend.forms.title',
        body: (_, frame) => formsScreen(_, rows, siteId, frame, localeQuery(url)),
      })
    },

  '/admin/website/forms/new':
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
          return adminPage(ctx, url, req, {
            title: 'website_backend.forms.newTitle',
            body: (_, frame) =>
              formEditorScreen(_, siteId, frame, {
                values: form,
                errors: [_('website_backend.error.invalidJson')],
                locale: localeQuery(url),
              }),
          })
        const result = await ctx.call(
          'website_form.saveForm',
          {
            id: randomUUID(),
            siteId,
            name: form.name,
            schema: schema.value,
            successMessage: form.successMessage,
            notifyTo: form.notifyTo || null,
            ...formContractFields(form),
            active: true,
          },
          url,
          req,
        )
        if ((result as { ok?: boolean }).ok)
          return seeOther(inLocale(url, `/admin/website/forms?site=${encodeURIComponent(siteId)}`))
        return adminPage(ctx, url, req, {
          title: 'website_backend.forms.newTitle',
          body: (_, frame) =>
            formEditorScreen(_, siteId, frame, {
              values: form,
              errors: resultErrors(result, _),
              locale: localeQuery(url),
            }),
        })
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      return adminPage(ctx, url, req, {
        title: 'website_backend.forms.newTitle',
        body: (_, frame) => formEditorScreen(_, siteId, frame, { locale: localeQuery(url) }),
      })
    },

  '/admin/website/forms/{id}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      const sites = await sitesOf(ctx, url, req)
      const posted = req.method === 'POST' ? await readForm(req) : null
      const siteId = posted?.siteId || url.searchParams.get('site') || selectedSite(url, sites)
      if (!siteId) return text(_('website_backend.content.noSite'), { status: 400 })
      // listForms is the screen's own data source and forms are few, so the
      // editor reads through it rather than adding a function whose only
      // caller would be this route.
      const forms = (await ctx.call('website_form.listForms', { siteId }, url, req)) as FormRow[]
      const existing = forms.find((row) => row.id === params.id)
      if (!existing) return text(_('website_backend.error.notFound'), { status: 404 })

      const render = (values: Record<string, string>, errors?: string[]) =>
        adminPage(ctx, url, req, {
          title: 'website_backend.forms.editTitle',
          body: (_, frame) =>
            formEditorScreen(_, siteId, frame, {
              id: params.id,
              values,
              errors,
              locale: localeQuery(url),
            }),
        })

      if (req.method === 'GET') return render(formValuesOf(existing))
      if (req.method !== 'POST') return text('GET or POST', { status: 405 })
      const form = posted ?? {}
      const schema = parseJson(form.schema)
      if (!schema.ok) return render(form, [_('website_backend.error.invalidJson')])
      const result = await ctx.call(
        'website_form.saveForm',
        {
          id: params.id,
          siteId,
          name: form.name,
          schema: schema.value,
          successMessage: form.successMessage,
          notifyTo: form.notifyTo || null,
          ...formContractFields(form),
        },
        url,
        req,
      )
      if ((result as { ok?: boolean }).ok)
        return seeOther(inLocale(url, `/admin/website/forms?site=${encodeURIComponent(siteId)}`))
      return render(form, resultErrors(result, _))
    },

  /**
   * One submission, and the record of everyone who opened it.
   *
   * readSubmission files an audit row for every read, and until this screen
   * existed it was recording calls nobody could make. The trail is rendered
   * beside the answers rather than tucked away: a record of who looked is
   * worth more when the person looking can see it too.
   */
  /**
   * The answers, out of the system, named field by field.
   *
   * exportSubmissions refuses anything the form does not ask and writes the
   * exact field list into the audit, so the record says what left rather than
   * that something did.
   */
  '/admin/website/forms/{id}/submissions/export':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const fields = (url.searchParams.get('fields') ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean)
      if (!fields.length) return text(_('website_backend.error.invalid'), { status: 400 })
      const result = (await ctx.call(
        'website_form.exportSubmissions',
        { formId: params.id, fields, reason: 'admin.export' },
        url,
        req,
      )) as { ok?: boolean; fields?: string[]; rows?: Array<Record<string, unknown>> }
      if (!result.ok) return text(resultErrors(result, _).join('; '), { status: 400 })
      const columns = ['_id', '_createdAt', '_status', ...(result.fields ?? [])]
      return withHeaders(text(csvOf(columns, result.rows ?? [])), {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${safeFilename(params.id)}-submissions.csv"`,
      })
    },

  /**
   * Run the retention window now, once someone has said so out loud.
   *
   * A confirmation rather than a button, because an erasure cannot be undone
   * and the answers are the one thing here that a person cannot recreate.
   */
  '/admin/website/forms/{id}/submissions/purge':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'POST') return text('POST', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const form = await readForm(req)
      if (!form.confirm) return text(_('website_backend.submissions.purgeUnconfirmed'), { status: 400 })
      const result = await ctx.call('website_form.purgeSubmissions', { formId: params.id }, url, req)
      if (!(result as { ok?: boolean }).ok) return text(resultErrors(result, _).join('; '), { status: 400 })
      return seeOther(inLocale(url, `/admin/website/forms/${params.id}/submissions`))
    },

  '/admin/website/forms/{id}/submissions/{submissionId}':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      const _ = ctx.translate(ctx.localeOf(url, req))
      if (req.method === 'POST') {
        const form = await readForm(req)
        const reason = (form.holdReason ?? '').trim()
        const held = await ctx.call(
          'website_form.holdSubmission',
          { id: params.submissionId, reason: reason || null },
          url,
          req,
        )
        if (!(held as { ok?: boolean }).ok) return text(resultErrors(held, _).join('; '), { status: 400 })
        return seeOther(inLocale(url, `/admin/website/forms/${params.id}/submissions/${params.submissionId}`))
      }
      if (req.method !== 'GET') return text('GET or POST', { status: 405 })
      const record = (await ctx.call(
        'website_form.readSubmission',
        { id: params.submissionId, reason: 'admin.submissions' },
        url,
        req,
      )) as SubmissionRecord | null
      // readSubmission answers the same way for a caller below the bar as for
      // one naming a row that is not there, so this cannot distinguish them
      // either - which is the point.
      if (!record) return text(_('website_backend.error.notFound'), { status: 404 })
      const audit = (await ctx.call(
        'website_form.listSubmissionAudit',
        { formId: params.id },
        url,
        req,
      )) as SubmissionAuditRow[]
      return adminPage(ctx, url, req, {
        title: 'website_backend.submission.title',
        body: (_, frame) =>
          submissionRecordScreen(
            _,
            record,
            audit.filter((entry) => entry.submissionId === params.submissionId),
            frame,
            localeQuery(url),
          ),
      })
    },

  '/admin/website/forms/{id}/submissions':
    (ctx: ServeContext): Route =>
    async (url, req, params) => {
      if (req.method !== 'GET') return text('GET', { status: 405 })
      const _ = ctx.translate(ctx.localeOf(url, req))
      const current = pageOf(url)
      const [rows, total] = await Promise.all([
        ctx.call(
          'website_form.listSubmissions',
          { formId: params.id, limit: PAGE_SIZE, offset: (current - 1) * PAGE_SIZE },
          url,
          req,
        ) as Promise<SubmissionRow[]>,
        ctx.call('website_form.countSubmissions', { formId: params.id }, url, req) as Promise<{
          count: number
        }>,
      ])
      const sites = await sitesOf(ctx, url, req)
      const siteId = url.searchParams.get('site') || selectedSite(url, sites)
      const forms = siteId
        ? ((await ctx.call('website_form.listForms', { siteId }, url, req)) as FormRow[])
        : []
      const form = forms.find((row) => row.id === params.id)
      // The export offers the form's own field names, so nobody has to
      // remember them - and the erasure only appears where a window exists to
      // enforce.
      const declared = (form?.schema as { fields?: unknown } | undefined)?.fields
      const schemaFields = Array.isArray(declared)
        ? declared
            .map((field) => (field as { name?: unknown } | null)?.name)
            .filter((name): name is string => typeof name === 'string')
        : []
      return adminPage(ctx, url, req, {
        title: 'website_backend.submissions.title',
        body: (_, frame) =>
          submissionsScreen(_, rows, frame, {
            formId: params.id,
            fields: form?.summaryFields?.length ? form.summaryFields : schemaFields,
            retentionDays: form?.retentionDays ?? null,
            locale: localeQuery(url),
            pager: pager(url, current, rows.length, total.count),
          }),
      })
    },
}
