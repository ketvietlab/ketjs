// Booting an app: the sequence every deployment repeats, written once.
//
// Before this, running a KetSuite-shaped app meant ~150 lines of hand-written boot
// in the app itself — open a database, migrate, register functions, install a
// bootstrap set, decide who the request is, build the theme, mount the framework's
// own routes, print something useful, shut down cleanly. Every one of those lines
// is app-agnostic, and every second app would have copied them, drift included.
//
// What stays with the app is what only the app knows: which modules it ships, which
// function turns a path into a page, which extra routes it serves, and how to open
// a datastore that is not SQLite. Those arrive through `AppSpec.serve` as data
// rather than as a closure the framework has to trust.

import { createAppRegistry } from '../kernel/apps.ts'
import { translator } from '../kernel/i18n.ts'
import { KetError } from '../kernel/errors.ts'
import { createTheme } from '../theme/render.ts'
import { agentDescriptor } from '../agent/capabilities.ts'
import { migrateOne } from '../data/fleet.ts'
import { callFn } from './fn.ts'
import { createKetServer } from './http.ts'
import { createSessions, dbSessionStore } from './session.ts'
import { createTenants, singleTenant } from './tenants.ts'
import { createJoints } from '../theme/joints.ts'
import { buildMenu } from '../kernel/menu.ts'
import type { MenuNode } from '../kernel/menu.ts'
import type { IslandRegistry, Markup } from '@ketvietlab/ketjs-view'
import type { Tenants, TenantSpec } from './tenants.ts'
import { createAdapterPool } from '../data/pool.ts'
import type { AppInfo } from '../kernel/apps.ts'
import type { SessionContext, Sessions, SessionOptions, SessionRecord } from './session.ts'
import { document, json, text, withHeaders } from './respond.ts'
import { join, isAbsolute } from 'node:path'
import { html, each } from '@ketvietlab/ketjs-view'
import { sqliteStore } from './config.ts'
import { bootRuntime } from './runtime.ts'
import type { RuntimeConfig, OpenStore } from './config.ts'
import { namespacedStorage, storageFromConfig } from './storage/index.ts'
import type { OpenStorage, Storage } from './storage/index.ts'
import type { OpenTransport } from './transport/index.ts'
import type { AppSpec } from '../kernel/workspace.ts'
import type { AppRegistry } from '../kernel/apps.ts'
import type { Translator } from '../kernel/i18n.ts'
import type { Adapter, Manifest, Scope } from '../types.ts'
import type { IncomingMessage } from 'node:http'
import type { RouteParams } from '../kernel/routes.ts'

export type { Html, RouteResult } from './respond.ts'
export {
  page,
  fragment,
  navigablePage,
  isNavigationRequest,
  text,
  bytes,
  streamed,
  raw,
  withHeaders,
} from './respond.ts'
export { json } from './respond.ts'
import type { Html, RouteResult } from './respond.ts'
export type Route = (
  url: URL,
  req: IncomingMessage,
  params: RouteParams,
) => Promise<RouteResult> | RouteResult

/**
 * What a route needs that only the running server has. Handed to `serve.routes` so
 * an app's screens can read live state without reaching for module-level globals.
 */
