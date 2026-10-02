import { randomUUID } from 'node:crypto'
import { createTestDeployment as boot } from '@ketvietlab/ketjs/testing'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'

/** Each PostgreSQL HTTP test owns a scratch database; the default lane remains SQLite. */
export async function createCommerceTestDeployment(...args: Parameters<typeof boot>) {
  const configured = process.env.KET_COMMERCE_PG
  if (!configured) return boot(...args)
  const adminUrl = new URL(configured)
  adminUrl.pathname = '/postgres'
  const admin = postgresAdapter(adminUrl.toString(), { max: 1 })
  const name = `commerce_test_${randomUUID().replaceAll('-', '')}`
  await admin.open()
  await admin.exec(`CREATE DATABASE "${name}"`)
  const url = new URL(configured)
  url.pathname = `/${name}`
  const drop = async () => {
    try {
      await admin.exec(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    } finally {
      await admin.close()
    }
  }
  try {
    const app = await boot(args[0], { ...args[1], env: { ...args[1]?.env, DATABASE_URL: url.toString() } })
    return {
      ...app,
      close: async () => {
        try {
          await app.close()
        } finally {
          await drop()
        }
      },
    }
  } catch (error) {
    await drop()
    throw error
  }
}
