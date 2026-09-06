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

test('large dialog: the frame is fixed, so tabbing does not resize it', () => {
  // A dialog sized to its content is a different dialog on every tab. The tall
  // frame is what a workbench wants; the second half of the min() is what keeps
  // it on a screen that cannot give it, with a margin left over.
  assert.match(rule(SIZED) ?? '', /^\s*block-size: min\(1000px, calc\(100dvh - 100px\)\);$/mu)
  assert.doesNotMatch(rule(SIZED) ?? '', /block-size: auto/u)
})

test('large dialog: the fixed frame scrolls rather than clips', () => {
  // A height only holds if the sheet gives its body a row that can be smaller
  // than its content, and the body scrolls. Both were already there; this fails
  // if either goes, because then the height would cut the screen off instead.
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
