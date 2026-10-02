import { uploadImage } from './image-upload.mjs'
import { attachLiveDescriptions } from './live-description.mjs'
// The Website Studio island: one client-rendered application opened in its own browser tab.
// The server renders only the deterministic loading view; everything after hydration — routing,
// reads, commands, modals — runs here. Product and Atlas run this exact module.
import { html, signal, batch, effect } from '@ketvietlab/ketjs-view'
import { attachDesignSystemInteractions } from '@ketvietlab/design-system'
import { routes, websiteExtensions, ownerOf, INSTANCE_HOOKS } from './extensions.mjs'
import { matchRoute, buildHref } from './routes.mjs'
import { tr } from './i18n.mjs'
import { createCoreScreens } from './screens/index.mjs'
import { studioFrame, loadingView, failureView } from './shell.mjs'
import { handleArchiveClick } from './archive-actions.mjs'
import { parseCommand } from './ui.mjs'

/**
 * @param {{ path?: string, query?: Record<string, string>, basePath?: string }} props
 * @param {{ call?: (name: string, input?: object, options?: object) => Promise<any> }} dependencies
 */
const THEME_KEY = 'ketsuite.theme'
/** A saved choice wins; without one, follow the system like the KetSuite shell does. */
export const initialTheme = () => {
  const saved = globalThis.localStorage?.getItem(THEME_KEY)
  if (saved === 'dark' || saved === 'light') return saved
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function createWebsiteStudio(props = {}, dependencies = {}) {
  const base = props.basePath ?? '/website/'
  const call =
    dependencies.call ??
    (() => Promise.reject(Object.assign(new Error('No Website transport'), { code: 'transport' })))
  const first = matchRoute(routes, props.path ?? '') ?? { key: 'overview', params: {} }
  const route = signal({ key: first.key, params: first.params, query: { ...(props.query ?? {}) } })
  const boot = signal(null)
  const data = signal(null)
  const failure = signal(null)
  const toasts = signal([])
  const busy = signal(false)
  const theme = signal(initialTheme())
  let reading = null
  let readKey = null
  let toastSeq = 0
  const cleanup = []

  const href = (key, params = {}, query = {}) =>
    buildHref(routes, base, key, params, { site: route().query.site ?? boot()?.site?.id, ...query })
  const can = (capability) => !capability || Boolean(boot()?.actor?.capabilities?.includes(capability))
  const notify = (title, tone = 'positive') => {
    const id = `toast-${++toastSeq}`
    toasts.set((list) => [...list.slice(-2), { id, title, tone }])
    const timer = setTimeout(() => toasts.set((list) => list.filter((t) => t.id !== id)), 5000)
    cleanup.push(() => clearTimeout(timer))
  }

  /** Shared with every screen and extension instance. Nothing here grants authority. */
  const ctx = {
    tr,
    call,
    uploadImage: dependencies.uploadImage ?? uploadImage,
    href,
    can,
    notify,
    navigate: (key, params, query, options) => go(href(key, params, query), options),
    route: () => route(),
    boot: () => boot(),
    theme: () => theme(),
    site: () => boot()?.site ?? null,
    busy: () => busy(),
    /** For a screen whose modal dialog hides the frame's toast region. */
    toasts: () => toasts(),
    refresh: () => readRoute(true),
    /** Re-read the bootstrap (site, actor, offer) and then the route, after a site-level change. */
    reload: () => bootstrap(boot()?.site?.id).then(() => readRoute(true)),
    /** Values contributed by extensions for a named slot, in registration order. Each instance also
     *  receives what its own `readFor` returned for the current route. */
    slot: (hook, value) =>
      instances.flatMap(({ name, instance }) => {
        const contributed = instance[hook]?.(value, data()?.extras?.[name])
        return contributed == null ? [] : [contributed]
      }),
  }

  const instances = websiteExtensions().map((extension) => {
    const instance = extension.create(ctx) ?? {}
    const unknown = Object.keys(instance).filter((hook) => !INSTANCE_HOOKS.includes(hook))
    if (unknown.length)
      throw new Error(`Website extension ${extension.name} has unknown hooks: ${unknown.join(', ')}`)
    return { name: extension.name, instance }
  })
  const screens = createCoreScreens(ctx)
  const commands = new Map()
  const addCommands = (owner, table = {}) => {
    for (const [name, run] of Object.entries(table)) {
      if (commands.has(name))
        throw new Error(`Website command ${name} is defined by ${commands.get(name).owner} and ${owner}`)
      commands.set(name, { owner, run })
    }
  }
  addCommands('core:studio', {
    'studio.retry': () =>
      boot() ? readRoute(true) : bootstrap(route().query.site).then(() => readRoute(true)),
    'studio.theme': () => {
      theme.set(theme() === 'dark' ? 'light' : 'dark')
      globalThis.localStorage?.setItem(THEME_KEY, theme())
    },
  })
  for (const [key, screen] of Object.entries(screens)) addCommands(`core:${key}`, screen.commands)
  for (const { name, instance } of instances) addCommands(name, instance.commands)

  /** Core screens and extension routes answer the same three questions. */
  const screenOf = (key) => {
    const owner = ownerOf(key)
    if (!owner) return screens[key]
    const { instance } = instances.find((x) => x.name === owner)
    return {
      read: instance.read ? (r, signal) => instance.read(key, r, signal) : null,
      view: (value) => instance.view?.(key, value) ?? null,
    }
  }

  const fromLocation = (url) => {
    const relative = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : ''
    const found = matchRoute(routes, relative)
    if (!found) return null
    return { ...found, query: Object.fromEntries(url.searchParams) }
  }

  async function bootstrap(site) {
    const value = await call('website_studio.bootstrap', { site: site ?? null })
    const previous = boot()?.site?.id
    batch(() => {
      boot.set(value)
      failure.set(null)
    })
    if (previous && previous !== value.site?.id) for (const { instance } of instances) instance.reset?.()
  }

  async function readRoute(force = false) {
    const current = route()
    const screen = screenOf(current.key)
    const back = routes[current.key]?.modal?.back
    const key = JSON.stringify([current.key, screen?.readKey?.(current) ?? current, boot()?.site?.id])
    if (!force && key === readKey && data()) return
    reading?.abort()
    const controller = new AbortController()
    reading = controller
    readKey = key
    try {
      const extras = ownerOf(current.key)
        ? Promise.resolve({})
        : Promise.all(
            instances.map(async ({ name, instance }) => {
              try {
                return [name, await instance.readFor?.(current.key, current, controller.signal)]
              } catch (error) {
                if (!controller.signal.aborted)
                  console.error(`Website extension ${name} failed to read`, error)
                return [name, undefined]
              }
            }),
          ).then(Object.fromEntries)
      const [value, backValue, extraValues] = await Promise.all([
        screen?.read ? screen.read(current, controller.signal) : null,
        back && screenOf(back)?.read ? screenOf(back).read(current, controller.signal) : null,
        extras,
      ])
      if (controller.signal.aborted) return
      applyPageMetadata(globalThis.document, screen?.metadata?.(value))
      batch(() => {
        data.set({ key: current.key, value, back: backValue, extras: extraValues })
        failure.set(null)
      })
    } catch (error) {
      if (controller.signal.aborted || error?.name === 'AbortError') return
      readKey = null
      batch(() => {
        data.set({ key: current.key, value: null, back: null, extras: {} })
        failure.set(error)
      })
    }
  }

  async function go(target, { replace = false } = {}) {
    const url = new URL(target, globalThis.location?.href ?? 'http://studio.invalid/')
    const next = fromLocation(url)
    if (!next) return
    if (globalThis.history)
      history[replace ? 'replaceState' : 'pushState'](null, '', url.pathname + url.search)
    await apply(next)
  }

  async function apply(next) {
    const siteChanged = Boolean(next.query.site) && next.query.site !== boot()?.site?.id
    route.set(next)
    try {
      if (siteChanged) await bootstrap(next.query.site)
      await readRoute()
    } catch (error) {
      failure.set(error)
    }
  }

  async function run(value, form) {
    const { name, args } = parseCommand(value)
    const command = commands.get(name)
    if (!command) throw new Error(`Unknown Website command ${name}`)
    toasts.set((list) => list.filter((t) => t.tone !== 'danger'))
    busy.set(true)
    try {
      await command.run(args, form)
    } catch (error) {
      for (const { instance } of instances) {
        const claimed = instance.mutationError?.(error, name)
        if (claimed !== undefined) {
          if (claimed.message) notify(claimed.message, 'danger')
          return
        }
      }
      notify(
        error?.code === 'conflict'
          ? tr('website.error.conflict')
          : (error?.message ?? tr('website.error.request')),
        'danger',
      )
    } finally {
      busy.set(false)
    }
  }

  const onClick = (event) => {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return
    if (handleArchiveClick(event, { run, busy })) return
    const button = event.target.closest?.('button[name="command"]')
    if (button && button.type !== 'submit') {
      event.preventDefault()
      if (!button.disabled && !busy()) run(button.value)
      return
    }
    const link = event.target.closest?.('a[href]')
    if (!link || link.target || link.hasAttribute('download')) return
    const url = new URL(link.href)
    if (url.origin !== location.origin || !url.pathname.startsWith(base)) return
    event.preventDefault()
    go(url.href)
  }
  /** `form[data-live=command]`: local draft edits on every keystroke. No request, no busy state. */
  const onInput = (event) => {
    const form = event.target.closest?.('form[data-live]')
    if (!form) return
    const command = commands.get(form.dataset.live)
    if (!command) throw new Error(`Unknown Website command ${form.dataset.live}`)
    command.run({}, new FormData(form))
  }
  const onChange = (event) => {
    if (event.target.name !== '__order') return
    const form = event.target.closest?.('form[data-reorder]')
    if (form) commands.get(form.dataset.reorder)?.run({}, new FormData(form))
  }
  const onSubmit = (event) => {
    const submitter = event.submitter
    if (submitter?.name === 'command') {
      event.preventDefault()
      if (Number(event.target.dataset.uploading || 0) > 0) {
        notify(tr('website.taxonomy.waitUpload'), 'danger')
        return
      }
      if (!busy()) run(submitter.value, new FormData(event.target))
      return
    }
    // A GET form into the Studio (the location strip's search) is a route change, not a reload.
    // The action's own query (the site) is kept; a native GET submission would drop it.
    const form = event.target
    if (form.method !== 'get') return
    const url = new URL(form.action)
    if (url.origin !== location.origin || !url.pathname.startsWith(base)) return
    event.preventDefault()
    for (const [name, value] of new FormData(form))
      if (typeof value === 'string') url.searchParams.set(name, value)
    go(url.href)
  }

  const content = () => {
    const current = route()
    const loaded = data()
    const ready = loaded?.key === current.key
    const back = routes[current.key]?.modal?.back
    return {
      key: current.key,
      route: routes[current.key],
      body: !ready
        ? null
        : failure()
          ? failureView(failure())
          : screenOf(current.key)?.view(loaded.value, current),
      background: back && ready && !failure() ? screenOf(back)?.view(loaded.back, current) : null,
    }
  }

  const view = () =>
    html`<div data-website-studio on:click=${onClick} on:input=${onInput} on:change=${onChange} on:submit=${onSubmit}>
      ${
        !boot() ? (failure() ? failureView(failure()) : loadingView()) : studioFrame(ctx, content(), toasts())
      }
    </div>`

  return {
    view,
    mount({ root, lifetime }) {
      // Theme belongs to the design-system root the host renders around the island.
      const scope = root.closest('[data-kv-design-system]')
      const stopTheme = effect(() => {
        document.documentElement.dataset.theme = theme()
        if (scope) scope.dataset.theme = theme()
      })
      // GAP ds-runtime-rebind: the DS runtime binds the elements present when it attaches (menus,
      // navigation drawer, search dialog) and refocuses its attach-time element when detached. A
      // client-rendered app re-attaches after each route, site or data change and puts focus back.
      const syncDescriptions = attachLiveDescriptions(root, lifetime)
      let detach = null
      const reattach = () => {
        const focused = document.activeElement
        detach?.()
        detach = attachDesignSystemInteractions(root)
        if (focused instanceof HTMLElement && focused.isConnected && focused !== document.activeElement)
          focused.focus()
      }
      const stopRuntime = effect(() => {
        route()
        boot()
        data()
        queueMicrotask(() => {
          if (!lifetime.aborted) {
            reattach()
            void syncDescriptions()
          }
        })
      })
      lifetime.addEventListener(
        'abort',
        () => {
          stopTheme()
          stopRuntime()
          detach?.()
        },
        { once: true },
      )
      const onPop = () => {
        const next = fromLocation(new URL(location.href))
        if (next) apply(next)
      }
      addEventListener('popstate', onPop)
      lifetime.addEventListener('abort', () => removeEventListener('popstate', onPop), { once: true })
      bootstrap(route().query.site)
        .then(() => {
          // Canonical URL: the site the server chose becomes explicit, so reload and share keep it.
          const site = boot()?.site?.id
          if (site && route().query.site !== site) {
            const next = { ...route(), query: { ...route().query, site } }
            route.set(next)
            history.replaceState(null, '', href(next.key, next.params, next.query))
          }
          return readRoute()
        })
        .catch((error) => failure.set(error))
    },
    dispose() {
      reading?.abort()
      for (const stop of cleanup.splice(0)) stop()
      for (const { instance } of instances) instance.dispose?.()
    },
  }
}
import { applyPageMetadata } from './metadata.mjs'
