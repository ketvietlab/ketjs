import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { tableNameFor } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const form = { 'content-type': 'application/x-www-form-urlencoded' }
const post = { headers: form, redirect: 'manual' as const }

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite)
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
  assert.match(html, /href="\/admin\/crm\/cases\/workspace\?tab=timeline&amp;lang=en"/)
  assert.match(html, /action="\/admin\/crm\/cases\/workspace\?lang=en"/)
  assert.match(html, /action="\/admin\/crm\/cases\/workspace\/attachments\?lang=en"/)
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
  const plannerHtml = await planner.text()
  assert.match(plannerHtml, /data-ui="list-page"/)
  assert.doesNotMatch(plannerHtml, /name="action" value="schedule"/)
  assert.match(plannerHtml, /name="action" value="complete"/)
  assert.match(plannerHtml, /action="\/admin\/crm\/activities\?tab=mine&amp;lang=en"/)
  assert.match(plannerHtml, /href="\/admin\/crm\/activities\?tab=calendar&amp;lang=en"/)
  assert.match(plannerHtml, /href="\/admin\/crm\/cases\/follow-up\?lang=en"/)
  const schedule = await app.client.get('/admin/crm/activities?tab=mine&schedule=1&lang=en')
  const scheduleHtml = await schedule.text()
  assert.match(scheduleHtml, /data-ui="modal-workspace"/)
  assert.match(scheduleHtml, /name="action" value="schedule"/)

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
  const invalid = await app.client.post(
    '/admin/crm/configuration?tab=tags&lang=en',
    new URLSearchParams({ name: '', active: 'on' }),
    post,
  )
  const invalidHtml = await invalid.text()
  assert.equal(invalid.status, 200)
  assert.match(invalidHtml, /data-ui="list-page"/)
  assert.match(invalidHtml, /data-ui="form-errors"/)
  assert.match(invalidHtml, /action="\/admin\/crm\/configuration\?tab=tags&amp;lang=en&amp;create=1"/)
  assert.match(invalidHtml, /href="\/admin\/crm\/configuration\?tab=members&amp;lang=en"/)

  const created = await app.client.post(
    '/admin/crm/configuration?tab=teams&lang=en',
    new URLSearchParams({ name: 'Field sales', code: 'field', active: 'on', assignmentMode: 'round_robin' }),
    post,
  )
  assert.equal(created.status, 303)
  assert.equal(created.headers.get('location'), '/admin/crm/configuration?tab=teams&lang=en')
  const teamOf = async () =>
    (await call<Record<string, Row[]>>('crm.configuration.get')).teams.find((row) => row.code === 'field')!
  let team = await teamOf()
  assert.equal(team.name, 'Field sales')

  const page = await app.client.get(`/admin/crm/configuration?tab=teams&edit=${String(team.id)}&lang=en`)
  const html = await page.text()
  assert.match(html, /value="Field sales"/, 'the edit form is pre-filled from the row')
  assert.match(html, /href="\/admin\/crm\/configuration\?tab=teams&amp;lang=en"/)
  assert.match(
    html,
    new RegExp(`action="/admin/crm/configuration\\?tab=teams&amp;lang=en&amp;edit=${String(team.id)}"`),
  )

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
  assert.match(html, /data-ui="list-page"/)
  assert.match(html, /data-col="rank"/)
  assert.match(html, /data-col="points"/)
  assert.match(html, /href="\/admin\/users\/admin\?lang=en"/)
  assert.match(html, /action="\/admin\/crm\/leaderboard\?lang=en"/)
  assert.match(html, /name="action" value="refresh"/)
})

