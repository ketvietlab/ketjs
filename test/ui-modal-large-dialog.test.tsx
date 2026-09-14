import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { modalSheet } from '@ketvietlab/ketsuite/backend'

const forms = readFileSync('packages/ketsuite/src/modules/backend/design/forms.css', 'utf8')
/** The body of one rule, matched from the start of its line so a selector that
 *  is the tail of a longer one does not answer for it. */
const rule = (selector: string) => {
  const at = forms.indexOf(`\n  ${selector} {`)
  return at < 0 ? null : forms.slice(at, forms.indexOf('}', at))
}

const SIZED = '[data-ui="modal-layer"][data-presentation="dialog"] [data-ui="modal-sheet"][data-size="large"]'
const DIALOG = '[data-ui="modal-layer"][data-presentation="dialog"] [data-ui="modal-sheet"]'

test('large dialog: the size the screen asks for reaches the stylesheet', () => {
  // `size` and `presentation` are two attributes on the same element, and the
  // rule for the pair has to name both — the dialog rule matches with one more
  // attribute than the size rule, which is how thirty-one screens came to ask
  // for a large modal and get the width of a form.
  const html = renderToString(
    modalSheet({
      id: 'workbench',
      title: 'Phiếu chăm sóc',
      closeHref: '/admin/crm/followups',
      closeLabel: 'Đóng',
      presentation: 'dialog',
      size: 'large',
      body: 'nội dung',
    }),
  )
  assert.match(html, /data-ui="modal-layer"[^>]*data-presentation="dialog"/u)
  assert.match(html, /data-ui="modal-sheet" data-size="large"/u)
  assert.ok(rule(SIZED), 'the stylesheet has a rule for a dialog that is large')
})

test('large dialog: it is a workbench width, not a form width', () => {
  assert.match(rule(SIZED) ?? '', /^\s*inline-size: min\(1200px, 100%\);$/mu)
})

test('large dialog: width does not force a nearly full-screen height', () => {
  // Large is a width choice. A short form should remain a short dialog, while
  // genuinely long content grows until it reaches the viewport cap.
  assert.match(rule(SIZED) ?? '', /^\s*block-size: auto;$/mu)
  assert.match(rule(SIZED) ?? '', /^\s*max-block-size: calc\(100dvh - 100px\);$/mu)
  assert.doesNotMatch(rule(SIZED) ?? '', /block-size: min\(1000px/u)
})

test('large dialog: the viewport cap scrolls rather than clips', () => {
  // Once content reaches the viewport cap, the body row must be able to shrink
  // and scroll instead of letting the sheet run past the screen.
  assert.match(rule('[data-ui="modal-sheet"]') ?? '', /grid-template-rows: auto minmax\(0, 1fr\);/u)
  assert.match(rule('[data-ui="modal-body"]') ?? '', /overflow: auto;/u)
})

test('large dialog: the sized rule comes after the one it corrects', () => {
  // Same specificity would not be enough here even if it were equal — these two
  // rules both set inline-size, so the later one has to be the sized one.
  const generic = forms.indexOf(`${DIALOG} {`)
  const sized = forms.indexOf(`${SIZED} {`)
  assert.ok(generic > 0 && sized > generic, 'the sized rule follows the generic dialog rule')
})

test('an ordinary dialog is untouched', () => {
  // Only the pair changed. A dialog that did not ask to be large keeps the
  // width and the content height it has always had.
  assert.match(rule(DIALOG) ?? '', /inline-size: min\(56rem, 100%\);/u)
  assert.match(rule(DIALOG) ?? '', /block-size: auto;/u)
})

test('mobile: all modal sizes and presentations cover the viewport without elevation', () => {
  const selector = '[data-ui="modal-layer"][data-presentation="dialog"] [data-ui="modal-sheet"][data-size]'
  const start = forms.indexOf(selector)
  assert.ok(start > forms.indexOf('@media (max-width: 47.9375rem)'))
  const mobile = forms.slice(start, forms.indexOf('}', start))
  assert.match(mobile, /block-size: 100dvh;/u)
  assert.match(mobile, /inline-size: 100%;/u)
  assert.match(mobile, /border-radius: 0;/u)
  assert.match(mobile, /box-shadow: none;/u)
})