export type ServeContext = {
  /** Everything this deployment ships, installed or not. */
  manifest: Manifest
  /**
   * Restricted to what is switched on for THIS request's tenant.
   *
   * It takes the request because the answer depends on it. Computing it once at
   * boot is what would show one tenant the module set of another — and that does
   * not fail, it answers wrongly, which is worse.
   */
  live: (req: IncomingMessage) => Promise<Manifest>
  /** The app list for this request's tenant. The registry itself stays leased. */
  appsOf: (req: IncomingMessage) => Promise<AppInfo[]>
  config: RuntimeConfig
  scopeOf: (url: URL, req: IncomingMessage) => Promise<Scope>
  localeOf: (url: URL, req: IncomingMessage) => string
  translate: (locale: string) => Translator
  /** A function call carrying this request's tenant, live manifest and scope. */
  call: (name: string, input: Record<string, unknown>, url: URL, req: IncomingMessage) => Promise<unknown>
  /**
   * The same call with the permission check off.
   *
   * Named so it is one word to grep for, like `raw`. It exists because deciding
   * *what* a caller may do is itself a question someone has to be allowed to ask:
   * a permission resolver that went through the check would be asking permission
   * to find out whether it has permission. Nothing else has that excuse.
   */
  callUnchecked: (
    name: string,
    input: Record<string, unknown>,
    url: URL,
    req: IncomingMessage,
  ) => Promise<unknown>
  /** The document every screen sits in. Markup, not a string — see respond.ts. */
  document: (o: { lang: string; title?: string; head?: Html; body: Html }) => Html
  /** Installed modules' stylesheets for this tenant, in dependency order. */
  styles: (req: IncomingMessage) => Promise<Html>
  /**
   * Render an extension point: every installed module's fills, in dependency
   * order, as markup a template inserts verbatim.
   *
   * Empty when nobody fills it, and empty when an installed module omitted it.
   */
  joint: (url: URL, req: IncomingMessage, key: string, props?: Record<string, unknown>) => Promise<Markup>
  /** False when an installed module omitted this joint — see jointShows in screens. */
  jointShows: (url: URL, req: IncomingMessage, key: string) => Promise<boolean>
  /**
   * The navigation tree as this viewer sees it: what the deployment ships, what
   * this database has switched on, and what this request may call — in that order,
   * because each filter depends on the one before.
   */
  menu: (url: URL, req: IncomingMessage) => Promise<MenuNode[]>
  /** Printable reports for a model whose read-only source this viewer may call. */
  reportsOf: (
    url: URL,
    req: IncomingMessage,
    target: string,
  ) => Promise<import('../types.ts').ComposedReport[]>
  /**
   * This request's sessions. A function because with subdomain tenants they live
   * in that tenant's database — one per tenant, not one per deployment.
   */
  sessionsOf: (url: URL, req: IncomingMessage) => Promise<Sessions | null>
  /** Blob storage isolated to this request's tenant. */
  storageOf: (url: URL, req: IncomingMessage) => Promise<Storage>
}

/**
 * How a path becomes a page. The resolver is named rather than passed, so the
 * framework never learns which module provides pages — swap the module and this
 * one string changes.
 *
 * The named function takes `{ path }` and returns null, or a row with `title` and
 * `layout` (the sections, as an array or as the JSON the database gave back).
 */
export type PagesSpec = {
  resolve: string
  /** Optional function taking `{ host }` and returning site id, title, locale and theme. */
  siteResolve?: string
  /** Theme region whose host carries the same data-ket-slot name. */
  region?: string
  /** Message key for the title of a path that has no page. */
  notFound?: string
  siteTitle?: string
}

export type SessionResolveContext = {
  adapter: Adapter
  manifest: Manifest
  record: SessionRecord
  url: URL
  req: IncomingMessage
}

export type ServeSpec = {
  pages?: PagesSpec
  assets?: { prefix: string; dir: string }
  /** Installed on an empty database so a first run has something to look at. */
  bootstrap?: string[]
  routes?: (ctx: ServeContext) => Record<string, Route>
  /** Anything other than SQLite; the framework cannot depend on a driver. */
  openStore?: OpenStore
  /** Override the built-in local/S3 storage selected by RuntimeConfig. */
  openStorage?: OpenStorage
  /** Inject a deployment-owned outbound provider for durable worker jobs. */
  openTransport?: OpenTransport
  /**
   * Turn on sessions. Present means the X-Ket-Company shim is gone and identity
   * comes from a signed cookie; absent means the shim stays and the banner says so.
   */
  sessions?: Omit<SessionOptions, 'store'> & { store?: SessionOptions['store'] }
  /** Revalidate live account state and memberships before scope and permissions. */
  resolveSession?: (ctx: SessionResolveContext) => Promise<SessionContext | null>
  /**
   * Serve several tenants, one database each — Odoo's model, and the one that
   * makes per-tenant module sets work. Absent, the app has a single datastore.
   */
  tenants?: TenantSpec
  /**
   * Which functions a signed-in user may call. Absent means no restriction, which
   * is what an app without roles is. Returning a list restricts every call the
   * request makes, including the ones a route makes on its behalf.
   */
  permissions?: (ctx: ServeContext, userId: string) => Promise<readonly string[] | null>
  defaults?: Partial<RuntimeConfig>
}

export type BootedApp = {
  name: string
  manifest: Manifest
  /** The datastore, when there is exactly one. Null when the app serves tenants. */
  adapter: Adapter | null
  /** Likewise: with tenants, "which apps" is a question about a tenant. */
  apps: AppRegistry | null
  /** Per-tenant access, and the only form that works in both modes. */
  tenants: Tenants
  config: RuntimeConfig
  port: number
  banner: () => Promise<string>
  close: () => Promise<void>
}

export type BootAppOptions = {
  env?: Record<string, string | undefined>
  port?: number
  /** Boot progress. Long-running serve keeps its banner separate. */
  log?: (line: string) => void
}

