import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bootDeployment, defineDeployment, defineModule, json, withHeaders } from '@ketvietlab/ketjs'
import type { DeploymentSpec, ServeSpec } from '@ketvietlab/ketjs'

/**
 * The defaults of a deployment that signs users in. Each one used to fail open:
 * no permission policy meant every function, no secret meant a key that changed on
 * every restart, a loopback bind meant a cookie without Secure, and a bumped
 * security version re-stamped the old session instead of ending it.
 */
let liveVersion = 0
const account = defineModule({
  name: 'account',
  functions: {
    whoami: { effects: [], handler: (ctx) => ({ actor: ctx.actor }) },
  },
  routes: {
    '/login': {
      anonymous: true,
      handler: (ctx) => async (url, req) => {
        const sessions = await ctx.sessionsOf(url, req)
        const started = await sessions!.start({
          userId: 'u1',
          companies: ['acme'],
          company: 'acme',
          securityVersion: liveVersion,
        })
        return withHeaders(json({ ok: true }), { 'set-cookie': started.cookie })
      },
    },
  },
})

const deployment = (serve: ServeSpec): DeploymentSpec =>
  defineDeployment({ name: 'session_policy', modules: [account], headless: true, serve })

const quiet = { KET_LOG: 'null', KET_SQLITE: ':memory:' }

test('session policy: signing users in without serve.permissions is refused at boot', async () => {
  await assert.rejects(
    () => bootDeployment(deployment({ sessions: { secret: 'policy-secret' } }), { env: quiet, port: 0 }),
    (error: { code?: string }) => error.code === 'E_PERMISSIONS_REQUIRED',
  )
  await assert.rejects(
    () => bootDeployment(deployment({ resolveIdentity: async () => null }), { env: quiet, port: 0 }),
    (error: { code?: string }) => error.code === 'E_PERMISSIONS_REQUIRED',
  )

  // Unrestricted access is still available, but it has to be said.
  const booted = await bootDeployment(
    deployment({ sessions: { secret: 'policy-secret' }, permissions: async () => null }),
    { env: quiet, port: 0 },
  )
  try {
    const base = `http://127.0.0.1:${booted.port}`
    const cookie = ((await fetch(`${base}/login`)).headers.get('set-cookie') ?? '').split(';')[0]!
    const called = await fetch(`${base}/_ket/fn/account.whoami`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: '{}',
    })
    assert.equal(called.status, 200)
  } finally {
    await booted.close()
  }
})

test('session policy: outside development a session secret is required and the cookie is Secure', async () => {
  const unsigned = deployment({ sessions: {}, permissions: async () => null })
  await assert.rejects(
    () => bootDeployment(unsigned, { env: quiet, port: 0 }),
    (error: { code?: string }) => error.code === 'E_SESSION_SECRET_REQUIRED',
  )

  const production = await bootDeployment(unsigned, {
    env: { ...quiet, KET_SECRET: 'stable-secret' },
    port: 0,
  })
  try {
    // Bound to 127.0.0.1, as a process behind a TLS-terminating proxy usually is.
    const cookie = (await fetch(`http://127.0.0.1:${production.port}/login`)).headers.get('set-cookie') ?? ''
    assert.match(cookie, /;\s*Secure/i)
  } finally {
    await production.close()
  }

  const development = await bootDeployment(unsigned, { env: { ...quiet, KET_DEV: '1' }, port: 0 })
  try {
    const cookie = (await fetch(`http://127.0.0.1:${development.port}/login`)).headers.get('set-cookie') ?? ''
    assert.doesNotMatch(cookie, /;\s*Secure/i, 'local development over http keeps working')
  } finally {
    await development.close()
  }
})

test('session policy: a changed security version ends the session', async () => {
  liveVersion = 0
  // The resolver from the sessions guide: it reports the account as it is now.
  const booted = await bootDeployment(
    deployment({
      sessions: { secret: 'policy-secret' },
      permissions: async () => null,
      resolveSession: async ({ record }) => ({
        companies: ['acme'],
        company: record.company,
        branches: null,
        branch: null,
        securityVersion: liveVersion,
      }),
    }),
    { env: quiet, port: 0 },
  )
  try {
    const base = `http://127.0.0.1:${booted.port}`
    const cookie = ((await fetch(`${base}/login`)).headers.get('set-cookie') ?? '').split(';')[0]!
    const whoami = async () =>
      (
        (await (
          await fetch(`${base}/_ket/fn/account.whoami`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', cookie },
            body: '{}',
          })
        ).json()) as { value?: { actor: string | null }; code?: string }
      ).value?.actor ?? null
    assert.equal(await whoami(), 'u1')

    liveVersion = 1 // the password changed, or an administrator signed the user out
    assert.equal(await whoami(), null, 'the old cookie no longer signs anyone in')
    liveVersion = 0
    assert.equal(await whoami(), null, 'and it was destroyed, not merely refused once')
  } finally {
    await booted.close()
  }
})
