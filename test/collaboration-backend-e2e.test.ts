import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from 'ketjs'
import { createTestApp, TestHttpError } from 'ketjs/testing'
import { ketsuite } from '../apps/ketsuite/app.ts'

const SCOPE = { company: 'acme', branches: null }

async function boot(t: TestContext, worker = false) {
  const e2e = await createTestApp(ketsuite, { worker })
  t.after(() => e2e.close())
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call(name, input, { scope: SCOPE })

  for (const [id, kind, name] of [
    ['acme-party', 'company', 'ACME'],
    ['admin-party', 'person', 'Administrator'],
    ['member-party', 'person', 'Operations Member'],
  ])
    await fixture('partner.savePartner', {
      id,
      kind,
      name,
      email: `${id}@example.test`,
    })
  await fixture('company.saveCompany', {
    id: 'acme',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  for (const [id, partnerId] of [
    ['admin', 'admin-party'],
    ['member', 'member-party'],
  ]) {
    await fixture('user.createUser', {
      id,
      partnerId,
      login: id,
      password: 'correct horse',
      name: id === 'admin' ? 'Administrator' : 'Operations Member',
      defaultCompanyId: 'acme',
      superuser: true,
    })
    await fixture('user.grantCompany', {
      id: `${id}:acme`,
      userId: id,
      companyId: 'acme',
    })
  }

  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  const call = <T = unknown>(name: string, input: Record<string, unknown> = {}) =>
    e2e.client.call<T>(name, input)

  await call('uom.saveUnit', { id: 'unit', name: 'Unit', relativeFactor: '1' })
  await call('product.saveTemplate', {
    id: 'tpl-collab',
    name: 'Collaborative product',
    type: 'goods',
    uomId: 'unit',
    listPrice: '100',
  })
  await call('product.saveVariant', {
    id: 'variant-collab',
    templateId: 'tpl-collab',
    defaultCode: 'COLLAB',
    combinationKey: '',
  })
  await call('stock.saveWarehouse', { id: 'wh', name: 'Main warehouse', code: 'WH' })
  await call('stock.createPicking', {
    id: 'pick-collab',
    name: 'WH/OUT/COLLAB',
    pickingTypeId: 'wh:outgoing',
  })

  const member = e2e.client.anonymous()
  await member.login({ login: 'member', password: 'correct horse' })
  return { e2e, call, member }
}

test('Chatter backend E2E: Product bridge renders, follows, posts attachments and updates inbox', async (t) => {
  const { e2e, call, member } = await boot(t)

  const productPage = await e2e.client.get('/admin/products/tpl-collab?lang=en', {
    headers: { accept: 'text/html' },
  })
  assert.equal(productPage.status, 200)
  const html = await productPage.text()
  assert.match(html, /data-island="mail\.chatter"/)
  assert.match(html, /&quot;resModel&quot;:&quot;product\.Template&quot;/)
  assert.match(html, /data-ui="chatter" data-state="loading"/)
  assert.match(html, /data-ui="chatter-kind" data-kind="comment"/)
  assert.doesNotMatch(html, /data-ui="chatter-composer"/)
  assert.match(html, /data-island="mail\.inbox-indicator"/)

  const bootstrap = await e2e.client.get('/_ket/islands.js')
  assert.match(await bootstrap.text(), /\/_ket\/asset\/mail_backend\/mail\.mjs/)

  const initial = (
    await call<{
      total: number
      following: boolean
      messages: Row[]
    }>('product_mail_backend.timeline', { targetId: 'tpl-collab' })
  ).value
  assert.deepEqual(initial, {
    threadId: null,
    displayName: 'Collaborative product',
    total: 0,
    messages: [],
    followers: [],
    following: false,
  })

  assert.deepEqual((await member.call('product_mail_backend.follow', { targetId: 'tpl-collab' })).value, {
    following: true,
    followerId: 'thread:product.Template:tpl-collab:member-party',
  })
  await call('storage.createAttachment', {
    id: 'attachment-collab',
    name: 'specification.pdf',
    resModel: 'mail.Message',
    resId: 'message-product',
    kind: 'url',
    url: 'https://cdn.example.test/specification.pdf',
    mimetype: 'application/pdf',
    size: 42,
    public: false,
    createdAt: '2026-08-20T00:00:00.000Z',
  })
  const posted = (
    await call<Row>('product_mail_backend.post', {
      id: 'message-product',
      targetId: 'tpl-collab',
      kind: 'comment',
      body: '<script>alert(1)</script> ready',
      attachmentIds: ['attachment-collab'],
    })
  ).value
  assert.equal(posted.threadId, 'thread:product.Template:tpl-collab')

  const timeline = (
    await member.call<{ total: number; following: boolean; messages: Row[] }>(
      'product_mail_backend.timeline',
      { targetId: 'tpl-collab' },
    )
  ).value
  assert.equal(timeline.total, 1)
  assert.equal(timeline.following, true)
  assert.equal(timeline.messages[0]!.body, '<script>alert(1)</script> ready')
  assert.equal((timeline.messages[0]!.attachments as Row[])[0]!.name, 'specification.pdf')
  assert.equal((await member.call<Row[]>('mail.listInbox')).value[0]!.messageId, 'message-product')

  const repeated = (
    await call<Row>('product_mail_backend.post', {
      id: 'message-product',
      targetId: 'tpl-collab',
      kind: 'comment',
      body: '<script>alert(1)</script> ready',
      attachmentIds: ['attachment-collab'],
    })
  ).value
  assert.equal(repeated.id, 'message-product')
  assert.equal(
    (await call<{ total: number }>('product_mail_backend.timeline', { targetId: 'tpl-collab' })).value.total,
    1,
  )
})

test('Chatter backend E2E: Stock bridge is company-scoped and owns the transfer screen joint', async (t) => {
  const { e2e, call, member } = await boot(t)
  const transferPage = await e2e.client.get('/admin/transfers/pick-collab?lang=vi', {
    headers: { accept: 'text/html' },
  })
  assert.equal(transferPage.status, 200)
  const html = await transferPage.text()
  assert.match(html, /data-island="mail\.chatter"/)
  assert.match(html, /&quot;resModel&quot;:&quot;stock\.Picking&quot;/)
  assert.match(html, /WH\/OUT\/COLLAB/)

  await member.call('stock_mail_backend.follow', { targetId: 'pick-collab' })
  await call('stock_mail_backend.post', {
    id: 'message-stock',
    targetId: 'pick-collab',
    kind: 'note',
    body: 'Internal warehouse note',
  })
  const timeline = (
    await member.call<{ total: number; messages: Row[] }>('stock_mail_backend.timeline', {
      targetId: 'pick-collab',
    })
  ).value
  assert.equal(timeline.total, 1)
  assert.equal(timeline.messages[0]!.kind, 'note')
  assert.equal((await member.call<Row[]>('mail.listInbox')).value.length, 1)

  await assert.rejects(
    () => call('stock_mail_backend.timeline', { targetId: 'missing' }),
    (error: unknown) => {
      assert.ok(error instanceof TestHttpError)
      assert.equal((error.body as { code?: string }).code, 'E_STOCK_MAIL_TARGET')
      return true
    },
  )

  const anonymous = e2e.client.anonymous()
  await assert.rejects(
    () => anonymous.call('stock_mail_backend.timeline', { targetId: 'pick-collab' }),
    (error: unknown) => {
      assert.ok(error instanceof TestHttpError)
      assert.equal((error.body as { code?: string }).code, 'E_FN_NOT_PERMITTED')
      return true
    },
  )
})

test('Activity backend E2E: Product scheduling, due state, atomic completion and chaining reach Chatter', async (t) => {
  const { e2e, call, member } = await boot(t)
  const type = (input: Record<string, unknown>) =>
    call('activity.saveType', {
      icon: 'check',
      defaultDelayDays: 0,
      chainingPolicy: 'none',
      sequence: 10,
      active: true,
      ...input,
    })

  await type({ id: 'type-email', name: 'Send email', category: 'email', defaultDelayDays: 2 })
  await type({
    id: 'type-follow-up',
    name: 'Follow up',
    category: 'todo',
    chainingPolicy: 'trigger',
    nextTypeId: 'type-email',
  })
  await call('product_mail_backend.follow', { targetId: 'tpl-collab' })
  await call('storage.createAttachment', {
    id: 'activity-brief',
    name: 'activity-brief.pdf',
    resModel: 'activity.Activity',
    resId: 'activity-product',
    kind: 'url',
    url: 'https://cdn.example.test/activity-brief.pdf',
    mimetype: 'application/pdf',
    size: 17,
    public: false,
    createdAt: '2026-08-19T00:00:00.000Z',
  })
  const scheduled = (
    await call<{ activity: Row }>('product_activity_backend.schedule', {
      id: 'activity-product',
      targetId: 'tpl-collab',
      typeId: 'type-follow-up',
      assigneeUserId: 'member',
      summary: 'Confirm launch quantity',
      note: 'Use the approved brief.',
      dueDate: '2026-08-19',
      attachmentIds: ['activity-brief'],
    })
  ).value.activity
  assert.equal(scheduled.threadId, 'thread:product.Template:tpl-collab')

  const productPage = await e2e.client.get('/admin/products/tpl-collab?lang=en', {
    headers: { accept: 'text/html' },
  })
  const productHtml = await productPage.text()
  assert.match(productHtml, /data-island="activity\.record"/)
  assert.match(productHtml, /data-ui="activity-record" data-state="loading"/)
  assert.match(productHtml, /data-ui="activity-schedule-trigger"/)
  assert.doesNotMatch(productHtml, /data-ui="activity-schedule"/)
  const bootstrap = await e2e.client.get('/_ket/islands.js')
  assert.match(await bootstrap.text(), /\/_ket\/asset\/activity_backend\/activity\.mjs/)

  const before = (
    await member.call<{ activities: Row[] }>('product_activity_backend.list', {
      targetId: 'tpl-collab',
      today: '2026-08-20',
    })
  ).value.activities
  assert.equal(before[0]!.state, 'overdue')
  assert.equal(before[0]!.assigneeName, 'Operations Member')
  assert.equal((before[0]!.attachments as Row[])[0]!.name, 'activity-brief.pdf')

  const completed = (
    await member.call<{ messageId: string; nextActivity: Row }>('activity.complete', {
      id: 'activity-product',
      feedback: 'Quantity confirmed with operations.',
      completedDate: '2026-08-20',
    })
  ).value
  assert.equal(completed.messageId, 'activity:activity-product:done')
  assert.equal(completed.nextActivity.typeId, 'type-email')
  assert.equal(completed.nextActivity.dueDate, '2026-08-22')

  const timeline = (
    await call<{ messages: Row[] }>('product_mail_backend.timeline', { targetId: 'tpl-collab' })
  ).value.messages
  assert.equal(timeline[0]!.kind, 'system')
  assert.match(String(timeline[0]!.body), /Quantity confirmed with operations/)
  assert.equal((timeline[0]!.attachments as Row[])[0]!.name, 'activity-brief.pdf')
  assert.equal((await call<Row[]>('mail.listInbox')).value[0]!.messageId, 'activity:activity-product:done')

  const my = (
    await member.call<{ activities: Row[] }>('activity.listMy', {
      today: '2026-08-20',
      includeDone: true,
    })
  ).value.activities
  assert.deepEqual(
    my.map((row) => [row.state, row.dueDate]),
    [
      ['done', '2026-08-19'],
      ['planned', '2026-08-22'],
    ],
  )
  const screen = await member.get('/admin/activities?today=2026-08-20&done=1', {
    headers: { accept: 'text/html' },
  })
  assert.equal(screen.status, 200)
  assert.match(await screen.text(), /Confirm launch quantity/)
})

test('Activity backend E2E: plans are retry-safe and a failed chain rolls completion back', async (t) => {
  const { call } = await boot(t)
  const type = (input: Record<string, unknown>) =>
    call('activity.saveType', {
      icon: 'check',
      defaultDelayDays: 0,
      chainingPolicy: 'none',
      sequence: 10,
      active: true,
      ...input,
    })
  await type({ id: 'type-call', name: 'Call', category: 'call' })
  await type({ id: 'type-review', name: 'Review', category: 'todo' })
  await call('activity.savePlan', {
    id: 'plan-handoff',
    name: 'Warehouse handoff',
    active: true,
    steps: [
      { id: 'step-call', typeId: 'type-call', offsetDays: 0, assigneeStrategy: 'actor', sequence: 10 },
      {
        id: 'step-review',
        typeId: 'type-review',
        offsetDays: 1,
        assigneeStrategy: 'specific',
        assigneeUserId: 'member',
        sequence: 20,
      },
    ],
  })
  const applied = (
    await call<{ activities: Row[] }>('stock_activity_backend.applyPlan', {
      targetId: 'pick-collab',
      planId: 'plan-handoff',
      startDate: '2026-08-20',
      requestId: 'apply-handoff',
    })
  ).value.activities
  assert.deepEqual(
    applied.map((row) => [row.id, row.assigneeUserId, row.dueDate]),
    [
      ['apply-handoff:step-call', 'admin', '2026-08-20'],
      ['apply-handoff:step-review', 'member', '2026-08-21'],
    ],
  )
  await call('stock_activity_backend.applyPlan', {
    targetId: 'pick-collab',
    planId: 'plan-handoff',
    startDate: '2026-08-20',
    requestId: 'apply-handoff',
  })
  assert.equal(
    (
      await call<{ activities: Row[] }>('stock_activity_backend.list', {
        targetId: 'pick-collab',
        today: '2026-08-20',
      })
    ).value.activities.length,
    2,
  )
  assert.deepEqual((await call('activity.countDue', { today: '2026-08-20' })).value, {
    count: 1,
    overdue: 0,
    today: 1,
  })
  await call('activity.reschedule', { id: 'apply-handoff:step-call', dueDate: '2026-08-23' })
  await call('activity.cancel', { id: 'apply-handoff:step-call', feedback: 'No longer required' })

  await type({ id: 'type-disabled-next', name: 'Disabled next', category: 'todo' })
  await type({
    id: 'type-broken-chain',
    name: 'Broken chain',
    category: 'todo',
    chainingPolicy: 'trigger',
    nextTypeId: 'type-disabled-next',
  })
  await call('product_activity_backend.schedule', {
    id: 'activity-rollback',
    targetId: 'tpl-collab',
    typeId: 'type-broken-chain',
    summary: 'Must remain open',
    dueDate: '2026-08-20',
  })
  await type({ id: 'type-disabled-next', name: 'Disabled next', category: 'todo', active: false })
  await assert.rejects(
    () =>
      call('activity.complete', {
        id: 'activity-rollback',
        feedback: 'This transaction must roll back',
        completedDate: '2026-08-20',
      }),
    (error: unknown) => {
      assert.ok(error instanceof TestHttpError)
      assert.equal((error.body as { code?: string }).code, 'E_ACTIVITY_TYPE')
      return true
    },
  )
  const after = (
    await call<{ activities: Row[] }>('product_activity_backend.list', {
      targetId: 'tpl-collab',
      today: '2026-08-20',
    })
  ).value.activities
  assert.equal(after[0]!.active, true)
  assert.equal(after[0]!.doneAt, null)
  assert.deepEqual(
    (await call<{ messages: Row[] }>('product_mail_backend.timeline', { targetId: 'tpl-collab' })).value
      .messages,
    [],
  )
})

test('Calendar E2E: timed/all-day recurrence, RSVP, exceptions and availability keep timezone semantics', async (t) => {
  const { call } = await boot(t)
  await call('calendar.saveTag', { id: 'tag-ops', name: 'Operations', color: '#536dfe', active: true })
  const saved = (
    await call<{ event: Row }>('calendar.saveEvent', {
      id: 'event-weekly',
      name: 'Weekly launch review',
      description: 'Review readiness across the DST boundary.',
      location: 'Room A',
      allDay: false,
      startAt: '2026-03-01T14:00:00.000Z',
      stopAt: '2026-03-01T15:00:00.000Z',
      timezone: 'America/New_York',
      privacy: 'public',
      showAs: 'busy',
      attendees: [{ id: 'attendee-member', partnerId: 'member-party' }],
      tagIds: ['tag-ops'],
      recurrence: { frequency: 'weekly', interval: 1, weekdays: ['SU'], count: 3 },
    })
  ).value.event
  assert.equal(saved.version, 1)
  const agenda = (
    await call<{ events: Row[] }>('calendar.listAgenda', {
      rangeStart: '2026-03-01',
      rangeStop: '2026-03-23',
      timezone: 'America/New_York',
    })
  ).value.events
  assert.deepEqual(
    agenda.map((row) => [row.occurrenceDate, row.startAt]),
    [
      ['2026-03-01', '2026-03-01T14:00:00.000Z'],
      ['2026-03-08', '2026-03-08T13:00:00.000Z'],
      ['2026-03-15', '2026-03-15T13:00:00.000Z'],
    ],
  )
  assert.equal((agenda[0]!.tags as Row[])[0]!.name, 'Operations')
  const token = String((agenda[0]!.attendees as Row[])[0]!.token)
  const rsvp = (await call<Row>('calendar.rsvp', { token, state: 'accepted' })).value
  assert.equal(rsvp.eventId, 'event-weekly')
  assert.equal(rsvp.state, 'accepted')
  assert.match(String(rsvp.respondedAt), /^2026-/)
  const afterRsvp = (
    await call<{ events: Row[] }>('calendar.listAgenda', {
      rangeStart: '2026-03-01',
      rangeStop: '2026-03-02',
      timezone: 'America/New_York',
    })
  ).value.events
  assert.equal((afterRsvp[0]!.attendees as Row[])[0]!.state, 'accepted')

  await call('calendar.saveEvent', {
    id: 'event-weekly-exception',
    name: 'Launch review — moved',
    allDay: false,
    startAt: '2026-03-08T16:00:00.000Z',
    stopAt: '2026-03-08T17:00:00.000Z',
    timezone: 'America/New_York',
    privacy: 'public',
    exceptionOfEventId: 'event-weekly',
    recurrenceDate: '2026-03-08',
  })
  const withException = (
    await call<{ events: Row[] }>('calendar.listAgenda', {
      rangeStart: '2026-03-08',
      rangeStop: '2026-03-09',
      timezone: 'America/New_York',
    })
  ).value.events
  assert.deepEqual(
    withException.map((row) => [row.id, row.startAt]),
    [['event-weekly-exception', '2026-03-08T16:00:00.000Z']],
  )
  const availability = (
    await call<{ conflicts: Row[] }>('calendar.availability', {
      userIds: ['member'],
      startAt: '2026-03-08T15:30:00.000Z',
      stopAt: '2026-03-08T16:30:00.000Z',
      timezone: 'America/New_York',
    })
  ).value.conflicts
  assert.equal(availability.length, 0, 'an exception does not inherit attendees implicitly')

  await call('calendar.saveEvent', {
    id: 'event-holiday',
    name: 'Inventory holiday',
    allDay: true,
    startDate: '2026-08-20',
    stopDate: '2026-08-22',
    timezone: 'Asia/Ho_Chi_Minh',
    privacy: 'private',
  })
  const allDay = (
    await call<{ events: Row[] }>('calendar.listAgenda', {
      rangeStart: '2026-08-20',
      rangeStop: '2026-08-21',
      timezone: 'Asia/Ho_Chi_Minh',
    })
  ).value.events
  assert.equal(allDay[0]!.startDate, '2026-08-20')
  assert.equal(allDay[0]!.startAt, null)
})

test('Calendar reminders: rescheduling leaves stale versioned jobs harmless and current delivery durable', async (t) => {
  const { e2e, call, member } = await boot(t, true)
  await call('calendar.saveEvent', {
    id: 'event-reminder',
    name: 'Dispatch reminder',
    allDay: false,
    startAt: '2026-08-20T00:00:00.000Z',
    stopAt: '2026-08-20T01:00:00.000Z',
    timezone: 'Asia/Ho_Chi_Minh',
    privacy: 'public',
    attendees: [{ partnerId: 'member-party' }],
    reminders: [{ id: 'reminder-dispatch', channel: 'inbox', offsetMinutes: 0 }],
  })
  await call('calendar.saveEvent', {
    id: 'event-reminder',
    name: 'Dispatch reminder rescheduled',
    allDay: false,
    startAt: '2026-08-20T00:30:00.000Z',
    stopAt: '2026-08-20T01:30:00.000Z',
    timezone: 'Asia/Ho_Chi_Minh',
    privacy: 'public',
    attendees: [{ partnerId: 'member-party' }],
    reminders: [{ id: 'reminder-dispatch', channel: 'inbox', offsetMinutes: 0 }],
  })
  assert.equal(await e2e.drainJobs(), 2)
  let durable: Row[] = []
  let reminderJobs: Row[] = []
  await e2e.fixture.withTenant('', async ({ adapter }) => {
    durable = await adapter.all(
      `SELECT m.id AS messageId, n."recipientUserId", r.version, r."sentAt"
       FROM calendar_reminder r
       LEFT JOIN mail_message m ON m.id = 'calendar:reminder:reminder-dispatch:v2'
       LEFT JOIN mail_notification n ON n."messageId" = m.id
       WHERE r.id = ?`,
      ['reminder-dispatch'],
    )
    reminderJobs = await adapter.all(
      `SELECT job, args, state, errors, scheduled_at FROM ket_job WHERE job = 'calendar.remind' ORDER BY scheduled_at`,
    )
  })
  const diagnostic = JSON.stringify({ durable, reminderJobs })
  assert.equal(durable[0]?.messageId, 'calendar:reminder:reminder-dispatch:v2', diagnostic)
  assert.equal(durable[0]?.recipientUserId, 'member', diagnostic)
  const inbox = (await member.call<Row[]>('mail.listInbox')).value
  assert.equal(inbox.filter((row) => row.messageId === 'calendar:reminder:reminder-dispatch:v2').length, 1)
  assert.equal(inbox.filter((row) => row.messageId === 'calendar:reminder:reminder-dispatch:v1').length, 0)
  await e2e.fixture.withTenant('', async ({ adapter }) => {
    const reminder = await adapter.all('SELECT version, "sentAt" FROM calendar_reminder WHERE id = ?', [
      'reminder-dispatch',
    ])
    assert.equal(reminder[0]!.version, 2)
    assert.ok(reminder[0]!.sentAt)
  })
})

test('Calendar Activity bridge: Meeting create, reschedule and cancel update both domains atomically', async (t) => {
  const { call } = await boot(t)
  await call('activity.saveType', {
    id: 'type-meeting',
    name: 'Meeting',
    category: 'meeting',
    icon: 'calendar',
    defaultDelayDays: 0,
    chainingPolicy: 'none',
    sequence: 10,
    active: true,
  })
  await call('product_activity_backend.schedule', {
    id: 'activity-meeting',
    targetId: 'tpl-collab',
    typeId: 'type-meeting',
    summary: 'Launch meeting',
    dueDate: '2026-08-20',
  })
  assert.deepEqual(
    (
      await call('calendar_activity.createMeeting', {
        activityId: 'activity-meeting',
        eventId: 'event-meeting',
        name: 'Launch coordination',
        startAt: '2026-08-21T02:00:00.000Z',
        stopAt: '2026-08-21T03:00:00.000Z',
        timezone: 'Asia/Ho_Chi_Minh',
        attendees: [{ partnerId: 'member-party' }],
      })
    ).value,
    { activityId: 'activity-meeting', eventId: 'event-meeting', dueDate: '2026-08-21' },
  )
  const linked = (
    await call<{ activities: Row[] }>('product_activity_backend.list', {
      targetId: 'tpl-collab',
      today: '2026-08-20',
    })
  ).value.activities[0]!
  assert.equal(linked.calendarEventId, 'event-meeting')
  assert.equal(linked.dueDate, '2026-08-21')

  const rescheduled = (
    await call<Row>('calendar_activity.rescheduleMeeting', {
      activityId: 'activity-meeting',
      startAt: '2026-08-22T03:00:00.000Z',
      stopAt: '2026-08-22T04:00:00.000Z',
      timezone: 'Asia/Ho_Chi_Minh',
    })
  ).value
  assert.equal(rescheduled.dueDate, '2026-08-22')
  assert.equal(rescheduled.version, 2)
  const agenda = (
    await call<{ events: Row[] }>('calendar.listAgenda', {
      rangeStart: '2026-08-22',
      rangeStop: '2026-08-23',
      timezone: 'Asia/Ho_Chi_Minh',
    })
  ).value.events
  assert.equal(agenda[0]!.startAt, '2026-08-22T03:00:00.000Z')

  assert.deepEqual(
    (
      await call('calendar_activity.cancelMeeting', {
        activityId: 'activity-meeting',
        feedback: 'Moved offline',
      })
    ).value,
    { activityId: 'activity-meeting', eventId: 'event-meeting', canceled: true },
  )
  assert.deepEqual(
    (
      await call<{ events: Row[] }>('calendar.listAgenda', {
        rangeStart: '2026-08-22',
        rangeStop: '2026-08-23',
        timezone: 'Asia/Ho_Chi_Minh',
      })
    ).value.events,
    [],
  )
})
