import { uploadImage } from './image-upload.tsx'
import { attachLiveDescriptions } from './live-description.tsx'
// The Website Studio island: one client-rendered application opened in its own browser tab.
// The server renders only the deterministic loading view; everything after hydration — routing,
// reads, commands, modals — runs here. Product and Atlas run this exact module.
import { signal, batch, effect } from '@ketvietlab/ketjs-view'
import { attachDesignSystemInteractions } from '@ketvietlab/design-system'
import { routes, websiteExtensions, ownerOf, INSTANCE_HOOKS } from './extensions.ts'
import { matchRoute, buildHref } from './routes.ts'
import { tr } from './i18n.ts'
import { createCoreScreens } from './screens/index.ts'
import { studioFrame, loadingView, failureView } from './shell.tsx'
import { handleArchiveClick } from './archive-actions.tsx'
import { parseCommand } from './ui.tsx'
import type { WebsiteExtensionInstance } from './extensions.ts'
import type {
  Boot,
  Call,
  Command,
  ImageUpload,
  Screen,
  Site,
  StudioContext,
  Toast,
  WebsiteLocation,
} from './types.ts'

export type StudioProps = { path?: string; query?: Record<string, string>; basePath?: string }
export type StudioDependencies = { call?: Call; uploadImage?: ImageUpload }
/** What the current route read: its own value, the value behind a modal, and extension extras. */
type Loaded = { key: string; value: unknown; back: unknown; extras: Record<string, unknown> }

