// What a live-Postgres test needs, in one place.
//
// These tests each provision a scratch database, so "is a server listening" is
// the wrong question: a server the role cannot create a database on makes the
// test fail inside CREATE DATABASE, long after it decided it was live. Worse,
// a failure there used to skip the `admin.close()` that followed it, leaving
// the pool's socket open — and because the runner waits for the child to exit,
// the whole suite hung instead of reporting the failure.
//
// So the probe asks for the permission the tests actually use, and every
// caller creates its scratch database inside the try whose finally closes the
// admin connection.
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'

const configured =
  process.env.KET_TEST_PG ?? process.env.DATABASE_URL ?? 'postgres://dev:devpassword@127.0.0.1:5435/ketjs_dev'

/** The maintenance database, which is where a scratch database is created from. */
export const adminUrl = new URL(configured)
adminUrl.pathname = '/postgres'

export const reachable = await (async () => {
  const adapter = postgresAdapter(adminUrl.toString())
  try {
    await adapter.open()
    const role = (await adapter.all('SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user'))[0]
    return Boolean(role?.rolcreatedb)
  } catch {
    return false
  } finally {
    await adapter.close().catch(() => {})
  }
})()

/** Pass as a node:test option object to skip when no such server is available. */
export const live = {
  skip: reachable ? false : `no PostgreSQL CREATE DATABASE role at ${adminUrl.host}`,
}
