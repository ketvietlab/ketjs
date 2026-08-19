// Everything a running app needs to know, read once, in one place.
//
// Configuration is deliberately a value rather than scattered process.env lookups:
// a misspelt variable is then a visible default rather than an undefined that
// surfaces three layers down as something else.
//
// Note what is NOT here: which driver to open. The framework knows the Adapter
// contract and ships SQLite, which it owns. Postgres lives in its own package, and
// a package the framework depended on would be a cycle — so an app that wants it
// hands `openStore` in. The fence is the reason, and the fence is checked.

import { sqliteAdapter } from '../data/sqlite.ts'
import { KetError } from '../kernel/errors.ts'
import type { Adapter } from '../types.ts'

export type RuntimeConfig = {
  port: number
  host: string
  /** Non-null means "not SQLite"; the app's openStore decides what it means. */
  databaseUrl: string | null
  sqliteFile: string
  /** Applied on boot unless told otherwise; a production deploy migrates separately. */
  migrateOnBoot: boolean
  /** Installed on an empty database so a first run has something to look at. */
  bootstrapApps: string[] | null
  /**
   * Whether modules declaring install: 'auto' are allowed to arrive on their own.
   * A module draws the boundary; this decides whether the deployment honours it.
   * Off is for development, where an app appearing by itself is a surprise.
   */
  autoInstall: boolean
  defaultLocale: string
  fallbackLocale: string
  /** Until there is authentication, the company a request acts as comes from here. */
  defaultCompany: string
  /**
   * Signing key for session cookies. It MUST be the same on every pod — a cookie
   * signed by one and rejected by another is a login that works until the load
   * balancer sends you elsewhere.
   */
  secret: string | null
}

const list = (v: string | undefined): string[] | null =>
  v === undefined ? null : v.split(',').map(s => s.trim()).filter(Boolean)

export function readConfig(
  env: Record<string, string | undefined> = process.env,
  defaults: Partial<RuntimeConfig> = {},
): RuntimeConfig {
  return {
    port: Number(env.PORT ?? defaults.port ?? 3000),
    host: env.HOST ?? defaults.host ?? '127.0.0.1',
    databaseUrl: env.DATABASE_URL ?? defaults.databaseUrl ?? null,
    sqliteFile: env.KET_SQLITE ?? defaults.sqliteFile ?? '.ket/app.db',
    migrateOnBoot: env.KET_MIGRATE !== '0',
    autoInstall: env.KET_AUTO_INSTALL === undefined ? (defaults.autoInstall ?? true) : env.KET_AUTO_INSTALL !== '0',
    bootstrapApps: list(env.KET_APPS) ?? defaults.bootstrapApps ?? null,
    defaultLocale: env.KET_LOCALE ?? defaults.defaultLocale ?? 'en',
    fallbackLocale: env.KET_FALLBACK_LOCALE ?? defaults.fallbackLocale ?? defaults.defaultLocale ?? 'en',
    defaultCompany: env.KET_COMPANY ?? defaults.defaultCompany ?? 'default',
    secret: env.KET_SECRET ?? defaults.secret ?? null,
  }
}

/** How an app opens its datastore. SQLite is the default because it needs no driver. */
export type OpenStore = (config: RuntimeConfig) => Adapter | Promise<Adapter>

export const sqliteStore: OpenStore = async (config) => {
  if (config.databaseUrl) {
    throw new KetError({
      code: 'E_NO_DATASTORE_DRIVER',
      module: 'ketjs',
      message: `DATABASE_URL is set, but this app only knows how to open SQLite`,
      hint: 'give the app a serve.openStore that imports a driver package (ketjs-postgres, say); '
        + 'the framework cannot depend on one without becoming a cycle',
    })
  }
  const adapter = sqliteAdapter(config.sqliteFile)
  await adapter.open()
  return adapter
}
