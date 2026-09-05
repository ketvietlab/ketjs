import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  type FormRow,
  formEditorScreen,
  formsScreen,
} from '../packages/ketsuite/src/modules/website_backend/screens/index.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const editor = (options: Parameters<typeof formEditorScreen>[3] = {}) =>
  renderToString(formEditorScreen(translate, 'site1', {}, options))

const row = (over: Partial<FormRow> = {}): FormRow => ({
  id: 'f1',
  name: 'Lien he',
  active: true,
  ...over,
})

/**
 * A form could be created and never edited, and the privacy notice was not on
 * the create screen at all - so the versioned-consent gate, the retention
 * window and the preview allowlist all existed with no way for an operator to
 * reach any of them.
 */
test('form editor: the contract fields the form actually has are on the screen', () => {
  const html = editor()
  for (const name of ['consentText', 'summaryFields', 'retentionDays'])
    assert.match(html, new RegExp(`name="${name}"`, 'u'), `${name} must be editable`)
})

test('form editor: each of them says what it does, including what blank means', () => {
  const html = editor()
  for (const key of ['help.consentText', 'help.summaryFields', 'help.retentionDays'])
    assert.match(html, new RegExp(key.replace('.', '\\.'), 'u'))
})

test('form editor: creating posts to new, editing posts to the form itself', () => {
  assert.match(editor(), /action="\/admin\/website\/forms\/new"/u)
  assert.match(editor({ id: 'f1' }), /action="\/admin\/website\/forms\/f1"/u)
})

test('form editor: an existing form arrives with its values filled in', () => {
  const html = editor({
    id: 'f1',
    values: {
      name: 'Lien he',
      consentText: 'Toi dong y duoc lien he.',
      summaryFields: 'company, email',
      retentionDays: '90',
      schema: '{}',
      successMessage: 'Da nhan.',
      notifyTo: '',
    },
  })
  assert.match(html, /Toi dong y duoc lien he\./u)
  assert.match(html, /company, email/u)
  assert.match(html, /value="90"/u)
})

test('forms list: a row opens the form, the way every other list here behaves', () => {
  const html = renderToString(formsScreen(translate, [row()], 'site1', {}))
  assert.match(html, /\/admin\/website\/forms\/f1(?!\/)/u, 'the row opens the editor')
  assert.match(html, /\/admin\/website\/forms\/f1\/submissions/u, 'submissions keep their own way in')
})

test('forms list: a form with no retention window says it keeps everything', () => {
  const kept = renderToString(formsScreen(translate, [row()], 'site1', {}))
  assert.match(kept, /state\.kept/u)

  const bounded = renderToString(formsScreen(translate, [row({ retentionDays: 90 })], 'site1', {}))
  assert.match(bounded, /90/u)
  assert.equal(bounded.includes('state.kept'), false)
})
