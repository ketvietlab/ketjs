import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createLiveDocView } from '../packages/ketsuite/src/ui/client/live-doc-view.tsx'

test('embedded image insertion preserves its anchor and refuses readonly, unsafe and disposed calls', () => {
  const original = globalThis.document
  globalThis.document = { getSelection: () => null, removeEventListener() {} } as unknown as Document
  try {
    const editor = createLiveDocView({ docId: 'post', local: true })
    const insert = editor.prepareImageInsertion()
    assert.equal(insert({ src: 'javascript:alert(1)', alt: '' }), false)
    assert.equal(insert({ src: '/files/photo-1', alt: 'First' }), true)
    const anchored = editor.prepareImageInsertion()
    assert.equal(anchored({ src: '/files/photo-2', alt: 'Second' }), true)
    const blocks = editor.getValue().blocks
    assert.deepEqual(
      blocks.map((b) => b.type),
      ['image', 'p', 'image', 'p'],
    )
    assert.equal(blocks[0].src, '/files/photo-1')
    assert.equal(blocks[2].alt, 'Second')
    assert.equal(editor.updateImage(0, { width: 45, align: 'center' }), true)
    assert.equal(editor.getValue().blocks[0].width, 45)
    assert.equal(editor.getValue().blocks[0].align, 'center')
    assert.equal(editor.updateImage(0, { width: 200 }), true)
    assert.equal(editor.getValue().blocks[0].width, 100)
    assert.equal(editor.updateImage(0, { width: NaN }), false)
    assert.equal(editor.updateImage(0, { align: 'invalid' }), false)
    assert.equal(editor.removeImage(2), true)
    assert.deepEqual(
      editor.getValue().blocks.map((b) => b.type),
      ['image', 'p', 'p'],
    )
    assert.equal(editor.removeImage(1), false)
    editor.dispose()
    assert.equal(anchored({ src: '/files/photo-3', alt: '' }), false)
    for (const props of [{ local: true, readOnly: true }, { local: false }]) {
      const blocked = createLiveDocView({ docId: 'blocked', ...props })
      assert.equal(blocked.prepareImageInsertion()({ src: '/files/photo', alt: '' }), false)
      assert.equal(blocked.getValue().blocks.length, 0)
      blocked.dispose()
    }
  } finally {
    globalThis.document = original
  }
})
