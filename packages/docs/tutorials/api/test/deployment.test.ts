import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { deployment } from '../ket.workspace.ts'

test('learn_api: real HTTP CRUD, validation and method contracts', async () => {
  const e2e = await createTestDeployment(deployment, { worker: false, client: { company: 'test' } })
  try {
    const created = await e2e.client.request('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '  Learn KetJS  ' }),
    })
    assert.equal(created.status, 201)
    const todo = (await created.json()) as { id: string; title: string; done: boolean }
    assert.equal(todo.title, 'Learn KetJS')
    assert.equal(todo.done, false)
    const listed = await e2e.client.request('/api/todos')
    assert.deepEqual(await listed.json(), [todo])
    const done = await e2e.client.request(`/api/todos/${todo.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ done: true }),
    })
    assert.equal(done.status, 200)
    assert.equal(((await done.json()) as { done: boolean }).done, true)
    const invalid = await e2e.client.request('/api/todos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '' }),
    })
    assert.equal(invalid.status, 400)
    const wrongMethod = await e2e.client.request('/api/todos', { method: 'DELETE' })
    assert.equal(wrongMethod.status, 405)
    assert.equal(wrongMethod.headers.get('Allow'), 'GET, POST')
  } finally {
    await e2e.close()
  }
})
