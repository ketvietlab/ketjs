import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, createQueue } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { address, partner, website, websiteForm } from '@ketvietlab/ketsuite'
import { leadOf } from '../packages/ketsuite/src/modules/crm_website/form-delivery.ts'
import { destinationsOf } from '../packages/ketsuite/src/modules/website_form/delivery.ts'
import { bootWebsiteStudio } from './fixtures/website-studio.ts'

const field = (name: string, label: string, type: string, required: boolean) => ({
  id: `row-${name}`,
  name,
  label,
  type,
  required,
  maxLength: type === 'textarea' ? 2000 : 120,
  classification: 'personal',
})

test('form routing: the visitor answers become a lead, labelled as the visitor read them', () => {
  const schema = {
    fields: [
      field('hoTen', 'Họ tên', 'text', true),
      field('so', 'Số điện thoại', 'tel', false),
      field('thu', 'Email', 'email', false),
      field('ghiChu', 'Ghi chú', 'textarea', false),
      field('nhanTin', 'Nhận tin', 'checkbox', false),
    ],
  }
  const lead = leadOf({ name: 'Tư vấn' }, schema, {
    hoTen: ' An ',
    so: '0903 112 233',
    thu: 'an@example.test',
    ghiChu: 'Da khô',
    nhanTin: true,
  })
  assert.deepEqual(lead, {
    name: 'Tư vấn: An',
    contactName: 'An',
    email: 'an@example.test',
    phone: '0903 112 233',
    description:
      'Họ tên: An\nSố điện thoại: 0903 112 233\nEmail: an@example.test\nGhi chú: Da khô\nNhận tin: Có',
    utmSource: 'website',
    utmMedium: 'form',
    utmCampaign: 'Tư vấn',
  })
  // Without a field named like a person, the first required text answer names them; an unticked box says so.
  const plain = leadOf(
    { name: 'Báo giá' },
    { fields: [field('cty', 'Công ty', 'text', true), field('ok', 'Đã có tài khoản', 'checkbox', false)] },
    { cty: 'Lam Sơn', ok: false },
  )
  assert.equal(plain.name, 'Báo giá: Lam Sơn')
  assert.equal(plain.description, 'Công ty: Lam Sơn\nĐã có tài khoản: Không')
  assert.equal(plain.email, null)
  assert.equal(plain.phone, null)
})

test('form routing: only a composed receiver is a destination', () => {
  const bare = compose([address, partner, website, websiteForm], { headless: true })
  assert.deepEqual(destinationsOf(bare), [])
})

/**
 * A form routed to CRM: the Website keeps its copy, a pass turns it into a lead, and later passes
 * report where the lead stands. A failed hand-off waits for a person to send it again.
 */
