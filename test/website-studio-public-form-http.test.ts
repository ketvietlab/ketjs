import assert from 'node:assert/strict'
import { request } from 'node:http'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

const field = (name: string, label: string, type: string, required: boolean) => ({
  id: `row-${name}`,
  name,
  label,
  type,
  required,
  maxLength: type === 'textarea' ? 2000 : 120,
  classification: 'public',
})

/**
 * A form placed on a published page reaches visitors as a plain HTML form: it posts to
 * `/forms/{id}` without JavaScript, a refused post comes back with the answers kept and each
 * problem beside its field, and an accepted one lands on a receipt only the same site answers.
 * The Studio preview checks an answer against the same saved form but keeps nothing.
 */
test('Studio public form: the section, the post, the receipt and the preview check', async (t) => {
  const { app, fixture } = await bootWebsiteStudio()
  t.after(() => app.close())
  for (const [id, siteId, host] of [
    ['form-domain-a', 'site-a', '127.0.0.1'],
    ['form-domain-a2', 'site-a2', 'site-a2.test'],
  ])
    await fixture('website.saveDomain', { id, siteId, host, primary: true })
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
  const saveForm = (siteId: string, id: string, title: string, active: string) =>
    call(
      'website_studio.saveResource',
      {
        siteId,
        kind: 'form-editor',
        id,
        expectedRevisionId: null,
        values: {
          title,
          schema: {
            fields: [
              field('name', 'Họ tên', 'text', true),
              field('note', 'Ghi chú', 'textarea', false),
              field('news', 'Nhận tin', 'checkbox', false),
            ],
          },
          recipient: '',
          successMessage: 'Đã nhận, hẹn gặp bạn.',
          consentLabel: 'Tôi đồng ý cho liên hệ lại',
          spamProtection: 'honeypot',
          active,
        },
      },
      editor,
    )
  await saveForm('site-a', 'form-booking', 'Đặt bàn', 'yes')
  await saveForm('site-a', 'form-closed', 'Nhận tin', 'no')
  await saveForm('site-a2', 'form-other', 'Đặt bàn', 'yes')
  const publish = async (id: string) => {
    const entry = (await call('website.getEntry', { id })).entry as Row
    await call('website.publishEntry', { id, expectedRevisionId: entry.revisionId })
  }
  await publish('page-site-a')
  await publish('page-site-a2')
  await call('website.saveEntry', {
    id: 'lien-he',
    siteId: 'site-a',
    type: 'page',
    title: 'Liên hệ',
    path: '/lien-he',
    expectedRevisionId: null,
    layout: [
      {
        id: 'contact-form',
        type: 'website_form.form',
        settings: { formId: 'form-booking', heading: 'Giữ bàn tối nay' },
      },
      { id: 'closed-form', type: 'website_form.form', settings: { formId: 'form-closed' } },
      // Another site's form is never drawn here, whatever the setting says.
      { id: 'foreign-form', type: 'website_form.form', settings: { formId: 'form-other' } },
    ],
  })
  await publish('lien-he')

  let agent = 0
  const visitor = app.client.anonymous()
  // The hydration markers sit between every tag and say nothing about the page.
  const bare = async (response: Response) => (await response.text()).replace(/<!--k\[?-->/g, '')
  const get = async (path: string) => {
    const response = await visitor.get(path)
    return { status: response.status, body: await bare(response) }
  }
  // Fetch will not send a Host of the caller's choosing; another site's host needs a plain request.
  const statusOn = (host: string, path: string) =>
    new Promise<number | undefined>((resolve, reject) => {
      request(new URL(path, visitor.baseUrl), { headers: { host } }, (response) => {
        response.resume()
        resolve(response.statusCode)
      })
        .on('error', reject)
        .end()
    })
  const post = async (path: string, values: Record<string, string>, headers: Record<string, string> = {}) => {
    agent += 1
    const response = await visitor.post(path, new URLSearchParams(values).toString(), {
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': `visitor-${agent}`,
        ...headers,
      },
    })
    return { status: response.status, location: response.headers.get('location'), body: await bare(response) }
  }
  const submissions = async () =>
    ((await call('website_form.listForms', { siteId: 'site-a' })).rows as Row[]).find(
      (form) => form.id === 'form-booking',
    )?.total

  // The section on a published page: the declared fields, the version and a fresh key.
  const page = await get('/lien-he')
  assert.equal(page.status, 200)
  assert.match(page.body, /<form class="wt-form__body" method="post" action="\/forms\/form-booking">/)
  assert.match(page.body, /<h2 class="wt-text__title" id="wt-form-contact-form-title">Giữ bàn tối nay<\/h2>/)
  assert.match(page.body, /<input type="hidden" name="_schemaVersion" value="1"/)
  const key = page.body.match(/name="submissionKey" value="([^"]+)"/)?.[1]
  assert.ok(key)
  assert.match(
    page.body,
    /<input type="text" id="wt-form-contact-form-name" name="name"[^>]*maxlength="120"[^>]*required=""/,
  )
  assert.match(page.body, /<textarea id="wt-form-contact-form-note" name="note"/)
  assert.match(page.body, /type="checkbox" id="wt-form-contact-form-news" name="news"/)
  assert.match(page.body, /name="consent"[^>]*required=""/)
  assert.match(page.body, /name="honeypot" tabindex="-1"/)
  // A closed form and another site's form draw nothing for visitors.
  assert.doesNotMatch(page.body, /form-closed|form-other|wt-unknown/)
  assert.equal(page.body.match(/<section class="wt-form"/g)?.length, 1)

  // The form's own page is not indexed, and a closed form has none.
  const own = await get('/forms/form-booking')
  assert.equal(own.status, 200)
  assert.match(own.body, /<h1 class="wt-text__title"[^>]*>Đặt bàn<\/h1>/)
  assert.match(own.body, /<meta name="robots" content="noindex">/)
  assert.equal((await get('/forms/form-closed')).status, 404)
  assert.equal((await get('/forms/form-other')).status, 404)

  // A refused post: the answers stay, each problem sits beside its field, nothing is kept.
  const refused = await post('/forms/form-booking', {
    name: '',
    note: 'Bàn gần cửa sổ',
    news: 'on',
    consent: 'on',
    _schemaVersion: '1',
  })
  assert.equal(refused.status, 422)
  assert.match(refused.body, /name="note"[^>]*>Bàn gần cửa sổ<\/textarea>/)
  assert.match(refused.body, /name="news"[^>]*checked=""/)
  assert.match(refused.body, /name="name"[^>]*aria-invalid="true" aria-describedby="wt-form-form-name-error"/)
  assert.match(refused.body, /id="wt-form-form-name-error">[^<]+<\/small>/)
  assert.doesNotMatch(refused.body, /wt-form-form-consent-error|wt-form-form-note-error/)
  assert.match(refused.body, /name="consent"[^>]*checked=""/)
  // Agreement is asked for before the answers are read.
  const unagreed = await post('/forms/form-booking', { name: 'An', _schemaVersion: '1' })
  assert.equal(unagreed.status, 422)
  assert.match(unagreed.body, /id="wt-form-form-consent-error">[^<]+<\/small>/)
  assert.match(unagreed.body, /name="name" value="An"/)
  assert.match(refused.body, /role="alert">Vui lòng kiểm tra lại các ô được đánh dấu\.<\/p>/)
  assert.equal(await submissions(), 0)

  // A post against an older version of the form is answered with the current one.
  const stale = await post('/forms/form-booking', { name: 'An', consent: 'on', _schemaVersion: '9' })
  assert.equal(stale.status, 409)
  assert.match(stale.body, /name="name" value="An"/)
  // A post from another origin, and one to a form the site does not serve, are refused outright.
  assert.equal(
    (await post('/forms/form-booking', { name: 'An', consent: 'on' }, { origin: 'https://elsewhere.test' }))
      .status,
    403,
  )
  assert.equal((await post('/forms/form-closed', { name: 'An', consent: 'on' })).status, 404)
  // A filled honeypot is thanked like anyone and kept as nothing.
  const robot = await post('/forms/form-booking', {
    name: 'Bot',
    consent: 'on',
    honeypot: 'x',
    _schemaVersion: '1',
  })
  assert.equal(robot.status, 200)
  assert.match(robot.body, /role="status">Đã nhận, hẹn gặp bạn\.<\/p>/)
  assert.doesNotMatch(robot.body, /Mã biên nhận/)
  assert.equal(await submissions(), 0)

  // An accepted post lands on its receipt, and posting the same key again lands on the same one.
  const accepted = await post('/forms/form-booking', {
    name: 'An',
    news: 'on',
    consent: 'on',
    _schemaVersion: '1',
    submissionKey: key,
  })
  assert.equal(accepted.status, 303)
  const id = accepted.location?.match(/^\/forms\/receipt\/([A-Za-z0-9-]+)$/)?.[1]
  assert.ok(id, String(accepted.location))
  const again = await post('/forms/form-booking', {
    name: 'An',
    consent: 'on',
    _schemaVersion: '1',
    submissionKey: key,
  })
  assert.equal(again.location, accepted.location)
  assert.equal(await submissions(), 1)
  const receipt = await get(`/forms/receipt/${id}`)
  assert.equal(receipt.status, 200)
  assert.match(receipt.body, /<p role="status">Đã nhận, hẹn gặp bạn\.<\/p>/)
  assert.match(receipt.body, new RegExp(`<dd><code>${id}</code></dd>`))
  assert.match(receipt.body, /<time datetime="\d{4}-\d{2}-\d{2}T[^"]+">/)
  assert.match(receipt.body, /<meta name="robots" content="noindex">/)
  // A receipt is answered only on the site that took the post.
  assert.equal(await statusOn('site-a2.test', '/'), 200)
  assert.equal(await statusOn('site-a2.test', `/forms/receipt/${id}`), 404)
  assert.equal((await get('/forms/receipt/not-a-submission')).status, 404)
  assert.equal((await get('/forms/receipt/..%2Fetc')).status, 404)

  // The Studio's receipt check and preview: same site only, and a preview keeps nothing.
  assert.deepEqual(await call('website_studio.submissionReceipt', { siteId: 'site-a', id }), {
    receipt: id,
    createdAt: (await call('website_studio.submissionReceipt', { siteId: 'site-a', id })).createdAt,
    state: 'received',
  })
  assert.equal(
    (await send(publisher, 'website_studio.submissionReceipt', { siteId: 'site-a2', id })).status,
    404,
  )
  const preview = (await call(
    'website_studio.visitorForm',
    { siteId: 'site-a', id: 'form-booking' },
    reader,
  )) as Row
  assert.deepEqual(
    (preview.fields as Row[]).map((f) => [f.name, f.type, f.required]),
    [
      ['name', 'text', true],
      ['note', 'textarea', false],
      ['news', 'checkbox', false],
    ],
  )
  assert.equal((preview.form as Row).consentLabel, 'Tôi đồng ý cho liên hệ lại')
  const check = (input: Row, client = reader) =>
    send(client, 'website_studio.submitVisitorForm', { siteId: 'site-a', formId: 'form-booking', ...input })
  const missing = await check({ fields: { name: '' }, consent: false })
  assert.equal(missing.status, 400)
  assert.match(String(missing.message), /^Đồng ý: .+ · Họ tên: .+$/)
  const passed = await check({ fields: { name: 'An', news: 'on' }, consent: true })
  assert.equal(passed.status, 200, JSON.stringify(passed))
  assert.deepEqual(passed.value, { preview: true })
  assert.equal(await submissions(), 1)
  // A closed form refuses even a complete answer.
  const closed = await check({ formId: 'form-closed', fields: { name: 'An' }, consent: true })
  assert.equal(closed.status, 400)
  assert.equal(closed.message, 'Biểu mẫu hiện không khả dụng.')
})
