// Does anything a person does in Flow actually reach them in the inbox?
//
// FLW-035 asks for an in-product inbox with `mail.Notification` readable. The
// inbox itself is not Flow's — `mail_backend` has served `/admin/inbox` and an
// unread indicator in the sidebar for some time. So the item is not "build an
// inbox"; it is "prove that Flow's own notifications arrive in the one that
// exists", which is a question no amount of reading the code settles, because
// what matters is whether the rows are written at all and whether the screen
// finds them.
//
// If this file is red, the answer is no and the gap is real. Green is the
// evidence that closes the item.

import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = <T = Row>(name: string, input: Record<string, unknown>, actor?: string) =>
    app.fixture.call<T>(name, input, { scope, actor }).then((result) => result.value)

  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'Kết Việt' })
  await fixture('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  // Both people carry a partner, because a notification is addressed to one:
  // `mail.Follower` and `mail.Notification` both name a partner, not a user.
  for (const [id, name] of [
    ['author', 'Người viết'],
    ['reader', 'Người được nhắc'],
  ] as const) {
    await fixture('partner.savePartner', { id: `${id}-party`, kind: 'person', name })
    await fixture('user.createUser', {
      id,
      login: id,
      password: 'correct horse battery',
      name,
      partnerId: `${id}-party`,
      defaultCompanyId: 'acme',
      superuser: true,
    })
    await fixture('user.grantCompany', { id: `${id}:acme`, userId: id, companyId: 'acme' })
  }

  await fixture(
    'flow.project.save',
    { values: { id: 'proj', key: 'PRJ', name: 'Dự án' }, idempotencyKey: 'inbox-project' },
    'author',
  )
  await fixture(
    'flow.project.member.add',
    { projectId: 'proj', userId: 'reader', idempotencyKey: 'inbox-member-reader' },
    'author',
  )
  await fixture(
    'flow.column.save',
    {
      values: { id: 'todo', projectId: 'proj', code: 'todo', name: 'Cần làm' },
      idempotencyKey: 'inbox-column',
    },
    'author',
  )
  await fixture(
    'flow.issue.save',
    {
      id: 'issue-1',
      projectId: 'proj',
      columnId: 'todo',
      title: 'Việc cần bàn',
      idempotencyKey: 'inbox-issue',
    },
    'author',
  )
  return { app, fixture }
}

test('a mention on a Flow issue arrives in the reader’s inbox and names the issue', async (t) => {
  const { app, fixture } = await boot(t)

  // Nothing yet: the count has to start at zero or the assertion below would
  // pass on somebody else's notification.
  await app.client.login({ login: 'reader', password: 'correct horse battery' })
  const before = (await app.client.call<Row>('mail.countUnread', {})).value
  assert.equal(Number((before as Row).count ?? before), 0, 'the reader starts with an empty inbox')

  await fixture(
    'flow.issue.comment',
    {
      id: 'comment-1',
      issueId: 'issue-1',
      body: 'Nhờ anh xem giúp phần này',
      mentionUserIds: ['reader'],
      idempotencyKey: 'inbox-comment-1',
    },
    'author',
  )

  const inbox = (await app.client.call<Row[]>('mail.listInbox', { unreadOnly: true })).value ?? []
  assert.equal(inbox.length, 1, 'the mention arrived')
  const held = inbox[0] as Row
  assert.match(String(held.body), /xem giúp phần này/)
  // The row says what it is about, which is what makes an inbox usable rather
  // than a list of disembodied sentences.
  assert.equal(String(held.targetModel), 'flow.Issue')

  // And the screen that serves it finds it. `/admin/inbox` is mail_backend's,
  // not Flow's — the point of this assertion is that Flow needed to build
  // nothing for its notifications to land somewhere a person can read them.
  const page = await (await app.client.get('/admin/inbox?lang=en')).text()
  assert.match(page, /xem giúp phần này/)

  // Reading it clears the count, so the indicator in the sidebar is telling
  // the truth rather than counting forever.
  await app.client.call('mail.markAllInboxRead', { readAt: new Date().toISOString() })
  const after = (await app.client.call<Row>('mail.countUnread', {})).value
  assert.equal(Number((after as Row).count ?? after), 0)
})

test('the author of a comment is not notified about their own comment', async (t) => {
  const { app, fixture } = await boot(t)
  await fixture(
    'flow.issue.comment',
    {
      id: 'comment-1',
      issueId: 'issue-1',
      body: 'Tự nói với mình',
      idempotencyKey: 'inbox-comment-self',
    },
    'author',
  )

  // Commenting subscribes the author to the thread, so this is the case that
  // would flood an inbox if `postMessage` did not exclude them: every comment
  // somebody writes would notify them about it.
  await app.client.login({ login: 'author', password: 'correct horse battery' })
  const held = (await app.client.call<Row[]>('mail.listInbox', { unreadOnly: true })).value ?? []
  assert.deepEqual(held, [])
})
