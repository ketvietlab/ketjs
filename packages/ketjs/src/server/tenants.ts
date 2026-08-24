// One deployment, many databases. A DeploymentSpec is immutable: every tenant
// receives the same composed manifest and schema. Tenant resolution chooses data,
// never a second module lifecycle.

import { KetError } from '../kernel/errors.ts'
import type { AdapterPool } from '../data/pool.ts'
import type { Adapter, Manifest } from '../types.ts'
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
  /** Open the datastore for one tenant. The deployment owns its driver choice. */
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
   * Per tenant when the tenant is known before the cookie is read — which it is
   * when tenants arrive by subdomain, because the Host says so. A deployment on one
   * domain for every tenant cannot do that (reading the session needs the
   * database, knowing the database needs the session), and supplies one shared
   * store instead. Both are expressible; neither is assumed.
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
  /** Built once per tenant, against that tenant's own datastore. */
  sessions?: (adapter: Adapter) => Promise<Sessions>
}): Tenants {
  const prepared = new Map<string, Promise<void>>()
  const prepare = (key: string, adapter: Adapter): Promise<void> => {
    let pending = prepared.get(key)
    if (!pending) {
      pending = o.prepare?.(key, adapter) ?? Promise.resolve()
      prepared.set(key, pending)
    }
    return pending
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
  const sessions = new Map<string, Promise<Sessions>>()
  const sessionsFor = (key: string, adapter: Adapter): Promise<Sessions> | null => {
    if (!o.sessions) return null
    let s = sessions.get(key)
    if (!s) {
      s = o.sessions(adapter)
      sessions.set(key, s)
    }
    return s
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
