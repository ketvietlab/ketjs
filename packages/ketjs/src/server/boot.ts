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

import { compose } from '../kernel/compose.ts'
import { createAppRegistry, restrictManifest } from '../kernel/apps.ts'
import { translator } from '../kernel/i18n.ts'
import { KetError } from '../kernel/errors.ts'
import { createTheme } from '../theme/render.ts'
import { agentDescriptor } from '../agent/capabilities.ts'
import { migrateOne } from '../data/fleet.ts'
import { registerFunctions, callFn } from './fn.ts'
import { createKetServer } from './http.ts'
import { document, json, text } from './respond.ts'
import { readFile } from 'node:fs/promises'
import { join, normalize, extname, isAbsolute } from 'node:path'
import { html, each } from 'ketjs-view'
import { readConfig, sqliteStore } from './config.ts'
import type { RuntimeConfig, OpenStore } from './config.ts'
import type { AppSpec } from '../kernel/workspace.ts'
import type { AppRegistry } from '../kernel/apps.ts'
import type { Translator } from '../kernel/i18n.ts'
import type { Adapter, Manifest, Scope } from '../types.ts'
import type { IncomingMessage } from 'node:http'

const MIME: Record<string, string> = {
  '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon',
}

export type { Html, RouteResult } from './respond.ts'
export { page, fragment, text, raw } from './respond.ts'
export { json } from './respond.ts'
import type { Html, RouteResult } from './respond.ts'
export type Route = (url: URL, req: IncomingMessage) => Promise<RouteResult> | RouteResult

/**
 * What a route needs that only the running server has. Handed to `serve.routes` so
 * an app's screens can read live state without reaching for module-level globals.
 */
export type ServeContext = {
  /** Everything this deployment ships, installed or not. */
  manifest: Manifest
  /** Restricted to what is switched on in this database, right now. */
  live: () => Promise<Manifest>
  adapter: Adapter
  apps: AppRegistry
  config: RuntimeConfig
  scopeOf: (url: URL, req: IncomingMessage) => Scope
  localeOf: (url: URL, req: IncomingMessage) => string
  translate: (locale: string) => Translator
  /** A function call carrying this request's live manifest and scope. */
  call: (name: string, input: Record<string, unknown>, url: URL, req: IncomingMessage) => Promise<unknown>
  /** The document every screen sits in. Markup, not a string — see respond.ts. */
  document: (o: { lang: string; title?: string; head?: Html; body: Html }) => Html
  /** Every installed module's stylesheets, in dependency order, as link tags. */
  styles: () => Promise<Html>
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
  /** Message key for the title of a path that has no page. */
  notFound?: string
  siteTitle?: string
}

export type ServeSpec = {
  pages?: PagesSpec
  assets?: { prefix: string; dir: string }
  /** Installed on an empty database so a first run has something to look at. */
  bootstrap?: string[]
  routes?: (ctx: ServeContext) => Record<string, Route>
  /** Anything other than SQLite; the framework cannot depend on a driver. */
  openStore?: OpenStore
  defaults?: Partial<RuntimeConfig>
}

export type BootedApp = {
  name: string
  manifest: Manifest
  adapter: Adapter
  apps: AppRegistry
  config: RuntimeConfig
  port: number
  banner: () => Promise<string>
  close: () => Promise<void>
}


/**
 * Opens, migrates, installs, serves. Returns before listening is announced so a
 * caller can print its own banner, or a test can boot on port 0 and never print.
 */
