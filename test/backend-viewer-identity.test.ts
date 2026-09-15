import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ServeContext } from '@ketvietlab/ketjs'
import { viewerOf } from '../packages/ketsuite/src/modules/backend/screen.ts'

type Identity = Awaited<ReturnType<ServeContext['requestIdentityOf']>>

// A request that carries a verified identity and no KetJS cookie session: `sessionsOf` answers,
// but its record lookup finds nothing, exactly as a gateway login does in fleet mode.
const contextFor = (identity: Identity, signOutPath: string | null = null): ServeContext =>
  ({
    requestIdentityOf: async () => identity,
    sessionsOf: async () => ({ of: async () => null }),
    callUnchecked: async (name: string) =>
      name === 'user.getUser' ? { name: 'Ngọc Linh', timezone: 'Asia/Ho_Chi_Minh' } : null,
    live: async () => ({ functions: {}, routes: { '/admin/profile': {} } }),
    translate: () => (key: string) => key,
    localeOf: () => 'vi',
    config: { defaultTimezone: 'UTC' },
    signOutPath,
  }) as unknown as ServeContext

const identity = (origin: 'session' | 'request'): Identity => ({
  userId: 'u-ngoc-linh',
  sessionId: origin === 'request' ? 'request:u-ngoc-linh' : 'session-1',
  origin,
  companies: ['acme', 'globex'],
  company: 'acme',
  branch: null,
  branches: null,
  securityVersion: 0,
})

const url = new URL('http://tenant.example/admin')
const req = { headers: {} } as Parameters<typeof viewerOf>[2]

test('backend viewer: a gateway identity without a cookie session is a viewer', async () => {
  const viewer = await viewerOf(contextFor(identity('request'), '/auth/logout'), url, req)
  assert.ok(viewer, 'a verified gateway identity must reach the sidebar')
  assert.equal(viewer.name, 'Ngọc Linh')
  assert.equal(viewer.company, 'acme')
  assert.deepEqual(viewer.companies, ['acme', 'globex'])
  assert.equal(viewer.profilePath, '/admin/profile')
  assert.equal(viewer.timezone, 'Asia/Ho_Chi_Minh')
  assert.deepEqual(viewer.signOut, { action: '/auth/logout' })
})

test('backend viewer: a gateway identity without a declared sign-out hides only the control', async () => {
  const viewer = await viewerOf(contextFor(identity('request')), url, req)
  assert.ok(viewer)
  assert.equal(viewer.signOut, null)
})

test('backend viewer: a cookie session keeps signing out through POST /logout', async () => {
  const viewer = await viewerOf(contextFor(identity('session'), '/auth/logout'), url, req)
  assert.ok(viewer)
  assert.deepEqual(viewer.signOut, { action: '/logout' })
})

test('backend viewer: no identity is no viewer', async () => {
  assert.equal(await viewerOf(contextFor(null), url, req), null)
})
