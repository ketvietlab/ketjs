import assert from 'node:assert/strict'
import test from 'node:test'
import { createNavigation } from '../site/navigation.ts'

const page = (route) => ({ route, title: route, html: '<p>Content</p>', toc: [] })
const url = (route) => new URL(route, 'https://ketjs.dev')
const deferred = () => {
  let resolve
  const promise = new Promise((done) => {
    resolve = done
  })
  return { promise, resolve }
}

test('the latest link wins even if an aborted fetch completes late', async () => {
  const slow = deferred(),
    committed = [],
    busy = []
  const navigate = createNavigation(
    page('/docs/'),
    {
      load: (target) =>
        target.pathname === '/docs/slow/' ? slow.promise : Promise.resolve(page(target.pathname)),
      commit: (next) => committed.push(next.route),
      fallback: () => assert.fail('Unexpected full navigation'),
      busy: (value) => busy.push(value),
    },
    new AbortController().signal,
  )
  const first = navigate(url('/docs/slow/'))
  await navigate(url('/docs/fast/'))
  slow.resolve(page('/docs/slow/'))
  await first
  assert.deepEqual(committed, ['/docs/fast/'])
  assert.equal(busy.at(-1), false)
})

test('Back/Forward reuses article data and restores the provided history position', async () => {
  const committed = [],
    loads = []
  const navigate = createNavigation(
    page('/docs/'),
    {
      load: async (target) => {
        loads.push(target.pathname)
        return page(target.pathname)
      },
      commit: (next, _target, pop, position) => committed.push({ route: next.route, pop, position }),
      fallback: () => assert.fail('Unexpected full navigation'),
      busy: () => {},
    },
    new AbortController().signal,
  )
  await navigate(url('/docs/models/'))
  await navigate(url('/docs/'), true, [0, 250])
  await navigate(url('/docs/models/'), true, [0, 600])
  assert.deepEqual(loads, ['/docs/models/'])
  assert.deepEqual(committed.slice(1), [
    { route: '/docs/', pop: true, position: [0, 250] },
    { route: '/docs/models/', pop: true, position: [0, 600] },
  ])
})

test('a current failed request falls back to the actual static route', async () => {
  const fallback = []
  const navigate = createNavigation(
    page('/docs/'),
    {
      load: async () => {
        throw new Error('Offline')
      },
      commit: () => assert.fail('Failed data rendered'),
      fallback: (target) => fallback.push(target.href),
      busy: () => {},
    },
    new AbortController().signal,
  )
  await navigate(url('/docs/models/#fields'))
  assert.deepEqual(fallback, ['https://ketjs.dev/docs/models/#fields'])
})

test('disposing an island prevents a pending request from rendering or navigating', async () => {
  const pending = deferred(),
    lifetime = new AbortController()
  const navigate = createNavigation(
    page('/docs/'),
    {
      load: () => pending.promise,
      commit: () => assert.fail('Disposed island rendered'),
      fallback: () => assert.fail('Disposed island navigated'),
      busy: () => {},
    },
    lifetime.signal,
  )
  const work = navigate(url('/docs/models/'))
  lifetime.abort()
  pending.resolve(page('/docs/models/'))
  await work
})
