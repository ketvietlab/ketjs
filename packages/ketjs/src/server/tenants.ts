// One deployment, many databases. A DeploymentSpec is immutable: every tenant
// receives the same composed manifest and schema. Tenant resolution chooses data,
// never a second module lifecycle.

import { KetError } from '../kernel/errors.ts'
import type { AdapterPool } from '../data/pool.ts'
import type { Adapter, Manifest, Scope } from '../types.ts'
import type { ThemeRuntime } from '../theme/render.ts'
import type { Sessions } from './session.ts'
import type { Joints } from '../theme/joints.ts'
import type { IncomingMessage } from 'node:http'
import type { RuntimeConfig } from './config.ts'

export type TenantSpec = {
  /**
   * Which tenant a request belongs to. Null means this deployment does not serve
   * it — answered as such rather than falling back to a default, because a default
   * tenant is how one customer's request quietly reads another's data.
   */
  resolve: (url: URL, req: IncomingMessage) => string | null
  /**
   * Create a fresh adapter for one tenant. The pool owns open/close; do not hand
   * back an adapter object that a prior pool entry already closed.
   */
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

/** What a request resolves to: its database and the deployment manifest. */
export type Tenant = {
  key: string
  adapter: Adapter
  live: Manifest
  /** Compiled against the deployment manifest and cached per tenant. */
  theme: ThemeRuntime | null
  /**
   * Extension points for one locale.
   *
   * KTL binds its `_` filter when it compiles, so a runtime is per language as
   * well as per tenant — one bound to the deployment default made every
   * fill answer in that language while the page around it answered in the
   * reader's, which is what a sidebar entry in the wrong language looks like.
   */
  joints: (locale: string) => Joints
  /**
   * Whose logins these are.
   *
   * Per tenant when the tenant is known before the cookie is read — for example
   * from a subdomain, a trusted gateway assertion, or an explicit path/header.
   * Deployments whose tenants share one domain may supply a shared identity store,
   * but each record remains tenant-bound; a session is never allowed to select a
   * different datastore by itself.
   */
  sessions: Sessions | null
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
  /**
   * Run once per datastore, before anything reads it — this is where the schema
   * arrives. A tenant database nobody migrated is a tenant with no tables, and
   * every query against it fails in a way that looks like a bug in the query.
   */
  prepare?: (key: string, adapter: Adapter) => Promise<void>
  /**
   * Compiles the theme for one tenant. Cached, because compiling
   * every template on every request would be the most expensive thing here.
   */
  theme?: (live: Manifest) => ThemeRuntime
  joints: (live: Manifest, locale: string) => Joints
  /** Built against the current adapter; the returned facade reacquires a lease per operation. */
  sessions?: (adapter: Adapter, key: string) => Promise<Sessions>
}): Tenants {
  // Adapter-owned work must not keep a closed pool entry alive. WeakMap has the
  // ephemeron semantics needed here even though the promise itself closes over
  // the adapter while preparation is running.
  const prepared = new WeakMap<Adapter, Promise<void>>()
  const prepare = (key: string, adapter: Adapter): Promise<void> => {
    const cached = prepared.get(adapter)
    if (cached) return cached

    // A key may be evicted and later reopened as a different adapter. Preparation
    // belongs to that concrete connection/datastore instance, not to the key for
    // the lifetime of the process (notably for SQLite :memory: databases).
    const promise = Promise.resolve().then(async () => {
      await o.prepare?.(key, adapter)
    })
    prepared.set(adapter, promise)
    void promise.catch(() => {
      // A failed migration/init is retryable. Do not let an older rejected promise
      // delete a newer attempt on the same adapter.
      if (prepared.get(adapter) === promise) prepared.delete(adapter)
    })
    return promise
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
   * Theme and joint runtimes are keyed by tenant (and locale for joints). Module
   * composition is immutable for the lifetime of this deployment process.
   */
  const themes = new Map<string, ThemeRuntime>()
  const jointsBy = new Map<string, Joints>()
  const sessionManagers = new WeakMap<Adapter, Promise<Sessions>>()
  const sessionFacades = new Map<string, Promise<Sessions>>()
  const managerFor = (key: string, adapter: Adapter): Promise<Sessions> => {
    const cached = sessionManagers.get(adapter)
    if (cached) return cached
    const value = (o.sessions as NonNullable<typeof o.sessions>)(adapter, key)
    sessionManagers.set(adapter, value)
    void value.catch(() => {
      if (sessionManagers.get(adapter) === value) sessionManagers.delete(adapter)
    })
    return value
  }
  const copyScope = (scope: Scope | null): Scope | null =>
    scope
      ? {
          company: scope.company,
          ...(scope.companies === undefined
            ? {}
            : { companies: scope.companies === null ? null : [...scope.companies] }),
          ...(scope.branch === undefined ? {} : { branch: scope.branch }),
          ...(scope.branches === undefined
            ? {}
            : { branches: scope.branches === null ? null : [...scope.branches] }),
        }
      : null
  const sessionsFor = (key: string, adapter: Adapter): Promise<Sessions> | null => {
    if (!o.sessions) return null
    const cached = sessionFacades.get(key)
    if (cached) return cached

    const withManager = <T>(body: (sessions: Sessions) => Promise<T>): Promise<T> =>
      o.pool.with(key, async (current) => {
        await prepare(key, current)
        return body(await managerFor(key, current))
      })
    let made!: Promise<Sessions>
    made = managerFor(key, adapter)
      .then((seed) => {
        // Snapshot only adapter-free values. In particular, do not close over the
        // first Sessions/SessionStore: it owns the adapter that eviction just closed.
        const storeName = seed.store.name
        const ephemeralSecret = seed.ephemeralSecret
        const tenant = seed.tenant
        const clearCookie = seed.clearCookie()
        const anonymous = copyScope(seed.scopeOf(null))
        return {
          ...(tenant === undefined ? {} : { tenant }),
          store: {
            name: storeName,
            init: () => withManager((sessions) => sessions.store.init()),
            create: (record) => withManager((sessions) => sessions.store.create(record)),
            read: (id) => withManager((sessions) => sessions.store.read(id)),
            touch: (id, expiresAt) => withManager((sessions) => sessions.store.touch(id, expiresAt)),
            updateContext: (id, expectedRevision, context) =>
              withManager((sessions) => sessions.store.updateContext(id, expectedRevision, context)),
            destroy: (id) => withManager((sessions) => sessions.store.destroy(id)),
            listUser: (userId) => withManager((sessions) => sessions.store.listUser(userId)),
            destroyUser: (userId) => withManager((sessions) => sessions.store.destroyUser(userId)),
            destroyUserExcept: (userId, keepId) =>
              withManager((sessions) => sessions.store.destroyUserExcept(userId, keepId)),
            sweep: (at) => withManager((sessions) => sessions.store.sweep(at)),
          },
          ephemeralSecret,
          start: (options) => withManager((sessions) => sessions.start(options)),
          of: (req) => withManager((sessions) => sessions.of(req)),
          end: (req) => withManager((sessions) => sessions.end(req)),
          endUser: (userId) => withManager((sessions) => sessions.endUser(userId)),
          endUserExcept: (userId, keepId) =>
            withManager((sessions) => sessions.endUserExcept(userId, keepId)),
          update: (record, context) => withManager((sessions) => sessions.update(record, context)),
          clearCookie: () => clearCookie,
          scopeOf: (record) => {
            if (!record || (tenant !== undefined && (record.tenant ?? null) !== tenant))
              return copyScope(anonymous)
            return {
              company: record.company,
              companies: [...record.companies],
              branch: record.branch,
              branches: record.branches ? [...record.branches] : null,
            }
          },
          sweep: () => withManager((sessions) => sessions.sweep()),
        }
      })
      .catch((error) => {
        if (sessionFacades.get(key) === made) sessionFacades.delete(key)
        throw error
      })
    sessionFacades.set(key, made)
    return made
  }
  const themeFor = (key: string): ThemeRuntime | null => {
    if (!o.theme) return null
    let t = themes.get(key)
    if (!t) {
      t = o.theme(o.manifest)
      themes.set(key, t)
    }
    return t
  }

  const withTenant = <T>(key: string, fn: (t: Tenant) => Promise<T>): Promise<T> =>
    o.pool.with(key, async (adapter) => {
      await prepare(key, adapter)
      const jointsFor = (locale: string): Joints => {
        const k = `${key}::${locale}`
        let made = jointsBy.get(k)
        if (!made) {
          made = o.joints(o.manifest, locale)
          jointsBy.set(k, made)
        }
        return made
      }
      return fn({
        key,
        adapter,
        live: o.manifest,
        theme: themeFor(key),
        joints: jointsFor,
        sessions: await (sessionsFor(key, adapter) ?? Promise.resolve(null)),
      })
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
export function singleTenant(o: {
  adapter: Adapter
  manifest: Manifest
  theme?: (live: Manifest) => ThemeRuntime
  joints: (live: Manifest, locale: string) => Joints
  sessions?: Sessions | null
}): Tenants {
  let theme: ThemeRuntime | null | undefined
  const jointsBy = new Map<string, Joints>()
  const run = async <T>(key: string, fn: (t: Tenant) => Promise<T>): Promise<T> => {
    theme ??= o.theme?.(o.manifest) ?? null
    const jointsFor = (locale: string): Joints => {
      const k = locale
      let made = jointsBy.get(k)
      if (!made) {
        made = o.joints(o.manifest, locale)
        jointsBy.set(k, made)
      }
      return made
    }
    return fn({
      key,
      adapter: o.adapter,
      live: o.manifest,
      theme,
      joints: jointsFor,
      sessions: o.sessions ?? null,
    })
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
