// One deployment, many databases.
//
// This is Odoo's model and it is the one that makes per-tenant module sets work at
// all: the code ships with the deployment, the decision about what is switched on
// lives in each database. `ket_app` per database is `ir_module_module` per
// database, and D7 makes it cheaper here — every schema exists everywhere, so
// enabling a module for a tenant is one UPDATE rather than a migration. Measured:
// 400 empty tables cost 17 MB, and adding a column across all of them 43 ms.
//
// What this file exists to prevent is subtler than a missing feature. Until now
// `bootApp` opened one adapter and built one AppRegistry at boot, so `live()` —
// the restricted manifest — was computed once. Serving two tenants through that
// would not crash; it would show tenant B the module set of tenant A. Wrong
// answers are worse than errors, so the registry is per datastore and the manifest
// is resolved per request.

import { createAppRegistry, restrictManifest } from '../kernel/apps.ts'
import { KetError } from '../kernel/errors.ts'
import type { AdapterPool } from '../data/pool.ts'
import type { AppRegistry } from '../kernel/apps.ts'
import type { Adapter, Manifest } from '../types.ts'
import type { ThemeRuntime } from '../theme/render.ts'
import type { IncomingMessage } from 'node:http'
import type { RuntimeConfig } from './config.ts'

export type TenantSpec = {
  /**
   * Which tenant a request belongs to. Null means this deployment does not serve
   * it — answered as such rather than falling back to a default, because a default
   * tenant is how one customer's request quietly reads another's data.
   */
  resolve: (url: URL, req: IncomingMessage) => string | null
  /** Open the datastore for one tenant. The app's, because drivers are the app's. */
  open: (key: string, config: RuntimeConfig) => Adapter | Promise<Adapter>
  /**
   * Every tenant this deployment serves. Needed to migrate the fleet, and to fail
   * at boot rather than at 3am if one of them cannot be opened.
   */
  list: () => Promise<string[]>
  /** How many datastores stay open at once. Postgres has a hard connection ceiling. */
  max?: number
  idleMs?: number
}

/** What a request resolves to: its database, and what is switched on in it. */
export type Tenant = {
  key: string
  adapter: Adapter
  apps: AppRegistry
  live: Manifest
  /** Compiled against what this tenant has installed, and cached with it. */
  theme: ThemeRuntime | null
}

export type Tenants = {
  keyOf: (url: URL, req: IncomingMessage) => string
  /** The pool, when there is one — the HTTP layer leases from it directly. */
  pool: AdapterPool | null
  /**
   * Lease a tenant's datastore for the duration of `fn`.
   *
   * Scoped rather than handed out, because the pool has a bounded size: an adapter
   * that escapes its lease is a connection nobody gives back.
   */
  with: <T>(key: string, fn: (t: Tenant) => Promise<T>) => Promise<T>
  ofRequest: <T>(url: URL, req: IncomingMessage, fn: (t: Tenant) => Promise<T>) => Promise<T>
  keys: () => Promise<string[]>
  close: () => Promise<void>
}