const THEME_KEY = 'ketsuite.theme'
/** A saved choice wins; without one, follow the system like the KetSuite shell does. */
export const initialTheme = (): 'dark' | 'light' => {
  const saved = globalThis.localStorage?.getItem(THEME_KEY)
  if (saved === 'dark' || saved === 'light') return saved
  return globalThis.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function createWebsiteStudio(props: StudioProps = {}, dependencies: StudioDependencies = {}) {
  const base = props.basePath ?? '/website/'
  const call: Call =
    dependencies.call ??
    (() => Promise.reject(Object.assign(new Error('No Website transport'), { code: 'transport' })))
  const first = matchRoute(routes, props.path ?? '') ?? { key: 'overview', params: {} }
  const route = signal<WebsiteLocation>({
    key: first.key,
    params: first.params,
    query: { ...(props.query ?? {}) },
  })
  const boot = signal<Boot | null>(null)
  const data = signal<Loaded | null>(null)
  const failure = signal<unknown>(null)
  const toasts = signal<Toast[]>([])
  const busy = signal(false)
  const theme = signal(initialTheme())
  let reading: AbortController | null = null
  let readKey: string | null = null
  let toastSeq = 0
  const cleanup: (() => void)[] = []

  const href: StudioContext['href'] = (key, params = {}, query = {}) =>
    buildHref(routes, base, key, params, { site: route().query.site ?? boot()?.site?.id, ...query })
  const can: StudioContext['can'] = (capability) =>
    !capability || Boolean(boot()?.actor?.capabilities?.includes(capability))
  const notify: StudioContext['notify'] = (title, tone = 'positive') => {
    const id = `toast-${++toastSeq}`
    toasts.set((list) => [...list.slice(-2), { id, title, tone }])
    const timer = setTimeout(() => toasts.set((list) => list.filter((t) => t.id !== id)), 5000)
    cleanup.push(() => clearTimeout(timer))
  }

  /** Shared with every screen and extension instance. Nothing here grants authority. */
  const ctx: StudioContext = {
    tr,
    call,
    uploadImage: dependencies.uploadImage ?? uploadImage,
    href,
    can,
    notify,
    navigate: (key, params, query, options) => go(href(key, params, query), options),
    route: () => route(),
    // Both are read only after the bootstrap answered; site-scoped screens need its site.
    boot: () => boot()!,
    theme: () => theme(),
    site: () => boot()?.site as Site,
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
    const instance: WebsiteExtensionInstance = extension.create(ctx) ?? {}
    const unknown = Object.keys(instance).filter((hook) => !INSTANCE_HOOKS.includes(hook))
    if (unknown.length)
      throw new Error(`Website extension ${extension.name} has unknown hooks: ${unknown.join(', ')}`)
    return { name: extension.name, instance }
  })
  const screens: Record<string, Screen> = createCoreScreens(ctx)
  const commands = new Map<string, { owner: string; run: Command }>()
  const addCommands = (owner: string, table: Record<string, Command> = {}) => {
    for (const [name, run] of Object.entries(table)) {
      if (commands.has(name))
        throw new Error(`Website command ${name} is defined by ${commands.get(name)!.owner} and ${owner}`)
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
  const screenOf = (key: string): Screen | undefined => {
    const owner = ownerOf(key)
    if (!owner) return screens[key]
    const { instance } = instances.find((x) => x.name === owner)!
    const read = instance.read
    return {
      read: read ? (r, signal) => read(key, r, signal) : null,
      view: (value) => instance.view?.(key, value) ?? null,
    }
  }

  const fromLocation = (url: URL): WebsiteLocation | null => {
    const relative = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : ''
    const found = matchRoute(routes, relative)
    if (!found) return null
    return { ...found, query: Object.fromEntries(url.searchParams) }
  }

  async function bootstrap(site: string | null | undefined) {
    const value = await call<Boot>('website_studio.bootstrap', { site: site ?? null })
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
            instances.map(async ({ name, instance }): Promise<[string, unknown]> => {
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
        back && screenOf(back)?.read ? screenOf(back)!.read!(current, controller.signal) : null,
        extras,
      ])
      if (controller.signal.aborted) return
      applyPageMetadata(globalThis.document, screen?.metadata?.(value))
      batch(() => {
        data.set({ key: current.key, value, back: backValue, extras: extraValues })
        failure.set(null)
      })
    } catch (error) {
      if (controller.signal.aborted || (error as Error | null)?.name === 'AbortError') return
      readKey = null
      batch(() => {
        data.set({ key: current.key, value: null, back: null, extras: {} })
        failure.set(error)
      })
    }
  }

  async function go(target: string, { replace = false } = {}) {
    const url = new URL(target, globalThis.location?.href ?? 'http://studio.invalid/')
    const next = fromLocation(url)
    if (!next) return
    if (globalThis.history)
      history[replace ? 'replaceState' : 'pushState'](null, '', url.pathname + url.search)
    await apply(next)
  }

  async function apply(next: WebsiteLocation) {
    const siteChanged = Boolean(next.query.site) && next.query.site !== boot()?.site?.id
    route.set(next)
    try {
      if (siteChanged) await bootstrap(next.query.site)
      await readRoute()
    } catch (error) {
      failure.set(error)
    }
  }

  async function run(value: string, form?: FormData) {
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
      const { code, message } = (error ?? {}) as { code?: string; message?: string }
      notify(
        code === 'conflict' ? tr('website.error.conflict') : (message ?? tr('website.error.request')),
        'danger',
      )
    } finally {
      busy.set(false)
    }
  }

  const onClick = (e: Event) => {
    const event = e as MouseEvent
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
    const target = event.target as Element
    const button = target.closest?.<HTMLButtonElement>('button[name="command"]')
    if (button && button.type !== 'submit') {
      event.preventDefault()
      if (!button.disabled && !busy()) run(button.value)
      return
    }
    const link = target.closest?.<HTMLAnchorElement>('a[href]')
    if (!link || link.target || link.hasAttribute('download')) return
    const url = new URL(link.href)
    if (url.origin !== location.origin || !url.pathname.startsWith(base)) return
    event.preventDefault()
    go(url.href)
  }
  /** `form[data-live=command]`: local draft edits on every keystroke. No request, no busy state. */
  const onInput = (event: Event) => {
    const form = (event.target as Element).closest?.<HTMLFormElement>('form[data-live]')
    if (!form) return
    const command = commands.get(form.dataset.live!)
    if (!command) throw new Error(`Unknown Website command ${form.dataset.live}`)
    command.run({}, new FormData(form))
  }
  const onChange = (event: Event) => {
    const target = event.target as HTMLInputElement
    if (target.name !== '__order') return
    const form = target.closest?.<HTMLFormElement>('form[data-reorder]')
    if (form) commands.get(form.dataset.reorder!)?.run({}, new FormData(form))
  }
  const onSubmit = (e: Event) => {
    const event = e as SubmitEvent
    const form = event.target as HTMLFormElement
    const submitter = event.submitter as HTMLButtonElement | null
    if (submitter?.name === 'command') {
      event.preventDefault()
      if (Number(form.dataset.uploading || 0) > 0) {
        notify(tr('website.taxonomy.waitUpload'), 'danger')
        return
      }
      if (!busy()) run(submitter.value, new FormData(form))
      return
    }
    // A GET form into the Studio (the location strip's search) is a route change, not a reload.
    // The action's own query (the site) is kept; a native GET submission would drop it.
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
          : screenOf(current.key)?.view(loaded!.value, current),
      background: back && ready && !failure() ? screenOf(back)?.view(loaded!.back, current) : null,
    }
  }

  const view = () => (
    // biome-ignore lint/a11y/noStaticElementInteractions: the Studio root delegates events from the native controls inside it.
    // biome-ignore lint/a11y/useKeyWithClickEvents: Delegates clicks from native buttons and links, which already handle the keyboard.
    <div data-website-studio onClick={onClick} onInput={onInput} onChange={onChange} onSubmit={onSubmit}>
      {!boot() ? (failure() ? failureView(failure()) : loadingView()) : studioFrame(ctx, content(), toasts())}
    </div>
  )

  return {
    view,
    mount({ root, lifetime }: { root: HTMLElement; lifetime: AbortSignal }) {
      // Theme belongs to the design-system root the host renders around the island.
      const scope = root.closest<HTMLElement>('[data-kv-design-system]')
      const stopTheme = effect(() => {
        document.documentElement.dataset.theme = theme()
        if (scope) scope.dataset.theme = theme()
      })
      // GAP ds-runtime-rebind: the DS runtime binds the elements present when it attaches (menus,
      // navigation drawer, search dialog) and refocuses its attach-time element when detached. A
      // client-rendered app re-attaches after each route, site or data change and puts focus back.
      const syncDescriptions = attachLiveDescriptions(root, lifetime)
      let detach: (() => void) | null = null
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
import { applyPageMetadata } from './metadata.ts'
