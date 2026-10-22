import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { compose, defineModule, migrateOne } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { adminUrl, live } from './postgres-live.ts'

/**
 * Replicas that boot together each migrate on boot. Before the advisory lock they
 * all read the same marker, planned the same DDL, and every one but the first
 * failed on a duplicate table (23505) or a duplicate column (42701).
 */
const manifestOf = (extra: boolean) =>
  compose(
    Array.from({ length: 8 }, (_, index) =>
      defineModule({
        name: `race${index}`,
        models: {
          Item: {
            scope: 'shared',
            fields: { id: 'id', a: 'text?', b: 'int?', ...(extra ? { c: 'text?' } : {}) },
            indexes: { by_a: { fields: ['a'] } },
          },
        },
      }),
    ),
    { headless: true },
  )

test('migrations: replicas migrating one PostgreSQL database at once all succeed', live, async () => {
  const name = `migrate_race_${randomUUID().replaceAll('-', '')}`
  const admin = postgresAdapter(adminUrl.toString())
  await admin.open()
  try {
    await admin.exec(`CREATE DATABASE "${name}"`)
    const url = new URL(adminUrl)
    url.pathname = `/${name}`
    const replicas = async (extra: boolean) =>
      Promise.allSettled(
        Array.from({ length: 4 }, async () => {
          const adapter = postgresAdapter(url.toString())
          await adapter.open()
          try {
            return (await migrateOne(adapter, manifestOf(extra))).length
          } finally {
            await adapter.close()
          }
        }),
      )

    for (const extra of [false, true]) {
      const results = await replicas(extra)
      const failures = results.flatMap((result) =>
        result.status === 'rejected' ? [String((result.reason as Error).message).slice(0, 120)] : [],
      )
      assert.deepEqual(failures, [], extra ? 'an upgrade' : 'an empty database')
      const applied = results.map((result) => (result.status === 'fulfilled' ? result.value : -1))
      assert.equal(applied.filter((count) => count > 0).length, 1, 'exactly one replica applied the plan')
    }
  } finally {
    await admin.exec(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    await admin.close()
  }
})
