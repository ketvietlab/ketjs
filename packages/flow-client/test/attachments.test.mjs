import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { createFixtureSession } from '../atlas/store.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
const input = {
  collection: 'files',
  taskId: 'KV-142',
  files: [
    { title: 'Brief.pdf', size: 1024 },
    { title: 'Design.png', size: 2048 },
  ],
  idempotencyKey: 'attachment-batch',
}
test('multiple file metadata saves atomically and replay does not duplicate attachments', () => {
  const s = createFixtureSession(),
    before = s.data.files.length
  const result = s.call('flow.entity.save', input).value
  assert.equal(result.ids.length, 2)
  assert.equal(s.data.files.length, before + 2)
  assert.deepEqual(
    s.data.files.slice(-2).map((f) => [f.taskId, f.title, f.size]),
    [
      ['KV-142', 'Brief.pdf', 1024],
      ['KV-142', 'Design.png', 2048],
    ],
  )
  assert.deepEqual(s.call('flow.entity.save', input).value, result)
  assert.equal(s.data.files.length, before + 2)
})
test('invalid file, missing task and readonly access leave all attachments unchanged', () => {
  const s = createFixtureSession(),
    before = structuredClone(s.data.files)
  for (const args of [
    { files: [] },
    { files: [input.files[0], { title: ' ', size: 0 }] },
    { files: [input.files[0], { title: 'bad', size: -1 }] },
    { taskId: 'missing' },
  ]) {
    assert.equal(s.call('flow.entity.save', { ...input, ...args }).value.ok, false)
    assert.deepEqual(s.data.files, before)
  }
  const read = createFixtureSession('readonly')
  assert.equal(read.call('flow.entity.save', input).value.errors[0].code, 'forbidden')
  const guest = createOrganizationSession('guest')
  assert.equal(
    guest.call('flow.entity.save', { ...input, companyId: 'demo' }).value.errors[0].code,
    'forbidden',
  )
})
