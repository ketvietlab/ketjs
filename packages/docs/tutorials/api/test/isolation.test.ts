import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { deployment } from '../ket.workspace.ts'

test('company scope keeps another company from reading or updating a todo', async () => {
  const lab = await createTestDeployment(deployment, { worker: false, client: { company: 'alpha' } })
  try {
    const todo = (await lab.client.call<{ id: string }>('learn_api.create', { title: 'Alpha only' })).value
    const other = lab.client.with({ company: 'beta' })
    assert.deepEqual((await other.call('learn_api.list')).value, [])
    assert.equal((await other.call('learn_api.complete', { id: todo.id, done: true })).value, null)
    assert.equal((await lab.client.call<{ done: boolean }[]>('learn_api.list')).value[0].done, false)
  } finally {
    await lab.close()
  }
})
