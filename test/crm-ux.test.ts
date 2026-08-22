import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestApp } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/app.ts'

const form = { 'content-type': 'application/x-www-form-urlencoded' }
const post = { headers: form, redirect: 'manual' as const }

const boot = async (t: TestContext) => {
  const app = await createTestApp(ketsuite)
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', {
    id: 'customer',
    kind: 'person',
    name: 'Nguyễn Minh',
    email: 'minh@example.test',
  })
  await fixture('company.saveCompany', { id: 'acme', code: 'ACME', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    partnerId: 'customer',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  const call = async <T = Row>(name: string, input: Record<string, unknown> = {}) =>
    (await app.client.call<T>(name, input)).value
  await call('crm.bootstrap.defaults', { idempotencyKey: 'crm-defaults' })
  return { app, call, fixture }
}

test('crm: a case that reaches a terminal state records when it closed', async (t) => {
  const { call } = await boot(t)
  await call('crm.case.save', {
    id: 'closing',
    kind: 'opportunity',
    name: 'Closing opportunity',
    partnerId: 'customer',
    idempotencyKey: 'save-closing-01',
  })
  let row = await call<Row>('crm.case.get', { id: 'closing' })
  assert.equal(row.closedAt, null)

  const won = await call<Row>('crm.case.markWon', {
    id: 'closing',
    expectedVersion: row.version,
    idempotencyKey: 'won-closing-01',
  })
  assert.equal(won.ok, true)
  row = await call<Row>('crm.case.get', { id: 'closing' })
  assert.equal(row.terminalState, 'won')
  assert.ok(row.closedAt, 'a won case carries a closing date')

  // Pulling it back into the pipeline clears the date again.
  const reopened = await call<Row>('crm.case.move', {
    id: 'closing',
    stageId: 'crm-stage-qualified',
    expectedVersion: row.version,
    idempotencyKey: 'reopen-closing-1',
  })
  assert.equal(reopened.ok, true)
  assert.equal((await call<Row>('crm.case.get', { id: 'closing' })).closedAt, null)
})

test('crm: duplicate detection reaches past the list page size', async (t) => {
  const { call } = await boot(t)
  for (let index = 0; index < 210; index += 1)
    await call('crm.case.save', {
      id: `bulk-${index}`,
      kind: 'lead',
      name: `Bulk ${index}`,
      email: 'dupe@example.test',
      idempotencyKey: `bulk-key-${index}-aaaa`,
    })
  const found = await call<Row>('crm.case.detectDuplicates', { email: 'dupe@example.test', limit: 100 })
  const rows = found.rows as Row[]
  assert.equal(rows.length, 100, 'the caller-supplied limit is honoured, not silently capped at 200 rows')
  assert.ok(rows.every((row) => row.email === 'dupe@example.test'))

  // The same number written with different spacing is one number. A different
  // country-code form is not: normalising `+84…` to `0…` is a dialling-plan
  // question this module has no business answering.
  await call('crm.case.save', {
    id: 'phone-a',
    kind: 'lead',
    name: 'Phone A',
    phone: '090 123 4567',
    idempotencyKey: 'phone-key-aaaa1',
  })
  const byPhone = (await call<Row>('crm.case.detectDuplicates', { phone: '0901234567' })).rows as Row[]
  assert.equal(
    byPhone.some((row) => row.id === 'phone-a'),
    true,
  )
})

test('crm: merging carries the whole record and refuses a second pass', async (t) => {
  const { call } = await boot(t)
  await call('crm.tag.save', { id: 'tag-hot', name: 'Hot' })
  for (const id of ['merge-target', 'merge-source'])
    await call('crm.case.save', {
      id,
      kind: 'lead',
      name: `Record ${id}`,
      email: 'same@example.test',
      idempotencyKey: `save-${id}-01`,
    })
  await call('crm.case.save', {
    id: 'merge-source',
    kind: 'lead',
    name: 'Record merge-source',
    email: 'same@example.test',
    tagIds: ['tag-hot'],
    idempotencyKey: 'save-merge-source-02',
  })
  await call('crm.case.addMessage', {
    id: 'note-1',
    caseId: 'merge-source',
    body: 'Called them back',
    visibility: 'internal',
    idempotencyKey: 'note-key-000001',
  })
  const target = await call<Row>('crm.case.get', { id: 'merge-target' })
  const merged = await call<Row>('crm.case.merge', {
    targetId: 'merge-target',
    sourceId: 'merge-source',
    expectedTargetVersion: target.version,
    idempotencyKey: 'merge-key-00001',
  })
  assert.equal(merged.ok, true)

  const after = await call<Row>('crm.case.get', { id: 'merge-target' })
  assert.equal((after.messages as Row[]).length, 1, 'notes move with the record')
  assert.equal((after.tags as Row[]).length, 1, 'tags move with the record')
  assert.equal(
    (after.timeline as Row[]).some((entry) => entry.eventType === 'merged'),
    true,
  )
  // The source's own history came across rather than staying on an archived row.
  assert.equal((after.timeline as Row[]).filter((entry) => entry.eventType === 'created').length, 2)
  const again = await call<Row>('crm.case.merge', {
    targetId: 'merge-target',
    sourceId: 'merge-source',
    expectedTargetVersion: after.version,
    idempotencyKey: 'merge-key-00002',
  })
  assert.equal(again.ok, false)
  assert.equal((again.errors as Row[])[0]?.code, 'crm.error.alreadyMerged')
})

test('crm backend: the case workspace exposes assign, merge and a lost reason', async (t) => {
  const { app, call } = await boot(t)
  await call('crm.case.save', {
    id: 'workspace',
    kind: 'opportunity',
    name: 'Workspace opportunity',
    partnerId: 'customer',
    email: 'twin@example.test',
    idempotencyKey: 'save-workspace-1',
  })
  await call('crm.case.save', {
    id: 'workspace-twin',
    kind: 'opportunity',
    name: 'Workspace twin',
    partnerId: 'customer',
    email: 'twin@example.test',
    idempotencyKey: 'save-twin-0001',
  })
  const page = await app.client.get('/admin/crm/cases/workspace?lang=en')
  const html = await page.text()
  assert.equal(page.status, 200)
  // Relational fields render as pickers, not as selects carrying every row.
  assert.match(html, /data-ui="relation-select"/)
  assert.doesNotMatch(html, /<select[^>]*name="partnerId"[^>]*>\s*<option[^>]*>—/)
  // Three controls the routes have always accepted and no screen ever offered.
  assert.match(html, /name="action" value="assign"/)
  assert.match(html, /name="action" value="merge"/)
  assert.match(html, /name="lostReason"/)
  // Duplicate detection has always run here; now it renders what it found.
  assert.match(html, /Possible duplicates/)
  assert.match(html, /Workspace twin/)

  // Assignment is restricted to the team, which is why the membership has to
  // exist before the picker's choice is accepted.
  await call('crm.team.member.save', {
    id: 'member-admin',
    teamId: 'crm-team-sales',
    userId: 'admin',
    idempotencyKey: 'member-key-00001',
  })
  const workspaceRow = await call<Row>('crm.case.get', { id: 'workspace' })
  const assigned = await app.client.post(
    '/admin/crm/cases/workspace?lang=en',
    new URLSearchParams({
      action: 'assign',
      assigneeUserId: 'admin',
      expectedVersion: String(workspaceRow.version),
    }),
    post,
  )
  assert.equal(assigned.status, 303)
  assert.equal((await call<Row>('crm.case.get', { id: 'workspace' })).assigneeUserId, 'admin')

  const held = await call<Row>('crm.case.get', { id: 'workspace' })
  const lost = await app.client.post(
    '/admin/crm/cases/workspace?lang=en',
    new URLSearchParams({
      action: 'lost',
      lostReason: 'Chose a competitor',
      expectedVersion: String(held.version),
    }),
    post,
  )
  assert.equal(lost.status, 303)
  const closed = await call<Row>('crm.case.get', { id: 'workspace' })
  assert.equal(closed.terminalState, 'lost')
  assert.equal(
    (closed.salesDetail as Row).lostReason,
    'Chose a competitor',
    'the reason the user typed is stored, not "not_specified"',
  )
})

test('crm backend: the timeline reads as words, not as message keys', async (t) => {
  const { app, call } = await boot(t)
  await call('crm.case.save', {
    id: 'readable',
    kind: 'lead',
    name: 'Readable record',
    partnerId: 'customer',
    idempotencyKey: 'save-readable-1',
  })
  const page = await app.client.get('/admin/crm/cases/readable?tab=timeline&lang=en')
  const html = await page.text()
  assert.match(html, /Record created/)
  assert.doesNotMatch(html.replace(/<[^>]*>/g, ' '), /crm\.timeline\./)
})

test('crm backend: an activity can be completed from the case and from the planner', async (t) => {
  const { app, call } = await boot(t)
  await call('crm.case.save', {
    id: 'follow-up',
    kind: 'lead',
    name: 'Follow up record',
    partnerId: 'customer',
    assigneeUserId: 'admin',
    idempotencyKey: 'save-followup-1',
  })
  const scheduled = await call<Row>('crm.activity.schedule', {
    id: 'activity-1',
    caseId: 'follow-up',
    summary: 'Call the buyer',
    dueDate: '2026-09-01',
    idempotencyKey: 'schedule-key-01',
  })
  assert.equal(scheduled.ok, true)

  const casePage = await app.client.get('/admin/crm/cases/follow-up?tab=activities&lang=en')
  const caseHtml = await casePage.text()
  assert.match(caseHtml, /Call the buyer/, 'the case lists the activities it owns')
  assert.match(caseHtml, /name="action" value="completeActivity"/)

  const planner = await app.client.get('/admin/crm/activities?tab=mine&lang=en')
  assert.match(await planner.text(), /name="action" value="complete"/)

  const completed = await app.client.post(
    '/admin/crm/cases/follow-up?tab=activities&lang=en',
    new URLSearchParams({ action: 'completeActivity', activityId: 'activity-1' }),
    post,
  )
  assert.equal(completed.status, 303)
  const row = await call<Row>('crm.case.get', { id: 'follow-up' })
  assert.equal(
    (row.activities as Row[]).every((item) => item.doneAt),
    true,
  )
})

test('crm backend: configuration records can be edited and archived, not only created', async (t) => {
  const { app, call } = await boot(t)
  const created = await app.client.post(
    '/admin/crm/configuration?tab=teams&lang=en',
    new URLSearchParams({ name: 'Field sales', code: 'field', active: 'on', assignmentMode: 'round_robin' }),
    post,
  )
  assert.equal(created.status, 303)
  const teamOf = async () =>
    (await call<Record<string, Row[]>>('crm.configuration.get')).teams.find((row) => row.code === 'field')!
  let team = await teamOf()
  assert.equal(team.name, 'Field sales')

  const page = await app.client.get(`/admin/crm/configuration?tab=teams&edit=${String(team.id)}&lang=en`)
  const html = await page.text()
  assert.match(html, /value="Field sales"/, 'the edit form is pre-filled from the row')

  const renamed = await app.client.post(
    '/admin/crm/configuration?tab=teams&lang=en',
    new URLSearchParams({
      id: String(team.id),
      name: 'Field sales North',
      code: 'field',
      active: 'on',
      assignmentMode: 'round_robin',
      expectedVersion: String(team.version),
    }),
    post,
  )
  assert.equal(renamed.status, 303)
  team = await teamOf()
  assert.equal(team.name, 'Field sales North', 'editing updates the row instead of minting a second one')

  const archived = await app.client.post(
    '/admin/crm/configuration?tab=teams&lang=en',
    new URLSearchParams({ action: 'archive', id: String(team.id), expectedVersion: String(team.version) }),
    post,
  )
  assert.equal(archived.status, 303)
  assert.equal((await teamOf()).active, false)
})

test('crm backend: team membership and tags are managed from configuration', async (t) => {
  const { app, call } = await boot(t)
  const members = await app.client.get('/admin/crm/configuration?tab=members&lang=en')
  assert.equal(members.status, 200)
  assert.match(await members.text(), /Team members/)

  const added = await app.client.post(
    '/admin/crm/configuration?tab=members&lang=en',
    new URLSearchParams({
      teamId: 'crm-team-sales',
      userId: 'admin',
      capacity: '5',
      sequence: '10',
      active: 'on',
    }),
    post,
  )
  assert.equal(added.status, 303)
  const listed = await call<Row[]>('crm.team.member.list', { teamId: 'crm-team-sales' })
  assert.equal(listed.length, 1)
  assert.equal(listed[0]!.userName, 'Administrator')

  // Round-robin routing depends on these rows existing, which is why the tab
  // had to exist before the assignment modes meant anything.
  const routed = await call<Row>('crm.case.save', {
    id: 'routed',
    kind: 'lead',
    name: 'Routed record',
    idempotencyKey: 'save-routed-001',
  })
  assert.equal(routed.ok, true)
  const assigned = await call<Row>('crm.case.assign', {
    id: 'routed',
    teamId: 'crm-team-sales',
    idempotencyKey: 'assign-routed-01',
  })
  assert.equal(assigned.assigneeUserId, 'admin')

  const tagged = await app.client.post(
    '/admin/crm/configuration?tab=tags&lang=en',
    new URLSearchParams({ name: 'Enterprise', active: 'on' }),
    post,
  )
  assert.equal(tagged.status, 303)
  const tags = await call<Row[]>('crm.tag.list', {})
  assert.equal(
    tags.some((tag) => tag.name === 'Enterprise'),
    true,
  )
})

test('crm backend: the leaderboard is reachable and refreshes', async (t) => {
  const { app, call } = await boot(t)
  await call('crm.case.save', {
    id: 'scored',
    kind: 'opportunity',
    name: 'Scored opportunity',
    partnerId: 'customer',
    assigneeUserId: 'admin',
    idempotencyKey: 'save-scored-001',
  })
  const refreshed = await app.client.post(
    '/admin/crm/leaderboard?lang=en',
    new URLSearchParams({ action: 'refresh' }),
    post,
  )
  assert.equal(refreshed.status, 303)
  const page = await app.client.get('/admin/crm/leaderboard?lang=en')
  const html = await page.text()
  assert.equal(page.status, 200)
  assert.match(html, /Leaderboard/)
  assert.match(html, /Administrator/)
})

test('crm backend: a cross-origin POST is refused', async (t) => {
  const { app } = await boot(t)
  const forged = await app.client.post(
    '/admin/crm/cases?lang=en',
    new URLSearchParams({ name: 'Forged', kind: 'lead' }),
    { headers: { ...form, origin: 'https://evil.test' }, redirect: 'manual' },
  )
  assert.equal(forged.status, 403)
})

test('crm: a second company in the tenant gets its own pipeline', async (t) => {
  const { app, call } = await boot(t)
  const inSecond = async <T = Row>(name: string, input: Record<string, unknown>): Promise<T> =>
    (await app.fixture.call<T>(name, input, { scope: { company: 'second', branches: null } })).value
  await inSecond('partner.savePartner', { id: 'second-party', kind: 'company', name: 'Second' })
  await inSecond('company.saveCompany', {
    id: 'second',
    code: 'SECOND',
    partnerId: 'second-party',
    currency: 'VND',
  })
  /**
   * The seed ids are the primary key across the whole tenant, so the second
   * company's `crm-stage-new` used to collide with the first one's and be
   * dropped by `ON CONFLICT DO NOTHING` — leaving that company with no stages
   * at all and every case refused for having nowhere to sit.
   */
  assert.equal((await inSecond<Row[]>('crm.stage.list', {})).length, 0)

  // The first write in a company seeds it, which is the path a second tenant
  // company actually takes.
  const created = await inSecond('crm_website.website.submitLead', {
    name: 'Second company lead',
    email: 'second@example.test',
    idempotencyKey: 'second-lead-0001',
  })
  assert.equal(created.ok, true, JSON.stringify(created))
  const stages = await inSecond<Row[]>('crm.stage.list', {})
  assert.ok(stages.length >= 5, 'the second company has a pipeline of its own')
  const cases = await inSecond<{ rows: Row[] }>('crm.case.list', { limit: 10 })
  assert.equal(cases.rows.length, 1)

  // And the first company still uses the ids it was installed with.
  const first = await call<Row[]>('crm.stage.list', {})
  assert.equal(
    first.some((stage) => stage.id === 'crm-stage-new'),
    true,
  )
  assert.equal(
    stages.every((stage) => String(stage.id).startsWith('second:')),
    true,
    'the second company holds its own rows rather than pointing at the first one',
  )
})

test('crm website: the public form cannot address an existing record', async (t) => {
  const { app, call } = await boot(t)
  await call('crm.case.save', {
    id: 'private-lead',
    kind: 'lead',
    name: 'Private lead',
    email: 'vip@example.test',
    assigneeUserId: 'admin',
    description: 'Confidential notes',
    idempotencyKey: 'save-private-01',
  })
  const anon = app.client.anonymous()
  // The id is no longer an input at all, so the overwrite has no way in.
  await assert.rejects(
    anon.call('crm_website.website.submitLead', {
      id: 'private-lead',
      name: 'pwned',
      email: 'attacker@example.test',
      idempotencyKey: 'attacker-key-01',
    }),
    /unknown input "id"/,
  )
  const posted = await anon.post(
    '/contact/sales?lang=en',
    new URLSearchParams({ id: 'private-lead', name: 'pwned', email: 'attacker@example.test' }),
    post,
  )
  assert.ok(posted.status === 303 || posted.status === 200)
  const untouched = await call<Row>('crm.case.get', { id: 'private-lead' })
  assert.equal(untouched.name, 'Private lead')
  assert.equal(untouched.assigneeUserId, 'admin')
  assert.equal(untouched.version, 1)
})

test('crm website: a submission lands, replays and is throttled', async (t) => {
  const { app } = await boot(t)
  // The anonymous scope names a company, and the write is pinned to it: the
  // company has to exist or every lead is discarded.
  const inDefault = async <T = Row>(name: string, input: Record<string, unknown>): Promise<T> =>
    (await app.fixture.call<T>(name, input, { scope: { company: 'default', branches: null } })).value
  await inDefault('partner.savePartner', { id: 'default-party', kind: 'company', name: 'Default' })
  const anon = app.client.anonymous()
  const submit = async (input: Record<string, unknown>) =>
    (await anon.call<Row>('crm_website.website.submitLead', input)).value
  const failed = await submit({
    name: 'Before the company exists',
    email: 'early@example.test',
    idempotencyKey: 'early-key-00001',
  })
  assert.equal(failed.ok, false)
  assert.equal(
    (failed.errors as Row[])[0]?.code,
    'crm_website.error.inboxUnavailable',
    'an unconfigured inbox says so instead of failing on an empty stage table',
  )

  await inDefault('company.saveCompany', {
    id: 'default',
    code: 'DEF',
    partnerId: 'default-party',
    currency: 'VND',
  })
  const first = await submit({
    name: 'Visitor lead',
    email: 'visitor@example.test',
    idempotencyKey: 'visitor-key-0001',
  })
  assert.equal(first.ok, true, JSON.stringify(first))
  assert.match(String(first.caseId), /^website-lead:/)

  const replay = await submit({
    name: 'Visitor lead again',
    email: 'visitor@example.test',
    idempotencyKey: 'visitor-key-0001',
  })
  assert.equal(replay.replayed, true)
  assert.equal(replay.caseId, first.caseId)

  // Five submissions per address per hour; the sixth is refused.
  const attempts: Row[] = []
  for (let index = 0; index < 8; index += 1)
    attempts.push(
      await submit({
        name: `Repeat ${index}`,
        email: 'visitor@example.test',
        idempotencyKey: `repeat-key-${index}-aa`,
      }),
    )
  assert.equal(
    attempts.some(
      (result) => (result.errors as Row[] | undefined)?.[0]?.code === 'crm_website.error.rateLimit',
    ),
    true,
  )
})

test('crm website: a filled honeypot writes nothing', async (t) => {
  const { app } = await boot(t)
  const inDefault = async <T = Row>(name: string, input: Record<string, unknown>): Promise<T> =>
    (await app.fixture.call<T>(name, input, { scope: { company: 'default', branches: null } })).value
  await inDefault('partner.savePartner', { id: 'default-party', kind: 'company', name: 'Default' })
  await inDefault('company.saveCompany', {
    id: 'default',
    code: 'DEF',
    partnerId: 'default-party',
    currency: 'VND',
  })
  const anon = app.client.anonymous()
  const trapped = await anon.post(
    '/contact/sales?lang=en',
    new URLSearchParams({ name: 'Bot', email: 'bot@example.test', website: 'http://spam.test' }),
    post,
  )
  assert.equal(trapped.status, 303, 'a script sees the same answer a person would')
  const cases = await inDefault<{ rows: Row[] }>('crm.case.list', { limit: 10 })
  assert.equal(cases.rows.length, 0, 'the trapped submission wrote nothing')

  // The same form without the trap filled does land, so the honeypot is not
  // simply refusing everything.
  const real = await anon.post(
    '/contact/sales?lang=en',
    new URLSearchParams({ name: 'Person', email: 'person@example.test' }),
    post,
  )
  assert.equal(real.status, 303)
  const after = await inDefault<{ rows: Row[] }>('crm.case.list', { limit: 10 })
  assert.equal(after.rows.length, 1)
})

test('crm sale: a quotation is written with the line the form asked for', async (t) => {
  const { app, call, fixture } = await boot(t)
  await fixture('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' })
  await fixture('product.saveTemplate', {
    id: 'gift-box',
    name: 'Gift box',
    type: 'goods',
    uomId: 'unit',
    listPrice: '250000',
    saleOk: true,
    purchaseOk: true,
  })
  await fixture('product.saveVariant', { id: 'gift-box-1', templateId: 'gift-box', combinationKey: '' })
  await fixture('stock.saveWarehouse', { id: 'main', code: 'MAIN', name: 'Main warehouse' })
  await call('crm.case.save', {
    id: 'quotable',
    kind: 'opportunity',
    name: 'Quotable opportunity',
    partnerId: 'customer',
    idempotencyKey: 'save-quotable-1',
  })
  const products = await call<Row[]>('crm_sale.sale.listQuotableProducts', { search: 'Gift' })
  assert.ok(products.length >= 1, 'the picker finds a sellable variant')
  const product = products[0]!

  const page = await app.client.get('/admin/crm/cases/quotable?tab=sales&lang=en')
  assert.match(await page.text(), /name="quantity"/, 'the quotation form asks for a line')

  const created = await app.client.post(
    '/admin/crm/cases/quotable?tab=sales&lang=en',
    new URLSearchParams({
      action: 'quotation',
      warehouseId: 'main',
      productId: String(product.id),
      productUomId: String(product.uomId),
      quantity: '3',
    }),
    post,
  )
  assert.equal(created.status, 303)
  const quotations = await call<Row[]>('crm_sale.sale.listQuotations', { caseId: 'quotable' })
  assert.equal(quotations.length, 1)
  assert.notEqual(Number(quotations[0]!.amountTotal), 0, 'the quotation has a line, so it has a total')

  const withQuotation = await app.client.get('/admin/crm/cases/quotable?tab=sales&lang=en')
  assert.match(await withQuotation.text(), /Quotations/)

  // A quotation with no product is refused rather than silently created empty.
  const empty = await call<Row>('crm_sale.sale.createQuotation', {
    id: 'empty-order',
    caseId: 'quotable',
    warehouseId: 'main',
    idempotencyKey: 'empty-key-00001',
  })
  assert.equal(empty.ok, false)
  assert.equal((empty.errors as Row[])[0]?.code, 'crm_sale.error.productRequired')
})
