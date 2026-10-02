// Studio frame: the KétSuite shell (brand in the sidebar, location strip over the main column),
// page slot, modal slot and toasts. Screens return complete Design System page patterns; the frame
// never adds headings, padding or boxes around them (L5, L8).
import { html } from '@ketvietlab/ketjs-view'
import {
  AppBrand,
  AppShell,
  AppNavigation,
  AppTopbar,
  Avatar,
  EmptyState,
  IconButton,
  Inline,
  LoadingState,
  Menu,
  NavigationToggle,
  Text,
  ToastRegion,
} from '@ketvietlab/design-system'
import { routes } from './extensions.mjs'
import { navGroups } from './routes.mjs'
import { tr } from './i18n.mjs'
import { h, icon, CommandButton } from './ui.mjs'

/** Nav entries in declared order; an extension entry lands after its `after` key. */
export function navigationEntries(group) {
  const entries = []
  for (const [key, route] of Object.entries(routes)) {
    if (route.nav?.group !== group) continue
    const at = route.nav.after ? entries.findIndex(([k]) => k === route.nav.after) : -1
    if (at >= 0) entries.splice(at + 1, 0, [key, route])
    else entries.push([key, route])
  }
  return entries
}

/** The nav entry a route belongs to: itself, or the entry whose path prefixes its path. */
export function activeEntry(key) {
  if (routes[key]?.nav) return key
  const path = routes[key]?.path ?? ''
  const back = routes[key]?.modal?.back
  if (back) return activeEntry(back)
  let best = null
  for (const [candidate, route] of Object.entries(routes))
    if (
      route.nav &&
      path.startsWith(`${route.path}/`) &&
      (!best || route.path.length > routes[best].path.length)
    )
      best = candidate
  return best
}

/** KétSuite serves its brand artwork to every app it launches; Website adds its name beside it. */
export const BRAND = Object.freeze({
  image: '/_ket/asset/backend/brand/logo-light.png',
  darkImage: '/_ket/asset/backend/brand/logo-dark.png',
})
const NAVIGATION_ID = 'website-navigation'

// GAP ds-app-brand-text: AppBrand shows an image or a label, never both; the product name sits
// beside it in an Inline until the DS takes a suffix.
const identity = (ctx) =>
  h(Inline, {
    items: [
      h(AppBrand, { label: tr('website.brand'), href: ctx.href('overview'), ...BRAND, imageFit: 'cover' }),
      h(Text, { children: tr('website.nav.app') }),
    ],
  })

/** Website selection is distinct from the company scope inherited from ERP. */
const siteContext = (ctx) => {
  const boot = ctx.boot()
  const companyScope = routes[ctx.route()?.key]?.scope === 'company'
  return h(Inline, {
    items: [
      h(Text, {
        children: tr(companyScope ? 'website.site.company' : 'website.settings.site'),
        tone: 'muted',
      }),
      h(Menu, {
        id: 'website-site-switch',
        label: tr('website.site.switch'),
        trigger: companyScope ? tr('website.route.sites') : boot.site.name,
        size: 'compact',
        items: [
          { id: 'sites', kind: 'label', label: tr('website.site.switch') },
          ...boot.sites.map((site) => ({
            id: site.id,
            label: site.name,
            description: site.host,
            href: ctx.href('overview', {}, { site: site.id }),
            leading: !companyScope && site.id === boot.site.id ? icon('check') : undefined,
          })),
          ...(ctx.can('website.site.manage')
            ? [
                { id: 'manage', label: tr('website.route.sites'), href: ctx.href('sites') },
                {
                  id: 'create',
                  label: tr('website.site.create'),
                  href: ctx.href('sites-edit', { id: 'new' }),
                },
              ]
            : []),
        ],
      }),
    ],
  })
}

/** Theme and account, in the order KétSuite's location strip shows them. */
const tools = (ctx) => {
  const boot = ctx.boot()
  const dark = ctx.theme() === 'dark'
  return h(Inline, {
    items: [
      h(IconButton, {
        label: tr('website.theme.toggle'),
        name: 'command',
        value: 'studio.theme',
        type: 'button',
        variant: 'secondary',
        pressed: dark,
        icon: icon(dark ? 'sun' : 'moon'),
      }),
      h(Menu, {
        id: 'website-viewer',
        label: boot.actor.name,
        trigger: h(Avatar, { name: boot.actor.name, size: 'small' }),
        align: 'end',
        items: [
          { id: 'who', kind: 'label', label: `${boot.actor.name} · ${boot.actor.role}` },
          { id: 'home', label: tr('website.viewer.home'), href: boot.home, leading: icon('layout-grid') },
        ],
      }),
    ],
  })
}

/** Website has no search page; the location strip's search finds pages by title or path. */
const search = (ctx) => {
  const route = ctx.route()
  return {
    id: 'website-search',
    action: ctx.href('pages'),
    label: tr('website.search.label'),
    triggerLabel: tr('website.search.trigger'),
    closeLabel: tr('website.search.close'),
    placeholder: tr('website.search.placeholder'),
    submitLabel: tr('website.search.submit'),
    query: route.key === 'pages' ? (route.query.q ?? '') : '',
  }
}

// GAP ds-app-topbar-search: AppTopbar always renders a search launcher; Website has no global
// search, so it scopes the launcher to its own pages instead of hiding it.
const locationBar = (ctx) =>
  h(AppTopbar, {
    location: siteContext(ctx),
    navigation: h(NavigationToggle, { controls: `${NAVIGATION_ID}-drawer`, label: tr('website.nav.open') }),
    search: search(ctx),
    tools: tools(ctx),
  })

const navigation = (ctx, key) => {
  const active = activeEntry(key)
  const groups = navGroups
    .map((group) => ({
      id: group,
      label: group === 'home' ? undefined : tr(`website.nav.${group}`),
      items: navigationEntries(group)
        .filter(([, route]) => ctx.can(route.capability))
        .map(([entry, route]) => ({
          id: entry,
          label: tr(route.title),
          href: ctx.href(entry),
          active: entry === active,
          leading: route.nav.icon ? icon(route.nav.icon) : undefined,
        })),
    }))
    .filter((group) => group.items.length)
  return h(AppNavigation, {
    id: NAVIGATION_ID,
    label: tr('website.nav.label'),
    externalTrigger: true,
    identity: identity(ctx),
    groups,
    menuLabel: tr('website.nav.open'),
    closeLabel: tr('website.nav.close'),
  })
}

/**
 * @param {any} ctx
 * @param {{ key: string, route: any, body: unknown, background: unknown }} content
 * @param {{ id: string, title: string, tone: string }[]} toasts
 */
export function studioFrame(ctx, content, toasts) {
  const region = h(ToastRegion, { label: tr('website.toast.region'), toasts })
  if (content.route?.frame === 'workspace')
    return html`<div class="website-workspace">${content.body ?? loadingView()}</div>${region}`
  const page = content.background ?? content.body ?? loadingView()
  const modal = content.background ? content.body : null
  return html`${h(AppShell, {
    location: locationBar(ctx),
    sidebar: navigation(ctx, content.key),
    main: html`${page}${modal}`,
    mode: 'viewport',
  })}${region}`
}

export const loadingView = () => h(LoadingState, { label: tr('website.loading'), lines: 3 })

export function failureView(error) {
  const denied = error?.code === 'forbidden'
  return h(EmptyState, {
    title: tr(denied ? 'website.error.forbiddenTitle' : 'website.error.unavailableTitle'),
    message: error?.message ?? tr('website.error.request'),
    actions: denied ? null : CommandButton({ label: tr('website.action.retry'), command: 'studio.retry' }),
  })
}
