import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as Y from 'yjs'
import { ensureTrailingParagraph } from '../packages/ketsuite/src/ui/client/live-doc-tail.ts'

test('local document always retains one empty final paragraph without accumulating placeholders', () => {
  const doc = new Y.Doc(),
    content = doc.getXmlFragment('content')
  doc.on('beforeObserverCalls', () => ensureTrailingParagraph(doc))
  ensureTrailingParagraph(doc)
  const tail = () => content.get(content.length - 1) as Y.XmlElement
  const assertTail = () => {
    assert.equal(tail().getAttribute('type'), 'p')
    assert.equal((tail().get(0) as Y.XmlText).length, 0)
  }
  assert.equal(content.length, 1)
  ;(tail().get(0) as Y.XmlText).insert(0, 'Write after image')
  assert.equal(content.length, 2)
  assertTail()
  content.delete(1, 1)
  assert.equal(content.length, 2)
  assertTail()
  doc.transact(() => {
    content.delete(0, content.length)
    const image = new Y.XmlElement('block')
    image.setAttribute('type', 'image')
    image.insert(0, [new Y.XmlText()])
    content.insert(0, [image])
  })
  assert.equal(content.length, 2)
  assertTail()
  for (let i = 0; i < 5; i++) ensureTrailingParagraph(doc)
  assert.equal(content.length, 2)
  const reopened = new Y.Doc()
  Y.applyUpdate(reopened, Y.encodeStateAsUpdate(doc))
  ensureTrailingParagraph(reopened)
  assert.equal(reopened.getXmlFragment('content').length, 2)
  reopened.destroy()
  doc.destroy()
})
