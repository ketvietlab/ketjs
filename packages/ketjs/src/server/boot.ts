// Booting a deployment: the sequence every deployment repeats, written once.
//
// Before this, running a KetSuite-shaped deployment meant ~150 lines of hand-written boot
// in the deployment itself — open a database, migrate, register functions,
// decide who the request is, build the theme, mount the framework's
// own routes, print something useful, shut down cleanly. Every one of those lines
// is deployment-agnostic, and every second deployment would have copied them, drift included.
//
// What stays with the deployment is what only it knows: which modules it ships, which
// function turns a path into a page, which extra routes it serves, and how to open
// a datastore that is not SQLite. Those arrive through `DeploymentSpec.serve` as data
// rather than as a closure the framework has to trust.

import { withoutVersion } from './assets.ts'
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
import type { DeploymentSpec } from '../kernel/workspace.ts'
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
 * deployment screens can read live state without reaching for module-level globals.
 */
export type ServeContext = {
  /** The immutable manifest selected by this deployment. */
  manifest: Manifest
  /** The authored deployment and its external-client compatibility policy. */
  deploymentName: string
  clientCompatibility: ClientCompatibilityPolicy | null
  /** Same manifest for every tenant; request-shaped for convenient route composition. */
  live: (req: IncomingMessage) => Promise<Manifest>
  config: RuntimeConfig
  scopeOf: (url: URL, req: IncomingMessage) => Promise<Scope>
  localeOf: (url: URL, req: IncomingMessage) => string
  translate: (locale: string) => Translator
  /** A function call carrying this request's tenant, live manifest and scope. */
  call: (
    name: string,
    input: Record<string, unknown>,
    url: URL,
    req: IncomingMessage,
    options?: {
      idempotencyKey?: string | null
      idempotencyNamespace?: string | null
      idempotencyDigest?: string | null
    },
  ) => Promise<unknown>
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
    options?: {
      idempotencyKey?: string | null
      idempotencyNamespace?: string | null
      idempotencyDigest?: string | null
    },
  ) => Promise<unknown>
  /** The document every screen sits in. Markup, not a string — see respond.ts. */
  document: (o: { lang: string; title?: string; head?: Html; body: Html }) => Html
  /** Composed modules' stylesheets for this tenant, in dependency order. */
  styles: (req: IncomingMessage) => Promise<Html>
  /**
   * Render an extension point: every composed module's fills, in dependency
   * order, as markup a template inserts verbatim.
   *
   * Empty when nobody fills it, and empty when a composed module omitted it.
   */
  joint: (url: URL, req: IncomingMessage, key: string, props?: Record<string, unknown>) => Promise<Markup>
  /** False when a composed module omitted this joint — see jointShows in screens. */
  jointShows: (url: URL, req: IncomingMessage, key: string) => Promise<boolean>
  /**
   * The navigation tree as this viewer sees it: what the deployment composes and
   * what this request may call.
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

/**
 * Identity established by infrastructure in front of the deployment.
 *
 * The resolver is the trust boundary: callers must verify the proxy credential
 * (for example a short-lived signed assertion) before returning an identity.
 * KetJS then applies the same actor, scope and permission pipeline used by a
 * cookie session without persisting a second login session in the tenant DB.
 */
export type RequestIdentity = {
  userId: string
  companies: string[]
  company: string | null
  branch?: string | null
  branches?: string[] | null
  securityVersion?: number
}

export type RequestIdentityResolveContext = {
  adapter: Adapter
  manifest: Manifest
  url: URL
  req: IncomingMessage
}