export function createTenants(o: {
  spec: TenantSpec
  pool: AdapterPool
  manifest: Manifest
  autoInstall: boolean
  /**
   * Run once per datastore, before anything reads it — this is where the schema
   * arrives. A tenant database nobody migrated is a tenant with no tables, and
   * every query against it fails in a way that looks like a bug in the query.
   */
  prepare?: (key: string, adapter: Adapter) => Promise<void>
  /** Run once, after the registry exists: the bootstrap set for a new tenant. */
  onFirstTouch?: (key: string, apps: AppRegistry, adapter: Adapter) => Promise<void>
  /**
   * Compiles the theme for one tenant's installed set. Cached, because compiling
   * every template on every request would be the most expensive thing here.
   */
  theme?: (live: Manifest) => ThemeRuntime
}): Tenants {
  // One registry per datastore, kept: building it runs DDL, and doing that per
  // request would put a CREATE TABLE IF NOT EXISTS in front of every page.
  const registries = new Map<string, Promise<AppRegistry>>()
  const registryFor = (key: string, adapter: Adapter): Promise<AppRegistry> => {
    let r = registries.get(key)
    if (!r) {
      r = (async () => {
        await o.prepare?.(key, adapter)
        const made = await createAppRegistry(o.manifest, adapter, { autoInstall: o.autoInstall })
        await o.onFirstTouch?.(key, made, adapter)
        return made
      })()
      // Cached before it resolves, so two concurrent first requests for one tenant
      // do not both run the DDL and both try to install the bootstrap set.
      registries.set(key, r)
    }
    return r
  }

  const keyOf = (url: URL, req: IncomingMessage): string => {
    const key = o.spec.resolve(url, req)
    if (!key) {
      throw new KetError({
        code: 'E_UNKNOWN_TENANT',
        message: `no tenant for ${req.headers.host ?? url.host}`,
        hint: 'tenants.resolve returned null — this deployment does not serve that host',
      })
    }
    return key
  }

  /**
   * Both caches are keyed by tenant AND by what is installed, so switching an app
   * on rebuilds rather than serving a stale answer until restart.
   *
   * The restricted manifest is worth caching for the same reason the theme is,
   * and it always was: 0.015 ms a call against KetSuite's manifest, which is
   * nothing until it is every request, and 0.0003 ms once kept. A deployment with
   * one database benefits most, because its installed set almost never changes.
   */
  const lives = new Map<string, Manifest>()
  const themes = new Map<string, ThemeRuntime>()
  const themeFor = (key: string, live: Manifest): ThemeRuntime | null => {
    if (!o.theme) return null
    const stamp = `${key}::${live.order.join(',')}`
    let t = themes.get(stamp)
    if (!t) { t = o.theme(live); themes.set(stamp, t) }
    return t
  }

  const withTenant = <T>(key: string, fn: (t: Tenant) => Promise<T>): Promise<T> =>
    o.pool.with(key, async (adapter) => {
      const apps = await registryFor(key, adapter)
      // Resolved per request. The whole reason this file exists: computing it once
      // would show one tenant the module set of another.
      const stamp = `${key}::${[...(await apps.enabled())].sort().join(',')}`
      let live = lives.get(stamp)
      if (!live) { live = restrictManifest(o.manifest, await apps.enabled()); lives.set(stamp, live) }
      return fn({ key, adapter, apps, live, theme: themeFor(key, live) })
    })

  return {
    keyOf,
    pool: o.pool,
    with: withTenant,
    ofRequest: (url, req, fn) => withTenant(keyOf(url, req), fn),
    keys: () => o.spec.list(),
    close: () => o.pool.close(),
  }
}

/**
 * One datastore, expressed as the same interface.
 *
 * Not a special case in the caller: two code paths through the thing that decides
 * whose data a request sees is exactly how one of them rots. Every existing test
 * exercises this implementation, and the pooled one differs only in where the
 * adapter comes from.
 */
export function singleTenant(o: { adapter: Adapter; apps: AppRegistry; manifest: Manifest; theme?: (live: Manifest) => ThemeRuntime }): Tenants {
  const lives = new Map<string, Manifest>()
  const themes = new Map<string, ThemeRuntime>()
  const run = async <T>(key: string, fn: (t: Tenant) => Promise<T>): Promise<T> => {
    const stamp = [...(await o.apps.enabled())].sort().join(',')
    let live = lives.get(stamp)
    if (!live) { live = restrictManifest(o.manifest, await o.apps.enabled()); lives.set(stamp, live) }
    let theme: ThemeRuntime | null = null
    if (o.theme) {
      theme = themes.get(stamp) ?? o.theme(live)
      themes.set(stamp, theme)
    }
    return fn({ key, adapter: o.adapter, apps: o.apps, live, theme })
  }
  return {
    keyOf: () => '',
    pool: null,
    with: run,
    ofRequest: (_url, _req, fn) => run('', fn),
    keys: async () => [''],
    close: async () => {},
  }
}
