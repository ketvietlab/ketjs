import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

const field = (name: string, label: string, classification: string) => ({
  id: `row-${name}`,
  name,
  label,
  type: 'text',
  required: true,
  maxLength: 4000,
  classification,
})

/**
 * What visitors sent, worked through the Studio: the queue shows only answers classified public,
 * opening one shows it under the labels the visitor actually read and marks it read, a hold keeps it
 * past its retention date, and the CSV is written by the server, safe to open in a spreadsheet.
 * Editors arrange forms; only publishers read, hold and export what came in.
 */
test('Studio submissions: queue, detail, hold, export and overview through website_form', async () => {
  const { app, fixture } = await bootWebsiteStudio()
  try {
    // Visitors post from the site's own host, which is what scopes the form to its company.
    await fixture('website.saveDomain', {
      id: 'forms-domain',
      siteId: 'site-a',
      host: '127.0.0.1',
      primary: true,
    })
    const login = async (name: string) => {
      const client = app.client.anonymous()
      await client.login({ login: `studio-${name}`, password: 'studio-local' })
      return client
    }
    const editor = await login('editor')
    const publisher = await login('publisher')
    const reader = await login('reader')
    const send = async (client: typeof editor, fn: string, input: Row) => {
      const response = await client.post('/website/api/' + fn, JSON.stringify(input), {
        headers: { 'content-type': 'application/json' },
      })
      return { status: response.status, ...((await response.json()) as { value: Row; message?: string }) }
    }
    const call = async (fn: string, input: Row, client = publisher) => {
      const r = await send(client, fn, input)
      assert.equal(r.status, 200, JSON.stringify(r))
      return r.value
    }
    const saveForm = (expectedRevisionId: unknown, phoneLabel: string) =>
      call(
        'website_studio.saveResource',
        {
          siteId: 'site-a',
          kind: 'form-editor',
          id: 'form-booking',
          expectedRevisionId,
          values: {
            title: 'Đặt bàn',
            schema: { fields: [field('name', 'Họ tên', 'public'), field('phone', phoneLabel, 'personal')] },
            recipient: 'dat-ban@example.test',
            successMessage: 'Đã nhận.',
            consentLabel: '',
            spamProtection: 'honeypot',
            active: 'yes',
          },
        },
        editor,
      )
    await saveForm(null, 'Điện thoại')
    let agent = 0
    const submit = async (name: string, phone: string) => {
      agent += 1
      const response = await app.client
        .anonymous()
        .post(
          '/website/forms/form-booking/submit',
          JSON.stringify({ payload: { name, phone }, _schemaVersion: 1 }),
          { headers: { 'content-type': 'application/json', 'user-agent': `visitor-${agent}` } },
        )
      assert.equal(response.status, 200, await response.text())
    }
    await submit('An', '0901000001')
    await submit('=1+1', '0901000002')
    await submit('Chi', '0901000003')
    // The form moves on after they wrote in; what they read stays theirs.
    await saveForm('1', 'Số điện thoại')

    const listed = await call('website_form.listForms', { siteId: 'site-a' }, reader)
    assert.deepEqual(
      (listed.rows as Row[]).map((r) => [r.newCount, r.total, typeof r.lastAt]),
      [[3, 3, 'string']],
    )
    const queue = async (status: string | null, client = publisher) =>
      call('website_form.listSubmissions', { formId: 'form-booking', status, limit: 50, offset: 0 }, client)
    const all = await queue(null, reader)
    assert.equal(all.total, 3)
    // Names are public, phone numbers are not: the queue carries one and never the other.
    assert.deepEqual((all.rows as Row[]).map((r) => r.summary).sort(), ['=1+1', 'An', 'Chi'])
    assert.doesNotMatch(JSON.stringify(all.rows), /0901/)
    assert.deepEqual(
      [...new Set((all.rows as Row[]).map((r) => `${r.status}/${r.deliveryState}`))],
      ['new/mail'],
    )
    const byName = Object.fromEntries((all.rows as Row[]).map((r) => [r.summary, r.id]))

    // Reading answers is for publishers.
    assert.equal(
      (await send(reader, 'website_studio.submissionDetail', { siteId: 'site-a', id: byName.An })).status,
      403,
    )
    assert.equal((await send(editor, 'website_form.readSubmission', { id: byName.An })).status, 403)
    assert.equal(
      (await send(publisher, 'website_studio.submissionDetail', { siteId: 'site-a2', id: byName.An })).status,
      404,
    )
    const detail = await call('website_studio.submissionDetail', { siteId: 'site-a', id: byName.An })
    assert.deepEqual((detail.submission as Row).fields, { name: 'An', phone: '0901000001' })
    assert.deepEqual(detail.labels, { name: 'Họ tên', phone: 'Điện thoại' })
    assert.equal((detail.submission as Row).formRevisionId, 'v1')
    assert.deepEqual(
      ((detail.submission as Row).audit as Row[]).map((a) => a.action),
      ['read', 'received'],
    )
    assert.equal((await queue('new')).total, 2, 'opening it took it off the new pile')

    assert.equal(
      (await send(editor, 'website_form.holdSubmission', { id: byName.Chi, reason: 'studio' })).status,
      403,
    )
    await call('website_form.holdSubmission', { id: byName.Chi, reason: 'studio' })
    const held = await queue('held')
    assert.deepEqual(
      (held.rows as Row[]).map((r) => [r.summary, r.status, r.retentionUntil]),
      [['Chi', 'held', null]],
    )
    assert.equal((await queue('new')).total, 1)

    assert.equal(
      (await send(editor, 'website_form.exportSubmissions', { formId: 'form-booking' })).status,
      403,
    )
    const file = await call('website_form.exportSubmissions', { formId: 'form-booking' })
    assert.match(String(file.filename), /^Dat-ban-\d{4}-\d{2}-\d{2}\.csv$/)
    const lines = String(file.content).split('\r\n')
    assert.equal(lines[0], '﻿Mã,Nhận lúc,Trạng thái,Họ tên,Số điện thoại')
    assert.equal(lines.length, 4)
    // A visitor's answer that a spreadsheet would run as a formula arrives as text.
    assert.ok(
      lines.some((line) => line.endsWith(",'=1+1,0901000002")),
      lines.join('\n'),
    )

    // Its record shows its own reads, not the hold on another row or the export of the whole form.
    const again = await call('website_studio.submissionDetail', { siteId: 'site-a', id: byName.An })
    assert.deepEqual(
      ((again.submission as Row).audit as Row[]).map((a) => a.action),
      ['read', 'read', 'received'],
    )

    const overview = await call('website_studio.overview', { siteId: 'site-a' })
    assert.equal((overview.counts as Row).newSubmissions, 1)
    assert.deepEqual(
      (overview.submissions as Row[]).map((r) => [r.summary, r.formTitle]),
      [['=1+1', 'Đặt bàn']],
    )

    // A form that keeps answers for a set time says when each one goes.
    await fixture('website_form.saveForm', {
      id: 'form-booking',
      siteId: 'site-a',
      name: 'Đặt bàn',
      schema: { fields: [field('name', 'Họ tên', 'public'), field('phone', 'Số điện thoại', 'personal')] },
      successMessage: 'Đã nhận.',
      retentionDays: 30,
    })
    const kept = (await queue(null)).rows as Row[]
    for (const r of kept)
      assert.equal(
        r.retentionUntil,
        r.status === 'held'
          ? null
          : new Date(new Date(String(r.createdAt)).getTime() + 30 * 86_400_000).toISOString(),
      )
  } finally {
    await app.close()
  }
})