export type ServeSpec = {
  pages?: PagesSpec
  assets?: { prefix: string; dir: string }
  routes?: (ctx: ServeContext) => Record<string, Route>
  /** Anything other than SQLite; the framework cannot depend on a driver. */
  openStore?: OpenStore
  /** Override the built-in local/S3 storage selected by RuntimeConfig. */
  openStorage?: OpenStorage
  /** Inject a deployment-owned outbound provider for durable worker jobs. */
  openTransport?: OpenTransport
  /** Version and maintenance policy published by profile bootstrap routes. */
  clientCompatibility?: ClientCompatibilityPolicy
  /**
   * Turn on sessions. Present means the X-Ket-Company shim is gone and identity
   * comes from a signed cookie; absent means the shim stays and the banner says so.
   */
  sessions?: Omit<SessionOptions, 'store'> & { store?: SessionOptions['store'] }
  /** Revalidate live account state and memberships before scope and permissions. */
  resolveSession?: (ctx: SessionResolveContext) => Promise<SessionContext | null>
  /** Verify and resolve identity asserted by a trusted gateway for this request. */
  resolveIdentity?: (ctx: RequestIdentityResolveContext) => Promise<RequestIdentity | null>
  /** Classify non-staff credentials so the generic function transport can fail closed. */
  resolveAudience?: (url: URL, req: IncomingMessage) => string | null | Promise<string | null>
  /**
   * Serve several tenants, one database each. Every tenant runs this same deployment.
   */
  tenants?: TenantSpec
  /**
   * Which functions a signed-in user may call. Absent means no restriction, which
   * is what a deployment without roles is. Returning a list restricts every call the
   * request makes, including the ones a route makes on its behalf.
   *
   * The request is handed over because answering the question almost always means
   * asking the database, and which database that is comes from the request. A
   * resolver that had to invent one could only reach the tenant a bare URL happens
   * to resolve to — which is the wrong one for every tenant but the default.
   */
  permissions?: (
    ctx: ServeContext,
    userId: string,
    url: URL,
    req: IncomingMessage,
  ) => Promise<readonly string[] | null>
  defaults?: Partial<RuntimeConfig>
}

export type ClientCompatibilityPolicy = {
  minimumVersions: { ios: string; android: string }
  recommendedVersions?: { ios: string; android: string }
  maintenance?: { enabled: boolean; messages?: Record<string, string> }
}

export type BootedDeployment = {
  name: string
  manifest: Manifest
  /** The datastore, when there is exactly one. Null when the deployment serves tenants. */
  adapter: Adapter | null
  /** Per-tenant access, and the only form that works in both modes. */
  tenants: Tenants
  config: RuntimeConfig
  port: number
  banner: () => Promise<string>
  close: () => Promise<void>
}

export type BootDeploymentOptions = {
  env?: Record<string, string | undefined>
  port?: number
  /** Boot progress. Long-running serve keeps its banner separate. */
  log?: (line: string) => void
}

/**
 * Opens, migrates, and serves. Returns before listening is announced so a
 * caller can print its own banner, or a test can boot on port 0 and never print.
 */
