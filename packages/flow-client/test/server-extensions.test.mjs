import test from 'node:test'
import assert from 'node:assert/strict'
import { createFlowServerExtensions } from '@ketvietlab/flow-client/server-extensions.mjs'

test('core mutations require capability, pass every guard in order and commit atomically', async () => {
  const events = [],
    state = { count: 0 }
  const host = {
    requireCapability: async (c, input) => {
      events.push('permission')
      assert.equal(c, 'flow.issue.write')
      if (input.deny) throw Error('forbidden')
    },
    transaction: async (work) => {
      events.push('begin')
      const draft = structuredClone(state)
      const result = await work(draft)
      Object.assign(state, draft)
      events.push('commit')
      return result
    },
  }
  const server = createFlowServerExtensions([
    { name: 'first', beforeMutation: () => events.push('first') },
    {
      name: 'second',
      beforeMutation: (_ctx, m) => {
        events.push('second')
        if (m.input.block) throw Error('guard')
      },
    },
  ])
  const write = (ctx) => {
    events.push('write')
    ctx.count++
    return ctx.count
  }
  const mutation = (input) => ({ name: 'flow.issue.save', capability: 'flow.issue.write', input })
  assert.equal(await server.mutate(host, mutation({}), write), 1)
  assert.deepEqual(events, ['permission', 'begin', 'first', 'second', 'write', 'commit'])
  events.length = 0
  await assert.rejects(server.mutate(host, mutation({ deny: true }), write), /forbidden/)
  assert.deepEqual(events, ['permission'])
  events.length = 0
  await assert.rejects(server.mutate(host, mutation({ block: true }), write), /guard/)
  assert.deepEqual(events, ['permission', 'begin', 'first', 'second'])
  assert.equal(state.count, 1)
  await assert.rejects(
    server.mutate(host, mutation({}), (ctx) => {
      ctx.count++
      throw Error('write failed')
    }),
    /write failed/,
  )
  assert.equal(state.count, 1)
  const core = createFlowServerExtensions()
  assert.equal(await core.mutate(host, mutation({}), write), 2)
})

test('private commands have explicit ownership and use the same permission/guard transaction', async () => {
  const calls = [],
    scoped = { tenant: 'verified-tenant' }
  const server = createFlowServerExtensions([
    {
      name: 'paid',
      beforeMutation: (ctx, m) => {
        assert.equal(ctx, scoped)
        calls.push(m.name)
      },
      commands: {
        'private.save': {
          capability: 'private.write',
          run: (ctx, input) => ({ tenant: ctx.tenant, id: input.id }),
        },
      },
    },
  ])
  const context = { requireCapability: (cap) => calls.push(cap), transaction: (fn) => fn(scoped) }
  assert.deepEqual(await server.dispatch(context, 'private.save', { id: '1' }), {
    handled: true,
    value: { tenant: 'verified-tenant', id: '1' },
  })
  assert.deepEqual(calls, ['private.write', 'private.save'])
  assert.deepEqual(await createFlowServerExtensions().dispatch(context, 'private.save', {}), {
    handled: false,
  })
  await assert.rejects(server.dispatch({}, 'private.save', {}), /scoped transaction/)
  assert.throws(() => createFlowServerExtensions([{ name: 'a' }, { name: 'a' }]), /Duplicate/)
  assert.throws(() => createFlowServerExtensions([{ name: 'a', commands: { x: { run() {} } } }]), /Invalid/)
  assert.throws(
    () =>
      createFlowServerExtensions([
        { name: 'a', commands: { x: { capability: 'x', run() {} } } },
        { name: 'b', commands: { x: { capability: 'x', run() {} } } },
      ]),
    /duplicate/,
  )
})

test('cleanup runs once in reverse order and does not skip a resource after a failure', async () => {
  const calls = [],
    server = createFlowServerExtensions([
      {
        name: 'a',
        dispose() {
          calls.push('a')
        },
      },
      {
        name: 'b',
        dispose() {
          calls.push('b')
          throw Error('b')
        },
      },
    ])
  await assert.rejects(server.dispose(), AggregateError)
  assert.deepEqual(calls, ['b', 'a'])
  await server.dispose()
  assert.deepEqual(calls, ['b', 'a'])
  await assert.rejects(server.dispatch({}, 'any', {}), /disposed/)
})
