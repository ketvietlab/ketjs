import {
  AppBrand,
  AppShell,
  AppNavigation,
  AppTopbar,
  Avatar,
  EmptyState,
  IconButton,
  Inline,
  LinkButton,
  LoadingState,
  Menu,
  NavigationToggle,
  Text,
  ToastRegion,
} from '@ketvietlab/design-system'
import { routes } from './extensions.ts'
import { navGroups } from './routes.ts'
import { tr } from './i18n.ts'
import { icon, CommandButton } from './ui.tsx'
import type { WebsiteRoute } from './extensions.ts'
import type { StudioContext, Toast, View } from './types.ts'

/** What the island hands the frame for the current route. */
export type StudioContent = {
  key: string
  route: WebsiteRoute | undefined
  body: View
  background: View
}

type NavRoute = WebsiteRoute & { nav: NonNullable<WebsiteRoute['nav']> }

/** Nav entries in declared order; an extension entry lands after its `after` key. */
export function navigationEntries(group: string): [string, NavRoute][] {
  const entries: [string, NavRoute][] = []
  for (const [key, route] of Object.entries(routes)) {
    if (route.nav?.group !== group) continue
    const nav = route.nav
    const at = nav.after ? entries.findIndex(([k]) => k === nav.after) : -1
    if (at >= 0) entries.splice(at + 1, 0, [key, route as NavRoute])
    else entries.push([key, route as NavRoute])
  }
  return entries
}

/** The nav entry a route belongs to: itself, or the entry whose path prefixes its path. */
export function activeEntry(key: string): string | null {
  if (routes[key]?.nav) return key
  const path = routes[key]?.path ?? ''
  const back = routes[key]?.modal?.back
  if (back) return activeEntry(back)
  let best: string | null = null
  for (const [candidate, route] of Object.entries(routes))
    if (
      route.nav &&
      path.startsWith(`${route.path}/`) &&
      (!best || route.path.length > routes[best]!.path.length)
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
const identity = (ctx: StudioContext) => (
  <Inline
    items={[
      <AppBrand label={tr('website.brand')} href={ctx.href('overview')} {...BRAND} imageFit="cover" />,
      <Text children={tr('website.nav.app')} />,
    ]}
  />
)

/** Website selection is distinct from the company scope inherited from ERP. */
const siteContext = (ctx: StudioContext) => {
  const boot = ctx.boot()
  const companyScope = routes[ctx.route()?.key]?.scope === 'company'
  return (
    <Inline
      items={[
        <Text children={tr(companyScope ? 'website.site.company' : 'website.settings.site')} tone="muted" />,
        <Menu
          id="website-site-switch"
          label={tr('website.site.switch')}
          trigger={companyScope ? tr('website.route.sites') : boot.site!.name}
          size="compact"
          items={[
            { id: 'sites', kind: 'label', label: tr('website.site.switch') },
            ...boot.sites.map((site) => ({
              id: site.id,
              label: site.name,
              description: site.host,
              href: ctx.href('overview', {}, { site: site.id }),
              leading: !companyScope && site.id === boot.site!.id ? icon('check') : undefined,
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
          ]}
        />,
      ]}
    />
  )
}

/** Theme and account, in the order KétSuite's location strip shows them. */
const tools = (ctx: StudioContext) => {
  const boot = ctx.boot()
  const dark = ctx.theme() === 'dark'
  return (
    <Inline
      items={[
        <IconButton
          label={tr('website.theme.toggle')}
          name="command"
          value="studio.theme"
          type="button"
          variant="secondary"
          pressed={dark}
          icon={icon(dark ? 'sun' : 'moon')}
        />,
        <Menu
          id="website-viewer"
          label={boot.actor.name}
          trigger={<Avatar name={boot.actor.name} size="small" />}
          align="end"
          items={[
            { id: 'who', kind: 'label', label: `${boot.actor.name} · ${boot.actor.role}` },
            { id: 'home', label: tr('website.viewer.home'), href: boot.home, leading: icon('layout-grid') },
          ]}
        />,
      ]}
    />
  )
}

/** Website has no search page; the location strip's search finds pages by title or path. */
const search = (ctx: StudioContext) => {
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
const locationBar = (ctx: StudioContext) => (
  <AppTopbar
    location={siteContext(ctx)}
    navigation={<NavigationToggle controls={`${NAVIGATION_ID}-drawer`} label={tr('website.nav.open')} />}
    search={search(ctx)}
    tools={tools(ctx)}
  />
)

const navigation = (ctx: StudioContext, key: string) => {
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
  return (
    <AppNavigation
      id={NAVIGATION_ID}
      label={tr('website.nav.label')}
      externalTrigger
      identity={identity(ctx)}
      groups={groups}
      menuLabel={tr('website.nav.open')}
      closeLabel={tr('website.nav.close')}
    />
  )
}

export function studioFrame(ctx: StudioContext, content: StudioContent, toasts: Toast[]) {
  const region = <ToastRegion label={tr('website.toast.region')} toasts={toasts} />
  if (content.route?.frame === 'workspace')
    return (
      <>
        <div class="website-workspace">{content.body ?? loadingView()}</div>
        {region}
      </>
    )
  const page = content.background ?? content.body ?? loadingView()
  const modal = content.background ? content.body : null
  return (
    <>
      <AppShell
        location={locationBar(ctx)}
        sidebar={navigation(ctx, content.key)}
        main={
          <>
            {page}
            {modal}
          </>
        }
        mode="viewport"
      />
      {region}
    </>
  )
}

export const loadingView = () => <LoadingState label={tr('website.loading')} lines={3} />

/** A missing record is not an outage: no retry, and a way back to the list it belongs to. */
export function failureView(error: unknown, back?: { label: string; href: string }) {
  const { code, message } = (error ?? {}) as { code?: string; message?: string }
  const denied = code === 'forbidden',
    missing = code === 'notFound'
  return (
    <EmptyState
      title={tr(
        denied
          ? 'website.error.forbiddenTitle'
          : missing
            ? 'website.error.notFoundTitle'
            : 'website.error.unavailableTitle',
      )}
      message={message ?? tr('website.error.request')}
      actions={
        missing ? (
          back ? (
            <LinkButton label={back.label} href={back.href} leading={icon('chevron-left')} />
          ) : null
        ) : denied ? null : (
          <CommandButton label={tr('website.action.retry')} command="studio.retry" />
        )
      }
    />
  )
}
