import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { deployment } from '../ket.workspace.ts'

test('durable completion runs through the worker and retains company scope', async () => {
  const lab = await createTestDeployment(deployment, { client: { company: 'alpha' } })
  try {
    const todo = (
      await lab.client.call<{ id: string }>('learn_api.create', { title: 'Finish in background' })
    ).value
    await lab.client.call('learn_api.scheduleCompletion', { id: todo.id })
    assert.ok((await lab.drainJobs()) >= 1)
    const rows = (await lab.client.call<{ done: boolean }[]>('learn_api.list')).value
    assert.equal(rows[0].done, true)
    assert.deepEqual((await lab.client.with({ company: 'beta' }).call('learn_api.list')).value, [])
    assert.equal((await lab.client.call('learn_api.scheduleCompletion', { id: 'missing' })).value, null)
  } finally {
    await lab.close()
  }
})
