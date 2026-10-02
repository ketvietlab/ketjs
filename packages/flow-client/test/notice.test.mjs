import { setFlowLocale } from '@ketvietlab/flow-client/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { createTransientNotice } from '@ketvietlab/flow-client/notice.mjs'
test('new feedback replaces the old message and renews dismissal; hover/focus pauses it', () => {
  const pending = new Map()
  let id = 0,
    shown = ''
  const feedback = createTransientNotice(
    (v) => {
      shown = v
    },
    {
      schedule: (fn) => {
        pending.set(++id, fn)
        return id
      },
      cancel: (key) => pending.delete(key),
    },
  )
  feedback.show('First')
  const first = id
  feedback.show('Second')
  assert.equal(shown, 'Second')
  assert.equal(pending.has(first), false)
  assert.equal(pending.size, 1)
  feedback.pause()
  assert.equal(pending.size, 0)
  assert.equal(shown, 'Second')
  feedback.show('Third')
  assert.equal(pending.size, 0)
  feedback.resume()
  assert.equal(pending.size, 1)
  pending.get(id)()
  assert.equal(shown, '')
  assert.equal(pending.size, 0)
  feedback.show('Fourth')
  feedback.clear()
  assert.equal(shown, '')
  assert.equal(pending.size, 0)
  feedback.show('Fifth')
  feedback.dispose()
  assert.equal(pending.size, 0)
})