export async function bootApp(spec: AppSpec, o: { env?: Record<string, string | undefined>; port?: number } = {}): Promise<BootedApp> {
  const serve = spec.serve ?? {}
  const config = readConfig(o.env ?? process.env, {
    sqliteFile: `.ket/${spec.name}.db`,
    ...serve.defaults,
    ...(o.port !== undefined ? { port: o.port } : {}),
  })
  if (o.port !== undefined) config.port = o.port

  const modules = spec.theme ? [...spec.modules, spec.theme] : [...spec.modules]
  const manifest = compose(modules, { appRequires: spec.requires ?? [], headless: spec.headless ?? false })

  const adapter = await (serve.openStore ?? sqliteStore)(config)
  if (config.migrateOnBoot) {
    const ops = await migrateOne(adapter, manifest)
    if (ops.length) console.log(`  migrate: ${ops.length} operation(s)`)
  }

  registerFunctions(modules)
  const apps = await createAppRegistry(manifest, adapter, { autoInstall: config.autoInstall })

  // An empty database is not a useful one to look at, so a first run installs
  // enough to see something. A database that has been used is left exactly as it is.
  const bootstrap = config.bootstrapApps ?? serve.bootstrap ?? []
  if (bootstrap.length && (await apps.enabled()).size === 0) {
    for (const name of bootstrap) await apps.install(name)
    console.log(`  first run, installed: ${[...(await apps.enabled())].sort().join(', ')}`)
  }

  /**
   * The one place a request's identity is decided. Until authentication exists this
   * reads headers; afterwards it reads a session, and nothing else changes.
   */
  const scopeOf = (_url: URL, req: IncomingMessage): Scope => ({
    company: (req.headers['x-ket-company'] as string | undefined) ?? config.defaultCompany,
    branches: ((req.headers['x-ket-branch'] as string | undefined) ?? '').split(',').filter(Boolean) || null,
  })
  /**
   * A locale is only ever one the deployment ships a catalogue for.
   *
   * Anything else falls back rather than being passed on: `Accept-Language: *` —
   * which Node's own fetch sends by default — used to reach Intl and throw, so any
   * client that did not set the header got a 500. Restricting to a known set fixes
   * that and closes the wider hole at the same time: the value reaches the `lang`
   * attribute of every page, and a value drawn from a fixed set cannot carry
   * anything into markup.
   */
  const known = new Set([...Object.keys(manifest.messages ?? {}), config.defaultLocale, config.fallbackLocale])
  const localeOf = (url: URL, req: IncomingMessage): string => {
    const asked = [
      url.searchParams.get('lang'),
      ...(req.headers['accept-language'] as string | undefined ?? '')
        .split(',').map(part => part.split(';')[0]?.trim()).flatMap(tag => tag ? [tag, tag.split('-')[0] as string] : []),
    ]
    return asked.find(l => l && known.has(l)) ?? config.defaultLocale
  }

  const live = async () => restrictManifest(manifest, await apps.enabled())
  const translate = (locale: string) => translator(manifest, locale, { fallback: config.fallbackLocale })

  /**
   * Every installed module's stylesheets, in dependency order, so a module that
   * extends another loads after it and can override it. The app used to name two
   * files belonging to another module by hand — which meant knowing that module's
   * file layout, and going on linking them after it was uninstalled.
   */
  const styles = async (): Promise<Html> => {
    const live = (await apps.enabled())
    const hrefs = manifest.styles.filter(s => live.has(s.by)).map(s => s.href)
    return html`${each(hrefs, h => h, h => html`<link rel="stylesheet" href=${h}>`)}`
  }

  const ctx: ServeContext = {
    manifest, live, adapter, apps, config, scopeOf, localeOf, translate, styles,
    call: async (name, input, url, req) =>
      (await callFn(name, input, { adapter, manifest: await live(), scope: scopeOf(url, req) })).value,
    document,
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
    moduleRoutes[path] = async (url, req) => {
      if (!(await apps.enabled()).has(entry.by)) {
        return text(`${path} belongs to "${entry.by}", which is not installed on this database`, { status: 404 })
      }
      return (routeHandlers.get(path) as Route)(url, req)
    }
  }

  /**
   * A module's assets, resolved per request so that switching the module off stops
   * them being served — without a restart, and without the app knowing where any
   * module keeps its files.
   */
  const assetMount = {
    prefix: '/_ket/asset/',
    resolve: async (rest: string): Promise<string | null> => {
      const slash = rest.indexOf('/')
      if (slash <= 0) return null
      const owner = rest.slice(0, slash)
      const file = rest.slice(slash + 1)
      const dir = manifest.assets[owner]
      if (!dir || !file || file.startsWith('..') || isAbsolute(file)) return null
      if (!(await apps.enabled()).has(owner)) return null
      return join(dir, file)
    },
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

  const server = await createKetServer({
    manifest, adapter,
    resolveLocale: localeOf,
    resolveScope: scopeOf,
    assets: serve.assets ? [assetMount, serve.assets] : [assetMount],
    ...(spec.headless || !spec.theme ? {} : {
      theme: createTheme(await live(), modules, { translate: translate(config.defaultLocale) }),
    }),
    /**
     * The storefront: a path becomes a page, and a page becomes its sections.
     *
     * The lookup runs through callFn like anything else, so the company filter and
     * the app-installed check apply to a public page exactly as they do to an API
     * call — the front of the site is not a second door with different rules.
     */
    ...(pages ? {
      pageScope: async (url: URL, req: IncomingMessage) => {
        const site = { title: pages.siteTitle ?? spec.name }
        // The theme's layout writes <html lang>, so the locale has to reach it.
        // It was hardcoded there, which made i18n untrue on the first tag of every
        // storefront page.
        const locale = localeOf(url, req)
        const row = await ctx.call(pages.resolve, { path: url.pathname }, url, req) as
          { id: string; title: string; layout: unknown } | null
        if (!row) {
          const _ = translate(locale)
          return { site, locale, page: { path: url.pathname, title: pages.notFound ? _(pages.notFound) : 'Not found' }, sections: [] }
        }
        return {
          site,
          locale,
          page: { id: row.id, path: url.pathname, title: row.title },
          meta: {},
          sections: typeof row.layout === 'string' ? JSON.parse(row.layout) : row.layout,
        }
      },
    } : {}),
    routes: {
      ...moduleRoutes,
      ...(serve.routes?.(ctx) ?? {}),
      // The framework's own two, mounted last so an app cannot shadow them by accident.
      '/_ket/health': async () => json({
        ok: true, app: spec.name, database: adapter.name,
        apps: [...(await apps.enabled())].sort(),
        orphans: await apps.orphans(),
        locales: Object.keys(manifest.messages ?? {}),
      }),
      '/_ket/agent': async () => json(agentDescriptor(await live())),
    },
  })

  const port = await server.listen(config.port)

  const banner = async () => {
    const enabled = [...(await apps.enabled())].sort()
    const at = `http://${config.host}:${port}`
    // A "site" row only means something if a path can become a page; an app that
    // declares its own "/" route would otherwise be listed twice, once wrongly.
    const paths = new Map<string, string>()
    if (pages) paths.set('/', 'site')
    // Module routes belong on the banner too, and only while installed — the list
    // is what the deployment actually serves, not what it could serve.
    for (const [p, r] of Object.entries(manifest.routes)) if (enabled.includes(r.by)) paths.set(p, p.replace(/^\//, ''))
    for (const p of Object.keys(serve.routes?.(ctx) ?? {})) paths.set(p, p.replace(/^\//, '') || 'site')
    const rows = [
      ...[...paths].map(([p, label]) => [label, at + p]),
      ['health', `${at}/_ket/health`],
      ['agent descriptor', `${at}/_ket/agent`],
      ['', ''],
      ['database', adapter.name + (config.databaseUrl ? '' : ` (${config.sqliteFile})`)],
      ['apps installed', enabled.join(', ') || '(none)'],
      ['locales', Object.keys(manifest.messages ?? {}).join(', ') || '(none)'],
      // Silence here would be the wrong kind: a module that declared install:'auto'
      // and did not arrive should say why, not look broken.
      ...(config.autoInstall ? [] : [['auto-install', 'off (KET_AUTO_INSTALL=0)']]),
    ]
    const w = Math.max(...rows.map(r => (r[0] as string).length))
    return `\n  ${spec.name} is running\n\n`
      + rows.map(([k, v]) => (k ? `    ${(k as string).padEnd(w)}  ${v as string}` : '')).join('\n')
      + `\n\n  No authentication yet: the company comes from the X-Ket-Company header,`
      + `\n  defaulting to "${config.defaultCompany}". Fine for development, NOT for production.\n`
  }

  const close = async () => { await server.close(); await adapter.close() }
  return { name: spec.name, manifest, adapter, apps, config, port, banner, close }
}

/** bootApp, plus the banner and the signal handling a long-running process wants. */
export async function serveApp(spec: AppSpec, o: { env?: Record<string, string | undefined>; port?: number } = {}): Promise<BootedApp> {
  const booted = await bootApp(spec, o)
  console.log(await booted.banner())
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => { void booted.close().then(() => process.exit(0)) })
  }
  return booted
}
