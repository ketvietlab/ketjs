import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bootDeployment, defineDeployment, defineModule, json } from '@ketvietlab/ketjs'

/**
 * close() waited for every request with no bound, and an open /_ket/stream never
 * finished at all, so a platform's SIGKILL arrived before the adapter and the log
 * sink were closed. A slow request now gets a grace period; a stream is ended.
 */
const slow = defineModule({
  name: 'slow',
  routes: {
    '/slow': {
      anonymous: true,
      handler: () => async () => {
        await new Promise((resolve) => setTimeout(resolve, 30_000).unref())
        return json({ late: true })
      },
    },
  },
})

const within = async (ms: number, work: Promise<unknown>): Promise<boolean> =>
  Promise.race([
    work.then(() => true),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), ms).unref()),
  ])

test('http shutdown: a request still running gets the grace period, then its connection is dropped', async () => {
  const booted = await bootDeployment(
    defineDeployment({ name: 'shutdown', modules: [slow], headless: true, serve: { shutdownGraceMs: 200 } }),
    { env: { KET_SQLITE: ':memory:', KET_LOG: 'null' }, port: 0 },
  )
  const pending = fetch(`http://127.0.0.1:${booted.port}/slow`).then(
    () => 'answered',
    () => 'dropped',
  )
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(await within(3_000, booted.close()), true, 'close() finished within the grace period')
  assert.equal(await pending, 'dropped')
})

test('http shutdown: an open event stream is ended rather than waited for', async () => {
  const booted = await bootDeployment(
    defineDeployment({
      name: 'shutdown_stream',
      modules: [slow],
      headless: true,
      serve: { resolveStream: async (_ctx, id) => id },
    }),
    { env: { KET_SQLITE: ':memory:', KET_LOG: 'null' }, port: 0 },
  )
  const response = await fetch(`http://127.0.0.1:${booted.port}/_ket/stream/quiet-topic`)
  assert.equal(response.headers.get('content-type'), 'text/event-stream')
  const body = response.text().then(
    () => 'ended',
    () => 'dropped',
  )
  assert.equal(await within(3_000, booted.close()), true, 'close() did not wait for the stream')
  assert.equal(await body, 'ended')
})
