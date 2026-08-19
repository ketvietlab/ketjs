// Everything the server needs to know, read once, in one place.
//
// Configuration is deliberately a value rather than scattered process.env lookups:
// a misspelt variable is then a visible default rather than an undefined that
// surfaces three layers down as something else.

import { sqliteAdapter } from 'ketjs'
import type { Adapter } from 'ketjs'

export type Config = {
  port: number
  databaseUrl: string | null
  sqliteFile: string
  /** Applied on boot unless told otherwise; a production deploy migrates separately. */
  migrateOnBoot: boolean
  /** Installed on an empty database so a first run has something to look at. */
  bootstrapApps: string[]
  defaultLocale: string
  /** Until there is authentication, the company comes from here. See serve.ts. */
  defaultCompany: string
}

export function readConfig(env: Record<string, string | undefined> = process.env): Config {
  return {
    port: Number(env.PORT ?? 3000),
    databaseUrl: env.DATABASE_URL ?? null,
    sqliteFile: env.KET_SQLITE ?? '.ket/ketsuite.db',
    migrateOnBoot: env.KET_MIGRATE !== '0',
    bootstrapApps: (env.KET_APPS ?? 'website,theme_paper,backend,product').split(',').map(s => s.trim()).filter(Boolean),
    defaultLocale: env.KET_LOCALE ?? 'vi',
    defaultCompany: env.KET_COMPANY ?? 'default',
  }
}

/**
 * Postgres when a URL is given, SQLite otherwise. The adapter contract is the same
 * either way, which is the point of having fixed it on day one.
 */
export async function openDatabase(config: Config): Promise<Adapter> {
  if (!config.databaseUrl) {
    const adapter = sqliteAdapter(config.sqliteFile)
    await adapter.open()
    return adapter
  }
  const { postgresAdapter } = await import('ketjs-postgres')
  const adapter = postgresAdapter(config.databaseUrl)
  await adapter.open()
  return adapter
}
