import { setFlowLocale } from '../src/i18n.mjs'
setFlowLocale('vi')
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { FlowFileDropzone } from '../src/workspace.mjs'
test('file picker names native multiple chooser and exposes removable file names and sizes', () => {
  const output = renderToStaticString(
    FlowFileDropzone({
      id: 'files',
      files: [new File(['abc'], 'Brief.txt'), new File(['x'], '<unsafe>.txt')],
      onChange: () => {},
    }),
  )
  assert.match(output, /type="file" multiple/)
  assert.match(output, /aria-label="Chọn tệp đính kèm"/)
  assert.match(output, /aria-describedby="files-hint"/)
  assert.match(output, /2 tệp đã chọn/)
  assert.match(output, /3 B/)
  assert.match(output, /aria-label="Bỏ tệp Brief.txt"/)
  assert.doesNotMatch(output, /<unsafe>/)
})
test('readonly picker disables both file chooser and removal', () => {
  const output = renderToStaticString(
    FlowFileDropzone({
      id: 'files',
      files: [new File(['abc'], 'Brief.txt')],
      disabled: true,
      onChange: () => {},
    }),
  )
  assert.match(output, /type="file" multiple="" disabled/)
  assert.match(output, /<button[^>]*disabled/)
})
const handler = (view, event) => view.values[view.strings.findIndex((s) => s.endsWith(`on:${event}=`))]
test('dropping files prevents browser navigation, retains previous selections and deduplicates', () => {
  const a = new File(['a'], 'a.txt', { lastModified: 1 }),
    b = new File(['bb'], 'b.txt', { lastModified: 2 })
  let selected = [a],
    prevented = 0,
    stopped = 0
  const view = FlowFileDropzone({
    id: 'files',
    files: selected,
    onChange: (files) => {
      selected = files
    },
  })
  const zone = { dataset: {} }
  const event = {
    currentTarget: zone,
    dataTransfer: { files: [a, b] },
    preventDefault: () => prevented++,
    stopPropagation: () => stopped++,
  }
  handler(view, 'dragover')(event)
  assert.equal(zone.dataset.dragging, 'true')
  assert.equal(event.dataTransfer.dropEffect, 'copy')
  handler(view, 'drop')(event)
  assert.deepEqual(selected, [a, b])
  assert.equal(zone.dataset.dragging, undefined)
  assert.equal(prevented, 2)
  assert.equal(stopped, 1)
  const input = { files: [a, b], value: 'selected' }
  handler(
    FlowFileDropzone({
      id: 'files',
      files: selected,
      onChange: (files) => {
        selected = files
      },
    }),
    'change',
  )({ currentTarget: input })
  assert.equal(input.value, '')
  assert.deepEqual(selected, [a, b])
})
test('disabled drop still prevents browser file navigation without changing selection', () => {
  let called = false,
    prevented = false
  const view = FlowFileDropzone({
    id: 'files',
    files: [],
    disabled: true,
    onChange: () => {
      called = true
    },
  })
  handler(
    view,
    'drop',
  )({
    currentTarget: { dataset: { dragging: 'true' } },
    dataTransfer: { files: [new File(['a'], 'a.txt')] },
    preventDefault: () => {
      prevented = true
    },
    stopPropagation: () => {},
  })
  assert.equal(called, false)
  assert.equal(prevented, true)
})
test('immediate file drop hands files straight to the consumer and blocks while saving', async () => {
  const { FlowFileDrop } = await import('../src/workspace.mjs')
  const a = new File(['a'], 'a.txt')
  let got = null,
    prevented = 0
  const view = FlowFileDrop({
    id: 'task-files',
    onFiles: (files) => {
      got = files
    },
    children: 'Existing.csv',
  })
  const zone = { dataset: {} },
    event = {
      currentTarget: zone,
      dataTransfer: { files: [a] },
      preventDefault: () => prevented++,
      stopPropagation: () => {},
    }
  handler(view, 'dragover')(event)
  assert.equal(zone.dataset.dragging, 'true')
  handler(view, 'drop')(event)
  assert.deepEqual(got, [a])
  assert.equal(zone.dataset.dragging, undefined)
  assert.equal(prevented, 2)
  const output = renderToStaticString(view)
  assert.match(output, /Existing\.csv[\s\S]*type="file" multiple/)
  assert.doesNotMatch(output, /file-drop-pending/)
  got = null
  handler(
    FlowFileDrop({
      id: 'task-files',
      busy: true,
      pending: [a],
      onFiles: (files) => {
        got = files
      },
      onRetry: () => {},
    }),
    'drop',
  )(event)
  assert.equal(got, null)
  const saving = renderToStaticString(
    FlowFileDrop({ id: 'task-files', busy: true, pending: [a], onFiles: () => {}, onRetry: () => {} }),
  )
  assert.match(saving, /Đang thêm 1 tệp/)
  assert.doesNotMatch(saving, /Thử lại/)
  const failed = renderToStaticString(
    FlowFileDrop({
      id: 'task-files',
      pending: [a],
      onFiles: () => {},
      onRetry: () => {},
      onDiscard: () => {},
    }),
  )
  assert.match(failed, /1 tệp chưa được thêm/)
  assert.match(failed, /Thử lại/)
  assert.match(failed, /Bỏ qua/)
})
test('attachments preview raster images and video, and download everything else', async () => {
  const { FlowAttachment, FlowMediaPreview, attachmentKind } = await import('../src/workspace.mjs')
  assert.equal(attachmentKind('image/svg+xml'), 'file')
  assert.equal(attachmentKind('text/html'), 'file')
  assert.equal(attachmentKind('video/mp4'), 'video')
  const image = renderToStaticString(
    FlowAttachment({
      title: 'a.jpg',
      meta: '1.2 MB',
      type: 'image/jpeg',
      url: '/_ket/files/1',
      onPreview: () => {},
    }),
  )
  assert.match(image, /<img src="\/_ket\/files\/1"/)
  assert.match(image, /aria-label="Xem trước a.jpg"/)
  assert.match(image, /href="\/_ket\/files\/1\?download=1" download="a.jpg"/)
  const video = renderToStaticString(
    FlowAttachment({ title: 'b.mp4', type: 'video/mp4', url: '/_ket/files/2', onPreview: () => {} }),
  )
  assert.match(video, /Xem trước b.mp4/)
  assert.doesNotMatch(video, /<img/)
  const svg = renderToStaticString(
    FlowAttachment({ title: 'c.svg', type: 'image/svg+xml', url: '/_ket/files/3', onPreview: () => {} }),
  )
  assert.doesNotMatch(svg, /Xem trước|<img/)
  assert.match(svg, /Tải xuống c.svg/)
  const sample = renderToStaticString(FlowAttachment({ title: 'd.csv', meta: '48 KB', url: null }))
  assert.match(sample, /48 KB · tệp mẫu, không lưu nội dung/)
  assert.doesNotMatch(sample, /download/)
  assert.match(
    renderToStaticString(FlowMediaPreview({ title: 'b.mp4', type: 'video/mp4', url: '/_ket/files/2' })),
    /<video src="\/_ket\/files\/2" controls/,
  )
  assert.match(
    renderToStaticString(FlowMediaPreview({ title: 'a.jpg', type: 'image/jpeg', url: '/_ket/files/1' })),
    /<img src="\/_ket\/files\/1" alt="a.jpg"/,
  )
})
