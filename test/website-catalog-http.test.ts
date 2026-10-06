import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import sharp from 'sharp'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

test('commerce catalog HTTP: permissions, owner images, native form and live public renderer', async (t) => {
  const { app, fixture } = await bootWebsiteStudio(undefined, { deployment: 'commerce' })
  t.after(() => app.close())
  await fixture('website.saveDomain', {
    id: 'catalog-domain',
    siteId: 'site-a',
    host: '127.0.0.1',
    primary: true,
  })
  const home = await fixture('website.getEntry', { id: 'page-site-a' })
  await fixture('website.publishEntry', {
    id: 'page-site-a',
    expectedRevisionId: (home.entry as Row).revisionId,
  })
  await fixture('website_form.saveForm', {
    id: 'catalog-form',
    siteId: 'site-a',
    name: 'Yêu cầu báo giá',
    schema: {
      fields: [
        {
          name: 'name',
          label: 'Họ tên',
          type: 'text',
          required: true,
          maxLength: 120,
          classification: 'public',
        },
      ],
    },
    successMessage: 'Đã nhận yêu cầu',
    active: true,
  })
  await fixture('product.saveTemplate', {
    id: 'catalog-http-product',
    name: 'In hộp giấy',
    type: 'service',
    description: 'Mô tả ERP',
  })
  const b = await fixture('website_catalog.addProduct', {
    siteId: 'site-a',
    productId: 'catalog-http-product',
  })
  const editor = app.client.anonymous(),
    reader = app.client.anonymous(),
    guest = app.client.anonymous()
  await editor.login({ login: 'studio-editor', password: 'studio-local' })
  await reader.login({ login: 'studio-reader', password: 'studio-local' })
  const request = async (client: typeof editor, name: string, input: Row) =>
    client.post('/website/api/' + name, JSON.stringify(input), {
      headers: { 'content-type': 'application/json' },
    })
  assert.equal((await request(guest, 'website_catalog.listBindings', { siteId: 'site-a' })).status, 401)
  assert.equal((await request(reader, 'website_catalog.listBindings', { siteId: 'site-a' })).status, 200)
  assert.equal((await request(reader, 'website_catalog.saveBinding', { siteId: 'site-a' })).status, 403)
  assert.equal(
    (
      await request(editor, 'product.saveTemplate', {
        siteId: 'site-a',
        id: 'new-source',
        name: 'New',
        type: 'service',
      })
    ).status,
    403,
    'Studio cannot bypass ERP owner permissions',
  )
  assert.equal(
    (await request(editor, 'website_catalog.getBinding', { siteId: 'site-b', id: b.id })).status,
    404,
  )
  const bytes = await sharp({ create: { width: 480, height: 320, channels: 3, background: '#235b46' } })
    .webp()
    .toBuffer()
  const form = () => {
    const f = new FormData()
    f.append('file', new Blob([new Uint8Array(bytes)], { type: 'image/webp' }), 'product.webp')
    return f
  }
  const uploadPath = `/website/catalog/images/Binding/${b.id}/image?site=site-a`
  assert.equal((await reader.post(uploadPath, form())).status, 403)
  const upload = await editor.post(uploadPath, form())
  assert.equal(upload.status, 201, await upload.clone().text())
  const image = (await upload.json()) as Row
  assert.equal((await guest.get(String(image.url))).status, 404)
  assert.equal((await editor.get(String(image.url))).status, 200)
  await fixture('website_catalog.importProductContent', {
    siteId: 'site-a',
    id: b.id,
    expectedRevisionId: b.revisionId,
    contentLayout: [
      { id: 'native-image', type: 'website.image', settings: { image: '', alt: 'Sản phẩm thực tế' } },
      { id: 'native-form', type: 'website_form.form', settings: { formId: 'catalog-form' } },
    ],
  })
  const builder = await request(editor, 'website_catalog.getBuilder', {
    siteId: 'site-a',
    id: b.id,
    mode: 'product',
  })
  assert.equal(builder.status, 200)
  const value = ((await builder.json()) as { value: Row }).value
  assert.ok(value.theme)
  const entry = value.entry as Row,
    layout = structuredClone(entry.layout) as Row[]
  ;(layout.find((n) => n.id === 'native-image')!.settings as Row).image = image.url
  const saved = await request(editor, 'website_catalog.saveBuilder', {
    siteId: 'site-a',
    id: b.id,
    mode: 'product',
    expectedRevisionId: entry.revisionId,
    layout,
  })
  assert.equal(saved.status, 200, await saved.clone().text())
  assert.equal((await guest.get(String(image.url))).status, 200)
  const current = await fixture('website_catalog.getBinding', { siteId: 'site-a', id: b.id })
  const visible = await request(editor, 'website_catalog.saveBinding', {
    siteId: 'site-a',
    id: b.id,
    expectedRevisionId: current.revisionId,
    visible: true,
    path: '/p/in-hop-giay',
    templateId: current.templateId,
    action: 'quote',
    categoryIds: [],
  })
  assert.equal(visible.status, 200, await visible.clone().text())
  const publicPage = await guest.get('/p/in-hop-giay')
  assert.equal(publicPage.status, 200)
  const html = await publicPage.text()
  assert.match(html, /In hộp giấy/)
  assert.match(html, /Mô tả ERP/)
  assert.ok(html.includes(String(image.url)))
  assert.match(html, /action="\/forms\/catalog-form"/)
  assert.match(html, /Họ tên/)
  const stale = await request(editor, 'website_catalog.saveBinding', {
    siteId: 'site-a',
    id: b.id,
    expectedRevisionId: current.revisionId,
    visible: false,
    path: '/p/in-hop-giay',
    templateId: current.templateId,
    action: 'quote',
    categoryIds: [],
  })
  assert.equal(stale.status, 400)
  assert.equal(((await stale.json()) as Row).code, 'conflict')
  const previewUrl = `/website/catalog/preview/product/${b.id}?site=site-a`
  assert.equal((await guest.get(previewUrl)).status, 401)
  assert.equal((await editor.get(previewUrl)).status, 200)
  const preview = await (await editor.get(previewUrl)).text()
  assert.match(preview, /In hộp giấy/)
  assert.doesNotMatch(preview, /gtm\.mjs|googletagmanager\.com/)
  assert.doesNotMatch(preview, /method="post"/)
  assert.match(preview, /disabled/)
  const source = await fixture('product.getTemplate', { id: 'catalog-http-product' })
  await fixture('product.saveTemplate', {
    id: source.id,
    expectedRevisionId: source.revisionId,
    type: 'service',
    name: 'Hộp giấy mới',
    description: 'Nội dung cập nhật',
  })
  const updated = await (await guest.get('/p/in-hop-giay')).text()
  assert.match(updated, /Hộp giấy mới/)
  assert.match(updated, /Nội dung cập nhật/)
})
