import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compose, translator } from '@ketvietlab/ketjs'
import { defineFormSchema } from '@ketvietlab/ketjs-view'
import backend from '@ketvietlab/ketsuite/backend'
import { formRefusal } from '@ketvietlab/ketsuite/backend'

const _ = translator(compose([backend], { headless: true }), 'vi')
const en = translator(compose([backend], { headless: true }), 'en')

const programme = defineFormSchema({
  fields: {
    name: { type: 'text', required: true, trim: true, minLength: 1, maxLength: 200 },
    sequence: { type: 'int', min: 0, max: 9999 },
    productFilter: { type: 'text', required: true, oneOf: ['any', 'include', 'exclude'] },
  },
})

const formRefusalIn = (t: Parameters<typeof formRefusal>[0]): string | null => {
  const refused = formRefusal(t)
  refused.check(programme, { name: 'Care', sequence: '10000', productFilter: 'any' })
  return refused.error('sequence')
}

test('KetSuite a form that passes hands back its values and nothing to show', () => {
  const refused = formRefusal(_)
  const values = refused.check(programme, { name: '  Care  ', sequence: '10', productFilter: 'any' })

  assert.deepEqual(values, { name: 'Care', sequence: 10, productFilter: 'any' })
  assert.equal(refused.refused(), false)
  assert.equal(refused.error('name'), null)
  assert.deepEqual(refused.sentences(), [])
})

test('KetSuite a refused form marks the control that caused it, in words', () => {
  const refused = formRefusal(_)
  const values = refused.check(programme, { name: '   ', sequence: '42', productFilter: 'nonsense' })

  assert.equal(values, null, 'nothing is handed back to write')
  assert.equal(refused.refused(), true)
  assert.equal(refused.error('name'), 'Trường này là bắt buộc.')
  assert.equal(refused.error('productFilter'), 'Giá trị không nằm trong danh sách cho phép.')
  assert.equal(refused.error('sequence'), null, 'a field that is fine carries no mark')
  assert.deepEqual(refused.sentences(), [], 'none of these concern the whole form')
})

test('KetSuite a bound that is exceeded says which bound it was', () => {
  assert.equal(formRefusalIn(_), 'Giá trị phải từ 9999 trở xuống.')
  assert.equal(formRefusalIn(en), 'Enter 9999 or less.', 'the second locale is a real translation')
})

test('KetSuite a refusal the shape rules did not raise still keeps the form open', () => {
  const refused = formRefusal(_)
  const values = refused.check(programme, { name: 'Care', sequence: '10', productFilter: 'any' })
  assert.notEqual(values, null, 'the shape was fine; the command is what said no')

  refused.add(['Chương trình này đã bị người khác sửa.'])

  assert.equal(refused.refused(), true, 'reading field marks alone would have closed the dialog')
  assert.deepEqual(refused.sentences(), ['Chương trình này đã bị người khác sửa.'])
  assert.equal(refused.error('name'), null)
})

test('KetSuite every code a schema can raise has words behind it', () => {
  // The nine keys `validateForm` names. A tenth code added upstream without a
  // sentence here would reach a person as its own code.
  for (const key of [
    'required',
    'type',
    'min',
    'max',
    'minLength',
    'maxLength',
    'oneOf',
    'pattern',
    'unknown',
  ])
    for (const t of [_, en]) assert.ok(t.resolves(`backend.validation.${key}`), `${key} in ${t.locale}`)
})

test('KetSuite a screen with two forms does not lose the first refusal to the second', () => {
  const refused = formRefusal(_)
  const other = defineFormSchema({ fields: { note: { type: 'text', maxLength: 4 } } })

  assert.equal(refused.check(programme, { name: '', productFilter: 'any' }), null)
  assert.notEqual(refused.check(other, { note: 'ok' }), null, 'the second form is fine')

  assert.equal(refused.refused(), true, 'the first form is still refused')
  assert.equal(refused.error('name'), 'Trường này là bắt buộc.')
})
