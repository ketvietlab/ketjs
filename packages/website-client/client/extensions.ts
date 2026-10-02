// Extension points for features outside the open core. Core never imports an extension: the
// product entry registers them before the Studio island is created. Without an extension its
// routes, navigation entries, cards and sections do not exist — no locked buttons, no dead links.
// Route visibility is not authorization: the server checks every capability again.
import { coreRoutes, navGroups } from './routes.ts'
import { registerMessages } from './i18n.ts'

import type { CommandArgs, StudioContext, View, WebsiteLocation } from './types.ts'

export type { WebsiteLocation }
export type WebsiteRoute = {
  /** Message key. */
  title: string
  /** Pattern relative to the Studio base, e.g. `analytics` or `pages/:id/builder`. */
  path: string
  /** Sidebar entry. */
  nav?: { group: string; after?: string; icon?: string }
  /** `site` routes act on the selected site (default). */
  scope?: 'site' | 'company'
  /** `workspace` owns the whole window (builder-like tools). */
  frame?: 'shell' | 'workspace'
  /** Route-owned modal drawn over its `back` route. */
  modal?: { back: string }
  /** Query keys this route keeps in the URL besides `site`. */
  query?: string[]
  /** Capability needed to see the entry; the server still enforces it. */
  capability?: string
}
export type WebsiteExtensionInstance = {
  /** Data for one of its own routes. Runs after navigation; aborted when the route changes. */
  read?: (key: string, route: WebsiteLocation, signal: AbortSignal) => Promise<unknown>
  /** The complete Design System page pattern (ListPage, WorkspacePage, RecordPage…) or, for a
   *  modal route, the ModalSheet. */
  view?: (key: string, data: unknown) => View
  /** Extension data for a core route, read in parallel with the core data and refreshed with it.
   *  Return null to skip. A failure here is logged and gives `undefined`; it never fails the core
   *  screen. */
  readFor?: (key: string, route: WebsiteLocation, signal: AbortSignal) => Promise<unknown> | null
  /** Buttons and forms name a command; names are namespaced by the extension (`analytics.export`).
   *  A `form[data-live=name]` runs its command on every input, without a busy state or request. */
  commands?: Record<string, (args: CommandArgs, form?: FormData) => unknown>
  /** One block on the site overview. */
  overviewCard?: (overview: unknown, extra: unknown) => View
  /** A Section on site settings. */
  siteSettingsSection?: (settings: unknown, extra: unknown) => View
  /** Client hint that activation will be refused; the server guard is the authority. */
  mutationError?: (error: unknown, name: string) => { message?: string } | undefined
  /** The selected site changed; drop site-specific state. */
  reset?: () => void
  /** Abort reads and release resources. */
  dispose?: () => void
}
export type WebsiteExtension = {
  name: string
  routes?: Record<string, WebsiteRoute>
  /** API error code → message key. */
  errors?: Record<string, string>
  messages?: { vi: Record<string, string> }
  create: (ctx: StudioContext) => WebsiteExtensionInstance
}

/** Hooks the core calls. Anything else on an instance is a contract violation. */
export const INSTANCE_HOOKS: readonly string[] = Object.freeze([
  'read',
  'view',
  'readFor',
  'commands',
  'overviewCard',
  'siteSettingsSection',
  'mutationError',
  'reset',
  'dispose',
])

const registered: WebsiteExtension[] = []
export const routes: Record<string, WebsiteRoute> = { ...coreRoutes }
export const extensionRoutes: Record<string, string> = {}
export const extensionErrors: Record<string, string> = {}

export function registerWebsiteExtension(extension: WebsiteExtension) {
  if (!extension?.name || typeof extension.create !== 'function')
    throw new Error('Website extension requires a name and factory')
  if (registered.some((x) => x.name === extension.name))
    throw new Error(`Website extension ${extension.name} is already registered`)
  const entries = Object.entries(extension.routes ?? {})
  const paths = new Set(Object.values(routes).map((r) => r.path))
  for (const [key, route] of entries) {
    if (routes[key]) throw new Error(`Website route ${key} is already defined`)
    if (!route.title || typeof route.path !== 'string')
      throw new Error(`Website route ${key} needs a title and path`)
    if (paths.has(route.path)) throw new Error(`Website path ${route.path} is already defined`)
    paths.add(route.path)
    if (route.nav && !navGroups.includes(route.nav.group))
      throw new Error(`Unknown Website navigation group ${route.nav.group}`)
    if (route.modal && !routes[route.modal.back] && !extension.routes?.[route.modal.back])
      throw new Error(`Website modal ${key} returns to an unknown route`)
  }
  for (const code of Object.keys(extension.errors ?? {}))
    if (Object.hasOwn(extensionErrors, code)) throw new Error(`Website error ${code} is already defined`)
  // The last step that can refuse; it is atomic itself, and nothing after it can throw.
  if (extension.messages) registerMessages(extension.name, extension.messages)
  registered.push(extension)
  for (const [key, route] of entries) {
    routes[key] = route
    extensionRoutes[key] = extension.name
  }
  Object.assign(extensionErrors, extension.errors)
}

export const websiteExtensions = () => [...registered]
export const ownerOf = (routeKey: string): string | null => extensionRoutes[routeKey] ?? null
