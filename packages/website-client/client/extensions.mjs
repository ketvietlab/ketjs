// Extension points for features outside the open core. Core never imports an extension: the
// product entry registers them before the Studio island is created. Without an extension its
// routes, navigation entries, cards and sections do not exist — no locked buttons, no dead links.
// Route visibility is not authorization: the server checks every capability again.
import { coreRoutes, navGroups } from './routes.mjs'
import { registerMessages } from './i18n.mjs'

/**
 * @typedef {object} WebsiteRoute
 * @property {string} title Message key.
 * @property {string} path Pattern relative to the Studio base, e.g. `analytics` or `pages/:id/builder`.
 * @property {{ group: string, after?: string, icon?: string }} [nav] Sidebar entry.
 * @property {'site' | 'company'} [scope] `site` routes act on the selected site (default).
 * @property {'shell' | 'workspace'} [frame] `workspace` owns the whole window (builder-like tools).
 * @property {{ back: string }} [modal] Route-owned modal drawn over its `back` route.
 * @property {string[]} [query] Query keys this route keeps in the URL besides `site`.
 * @property {string} [capability] Capability needed to see the entry; the server still enforces it.
 */
/**
 * @typedef {{ key: string, params: Record<string, string>, query: Record<string, string> }} WebsiteLocation
 * @typedef {object} WebsiteExtensionInstance
 * @property {(key: string, route: WebsiteLocation, signal: AbortSignal) => Promise<unknown>} [read]
 *   Data for one of its own routes. Runs after navigation; aborted when the route changes.
 * @property {(key: string, data: unknown) => unknown} [view] The complete Design System page pattern
 *   (ListPage, WorkspacePage, RecordPage…) or, for a modal route, the ModalSheet.
 * @property {(key: string, route: WebsiteLocation, signal: AbortSignal) => Promise<unknown> | null} [readFor]
 *   Extension data for a core route, read in parallel with the core data and refreshed with it.
 *   Return null to skip. A failure here is logged and gives `undefined`; it never fails the core screen.
 * @property {Record<string, (args: Record<string, string>, form?: FormData) => unknown>} [commands]
 *   Buttons and forms name a command; names are namespaced by the extension (`analytics.export`).
 *   A `form[data-live=name]` runs its command on every input, without a busy state or request.
 * @property {(overview: any, extra: unknown) => unknown} [overviewCard] One block on the site overview.
 * @property {(settings: any, extra: unknown) => unknown} [siteSettingsSection] A Section on site settings.
 *   Client hint that activation will be refused; the server guard is the authority.
 * @property {(error: { code: string }, name: string) => { message?: string } | undefined} [mutationError]
 * @property {() => void} [reset] The selected site changed; drop site-specific state.
 * @property {() => void} [dispose] Abort reads and release resources.
 */
/**
 * @typedef {object} WebsiteExtension
 * @property {string} name
 * @property {Record<string, WebsiteRoute>} [routes]
 * @property {Record<string, string>} [errors] API error code → message key.
 * @property {{ vi: Record<string, string> }} [messages]
 * @property {(ctx: any) => WebsiteExtensionInstance} create
 */

/** Hooks the core calls. Anything else on an instance is a contract violation. */
export const INSTANCE_HOOKS = Object.freeze([
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

/** @type {WebsiteExtension[]} */
const registered = []
/** @type {Record<string, WebsiteRoute>} */
export const routes = { ...coreRoutes }
/** @type {Record<string, string>} */
export const extensionRoutes = {}
/** @type {Record<string, string>} */
export const extensionErrors = {}

/** @param {WebsiteExtension} extension */
export function registerWebsiteExtension(extension) {
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
export const ownerOf = (routeKey) => extensionRoutes[routeKey] ?? null
