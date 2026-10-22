import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compose, defineModule } from '@ketvietlab/ketjs'

/**
 * `compatible` read only the major of a caret range and compared anything else as
 * a string: `^1.5.0` accepted 1.2.0, `^0.3.0` accepted 0.9.0, and `~1.2.0` never
 * matched anything. It now reads ranges the way npm does.
 */
const versionsAccepted = (range: string, versions: string[]): string[] =>
  versions.filter((version) => {
    const owner = defineModule({ name: 'api', version })
    const extension = defineModule({ name: 'ext', depends: ['api'], compatible: { api: range } })
    try {
      compose([owner, extension], { headless: true })
      return true
    } catch (error) {
      const codes = ((error as { items?: Array<{ code: string }> }).items ?? []).map((item) => item.code)
      assert.deepEqual(codes, ['E_MODULE_VERSION_SKEW'], `${range} against ${version}`)
      return false
    }
  })

const candidates = [
  '0.2.9',
  '0.3.0',
  '0.3.5',
  '0.9.0',
  '1.0.0',
  '1.2.0',
  '1.5.0',
  '1.5.7',
  '1.9.0',
  '2.0.0-rc.1',
  '2.0.0',
]

test('compatible: caret, tilde and partial ranges mean what they mean in npm', () => {
  assert.deepEqual(versionsAccepted('^1.5.0', candidates), ['1.5.0', '1.5.7', '1.9.0'])
  assert.deepEqual(versionsAccepted('^0.3.0', candidates), ['0.3.0', '0.3.5'])
  assert.deepEqual(versionsAccepted('^1', candidates), ['1.0.0', '1.2.0', '1.5.0', '1.5.7', '1.9.0'])
  assert.deepEqual(versionsAccepted('~1.5.0', candidates), ['1.5.0', '1.5.7'])
  assert.deepEqual(versionsAccepted('1.5', candidates), ['1.5.0', '1.5.7'])
  assert.deepEqual(versionsAccepted('1.2.0', candidates), ['1.2.0'])
  assert.deepEqual(versionsAccepted('^2.0.0-rc.1', candidates), ['2.0.0-rc.1', '2.0.0'])
})

test('compatible: an unreadable range is reported as such', () => {
  const owner = defineModule({ name: 'api', version: '1.0.0' })
  const extension = defineModule({ name: 'ext', depends: ['api'], compatible: { api: '>=1 <2' } })
  assert.throws(
    () => compose([owner, extension], { headless: true }),
    (error: { items?: Array<{ code: string }> }) => error.items?.[0]?.code === 'E_MODULE_COMPATIBILITY_RANGE',
  )
})