export async function bootDeployment(
  spec: DeploymentSpec,
  o: BootDeploymentOptions = {},
): Promise<BootedDeployment> {
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

  // Opened here only when there is one. With tenants there is no single datastore,
  // and a nullable field says that more honestly than a default one would.
  const adapter: Adapter | null = serve.tenants ? null : await (serve.openStore ?? sqliteStore)(config)
  if (adapter) {
    if (config.migrateOnBoot) {
      const ops = await migrateOne(adapter, manifest)
      if (ops.length) log(`  migrate: ${ops.length} operation(s)`)
    }
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
   * A deployment serving every tenant from one domain cannot do that, because reading
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

  const islandRegistry = (): IslandRegistry => {
    const registry: IslandRegistry = {}
    for (const module of modules) {
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
    createJoints(live, { translate: translate(locale), islands: islandRegistry() })

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
        ...(config.migrateOnBoot
          ? {
              prepare: async (key, a) => {
                const ops = await migrateOne(a, manifest)
                if (ops.length) log(`  migrate [${key}]: ${ops.length} operation(s)`)
              },
            }
          : {}),
        ...(makeSessions ? { sessions: makeSessions } : {}),
        joints: jointFactory,
        ...themeFactory,
      })
    : singleTenant({
        adapter: adapter as Adapter,
        manifest,
        joints: jointFactory,
        ...themeFactory,
        sessions,
      })

  /**
   * Sessions, when the deployment asks for them. Absent, the header shim stays and the
   * banner keeps saying so — a deployment that has not wired auth yet should look like
   * one rather than quietly appear to have it.
   */
  /** This request's tenant's sessions — the same instance for all, when shared. */
  const sessionsOf = (url: URL, req: IncomingMessage): Promise<Sessions | null> =>
    sessions ? Promise.resolve(sessions) : tenants.ofRequest(url, req, async (t) => t.sessions)

  // One cookie lookup per request even though scope, permissions and actor all
  // depend on it. With tenant databases this also avoids three separate leases.
  const authenticationEnabled = Boolean(makeSessions || serve.resolveIdentity)
  const sessionRecords = new WeakMap<IncomingMessage, Promise<SessionRecord | null>>()
  const sessionRecordOf = (url: URL, req: IncomingMessage): Promise<SessionRecord | null> => {
    if (!authenticationEnabled) return Promise.resolve(null)
    let record = sessionRecords.get(req)
    if (!record) {
      record = tenants.ofRequest(url, req, async (tenant) => {
        const identity = await serve.resolveIdentity?.({
          adapter: tenant.adapter,
          manifest: tenant.live,
          url,
          req,
        })
        if (identity) {
          const companies = [...new Set(identity.companies)]
          if (
            !identity.userId ||
            !companies.length ||
            !identity.company ||
            !companies.includes(identity.company)
          )
            return null
          const now = Date.now()
          return {
            id: `request:${identity.userId}`,
            userId: identity.userId,
            companies,
            company: identity.company,
            branch: identity.branch ?? null,
            branches: identity.branches ?? null,
            securityVersion: identity.securityVersion ?? 0,
            revision: 0,
            createdAt: now,
            expiresAt: now,
          }
        }
        const manager = await sessionsOf(url, req)
        const raw = (await manager?.of(req)) ?? null
        if (!raw || !manager || !serve.resolveSession) return raw
        const resolved = await serve.resolveSession({
          adapter: tenant.adapter,
          manifest: tenant.live,
          record: raw,
          url,
          req,
        })
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
    if (!authenticationEnabled) {
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
    const record = await sessionRecordOf(url, req)
    if (!record) {
      const s = await sessionsOf(url, req)
      return s?.scopeOf(null) ?? { company: null }
    }
    return {
      companies: record.companies,
      company: record.company,
      branch: record.branch,
      branches: record.branches,
    }
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
   * Every composed module's stylesheets, in dependency order, so a module that
   * extends another loads after it and can override it. A deployment does not
   * name another module's files by hand, so it never needs to know that module's
   * internal file layout.
   */
  const styles = async (_req: IncomingMessage): Promise<Html> =>
    html`${each(
      manifest.styles.map((style) => style.href),
      (href) => href,
      (href) => html`<link rel="stylesheet" href=${href}>`,
    )}`

  const ctx: ServeContext = {
    manifest,
    deploymentName: spec.name,
    clientCompatibility: serve.clientCompatibility ?? null,
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
        buildMenu(t.live, { allow, translate: (k) => _(k), locale: _.locale, active: url.pathname, q }),
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
    callUnchecked: async (name, input, url, req, options) => {
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
              idempotencyKey: options?.idempotencyKey,
              idempotencyNamespace: options?.idempotencyNamespace,
              idempotencyDigest: options?.idempotencyDigest,
              queueNotify: config.queueNotify,
            })
          ).value,
      )
    },
    call: async (name, input, url, req, options) => {
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
              idempotencyKey: options?.idempotencyKey,
              idempotencyNamespace: options?.idempotencyNamespace,
              idempotencyDigest: options?.idempotencyDigest,
              queueNotify: config.queueNotify,
            })
          ).value,
      )
    },
  }

  /**
   * Module-contributed routes and assets.
   *
   * Both are mounted from the immutable deployment manifest.
   */
  const routeHandlers = new Map<string, Route>()
  for (const [path, entry] of Object.entries(manifest.routes)) routeHandlers.set(path, entry.make(ctx))

  const moduleRoutes: Record<string, Route> = {}
  for (const [path, entry] of Object.entries(manifest.routes)) {
    moduleRoutes[path] = async (url, req, params) => {
      // Closed unless the module said otherwise. A browser is sent to the sign-in
      // page carrying where it was going; anything else gets the status, because a
      // redirect to an HTML form is a useless answer to a fetch().
      if (authenticationEnabled && !entry.anonymous) {
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
   * A module's assets, resolved without exposing module file layout to the deployment.
   */
  const assetMount = {
    prefix: '/_ket/asset/',
    resolve: async (rest: string, _url: URL, _req: IncomingMessage): Promise<string | null> => {
      const slash = rest.indexOf('/')
      if (slash <= 0) return null
      const owner = rest.slice(0, slash)
      // A version segment names the bytes, not a directory — see assets.ts.
      const file = withoutVersion(rest.slice(slash + 1))
      const dir = manifest.assets[owner]
      if (!dir || !file || file.startsWith('..') || isAbsolute(file)) return null
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
    if (!authenticationEnabled) return null // no login exists yet; the shim is the identity
    const audience = await serve.resolveAudience?.(url, req)
    if (audience && audience !== 'anonymous' && audience !== 'staff') return []
    const record = await sessionRecordOf(url, req)
    if (!record) {
      return anonymousFns // a stranger, not an administrator
    }
    if (!serve.permissions) return null
    const granted = await serve.permissions(ctx, record.userId, url, req)
    return granted === null ? null : [...new Set([...anonymousFns, ...granted])]
  }

  const pages = serve.pages
  if (pages && !manifest.functions[pages.resolve]) {
    throw new KetError({
      code: 'E_PAGE_RESOLVER_MISSING',
      module: spec.name,
      message: `deployment "${spec.name}" resolves pages with "${pages.resolve}", which no composed module declares`,
      hint: `add the module that owns "${pages.resolve.split('.')[0]}" to the deployment, or drop serve.pages`,
    })
  }
  if (pages?.siteResolve && !manifest.functions[pages.siteResolve]) {
    throw new KetError({
      code: 'E_SITE_RESOLVER_MISSING',
      module: spec.name,
      message: `deployment "${spec.name}" resolves sites with "${pages.siteResolve}", which no composed module declares`,
    })
  }
  for (const selected of availableThemes)
    if (pages?.region && !selected.templates[pages.region]) {
      throw new KetError({
        code: 'E_PAGE_REGION_MISSING',
        module: spec.name,
        message: `deployment "${spec.name}" navigates through region "${pages.region}", which theme "${selected.name}" does not render`,
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
        message: `deployment "${spec.name}" claims "${path}", which is reserved`,
        hint: '/_ket/ belongs to the framework: health, the agent descriptor, streams and assets',
      })
    }
    const reservation = Object.entries(manifest.routePrefixes).find(([prefix]) => path.startsWith(prefix))
    if (reservation) {
      throw new KetError({
        code: 'E_ROUTE_RESERVED',
        module: spec.name,
        message: `deployment "${spec.name}" claims "${path}", inside the prefix reserved by "${reservation[1]}"`,
        hint: 'reserved API routes must be declared by modules through the published route factory',
      })
    }
    const owner = manifest.routes[path]?.by
    if (owner) {
      throw new KetError({
        code: 'E_ROUTE_CLASH',
        module: spec.name,
        message: `module "${owner}" and deployment "${spec.name}" both serve "${path}"`,
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
              if (!allowed) return null
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
     * the composed manifest applies to a public page exactly as it does to an API
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
      // The framework's own two, mounted last so a deployment cannot shadow them.
      '/_ket/health': async (url, req) =>
        tenants.ofRequest(url, req, async (t) =>
          json({
            ok: true,
            deployment: spec.name,
            database: t.adapter.name,
            ...(t.key ? { tenant: t.key } : {}),
            modules: manifest.order,
            locales: Object.keys(manifest.messages ?? {}),
          }),
        ),
      '/_ket/agent': async (url, req) =>
        tenants.ofRequest(url, req, async (t) => json(agentDescriptor(t.live))),
    },
  })

  const port = await server.listen(config.port)

  const banner = async () => {
    const at = `http://${config.host}:${port}`
    // A "site" row only means something if a path can become a page; a deployment that
    // declares its own "/" route would otherwise be listed twice, once wrongly.
    const paths = new Map<string, string>()
    if (pages) paths.set('/', 'site')
    for (const p of Object.keys(manifest.routes)) paths.set(p, p.replace(/^\//, ''))
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
      ['modules', manifest.order.join(', ') || '(none)'],
      ['locales', Object.keys(manifest.messages ?? {}).join(', ') || '(none)'],
      [
        'identity',
        makeSessions
          ? `sessions (${sessions ? sessions.store.name : 'one per tenant'})`
          : 'X-Ket-Company header',
      ],
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
  return { name: spec.name, manifest, adapter, tenants, config, port, banner, close }
}

/** bootDeployment, plus the banner and the signal handling a long-running process wants. */
export async function serveDeployment(
  spec: DeploymentSpec,
  o: BootDeploymentOptions = {},
): Promise<BootedDeployment> {
  const booted = await bootDeployment(spec, o)
  console.log(await booted.banner())
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void booted.close().then(() => process.exit(0))
    })
  }
  return booted
}
