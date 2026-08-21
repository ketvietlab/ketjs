// The one thing the framework cannot do for an app: reach a driver.
//
// ketjs ships SQLite, which it owns. Postgres lives in its own package, and a
// framework that depended on it would be a cycle — so the app imports it, and the
// zero-dep audit is what keeps that honest rather than a comment.

import type { OpenStore } from '@ketvietlab/ketjs'
import { sqliteStore } from '@ketvietlab/ketjs'

export const openStore: OpenStore = async (config) => {
  if (!config.databaseUrl) return sqliteStore(config)
  const { postgresAdapter } = await import('@ketvietlab/ketjs-postgres')
  const adapter = postgresAdapter(config.databaseUrl)
  await adapter.open()
  return adapter
}