test('form routing: submissions reach CRM, report its status back, and can be sent again', async (t) => {
  const { app, fixture, revision } = await bootWebsiteStudio(undefined, { worker: true })
  t.after(() => app.close())
  const login = async (name: string) => {
    const client = app.client.anonymous()
    await client.login({ login: `studio-${name}`, password: 'studio-local' })
    return client
  }
  const editor = await login('editor')
  const publisher = await login('publisher')
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
  const values = (title: string, fields: unknown[], destination?: string) => ({
    title,
    schema: { fields },
    recipient: '',
    successMessage: 'Đã nhận.',
    consentLabel: '',
    spamProtection: 'honeypot',
    active: 'yes',
    ...(destination === undefined ? {} : { destination }),
  })
  const save = (id: string, v: Row, expectedRevisionId: string | null = null) =>
    send(editor, 'website_studio.saveResource', {
      siteId: 'site-a',
      kind: 'form-editor',
      id,
      expectedRevisionId,
      values: v,
    })
  const contact = [
    field('name', 'Họ tên', 'text', true),
    field('phone', 'Điện thoại', 'tel', false),
    field('note', 'Nhu cầu', 'textarea', false),
  ]
  assert.equal((await save('form-contact', values('Tư vấn', contact, 'crm_website'))).status, 200)
  assert.equal(
    (await save('form-nocontact', values('Góp ý', [field('note', 'Góp ý', 'textarea', true)], 'crm_website')))
      .status,
    200,
  )
  assert.equal((await save('form-plain', values('Nhận tin', contact))).status, 200)
  // A receiver this deployment does not compose is refused, not stored to wait for ever.
  const unknown = await save('form-unknown', values('Lạ', contact, 'sale'))
  assert.equal(unknown.status, 400, JSON.stringify(unknown))
  assert.match(String(unknown.message), /Nơi nhận phản hồi này không có trong hệ thống/)

  const detail = await call(
    'website_studio.getResource',
    { siteId: 'site-a', kind: 'form-editor', id: 'form-contact' },
    editor,
  )
  assert.equal(detail.destination, 'crm_website')
  assert.deepEqual(detail.destinations, [{ value: 'crm_website', label: 'CRM · khách tiềm năng' }])
  // A save that does not mention the destination leaves it where it was.
  assert.equal((await save('form-contact', values('Tư vấn', contact), String(detail.revisionId))).status, 200)
  assert.equal(
    (
      await call(
        'website_studio.getResource',
        { siteId: 'site-a', kind: 'form-editor', id: 'form-contact' },
        editor,
      )
    ).destination,
    'crm_website',
  )

  const submit = async (formId: string, payload: Row, key: string, rateKey?: string) => {
    const result = await fixture('website_form.submitForm', {
      formId,
      payload,
      schemaVersion: 1,
      submissionKey: key,
      rateKey,
    })
    assert.equal(result.ok, true, JSON.stringify(result))
    return String(result.id)
  }
  const routed = await submit(
    'form-contact',
    { name: 'Nguyễn An', phone: '0903 112 233', note: 'Tư vấn da' },
    'k1',
  )
  const silent = await submit('form-nocontact', { note: 'Quán đẹp' }, 'k2')
  const kept = await submit('form-plain', { name: 'Bình', phone: '0909', note: '' }, 'k3')

  const rowOf = async (formId: string, id: string) =>
    ((await call('website_form.listSubmissions', { siteId: 'site-a', formId })).rows as Row[]).find(
      (r) => r.id === id,
    )!
  assert.equal((await rowOf('form-contact', routed)).destinationState, 'pending')
  assert.equal((await rowOf('form-plain', kept)).destinationState, null)

  const sweep = async () => {
    await app.fixture.withTenant('', async (tenant) => {
      const queue = await createQueue(tenant.adapter)
      await queue.enqueue('crm_website.deliverFormSubmissions', {}, { queue: 'default', maxAttempts: 1 })
    })
    await app.drainJobs()
  }
  // A pass for one company, as the sweep queues it; a second sweep in the same minute would be collapsed.
  const pass = async () => {
    await app.fixture.withTenant('', async (tenant) => {
      const queue = await createQueue(tenant.adapter)
      await queue.enqueue(
        'crm_website.routeFormSubmissions',
        {},
        { queue: 'default', maxAttempts: 1, scope: { company: 'studio-a' } },
      )
    })
    await app.drainJobs()
  }
  await sweep()
  const passes = app.records.of('job_completed').filter((r) => r.fn === 'crm_website.routeFormSubmissions')
  assert.equal(passes.length, 1, 'one pass, for the one company with a routed form')

  const delivered = await rowOf('form-contact', routed)
  assert.equal(delivered.destinationState, 'delivered')
  assert.equal(delivered.destinationOutcome, 'open')
  assert.ok(delivered.destinationStatus, 'the stage the lead entered')
  assert.equal((await rowOf('form-plain', kept)).destinationState, null)

  const opened = await call('website_studio.submissionDetail', { siteId: 'site-a', id: routed })
  const destination = (opened.submission as Row).destination as Row
  assert.equal(destination.title, 'CRM · khách tiềm năng')
  assert.equal(destination.state, 'delivered')
  assert.equal(destination.error, null)
  assert.equal(destination.attempts, 1)
  // The publisher has no CRM rights: a link to the lead would only open a refusal.
  assert.equal(destination.href, null)
  // CRM's own screens are not under test here; its record is read and moved as CRM stores it.
  const sql = (query: string, params: unknown[]) =>
    app.fixture.withTenant('', (tenant) => tenant.adapter.all(query, params))
  const [stored] = await sql(
    'SELECT "deliveryRef", "deliveryHref" FROM website_form_form_submission WHERE id = ?',
    [routed],
  )
  const caseId = String(stored.deliveryRef)
  assert.match(caseId, /^website-lead:[0-9a-f]{32}$/)
  assert.equal(stored.deliveryHref, `/admin/crm/cases/${encodeURIComponent(caseId)}`)
  // Once they may read CRM cases, the way there is shown.
  await fixture('user.applyRoleTemplate', {
    roleId: 'studio-crm-reader',
    templateKey: 'office.tenant-auditor',
    expectedRoleRevision: 0,
    expectedAuthorizationRevision: await revision(),
    idempotencyKey: 'apply-crm-reader',
  })
  await fixture('user.assignScopedRole', {
    id: 'publisher-crm',
    userId: 'studio-publisher',
    roleId: 'studio-crm-reader',
    scopeKind: 'company',
    companyId: 'studio-a',
    expectedAuthorizationRevision: await revision(),
    idempotencyKey: 'publisher-crm',
  })
  const crmReader = await login('publisher')
  const shown = (await call('website_studio.submissionDetail', { siteId: 'site-a', id: routed }, crmReader))
    .submission as Row
  assert.equal((shown.destination as Row).href, stored.deliveryHref)
  const [lead] = await sql('SELECT * FROM crm_case WHERE id = ?', [caseId])
  assert.ok(lead, 'the lead exists in CRM')
  assert.equal(lead.kind, 'lead')
  assert.equal(lead.companyId, 'studio-a')
  assert.equal(lead.name, 'Tư vấn: Nguyễn An')
  assert.equal(lead.phone, '0903 112 233')
  assert.equal(lead.description, 'Họ tên: Nguyễn An\nĐiện thoại: 0903 112 233\nNhu cầu: Tư vấn da')
  assert.equal(lead.utmSource, 'website')
  const [entered] = await sql('SELECT name FROM crm_stage WHERE id = ?', [lead.stageId])
  assert.equal(delivered.destinationStatus, entered?.name)

  // CRM moves the lead on; the next pass says so beside the Website's copy.
  const [next] = await sql(
    'SELECT id, name FROM crm_stage WHERE "companyId" = ? AND id <> ? AND name <> ? LIMIT 1',
    ['studio-a', String(lead.stageId), String(entered?.name)],
  )
  assert.ok(next, 'another stage to move to')
  await sql('UPDATE crm_case SET "stageId" = ? WHERE id = ?', [next.id, caseId])
  await pass()
  assert.equal((await rowOf('form-contact', routed)).destinationStatus, next.name)
  await sql('UPDATE crm_case SET "terminalState" = ? WHERE id = ?', ['lost', caseId])
  await pass()
  const lost = await rowOf('form-contact', routed)
  assert.equal(lost.destinationOutcome, 'lost')
  // A closed lead leaves the rotation: CRM changing it again is no longer looked for.
  await sql('UPDATE crm_case SET "terminalState" = ? WHERE id = ?', ['won', caseId])
  await pass()
  assert.equal((await rowOf('form-contact', routed)).destinationOutcome, 'lost')

  // A pass that died after CRM saved the lead hands the same submission over again and finds that lead.
  await app.fixture.withTenant('', (tenant) =>
    tenant.adapter.run('UPDATE website_form_form_submission SET "deliveryState" = ? WHERE id = ?', [
      'pending',
      routed,
    ]),
  )
  await pass()
  assert.equal((await rowOf('form-contact', routed)).destinationState, 'delivered')
  const leads = await app.fixture.withTenant('', (tenant) =>
    tenant.adapter.all('SELECT id FROM crm_case WHERE "utmMedium" = ?', ['form']),
  )
  assert.deepEqual(
    leads.map((r) => r.id),
    [caseId],
  )

  // CRM cannot reach a person with no email or phone; the copy says why, in staff terms.
  const failed = await rowOf('form-nocontact', silent)
  assert.equal(failed.destinationState, 'failed')
  const why = (
    (await call('website_studio.submissionDetail', { siteId: 'site-a', id: silent })).submission as Row
  ).destination as Row
  assert.equal(why.error, 'Phản hồi không có email hay số điện thoại nên CRM không tạo được khách tiềm năng.')

  // Sending again is the publisher's, on a failed hand-off only, and leaves a line in the record.
  assert.equal(
    (await send(editor, 'website_form.retryDelivery', { siteId: 'site-a', id: silent })).status,
    403,
  )
  assert.equal(
    (await send(publisher, 'website_form.retryDelivery', { siteId: 'site-a2', id: silent })).status,
    400,
  )
  const notRetryable = await send(publisher, 'website_form.retryDelivery', { siteId: 'site-a', id: routed })
  assert.equal(notRetryable.status, 400)
  assert.match(String(notRetryable.message), /Chỉ gửi lại được phản hồi chuyển không thành công/)
  assert.deepEqual(await call('website_form.retryDelivery', { siteId: 'site-a', id: silent }), {
    ok: true,
    state: 'pending',
  })
  const retried = (await call('website_studio.submissionDetail', { siteId: 'site-a', id: silent }))
    .submission as Row
  assert.equal((retried.destination as Row).state, 'pending')
  assert.equal((retried.destination as Row).error, null)
  assert.ok((retried.audit as Row[]).some((a) => a.action === 'retry'))

  // Twelve visitors in one hour, each within the Website's limit. CRM's limit on its own public form
  // would see them all arrive from the worker as one source, and fail most of them.
  const busy = []
  for (let i = 0; i < 12; i += 1)
    busy.push(
      await submit(
        'form-contact',
        { name: `Khách ${i}`, phone: `0903 000 0${String(i).padStart(2, '0')}` },
        `b${i}`,
        `visitor-${i}`,
      ),
    )
  await pass()
  const states = await Promise.all(busy.map(async (id) => (await rowOf('form-contact', id)).destinationState))
  assert.deepEqual(new Set(states), new Set(['delivered']))
})