/**
 * Opens, migrates, installs, serves. Returns before listening is announced so a
 * caller can print its own banner, or a test can boot on port 0 and never print.
 */
export async function bootApp(spec: AppSpec, o: BootAppOptions = {}): Promise<BootedApp> {
  const serve = spec.serve ?? {}
  const log = o.log ?? console.log
  const { config, modules, manifest } = await bootRuntime(spec, o)
  const baseStorage = await (serve.openStorage ?? storageFromConfig)(config)
  const storages = new Map<string, Storage>()
  const storageFor = (key: string): Storage => {
    const namespace = key || spec.name
    let storage = storages.get(namespace)
    if (!storage) {
      storage = namespacedStorage(baseStorage, namespace)
      storages.set(namespace, storage)
    }
    return storage
  }

  /**
   * An empty database is not a useful one to look at, so a first run installs
   * enough to see something. A database that has been used is left exactly as it
   * is — and with tenants, "first run" is per tenant rather than per deployment.
   */
  const bootstrap = config.bootstrapApps ?? serve.bootstrap ?? []
  const bootstrapInto = async (key: string, apps: AppRegistry): Promise<void> => {
    if (!bootstrap.length || (await apps.enabled()).size !== 0) return
    for (const name of bootstrap) await apps.install(name)
    log(`  first run${key ? ` [${key}]` : ''}, installed: ${[...(await apps.enabled())].sort().join(', ')}`)
  }

  // Opened here only when there is one. With tenants there is no single datastore,
  // and a nullable field says that more honestly than a default one would.
  const adapter: Adapter | null = serve.tenants ? null : await (serve.openStore ?? sqliteStore)(config)
  let apps: AppRegistry | null = null
  if (adapter) {
    if (config.migrateOnBoot) {
      const ops = await migrateOne(adapter, manifest)
      if (ops.length) log(`  migrate: ${ops.length} operation(s)`)
    }
    apps = await createAppRegistry(manifest, adapter, { autoInstall: config.autoInstall })
    await bootstrapInto('', apps)
  }

  /**
   * How a request finds its database. One datastore is the degenerate case of the
   * same interface rather than a second code path — two paths through the thing
   * that decides whose data a request sees is exactly how one of them rots.
   */
  /**
   * Where logins live.
   *
   * With tenants arriving by subdomain the Host names the tenant before any cookie
   * is read, so each tenant keeps its own sessions in its own database — which is
   * also the isolation you want: a session id from one tenant simply is not in
   * another's table.
   *
   * An app serving every tenant from one domain cannot do that, because reading
   * the session needs the database and knowing the database needs the session. It
   * passes `sessions.store` instead — one shared store, with the tenant recorded
   * on the session. Both work; the framework assumes neither.
   */
  const sharedStore = serve.sessions?.store ?? null
  const sessionOpts = serve.sessions
    ? {
        ...(config.secret ? { secret: config.secret } : {}),
        secure: config.host !== '127.0.0.1' && config.host !== 'localhost',
        ...serve.sessions,
      }
    : null
  const makeSessions = sessionOpts
    ? (a: Adapter) => createSessions({ ...sessionOpts, store: sharedStore ?? dbSessionStore(a) })
    : null

  // Single datastore: one Sessions, built now. Tenants: one per tenant, built on
  // first touch — unless a shared store was supplied, in which case it is one
  // again and every tenant hands back the same instance.
  const sessions: Sessions | null = makeSessions && adapter ? await makeSessions(adapter) : null

  // Built per tenant, because which templates exist depends on what is installed.
  const islandRegistry = (live: Manifest): IslandRegistry => {
    const disabled = new Set(live.disabledModules ?? [])
    const registry: IslandRegistry = {}
    for (const module of modules) {
      if (disabled.has(module.name)) continue
      for (const [name, definition] of Object.entries(module.islands)) registry[name] = definition.view
    }
    return registry
  }

  const availableThemes = [spec.theme, ...(spec.themes ?? [])].filter(
    (theme): theme is NonNullable<typeof theme> => theme !== undefined,
  )
  const fallbackTheme = spec.theme ?? availableThemes[0]
  const themeFactory =
    spec.headless || !fallbackTheme
      ? {}
      : {
          theme: (live: Manifest) =>
            createTheme(live, modules, {
              translate: translate(config.defaultLocale),
              theme: fallbackTheme.name,
            }),
        }

  // Fills are KTL, so they translate the way templates do.
  const jointFactory = (live: Manifest, locale: string) =>
    createJoints(live, { translate: translate(locale), islands: islandRegistry(live) })

  const tenants: Tenants = serve.tenants
    ? createTenants({
        spec: serve.tenants,
        pool: createAdapterPool({
          create: (key) => {
            const made = (serve.tenants as TenantSpec).open(key, config)
            // The pool wants an Adapter now; opening is the adapter's own job.
            return made as Adapter
          },
          ...(serve.tenants.max !== undefined ? { max: serve.tenants.max } : {}),
          ...(serve.tenants.idleMs !== undefined ? { idleMs: serve.tenants.idleMs } : {}),
        }),
        manifest,
        autoInstall: config.autoInstall,
        ...(config.migrateOnBoot
          ? {
              prepare: async (key, a) => {
                const ops = await migrateOne(a, manifest)
                if (ops.length) log(`  migrate [${key}]: ${ops.length} operation(s)`)
              },
            }
          : {}),
        onFirstTouch: (key, made) => bootstrapInto(key, made),
        ...(makeSessions ? { sessions: makeSessions } : {}),
        joints: jointFactory,
        ...themeFactory,
      })
    : singleTenant({
        adapter: adapter as Adapter,
        apps: apps as AppRegistry,
        manifest,
        joints: jointFactory,
        ...themeFactory,
        sessions,
      })

  /**
   * Sessions, when the app asks for them. Absent, the header shim stays and the
   * banner keeps saying so — an app that has not wired auth yet should look like
   * one rather than quietly appear to have it.
   */
  /** This request's tenant's sessions — the same instance for all, when shared. */
  const sessionsOf = (url: URL, req: IncomingMessage): Promise<Sessions | null> =>
    sessions ? Promise.resolve(sessions) : tenants.ofRequest(url, req, async (t) => t.sessions)

  // One cookie lookup per request even though scope, permissions and actor all
  // depend on it. With tenant databases this also avoids three separate leases.
  const sessionRecords = new WeakMap<IncomingMessage, Promise<SessionRecord | null>>()
  const sessionRecordOf = (url: URL, req: IncomingMessage): Promise<SessionRecord | null> => {
    if (!makeSessions) return Promise.resolve(null)
    let record = sessionRecords.get(req)
    if (!record) {
      record = sessionsOf(url, req).then(async (manager) => {
        const raw = (await manager?.of(req)) ?? null
        if (!raw || !manager || !serve.resolveSession) return raw
        const resolved = await tenants.ofRequest(url, req, (tenant) =>
          serve.resolveSession!({ adapter: tenant.adapter, manifest: tenant.live, record: raw, url, req }),
        )
        if (!resolved) {
          await manager.store.destroy(raw.id)
          return null
        }
        const current: SessionContext = {
          companies: raw.companies,
          company: raw.company,
          branch: raw.branch,
          branches: raw.branches,
          securityVersion: raw.securityVersion,
        }
        if (JSON.stringify(current) === JSON.stringify(resolved)) return raw
        return manager.update(raw, resolved)
      })
      sessionRecords.set(req, record)
    }
    return record
  }

  const actorOf = async (url: URL, req: IncomingMessage): Promise<string | null> =>
    (await sessionRecordOf(url, req))?.userId ?? null

  /**
   * The one place a request's identity is decided — one function since D27,
   * precisely so that replacing headers with a login would be one change.
   *
   * With sessions on the headers are gone entirely rather than kept as a fallback:
   * a system where a header can stand in for a login is a system with no login.
   *
   * Reading a session now costs a tenant lease, because with subdomains the
   * session lives in that tenant's database. That is the price of the isolation:
   * a session id issued by one tenant is not a row in another's table at all.
   */
  const scopeOf = async (url: URL, req: IncomingMessage): Promise<Scope> => {
    if (!makeSessions) {
      const list = (h: string) =>
        ((req.headers[h] as string | undefined) ?? '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      const company = (req.headers['x-ket-company'] as string | undefined) ?? config.defaultCompany
      const companies = list('x-ket-companies')
      return {
        company,
        companies: companies.length ? [...new Set([company, ...companies])] : null,
        branch: (req.headers['x-ket-current-branch'] as string | undefined) ?? null,
        branches: list('x-ket-branch') || null,
      }
    }
    const s = await sessionsOf(url, req)
    return s?.scopeOf(await sessionRecordOf(url, req)) ?? { company: null }
  }

  /**
   * A locale is only ever one the deployment ships a catalogue for.
   *
   * Anything else falls back rather than being passed on: `Accept-Language: *` —
   * which Node's own fetch sends by default — used to reach Intl and throw. It also
   * closes the wider hole: the value reaches the `lang` attribute of every page,
   * and one drawn from a fixed set carries nothing into markup.
   */
  const known = new Set([
    ...Object.keys(manifest.messages ?? {}),
    config.defaultLocale,
    config.fallbackLocale,
  ])

  const localeOf = (url: URL, req: IncomingMessage): string => {
    const asked = [
      url.searchParams.get('lang'),
      ...((req.headers['accept-language'] as string | undefined) ?? '')
        .split(',')
        .map((part) => part.split(';')[0]?.trim())
        .flatMap((tag) => (tag ? [tag, tag.split('-')[0] as string] : [])),
    ]
    return asked.find((l) => l && known.has(l)) ?? config.defaultLocale
  }

  const translate = (locale: string) => translator(manifest, locale, { fallback: config.fallbackLocale })

  /**
   * Every installed module's stylesheets, in dependency order, so a module that
   * extends another loads after it and can override it. The app used to name two
   * files belonging to another module by hand — which meant knowing that module's
   * file layout, and going on linking them after it was uninstalled.
   */
  const styles = async (req: IncomingMessage): Promise<Html> =>
    tenants.ofRequest(new URL('http://x/'), req, async (t) => {
      const on = await t.apps.enabled()
      const hrefs = manifest.styles.filter((s) => on.has(s.by)).map((s) => s.href)
      return html`${each(
        hrefs,
        (h) => h,
        (h) => html`<link rel="stylesheet" href=${h}>`,
      )}`
    })

  const ctx: ServeContext = {
    manifest,
    config,
    scopeOf,
    localeOf,
    translate,
    styles,
    sessionsOf,
    storageOf: async (url, req) => storageFor(tenants.keyOf(url, req)),
    document,
    joint: (url, req, key, props) =>
      tenants.ofRequest(url, req, async (t) => t.joints(localeOf(url, req)).render(key, props)),
    jointShows: (url, req, key) =>
      tenants.ofRequest(url, req, async (t) => t.joints(localeOf(url, req)).shows(key)),
    menu: async (url, req) => {
      const allow = await allowFor(url, req)
      const _ = translate(localeOf(url, req))
      // The sidebar's search is in the URL like every other list's, so a filtered
      // menu is a link and the back button walks out of it.
      const q = url.searchParams.get('menu')?.trim() || undefined
      return tenants.ofRequest(url, req, async (t) =>
        buildMenu(t.live, { allow, translate: (k) => _(k), active: url.pathname, q }),
      )
    },
    reportsOf: async (url, req, target) => {
      const allow = await allowFor(url, req)
      return tenants.ofRequest(url, req, async (t) =>
        Object.values(t.live.reports).filter(
          (report) =>
            t.live.routes['/reports/{report}/{id}'] !== undefined &&
            report.target === target &&
            (allow === null || allow.includes(report.source)),
        ),
      )
    },
    live: (req) => tenants.ofRequest(new URL('http://x/'), req, async (t) => t.live),
    appsOf: (req) => tenants.ofRequest(new URL('http://x/'), req, (t) => t.apps.list()),
    callUnchecked: async (name, input, url, req) => {
      const scope = await scopeOf(url, req)
      const actor = await actorOf(url, req)
      return tenants.ofRequest(
        url,
        req,
        async (t) =>
          (
            await callFn(name, input, {
              adapter: t.adapter,
              manifest: t.live,
              scope,
              actor,
              queueNotify: config.queueNotify,
            })
          ).value,
      )
    },
    call: async (name, input, url, req) => {
      // One lease for the whole call: the scope and the allow-list are resolved
      // outside it, so a session lookup never holds a pooled connection.
      const scope = await scopeOf(url, req)
      const allow = await allowFor(url, req)
      const actor = await actorOf(url, req)
      return tenants.ofRequest(
        url,
        req,
        async (t) =>
          (
            await callFn(name, input, {
              adapter: t.adapter,
              manifest: t.live,
              scope,
              allow,
              actor,
              queueNotify: config.queueNotify,
            })
          ).value,
      )
    },
  }

  /**
   * Module-contributed routes and assets.
   *
   * Both are looked up per request against the LIVE manifest rather than mounted
   * once at boot. That costs a set lookup and buys the property the app model
   * claims: switching a module off stops its routes answering and stops its
   * stylesheet being served, without a restart.
   */
  const routeHandlers = new Map<string, Route>()
  for (const [path, entry] of Object.entries(manifest.routes)) routeHandlers.set(path, entry.make(ctx))

  const moduleRoutes: Record<string, Route> = {}
  for (const [path, entry] of Object.entries(manifest.routes)) {
    moduleRoutes[path] = async (url, req, params) => {
      const on = await tenants.ofRequest(url, req, (t) => t.apps.enabled())
      if (!on.has(entry.by)) {
        return text(`${path} belongs to "${entry.by}", which is not installed on this database`, {
          status: 404,
        })
      }
      // Closed unless the module said otherwise. A browser is sent to the sign-in
      // page carrying where it was going; anything else gets the status, because a
      // redirect to an HTML form is a useless answer to a fetch().
      if (makeSessions && !entry.anonymous) {
        if (!(await sessionRecordOf(url, req))) {
          const wantsHtml = String(req.headers.accept ?? '').includes('text/html')
          return wantsHtml
            ? withHeaders(text('', { status: 303 }), {
                location: `/login?next=${encodeURIComponent(url.pathname + url.search)}`,
              })
            : text('sign in first', { status: 401 })
        }
      }
      return (routeHandlers.get(path) as Route)(url, req, params)
    }
  }

  /**
   * A module's assets, resolved per request so that switching the module off stops
   * them being served — without a restart, and without the app knowing where any
   * module keeps its files.
   */
  const assetMount = {
    prefix: '/_ket/asset/',
    resolve: async (rest: string, url: URL, req: IncomingMessage): Promise<string | null> => {
      const slash = rest.indexOf('/')
      if (slash <= 0) return null
      const owner = rest.slice(0, slash)
      const file = rest.slice(slash + 1)
      const dir = manifest.assets[owner]
      if (!dir || !file || file.startsWith('..') || isAbsolute(file)) return null
      if (!(await tenants.ofRequest(url, req, (t) => t.apps.enabled())).has(owner)) return null
      return join(dir, file)
    },
  }

  /**
   * Every function a request with no session may call — which is not "all of them".
   *
   * `allow: null` means unrestricted, and that is correct for an in-process call:
   * a migration, a test, a script. It was also what an anonymous HTTP request got,
   * and that was a hole wide enough to create a user account through. A stranger
   * is not an unrestricted caller; a stranger is a stranger.
   */
  const anonymousFns = Object.entries(manifest.functions)
    .filter(([, f]) => f.anonymous)
    .map(([k]) => k)

  const allowFor = async (url: URL, req: IncomingMessage): Promise<readonly string[] | null> => {
    if (!makeSessions) return null // no login exists yet; the shim is the identity
    const record = await sessionRecordOf(url, req)
    if (!record) return anonymousFns // a stranger, not an administrator
    if (!serve.permissions) return null
    const granted = await serve.permissions(ctx, record.userId)
    return granted === null ? null : [...new Set([...anonymousFns, ...granted])]
  }

  const pages = serve.pages
  if (pages && !manifest.functions[pages.resolve]) {
    throw new KetError({
      code: 'E_PAGE_RESOLVER_MISSING',
      module: spec.name,
      message: `app "${spec.name}" resolves pages with "${pages.resolve}", which no installed module declares`,
      hint: `add the module that owns "${pages.resolve.split('.')[0]}" to the app, or drop serve.pages`,
    })
  }
  if (pages?.siteResolve && !manifest.functions[pages.siteResolve]) {
    throw new KetError({
      code: 'E_SITE_RESOLVER_MISSING',
      module: spec.name,
      message: `app "${spec.name}" resolves sites with "${pages.siteResolve}", which no installed module declares`,
    })
  }
  for (const selected of availableThemes)
    if (pages?.region && !selected.templates[pages.region]) {
      throw new KetError({
        code: 'E_PAGE_REGION_MISSING',
        module: spec.name,
        message: `app "${spec.name}" navigates through region "${pages.region}", which theme "${selected.name}" does not render`,
        hint: `add a "${pages.region}" template, or remove serve.pages.region to keep full navigation`,
      })
    }

  type ResolvedSite = { id?: string; title?: string; locale?: string; theme?: string; tokens?: unknown }
  const siteRecords = new WeakMap<IncomingMessage, Promise<ResolvedSite | null>>()
  const requestHost = (url: URL, req: IncomingMessage): string => {
    const raw = String(req.headers.host ?? url.host).trim()
    try {
      return new URL(`http://${raw}`).hostname.replace(/^\[|\]$/g, '')
    } catch {
      return ''
    }
  }
  const siteOf = (url: URL, req: IncomingMessage): Promise<ResolvedSite | null> => {
    if (!pages?.siteResolve) return Promise.resolve(null)
    let pending = siteRecords.get(req)
    if (!pending) {
      pending = ctx.call(
        pages.siteResolve,
        { host: requestHost(url, req) },
        url,
        req,
      ) as Promise<ResolvedSite | null>
      siteRecords.set(req, pending)
    }
    return pending
  }
  const dynamicThemes = new Map<string, ReturnType<typeof createTheme>>()

  const appRoutes = serve.routes?.(ctx) ?? {}
  for (const path of Object.keys(appRoutes)) {
    if (path.startsWith('/_ket/')) {
      throw new KetError({
        code: 'E_ROUTE_RESERVED',
        module: spec.name,
        message: `app "${spec.name}" claims "${path}", which is reserved`,
        hint: '/_ket/ belongs to the framework: health, the agent descriptor, streams and assets',
      })
    }
    const owner = manifest.routes[path]?.by
    if (owner) {
      throw new KetError({
        code: 'E_ROUTE_CLASH',
        module: spec.name,
        message: `module "${owner}" and app "${spec.name}" both serve "${path}"`,
        hint: 'two owners cannot share one path — rename one, or keep the route in its module',
      })
    }
  }

  const server = await createKetServer({
    manifest,
    adapter,
    /**
     * The HTTP layer gets a pool whose leases go through the tenant runtime, not
     * the raw one.
     *
     * Handing it the raw pool looked equivalent and was not: /_ket/fn would lease
     * a datastore that had never been migrated, because migration happens the
     * first time the tenant runtime touches it. The first API call to a new tenant
     * failed with "no such table" while a page request to the same tenant worked.
     * One door, so there is one place preparation can be forgotten.
     */
    ...(tenants.pool
      ? {
          pool: {
            ...tenants.pool,
            with: <T>(key: string, fn: (a: Adapter) => Promise<T>) => tenants.with(key, (t) => fn(t.adapter)),
          },
          resolveDatastore: (url: URL, req: IncomingMessage) => tenants.keyOf(url, req),
        }
      : {}),
    resolveLocale: localeOf,
    resolveScope: scopeOf,
    resolveAllow: allowFor,
    resolveActor: actorOf,
    queueNotify: config.queueNotify,
    islandClients: (url: URL, req: IncomingMessage) =>
      tenants.ofRequest(url, req, async (tenant) =>
        Object.fromEntries(
          Object.entries(tenant.live.islands)
            .filter(([, island]) => island.client !== undefined)
            .map(([name, island]) => [name, island.client as { src: string; export: string }]),
        ),
      ),
    assets: serve.assets ? [assetMount, serve.assets] : [assetMount],
    ...(spec.headless || !fallbackTheme
      ? {}
      : {
          theme: (url: URL, req: IncomingMessage) =>
            tenants.ofRequest(url, req, async (t) => {
              const site = await siteOf(url, req)
              // A multisite app must never serve its fallback site for an unknown
              // Host header. Apart from leaking tenant content, that turns Host
              // header poisoning into generated links and cached HTML.
              if (pages?.siteResolve && !site) return null
              const chosen = site?.theme ?? fallbackTheme.name
              const allowed = availableThemes.find((theme) => theme.name === chosen)
              if (!allowed || t.live.disabledModules?.includes(allowed.name)) return null
              const locale = site?.locale ?? localeOf(url, req)
              const key = `${t.key}::${t.live.order.join(',')}::${allowed.name}::${locale}`
              let runtime = dynamicThemes.get(key)
              if (!runtime) {
                runtime = createTheme(t.live, modules, {
                  translate: translate(locale),
                  theme: allowed.name,
                })
                dynamicThemes.set(key, runtime)
              }
              return runtime
            }),
        }),
    /**
     * The storefront: a path becomes a page, and a page becomes its sections.
     *
     * The lookup runs through callFn like anything else, so the company filter and
     * the app-installed check apply to a public page exactly as they do to an API
     * call — the front of the site is not a second door with different rules.
     */
    ...(pages
      ? {
          ...(pages.region ? { pageRegion: pages.region } : {}),
          pageScope: async (url: URL, req: IncomingMessage) => {
            const resolvedSite = await siteOf(url, req)
            const site = {
              id: resolvedSite?.id,
              title: resolvedSite?.title ?? pages.siteTitle ?? spec.name,
              theme: resolvedSite?.theme ?? fallbackTheme?.name,
            }
            // The theme's layout writes <html lang>, so the locale has to reach it.
            // It was hardcoded there, which made i18n untrue on the first tag of every
            // storefront page.
            const locale = resolvedSite?.locale ?? localeOf(url, req)
            const row = (await ctx.call(
              pages.resolve,
              { path: url.pathname, ...(resolvedSite?.id ? { siteId: resolvedSite.id } : {}) },
              url,
              req,
            )) as {
              id: string
              title: string
              layout: unknown
            } | null
            if (!row) {
              const _ = translate(locale)
              return {
                site,
                locale,
                page: { path: url.pathname, title: pages.notFound ? _(pages.notFound) : 'Not found' },
                sections: [],
              }
            }
            return {
              site,
              locale,
              page: { id: row.id, path: url.pathname, title: row.title },
              meta: {},
              sections: typeof row.layout === 'string' ? JSON.parse(row.layout) : row.layout,
            }
          },
        }
      : {}),
    routes: {
      ...moduleRoutes,
      ...appRoutes,
      // The framework's own two, mounted last so an app cannot shadow them by accident.
      // Both answer for the tenant that asked: "which apps are on" has no
      // deployment-wide answer once there is more than one database.
      '/_ket/health': async (url, req) =>
        tenants.ofRequest(url, req, async (t) =>
          json({
            ok: true,
            app: spec.name,
            database: t.adapter.name,
            ...(t.key ? { tenant: t.key } : {}),
            apps: [...(await t.apps.enabled())].sort(),
            orphans: await t.apps.orphans(),
            locales: Object.keys(manifest.messages ?? {}),
          }),
        ),
      '/_ket/agent': async (url, req) =>
        tenants.ofRequest(url, req, async (t) => json(agentDescriptor(t.live))),
    },
  })

  const port = await server.listen(config.port)

  const banner = async () => {
    // With tenants there is no deployment-wide list of installed apps, and the
    // banner says which mode it is in rather than inventing one.
    const enabled = apps ? [...(await apps.enabled())].sort() : []
    const at = `http://${config.host}:${port}`
    // A "site" row only means something if a path can become a page; an app that
    // declares its own "/" route would otherwise be listed twice, once wrongly.
    const paths = new Map<string, string>()
    if (pages) paths.set('/', 'site')
    // Module routes belong on the banner too, and only while installed — the list
    // is what the deployment actually serves, not what it could serve.
    for (const [p, r] of Object.entries(manifest.routes))
      if (enabled.includes(r.by)) paths.set(p, p.replace(/^\//, ''))
    for (const p of Object.keys(appRoutes)) paths.set(p, p.replace(/^\//, '') || 'site')
    const rows = [
      ...[...paths].map(([p, label]) => [label, at + p]),
      ['health', `${at}/_ket/health`],
      ['agent descriptor', `${at}/_ket/agent`],
      ['', ''],
      [
        'database',
        adapter
          ? adapter.name + (config.databaseUrl ? '' : ` (${config.sqliteFile})`)
          : `${(await tenants.keys()).length} tenant(s), one database each`,
      ],
      ['apps installed', apps ? enabled.join(', ') || '(none)' : 'per tenant'],
      ['locales', Object.keys(manifest.messages ?? {}).join(', ') || '(none)'],
      [
        'identity',
        makeSessions
          ? `sessions (${sessions ? sessions.store.name : 'one per tenant'})`
          : 'X-Ket-Company header',
      ],
      // Silence here would be the wrong kind: a module that declared install:'auto'
      // and did not arrive should say why, not look broken.
      ...(config.autoInstall ? [] : [['auto-install', 'off (KET_AUTO_INSTALL=0)']]),
    ]
    const w = Math.max(...rows.map((r) => (r[0] as string).length))
    const note = makeSessions
      ? (sessions?.ephemeralSecret ?? !config.secret)
        ? `\n  KET_SECRET is not set, so a signing key was generated for this process.` +
          `\n  Sessions will not survive a restart and will not work across pods.`
        : ''
      : `\n  No authentication yet: the company comes from the X-Ket-Company header,` +
        `\n  defaulting to "${config.defaultCompany}". Fine for development, NOT for production.`
    return (
      `\n  ${spec.name} is running\n\n` +
      rows.map(([k, v]) => (k ? `    ${(k as string).padEnd(w)}  ${v as string}` : '')).join('\n') +
      `${note}\n`
    )
  }

  const close = async () => {
    await server.close()
    if (adapter) await adapter.close()
    await tenants.close()
  }
  return { name: spec.name, manifest, adapter, apps, tenants, config, port, banner, close }
}

/** bootApp, plus the banner and the signal handling a long-running process wants. */
export async function serveApp(spec: AppSpec, o: BootAppOptions = {}): Promise<BootedApp> {
  const booted = await bootApp(spec, o)
  console.log(await booted.banner())
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void booted.close().then(() => process.exit(0))
    })
  }
  return booted
}
