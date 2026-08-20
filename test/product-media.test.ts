import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, renderToString, sqliteAdapter } from 'ketjs'
import { company, mediaPanel, partner, product, productBackend, productMedia, storage, uom } from 'ketsuite'
import { address } from 'ketsuite'

test('product media: unavailable state performs no image request and cannot upload', () => {
  const html = renderToString(mediaPanel({ status: 'unavailable' }))
  assert.match(html, /data-ui="media" data-state="unavailable"/)
  assert.doesNotMatch(html, /<img/)
  assert.doesNotMatch(html, /src=/)
  assert.equal((html.match(/ disabled/g) ?? []).length, 1)
})

test('product media: ready gallery exposes native, storage-neutral actions', () => {
  const html = renderToString(
    mediaPanel({
      status: 'ready',
      uploadAction: '/products/t/media',
      images: [
        {
          id: 'm1',
          src: '/files/a1',
          alt: 'Front',
          primary: true,
          actions: { remove: '/products/t/media/m1/remove' },
        },
      ],
    }),
  )
  assert.match(html, /enctype="multipart\/form-data"/)
  assert.match(html, /data-ui="media-file-label"/)
  assert.match(html, /data-ui="media-file-input"/)
  assert.match(html, /src="\/files\/a1"/)
  assert.match(html, /action="\/products\/t\/media\/m1\/remove"/)
})

test('product media: metadata is ordered and primary is unique per target', async () => {
  const modules = [address, partner, company, storage, uom, product, productMedia]
  const manifest = compose(modules, { headless: true })
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  const scope = { company: 'acme', branches: null }
  const call = (name: string, args: Record<string, unknown>) =>
    callFn(name, args, { adapter, manifest, scope })
  try {
    await call('partner.savePartner', { id: 'party', kind: 'company', name: 'ACME' })
    await call('company.saveCompany', { id: 'acme', partnerId: 'party', currency: 'VND' })
    await call('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' })
    await call('product.saveTemplate', { id: 'tpl', name: 'Shirt', type: 'goods', uomId: 'unit' })
    for (const [id, name] of [
      ['a1', 'Front'],
      ['a2', 'Back'],
    ]) {
      await call('storage.createAttachment', {
        id,
        name,
        resModel: 'product.Template',
        resId: 'tpl',
        resField: 'media',
        kind: 'url',
        url: `https://cdn.example/${id}.png`,
        mimetype: 'image/png',
        size: 0,
        public: false,
        createdAt: new Date().toISOString(),
      })
      await call('product_media.attachMedia', {
        id: `m:${id}`,
        attachmentId: id,
        templateId: 'tpl',
        sequence: id === 'a1' ? 10 : 20,
      })
    }
    await call('product_media.setPrimary', { id: 'm:a2' })
    await call('product_media.reorderMedia', { templateId: 'tpl', ids: ['m:a2', 'm:a1'] })
    const rows = (await call('product_media.listMedia', { templateId: 'tpl' })).value as Array<{
      id: string
      primary: boolean
    }>
    assert.deepEqual(
      rows.map((row) => [row.id, row.primary]),
      [
        ['m:a2', true],
        ['m:a1', false],
      ],
    )
  } finally {
    await adapter.close()
  }
})

test('product media: backend retains named integration joints and Product stays headless', async () => {
  const backend = (await import('ketsuite/backend')).default
  const manifest = compose([
    address,
    partner,
    company,
    storage,
    uom,
    product,
    productMedia,
    backend,
    productBackend,
  ])
  assert.deepEqual(manifest.joints['product_backend:template.media']!.props, { templateId: 'id' })
  assert.deepEqual(manifest.joints['product_backend:variant.media']!.props, { productId: 'id' })
  assert.equal('product.Media' in manifest.models, false)
  assert.ok(manifest.models['product_media.Media'])
})
