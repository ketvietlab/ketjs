// Extension points for features outside the open core. Core never imports an extension:
// the product entry registers them before the workspace is created. Without an extension
// its routes, menu entries and hooks do not exist — no locked buttons, no dead links.
import { routes } from './routes.mjs'
import { personalRoutes, workspaceRoutes, managementTabs } from './navigation.mjs'

/** @typedef {{ key: string, label: string, icon: string }} FlowNavEntry */
/**
 * A status change an extension wants to stop or redirect. `blocked` refuses it with `message`;
 * `action` replaces the move with a route the user must go through (only for one task at a time).
 * `dragMessage` replaces the board's generic refusal when a drop is not allowed.
 * @typedef {{ message?: string, blocked?: boolean, action?: { label: string, key: string }, dragMessage?: string }} FlowTransition
 */
/**
 * @typedef {object} FlowExtensionInstance
 * @property {(key: string) => unknown} [view] Page for one of its routes.
 * @property {(key: string) => unknown} [modal] Body for one of its forms.
 * @property {(key: string) => unknown} [topAction] Action in the shell header for its page.
 * @property {() => Record<string, string>} [urlParams] Current route state, merged before explicit navigation parameters.
 * @property {(report: any) => unknown} [sprintSummary] Extra summary for a closed sprint.
 * @property {(params: Record<string, string>) => void} [readUrl]
 * @property {(key: string) => void} [beforeNavigate]
 * @property {() => void} [reset] Company or workspace switched.
 * @property {(task: any) => unknown} [taskSection] Section in the task detail.
 * @property {(task: any) => unknown} [taskLinks] Related resources after the task's main content.
 * @property {() => void | Promise<void>} [sync] Refresh external data after navigation or bootstrap.
 * @property {() => void | Promise<void>} [afterRender] Attach external viewers after DOM updates.
 * @property {() => void} [dispose] Abort reads and release external resources.
 * @property {(task: any) => unknown} [taskEstimate] Replaces the points field; null keeps it.
 * @property {(task: any) => string | null} [taskStatusHint] Line under a task's status in lists.
 * @property {(task: any, columnId: string) => FlowTransition | null} [transition]
 * @property {(task: any) => number | undefined} [taskPoints] Points a sprint counts for the task.
 * @property {(group: 'personal' | 'workspace') => FlowNavEntry[]} [navigation] Sidebar entries.
 * @property {(error: { code: string }, input: any) => { message?: string } | undefined} [mutationError]
 *   Claim a failed write; return a message to show, or `{}` when the extension already responded.
 * @property {(key: string, entity?: any) => unknown} [settingsSection] Section on a core settings
 *   page: `organization-settings`, or `member-edit` with the member being edited.
 * @property {() => boolean} [ownsFeedback] True while the extension shows the toast in its own dialog.
 */
/**
 * @typedef {object} FlowExtensionRoute
 * @property {string} title
 * @property {string} [group]
 * @property {string} pattern
 * @property {'personal' | 'workspace' | 'project'} [scope]
 * @property {'standard' | 'wide' | 'full'} [width]
 * @property {{ group: 'workspace' | 'company', after: string, icon: string, label?: string }} [tab]
 * @property {boolean} [footer] False hides the task count in the shell footer.
 * @property {boolean} [taskSearch] Include the core task search controls.
 * @property {boolean} [admin] Excludes guests from configuration routes.
 */
/**
 * @typedef {object} FlowExtension
 * @property {string} name
 * @property {Record<string, FlowExtensionRoute>} [routes] Pages.
 * @property {Record<string, { title: string, group?: string, back: string, size?: string }>} [forms] Modal routes.
 * @property {Record<string, string>} [errors] API error code → message key.
 * @property {(data: any) => { id: string, title: string, description: string, icon: string, route: string }[]} [commands]
 * @property {(ctx: any) => FlowExtensionInstance} create
 */

/** @type {FlowExtension[]} */
const registered = []
/** @type {Record<string, FlowExtensionRoute>} */
export const extensionRoutes = {}
/** @type {Record<string, { title: string, back: string, size?: string }>} */
export const extensionForms = {}
/** @type {Record<string, string>} */
export const extensionErrors = {}

/** @param {FlowExtension} extension */
export function registerFlowExtension(extension) {
  if (!extension.name || typeof extension.create !== 'function')
    throw new Error('Flow extension requires a name and factory')
  if (registered.some((x) => x.name === extension.name))
    throw new Error(`Flow extension ${extension.name} is already registered`)
  const keys = [...Object.keys(extension.routes ?? {}), ...Object.keys(extension.forms ?? {})]
  if (new Set(keys).size !== keys.length) throw new Error('Flow route is duplicated within the extension')
  for (const route of Object.values(extension.routes ?? {}))
    if (route.tab && !managementTabs[route.tab.group]) throw new Error('Unknown Flow tab group')
  for (const code of Object.keys(extension.errors ?? {}))
    if (Object.hasOwn(extensionErrors, code)) throw new Error(`Flow error ${code} is already defined`)
  const taken = keys.find((key) => routes[key])
  if (taken) throw new Error(`Flow route ${taken} is already defined`)
  registered.push(extension)
  for (const [key, route] of Object.entries(extension.routes ?? {})) {
    routes[key] = route
    extensionRoutes[key] = route
    if (route.scope === 'personal') personalRoutes.add(key)
    else if (route.scope === 'workspace') workspaceRoutes.add(key)
    if (route.tab) {
      const tabs = managementTabs[route.tab.group]
      const at = tabs.findIndex((tab) => tab.value === route.tab.after)
      const tab = {
        value: key,
        get label() {
          return route.tab.label ?? route.title
        },
        icon: route.tab.icon,
      }
      tabs.splice(at < 0 ? tabs.length : at + 1, 0, tab)
    }
  }
  for (const [key, form] of Object.entries(extension.forms ?? {})) {
    extensionForms[key] = form
    routes[key] = {
      get title() {
        return form.title
      },
      get group() {
        return form.group ?? ''
      },
      pattern: 'record',
    }
  }
  Object.assign(extensionErrors, extension.errors)
}

export const flowExtensions = () => [...registered]
export const extensionCommands = (data) => registered.flatMap((x) => x.commands?.(data) ?? [])
