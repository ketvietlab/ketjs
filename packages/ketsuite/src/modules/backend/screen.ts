// One way to answer a backend request.
//
// Every admin screen needs the same five things before it can render anything of
// its own: who is looking, the menu that viewer may see, the joints other modules
// hang off the shell, the locale, and the choice between a whole document and the
// navigation fragment. That is not module knowledge — it is the shell's — and each
// module writing it out again is how three of them ended up serving `page()`
// directly and losing progressive navigation, and how fourteen of them stopped
// rendering `backend:sidebar.foot` so the unread-mail badge disappeared halfway
// through a session.
//
// So it lives here, once, and a module says only which title and which body.

import { isNavigationRequest, isTimezone } from '@ketvietlab/ketjs'
import type { Route, ServeContext, Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { actionGroup, backendPage, linkButton } from '../../ui/index.ts'
import type { Extras, Frame, FormField, Viewer } from '../../ui/index.ts'

/** The raw request a route handler is handed. */
export type Req = Parameters<Route>[1]

/** A row as a screen sees it: the domain owns the shape, the screen reads fields. */
export type AnyRow = Record<string, unknown>

/**
 * Who is looking. The screens show it in the topbar, which is the difference
 * between a page that happens to be behind a login and one that says so.
 */
export const viewerOf = async (ctx: ServeContext, url: URL, req: Req): Promise<Viewer | null> => {
  const sessions = await ctx.sessionsOf(url, req)
  const record = await sessions?.of(req)
  if (!record) return null
  const user = (await ctx.callUnchecked('user.getUser', { id: record.userId }, url, req)) as {
    name?: string
    timezone?: string | null
  } | null
  const live = await ctx.live(req)
  const labels = live.functions['company.contextLabels']
    ? ((await ctx.callUnchecked(
        'company.contextLabels',
        { companyId: record.company, branchId: record.branch },
        url,
        req,
      )) as {
        companyName?: string | null
        branchName?: string | null
        branchCode?: string | null
        branchIsRoot?: boolean | null
      })
    : {}
  const lang = url.searchParams.get('lang')
  return {
    name: user?.name ?? record.userId,
    company: record.company,
    companies: record.companies,
    companyName: labels.companyName ?? record.company,
    branch: record.branch,
    branches: record.branches,
    branchName: labels.branchIsRoot
      ? `${ctx.translate(ctx.localeOf(url, req))('backend.context.rootBranch')} · ${labels.branchCode}`
      : (labels.branchName ?? record.branch),
    contextPath: live.routes['/admin/context']
      ? `/admin/context${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`
      : null,
    profilePath: live.routes['/admin/profile']
      ? `/admin/profile${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`
      : null,
    timezone: user?.timezone && isTimezone(user.timezone) ? user.timezone : ctx.config.defaultTimezone,
  }
}

export const timezoneOf = async (ctx: ServeContext, url: URL, req: Req): Promise<string> =>
  (await viewerOf(ctx, url, req))?.timezone ?? ctx.config.defaultTimezone

export type FrameOptions = {
  /**
   * The list a detail page belongs to. A quotation at `/admin/sales/quotations/{id}`
   * highlights the Quotations entry; without this the sidebar marks nothing, which
   * reads as "you have left the app".
   */
  active?: string
  /** Screen-specific joints, merged over the ones every screen gets. */
  extras?: Extras
}

/**
 * The shell's half of a screen.
 *
 * `sidebar.foot` is skipped for a navigation fragment on purpose: the foot sits
 * outside `[data-ui="sidebar-main"]`, so it is not one of the slots the client
 * replaces, and rendering its islands would build markup the browser discards.
 */
export const frameOf = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  options: FrameOptions = {},
): Promise<Frame> => {
  const active = options.active ?? url.pathname
  const menuUrl = active === url.pathname ? url : Object.assign(new URL(url), { pathname: active })
  const navigation = isNavigationRequest(req)
  const lang = ctx.localeOf(url, req)
  return {
    navigation,
    viewer: await viewerOf(ctx, url, req),
    menu: await ctx.menu(menuUrl, req),
    // The sidebar's search is in the URL like every other list's, so a filtered
    // menu is a link and the back button walks out of it.
    menuFilter: url.searchParams.get('menu')?.trim() || null,
    extras: {
      'nav.items': await ctx.joint(url, req, 'backend:nav.items', { active }),
      'topbar.end': await ctx.joint(url, req, 'backend:topbar.end'),
      'sidebar.foot': navigation ? undefined : await ctx.joint(url, req, 'backend:sidebar.foot', { lang }),
      ...options.extras,
    },
  }
}

export type ScreenOptions = FrameOptions & {
  /** A message key by default; pass `translate: false` for a literal. */
  title: string
  translate?: boolean
  status?: number
}

/**
 * A whole backend response: frame, translator, and the document-or-fragment
 * decision. The body is a function rather than a value so nothing is rendered
 * before the frame it sits in is known.
 */
export const adminPage = async (
  ctx: ServeContext,
  url: URL,
  req: Req,
  options: ScreenOptions & {
    body: (_: Translator, frame: Frame) => TemplateResult | Promise<TemplateResult>
  },
): Promise<ReturnType<typeof backendPage>> => {
  const lang = ctx.localeOf(url, req)
  const _ = ctx.translate(lang)
  const frame = await frameOf(ctx, url, req, options)
  return backendPage(ctx, req, {
    lang,
    title: options.translate === false ? options.title : _(options.title),
    body: await options.body(_, frame),
    status: options.status,
  })
}

