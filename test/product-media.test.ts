import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compose, renderToString } from 'ketjs'
import { mediaPanel, product, productBackend, uom } from 'ketsuite'

test('product media: unavailable scaffold has no image request and all actions are disabled', () => {
  const html = renderToString(mediaPanel({ status: 'unavailable' }))
  assert.match(html, /data-ui="media" data-state="unavailable"/)
  assert.doesNotMatch(html, /<img/)
  assert.doesNotMatch(html, /src=/)
  assert.equal((html.match(/ disabled/g) ?? []).length, 3)
})

test('product media: the backend integration is named but owns no image data model', async () => {
  const backend = (await import('ketsuite/backend')).default
  const manifest = compose([uom, product, backend, productBackend])
  assert.deepEqual(manifest.joints['product_backend:template.media']!.props, { templateId: 'id' })
  assert.deepEqual(manifest.joints['product_backend:variant.media']!.props, { productId: 'id' })
  assert.equal(
    Object.keys(manifest.models).some((name) => /image|media/i.test(name)),
    false,
  )
  assert.equal(
    Object.keys(manifest.functions).some((name) => /upload|image|media/i.test(name)),
    false,
  )
})
