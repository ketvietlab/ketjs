import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

const field = (name: string, label: string, extra: Row = {}) => ({
  id: `row-${name}`,
  name,
  label,
  type: 'text',
  required: true,
  maxLength: 4000,
  classification: 'personal',
  ...extra,
})

/**
 * An editor builds a form in the Studio and the form is stored by `website_form` itself: each change
 * to what a visitor is asked becomes a new version, the old ones stay readable, two editors cannot
 * overwrite each other, and a form still placed on a page cannot be archived out from under it.
 */
test('Studio forms: create, version, conflict and archive through website_form', async () => {
  const { app, fixture } = await bootWebsiteStudio()
  const login = async (name: string) => {
    const client = app.client.anonymous()
    await client.login({ login: `studio-${name}`, password: 'studio-local' })
    return client
  }
  try {
    const editor = await login('editor')
    const reader = await login('reader')
    const send = async (client: typeof editor, fn: string, input: Row) => {
      const response = await client.post('/website/api/' + fn, JSON.stringify(input), {
        headers: { 'content-type': 'application/json' },
      })
      return {
        status: response.status,
        ...((await response.json()) as { value: Row; message?: string; code?: string }),
      }
    }
    const call = async (fn: string, input: Row, client = editor) => {
      const r = await send(client, fn, input)
      assert.equal(r.status, 200, JSON.stringify(r))
      return r.value
    }
    const values = (fields: Row[], extra: Row = {}) => ({
      title: 'Đặt bàn',
      schema: { fields },
      recipient: 'dat-ban@example.test',
      successMessage: '',
      consentLabel: 'Tôi đồng ý để nhà hàng liên hệ.',
      spamProtection: 'honeypot',
      active: 'yes',
      ...extra,
    })
    const save = (id: string, expectedRevisionId: unknown, v: Row, client = editor, siteId = 'site-a') =>
      send(client, 'website_studio.saveResource', {
        siteId,
        kind: 'form-editor',
        id,
        expectedRevisionId,
        values: v,
      })

    const first = [field('name', 'Họ tên'), field('phone', 'Điện thoại', { type: 'tel' })]
    const created = await save('form-booking', null, values(first))
    assert.equal(created.status, 200, JSON.stringify(created))
    assert.equal(created.value.revisionId, '1')
    assert.equal(created.value.title, 'Đặt bàn')
    assert.equal(created.value.recipient, 'dat-ban@example.test')
    // Left empty, the message a visitor reads after sending is the Studio's own.
    assert.equal(created.value.successMessage, 'Cảm ơn bạn. Chúng tôi đã nhận được thông tin.')
    assert.deepEqual(
      ((created.value.schema as Row).fields as Row[]).map((f) => [f.id, f.name, f.label, f.type]),
      [
        ['row-name', 'name', 'Họ tên', 'text'],
        ['row-phone', 'phone', 'Điện thoại', 'tel'],
      ],
    )
    assert.deepEqual(
      (created.value.versions as Row[]).map((v) => v.revisionId),
      ['v1'],
    )

    // The list screen counts what came in; a reader sees it, and opening it reads the same form.
    const listed = await call('website_form.listForms', { siteId: 'site-a' }, reader)
    assert.deepEqual(listed.rows, [
      { id: 'form-booking', title: 'Đặt bàn', active: true, newCount: 0, total: 0, lastAt: null },
    ])
    assert.deepEqual(await call('website_form.getForm', { id: 'form-booking' }, reader), {
      id: 'form-booking',
      siteId: 'site-a',
      title: 'Đặt bàn',
      active: true,
      retentionDays: null,
    })
    assert.equal((await save('form-booking', '1', values(first, { title: 'Khác' }), reader)).status, 403)

    // A wording change keeps the version; changing what is asked starts a new one.
    const worded = await save('form-booking', '1', values(first, { successMessage: 'Hẹn gặp bạn.' }))
    assert.equal(worded.value.revisionId, '2')
    assert.equal((worded.value.versions as Row[]).length, 1)
    const second = [field('phone', 'Số điện thoại', { type: 'tel' }), field('name', 'Họ tên')]
    const moved = await save('form-booking', '2', values(second))
    assert.equal(moved.value.revisionId, '3')
    const versions = moved.value.versions as Row[]
    assert.deepEqual(
      versions.map((v) => [v.revisionId, ((v.schema as Row).fields as Row[]).map((f) => f.label)]),
      [
        ['v2', ['Số điện thoại', 'Họ tên']],
        ['v1', ['Họ tên', 'Điện thoại']],
      ],
    )

    // Someone who opened revision 2 cannot overwrite revision 3.
    const stale = await save('form-booking', '2', values(first))
    assert.deepEqual([stale.status, stale.code], [400, 'conflict'], JSON.stringify(stale))
    assert.equal(
      (
        await call('website_studio.getResource', {
          siteId: 'site-a',
          kind: 'form-editor',
          id: 'form-booking',
        })
      ).revisionId,
      '3',
    )

    const refuse = async (v: Row, message: RegExp) => {
      const refused = await save('form-booking', '3', v)
      assert.equal(refused.status, 400, JSON.stringify(refused))
      assert.match(String(refused.message), message)
    }
    await refuse(values(second, { spamProtection: 'challenge' }), /chưa hỗ trợ thử thách/)
    await refuse(values([field('phone', ' ')]), /schema biểu mẫu không hợp lệ/)
    await refuse(values([field('phone', 'A'), field('phone', 'B')]), /Tên trường bị trùng/)
    await refuse(values(second, { recipient: 'không-phải-email' }), /email/)

    // Another site's screen does not reach this form.
    assert.equal(
      (
        await send(editor, 'website_studio.getResource', {
          siteId: 'site-a2',
          kind: 'form-editor',
          id: 'form-booking',
        })
      ).status,
      404,
    )
    assert.equal((await save('form-booking', '3', values(second), editor, 'site-a2')).status, 404)

    // A page that shows the form, even inside a column, keeps it from being archived.
    const page = (await call('website.getEntry', { id: 'page-site-a' })).entry as Row
    await call('website.saveEntry', {
      ...page,
      expectedRevisionId: page.revisionId,
      layout: [
        {
          id: 'section-columns',
          type: 'website.columns',
          settings: {},
          slots: {
            left: [],
            right: [
              {
                id: 'section-booking',
                type: 'website_form.form',
                settings: { formId: 'form-booking', heading: 'Đặt bàn' },
              },
            ],
          },
        },
      ],
    })
    const archive = (expectedRevisionId: unknown) =>
      send(editor, 'website_studio.archiveResource', {
        siteId: 'site-a',
        kind: 'form-editor',
        id: 'form-booking',
        expectedRevisionId,
        confirmed: true,
      })
    const inUse = await archive('3')
    assert.equal(inUse.status, 400)
    assert.match(String(inUse.message), /Đang được dùng tại: Trang site-a/)
    // Live, the page still shows it after the draft drops it, so it stays in use until that is published.
    await fixture('website.publishEntry', { id: 'page-site-a' })
    const placed = (await call('website.getEntry', { id: 'page-site-a' })).entry as Row
    await call('website.saveEntry', { ...placed, expectedRevisionId: placed.revisionId, layout: [] })
    assert.match(String((await archive('3')).message), /Đang được dùng tại: Trang site-a/)
    await fixture('website.publishEntry', { id: 'page-site-a' })
    assert.equal((await archive('2')).code, 'conflict')
    assert.equal((await archive('3')).status, 200)
    assert.deepEqual((await call('website_form.listForms', { siteId: 'site-a' })).rows, [])
    assert.equal(
      (
        await send(editor, 'website_studio.getResource', {
          siteId: 'site-a',
          kind: 'form-editor',
          id: 'form-booking',
        })
      ).status,
      404,
    )
    // Visitors are no longer answered.
    assert.equal(
      (await app.client.anonymous().call<Row>('website_form.getForm', { id: 'form-booking' })).value,
      null,
    )
  } finally {
    await app.close()
  }
})