/**
 * A GET-only screen, for the common case where the route does nothing but read.
 * Anything that also accepts POST dispatches itself and calls `adminPage`.
 */
export const screen =
  (
    ctx: ServeContext,
    options: ScreenOptions & {
      body: (_: Translator, frame: Frame, url: URL, req: Req) => TemplateResult | Promise<TemplateResult>
    },
  ): Route =>
  async (url, req) =>
    adminPage(ctx, url, req, { ...options, body: (_, frame) => options.body(_, frame, url, req) })

/**
 * The same path in the language currently being read.
 *
 * `?lang=` is how the backend switches locale, so every link a screen builds has
 * to carry it or the next click silently reverts. It takes the path apart rather
 * than appending a suffix: half the modules used to append `?lang=` and the other
 * half had to write a second helper to repair the ones that already had a query.
 */
export const inLocale = (url: URL, path: string): string => {
  const target = new URL(path, 'http://ket.local')
  const lang = url.searchParams.get('lang')
  if (lang) target.searchParams.set('lang', lang)
  return `${target.pathname}${target.search}`
}

/**
 * The `?lang=` a screen has to carry into every link it builds.
 *
 * A screen is a pure function of its data, so it cannot read the request; it is
 * handed this instead. Empty when the reader never asked for a language, which is
 * the common case and leaves the URLs clean.
 */
export const localeQuery = (url: URL): string => {
  const lang = url.searchParams.get('lang')
  return lang ? `?lang=${encodeURIComponent(lang)}` : ''
}

/**
 * A path plus that query, whether or not the path already had one.
 *
 * Eleven copies of this used to live in eleven screen files, four of them written
 * differently and one of them producing `…?state=draft?lang=en`. Taking the URL
 * apart rather than concatenating is what makes the question stop coming up.
 */
export const localized = (path: string, locale: string): string => {
  if (!locale) return path
  const target = new URL(path, 'http://ket.local')
  const lang = new URLSearchParams(locale.replace(/^\?/, '')).get('lang')
  if (lang) target.searchParams.set('lang', lang)
  return `${target.pathname}${target.search}`
}

/** Rows as `<select>` options; `empty` adds the "not chosen" one at the top. */
export const choices = (rows: readonly AnyRow[], empty = false) => [
  ...(empty ? [{ value: '', label: '—' }] : []),
  ...rows.map((row) => ({
    value: String(row.id),
    label: String(row.name ?? row.code ?? row.id),
  })),
]

/**
 * The print group on a record screen.
 *
 * Four backends each built this by hand with `label: 'Print'` written in as an
 * English literal, so the group read "Print" on a Vietnamese screen while the
 * document names beside it were translated. One helper, one translated label.
 */
export const printGroup = (
  _: Translator,
  reports: ReadonlyArray<{ id: string; title: string }>,
  recordId: string,
  search: string,
): TemplateResult | undefined =>
  reports.length
    ? actionGroup({
        label: _('backend.print.label'),
        actions: reports.map((report) =>
          linkButton({
            label: _(report.title),
            href: `/reports/${encodeURIComponent(report.id)}/${encodeURIComponent(recordId)}${search}`,
          }),
        ),
      })
    : undefined

/**
 * A required select with nothing to select is a dead end.
 *
 * The browser refuses to submit an empty required dropdown and says only
 * "please select an item in the list" — it cannot say that the tenant has no
 * warehouse yet, or no sales journal, or no income account. The form looks
 * broken and the screen offers no way out. Naming what is missing, and where to
 * create it, turns a dead end back into a next step.
 */
export const needs = (field: FormField, hint: string): FormField =>
  (field.options ?? []).some((option) => option.value !== '')
    ? field
    : { ...field, disabled: true, help: hint }

/** A field the domain should not see at all when the form left it blank. */
export const optional = (form: Record<string, string>, name: string) =>
  form[name] ? { [name]: form[name] } : {}

/**
 * A stable domain code shown in the reader's language.
 *
 * The code stays in the DOM as `data-value` so a stylesheet and a test can both
 * name it; only the words change. A code with no message key falls back to itself,
 * which is how the pseudo-locale shows up an untranslated selection immediately.
 */
export const selectionLabel = (_: Translator, prefix: string, group: string, value: unknown): string => {
  const raw = String(value ?? '')
  const key = `${prefix}.${group}.${raw}`
  return _.resolves(key) ? _(key) : raw
}

export const selectionOptions = (
  _: Translator,
  prefix: string,
  group: string,
  values: readonly string[],
): Array<{ value: string; label: string }> =>
  values.map((value) => ({ value, label: selectionLabel(_, prefix, group, value) }))

type Issue = {
  field?: string
  code?: string
  message?: string
  params?: Record<string, unknown>
}

/**
 * A failed call's reasons, in the reader's language.
 *
 * The domain answers with `{ field, code, params }` — machine-readable, so the
 * words are chosen here rather than by a function that has no idea who is reading.
 * `fallback` is the module's own "that value will not do", for the rare error that
 * arrives with nothing but a shape.
 */
export const resultErrors = (result: unknown, _: Translator, fallback: string): string[] =>
  ((result as { errors?: Issue[] } | null)?.errors ?? []).map((error) => {
    const body = error.code ? _(error.code, error.params) : (error.message ?? _(fallback))
    return error.field ? `${error.field}: ${body}` : body
  })