test('crm: a case kind another module owns stays out of the CRM screens', async (t) => {
  const { app, call } = await boot(t)
  await call('crm.case.save', {
    id: 'crm-lead',
    kind: 'lead',
    name: 'A CRM lead',
    email: 'shared@example.test',
    idempotencyKey: 'save-crm-lead-1',
  })
  /**
   * `crm.Case` is a shared header: a module built on the CRM may store its own
   * `kind` there, the way the private customer-care module stores tickets. That
   * row used to appear in the CRM list under a raw kind, open a detail screen
   * whose save refused it, and be offered as a merge candidate.
   */
  await app.fixture.withTenant('', async ({ adapter }) => {
    const columns = [
      'companyId',
      'id',
      'kind',
      'name',
      'email',
      'stageId',
      'priority',
      'terminalState',
      'active',
      'version',
      'score',
      'threadId',
      'createdAt',
      'updatedAt',
    ]
    await adapter.run(
      `INSERT INTO ${adapter.quoteIdent(tableNameFor('crm.Case'))} (${columns
        .map((name) => adapter.quoteIdent(name))
        .join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
      [
        'acme',
        'foreign-ticket',
        'ticket',
        'A support ticket',
        'shared@example.test',
        'crm-stage-new',
        '1',
        'open',
        1,
        1,
        '0',
        'thread:crm.Case:crm-lead',
        '2026-08-22T00:00:00.000Z',
        '2026-08-22T00:00:00.000Z',
      ],
    )
  })

  const listed = await call<Row>('crm.case.list', { limit: 50 })
  assert.equal(
    (listed.rows as Row[]).some((row) => row.id === 'foreign-ticket'),
    false,
    'the CRM list shows only the kinds the CRM owns',
  )
  assert.equal((await call<Row>('crm.case.count', {})).count, 1)
  assert.equal(await call<Row | null>('crm.case.get', { id: 'foreign-ticket' }), null)

  const page = await app.client.get('/admin/crm/cases/foreign-ticket?lang=en')
  assert.equal(page.status, 404, 'and its detail screen does not claim the record')

  // A duplicate hunt on the shared email must not offer to merge the two.
  const duplicates = await call<Row>('crm.case.detectDuplicates', { email: 'shared@example.test' })
  assert.equal(
    (duplicates.rows as Row[]).some((row) => row.id === 'foreign-ticket'),
    false,
  )
  // The owning module still reaches its own row through its own query.
  await app.fixture.withTenant('', async ({ adapter }) => {
    const found = await adapter.all(
      `SELECT id FROM ${adapter.quoteIdent(tableNameFor('crm.Case'))} WHERE kind = ?`,
      ['ticket'],
    )
    assert.equal(found.length, 1)
  })
})

test('crm backend: a cross-origin POST is refused', async (t) => {
  const { app } = await boot(t)
  const forged = await app.client.post(
    '/admin/crm/cases?lang=en',
    new URLSearchParams({ name: 'Forged', kind: 'lead' }),
    { headers: { ...form, origin: 'https://evil.test' }, redirect: 'manual' },
  )
  assert.equal(forged.status, 403)
  const forgedConfiguration = await app.client.post(
    '/admin/crm/configuration?tab=teams&lang=en',
    new URLSearchParams({ name: 'Forged team', code: 'forged' }),
    { headers: { ...form, origin: 'https://evil.test' }, redirect: 'manual' },
  )
  assert.equal(forgedConfiguration.status, 403)
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

test('crm pipeline: the header counts the board it is standing over, not the whole board', async (t) => {
  const { app, call } = await boot(t)
  const save = (id: string, name: string, revenue: string, probability: string) =>
    call('crm.case.save', {
      id,
      kind: 'opportunity',
      name,
      partnerId: 'customer',
      stageId: 'crm-stage-qualified',
      expectedRevenue: revenue,
      probability,
      idempotencyKey: `pipeline-${id}`.padEnd(16, '0'),
    })
  await save('open-one', 'Open one', '100', '25')
  await save('open-two', 'Open two', '200', '50')
  await save('closing-deal', 'Closing deal', '400', '100')

  const before = await call<Row>('crm.pipeline.summary', {})
  assert.equal(before.openCount, 3)
  assert.equal(Number(before.expectedRevenue), 700)
  // 100×25% + 200×50% + 400×100% — a probability is a percentage, not a factor.
  assert.equal(Number(before.weightedRevenue), 525)

  const held = await call<Row>('crm.case.get', { id: 'closing-deal' })
  const won = await call<Row>('crm.case.markWon', {
    id: 'closing-deal',
    expectedVersion: held.version,
    idempotencyKey: 'pipeline-won-0001',
  })
  assert.equal(won.ok, true)

  // Winning a deal takes it out of the header and leaves it in its column: a
  // pipeline total that climbs every time something closes measures nothing.
  const after = await call<Row>('crm.pipeline.summary', {})
  assert.equal(after.openCount, 2)
  assert.equal(Number(after.expectedRevenue), 300)
  assert.equal(Number(after.weightedRevenue), 125)
  const wonColumn = (after.stages as Row[]).find((stage) => String(stage.id).endsWith('crm-stage-won'))
  assert.equal(Number(wonColumn?.count), 1, 'the Won column still states its own count')
  assert.equal(Number(wonColumn?.expectedRevenue), 400)

  // And the filters the board runs are the filters the header runs.
  assert.equal((await call<Row>('crm.pipeline.summary', { search: 'Open one' })).openCount, 1)
  assert.equal((await call<Row>('crm.pipeline.summary', { mine: true })).openCount, 0)

  const page = await app.client.get('/admin/crm/pipeline?lang=en')
  const html = await page.text()
  assert.equal(page.status, 200)
  assert.match(html, /data-ui="metric-icon"/, 'the figures render as metric cards')
  assert.match(html, /Weighted value/)
  // The filters are the shared list chrome, not a form of their own above the board.
  assert.match(html, /data-ui="chrome-search-input"/)
  assert.match(html, /data-ui="view-kind"[^>]*data-kind="list"/)
})

test('crm pipeline: a column offers only the record kind that column can hold', async (t) => {
  const { app, call } = await boot(t)
  const board = await (await app.client.get('/admin/crm/pipeline?lang=en')).text()
  // `crm-stage-proposition` accepts opportunities only, so its column may not
  // offer a lead — the save would be refused for the kind it just asked for.
  assert.match(board, /crm-stage-proposition&amp;kind=opportunity/)
  assert.match(board, /crm-stage-new&amp;kind=lead/)
  assert.doesNotMatch(board, /crm-stage-proposition&amp;kind=lead/)

  // And the form the column points at arrives with that stage already chosen.
  const create = await app.client.get(
    '/admin/crm/cases/new?stageId=crm-stage-proposition&kind=opportunity&lang=en',
  )
  const html = await create.text()
  assert.match(
    html,
    /<select[^>]*name="stageId"[\s\S]*?<option[^>]*value="crm-stage-proposition"[^>]*selected/,
  )

  const made = await app.client.post(
    '/admin/crm/cases?lang=en',
    new URLSearchParams({
      name: 'Straight into proposition',
      kind: 'opportunity',
      stageId: 'crm-stage-proposition',
      priority: '1',
    }),
    post,
  )
  assert.equal(made.status, 303)
  const rows = await app.client.call<{ rows: Row[] }>('crm.case.list', { search: 'Straight into' })
  assert.equal(rows.value.rows[0]?.stageId, 'crm-stage-proposition')

  // The stage picker belongs to the create form only. On a record that exists the
  // stage moves through the action that records the move and checks the version.
  await call('crm.case.save', {
    id: 'held-record',
    kind: 'opportunity',
    name: 'Held record',
    partnerId: 'customer',
    idempotencyKey: 'held-record-0001',
  })
  const detail = await app.client.get('/admin/crm/cases/held-record?lang=en')
  assert.equal(detail.status, 200)
  const detailHtml = await detail.text()
  assert.match(detailHtml, /name="action" value="move"/, 'the move action is still the way')
  // One `stageId` on the page, and it belongs to that action. A second one in the
  // record form would write the same column without recording the move.
  assert.equal(detailHtml.match(/name="stageId"/g)?.length, 1)
})

test('crm: a pipeline card carries its tags and the next thing owed on it', async (t) => {
  const { app, call } = await boot(t)
  await call('crm.tag.save', { id: 'tag-gift', name: 'Gift' })
  await call('crm.case.save', {
    id: 'carded',
    kind: 'opportunity',
    name: 'Carded opportunity',
    partnerId: 'customer',
    tagIds: ['tag-gift'],
    expectedRevenue: '90',
    probability: '40',
    idempotencyKey: 'carded-00000001',
  })
  await call('crm.activity.schedule', {
    id: 'carded-call',
    caseId: 'carded',
    summary: 'Call the buyer back',
    dueDate: '2020-01-01',
    idempotencyKey: 'carded-activity-1',
  })
  const listed = await call<{ rows: Row[] }>('crm.case.list', { search: 'Carded' })
  const row = listed.rows[0]!
  assert.deepEqual(
    (row.tags as Row[]).map((tag) => tag.name),
    ['Gift'],
  )
  const activity = row.nextActivity as Row
  assert.equal(activity.summary, 'Call the buyer back')
  assert.equal(activity.overdue, true, 'a due date in the past is late, decided where today is known')

  const board = await (await app.client.get('/admin/crm/pipeline?lang=en')).text()
  assert.match(board, /Call the buyer back/)
  assert.match(board, /crm-card-tag/)
})
