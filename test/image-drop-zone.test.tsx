import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ImageDropZone } from '@ketvietlab/design-system'
import { renderToString } from '@ketvietlab/ketjs-view'
import { RecordImageField } from '../packages/ketsuite/src/ui/client/record-modal-form.tsx'
const labels = { empty: 'Left', upload: 'Upload', replace: 'Replace', remove: 'Remove', drop: 'Drop image' }
test('image record field retains scoped upload and remove commands and preview', () => {
  const html = renderToString(
    RecordImageField({
      kind: 'care',
      id: 'left-photo',
      viewer: <img src="/files/photo" alt="Left" />,
      hidden: { checkpointId: 'checkpoint-1', angle: 'left' },
      uploadCommand: 'photoUpload',
      removeCommand: 'photoRemove',
      labels,
    }),
  )
  for (const part of [
    'data-ui="image-drop-zone"',
    'src="/files/photo"',
    'name="checkpointId"',
    'value="checkpoint-1"',
    'value="left"',
    'value="photoUpload"',
    'value="photoRemove"',
    'data-record-submit="true"',
    'data-ui="image-drop-picker"',
    'aria-label="Replace"',
  ])
    assert.ok(html.includes(part), part)
})
test('read-only image has no upload or delete controls', () => {
  const html = renderToString(
    RecordImageField({
      kind: 'care',
      id: 'left-photo',
      viewer: <img src="/files/photo" alt="Left" />,
      labels,
    }),
  )
  assert.ok(html.includes('src="/files/photo"'))
  assert.ok(!html.includes('type="file"'))
  assert.ok(!html.includes('type="submit"'))
})

test('ImageDropZone exposes busy and error semantics', () => {
  const html = renderToString(ImageDropZone({ label: 'Photo', busy: true, error: 'Upload failed' }))
  assert.ok(html.includes('aria-busy="true"'))
  assert.ok(html.includes('role="alert"'))
  assert.ok(html.includes('Upload failed'))
})
