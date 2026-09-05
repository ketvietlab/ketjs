import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

type Envelope<T> = { data: T; error: { code: string } | null }

const boot = async (t: TestContext) => {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>, actor?: string) =>
    e2e.fixture.call<Row>(name, input, { scope, ...(actor ? { actor } : {}) })

  for (const [id, kind, name] of [
    ['acme-party', 'company', 'Kết Việt'],
    ['notification-party', 'person', 'Nhân viên kho'],
    ['author-party', 'person', 'Điều phối viên'],
  ])
    await fixture('partner.savePartner', { id, kind, name })
  await fixture('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  for (const [id, partnerId] of [
    ['notification-user', 'notification-party'],
    ['notification-author', 'author-party'],
  ]) {
    await fixture('user.createUser', {
      id,
      partnerId,
      login: id,
      password: 'correct horse battery',
      name: id === 'notification-user' ? 'Nhân viên kho' : 'Điều phối viên',
      defaultCompanyId: 'acme',
      superuser: false,
    })
    await fixture('user.grantCompany', {
      id: `${id}:acme`,
      userId: id,
      companyId: 'acme',
    })
  }
  await fixture('user.saveRole', { id: 'notification-reader', name: 'Notification reader' })
  for (const fnKey of [
    'mail.listInbox',
    'mail.countInbox',
    'mail.countUnread',
    'mail.markInboxRead',
    'mail.markAllInboxRead',
  ])
    await fixture('user.grantFunction', {
      id: `notification-reader:${fnKey}`,
      roleId: 'notification-reader',
      fnKey,
    })
  for (const id of ['notification-user', 'notification-author'])
    await fixture('user.assignRole', {
      id: `${id}:notification-reader`,
      userId: id,
      roleId: 'notification-reader',
    })

  await fixture('stock.saveWarehouse', { id: 'wh', name: 'Kho chính', code: 'WH' })
  await fixture('stock.createPicking', {
    id: 'pick-notification',
    name: 'WH/OUT/00001',
    pickingTypeId: 'wh:outgoing',
    scheduledDate: '2026-08-25T09:00:00.000Z',
  })
  await fixture('stock_mail_backend.follow', { targetId: 'pick-notification' }, 'notification-user')
  for (const [id, body] of [
    ['message-a', 'Phiếu kho vừa được tạo.'],
    ['message-b', 'Phiếu kho cần được kiểm tra.'],
  ])
    await fixture(
      'stock_mail_backend.post',
      { id, targetId: 'pick-notification', kind: 'comment', body },
      'notification-author',
    )
  return e2e
}

const csrfHeaders = (csrfToken: string) => ({ 'x-csrf-token': csrfToken })

test('staff notification channel pages the actor inbox and derives safe destinations', async (t) => {
  const e2e = await boot(t)
  assert.equal((await e2e.client.get('/api/staff/v1/notifications')).status, 401)
  await e2e.client.login({ login: 'notification-user', password: 'correct horse battery' })

  const bootstrap =
    await e2e.client.json<Envelope<{ capabilities: Array<{ key: string; actions: string[] }> }>>(
      '/api/staff/v1/bootstrap',
    )
  assert.deepEqual(
    bootstrap.data.capabilities.find((capability) => capability.key === 'mail.notifications'),
    { key: 'mail.notifications', actions: ['read'] },
  )

  const first = await e2e.client.json<
    Envelope<{ items: Row[]; total: number; page: number; pageSize: number; unreadCount: number }>
  >('/api/staff/v1/notifications?page=1&pageSize=1')
  assert.equal(first.data.total, 2)
  assert.equal(first.data.unreadCount, 2)
  assert.equal(first.data.page, 1)
  assert.equal(first.data.pageSize, 1)
  assert.deepEqual(first.data.items[0], {
    id: 'message-b:user:notification-user',
    eventType: 'mail.comment',
    title: 'WH/OUT/00001',
    body: 'Phiếu kho cần được kiểm tra.',
    createdAt: first.data.items[0]?.createdAt,
    readAt: null,
    destination: { kind: 'warehouse_picking', id: 'pick-notification' },
  })
  assert.match(String(first.data.items[0]?.createdAt), /^\d{4}-\d{2}-\d{2}T/)

  const second = await e2e.client.json<Envelope<{ items: Row[] }>>(
    '/api/staff/v1/notifications?page=2&pageSize=1',
  )
  assert.equal(second.data.items[0]?.id, 'message-a:user:notification-user')
  assert.equal(
    (await e2e.client.json<Envelope<{ count: number }>>('/api/staff/v1/notifications/unread-count')).data
      .count,
    2,
  )
  assert.equal((await e2e.client.get('/api/staff/v1/notifications?page=0')).status, 422)
})

test('staff notification read markers enforce ownership and CSRF and remain idempotent', async (t) => {
  const e2e = await boot(t)
  const notificationId = 'message-b:user:notification-user'

  const author = e2e.client.anonymous()
  await author.login({ login: 'notification-author', password: 'correct horse battery' })
  const authorBootstrap = await author.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')
  assert.equal(
    (
      await author.request(`/api/staff/v1/notifications/${notificationId}/read`, {
        method: 'PATCH',
        headers: csrfHeaders(authorBootstrap.data.csrfToken),
      })
    ).status,
    404,
  )

  await e2e.client.login({ login: 'notification-user', password: 'correct horse battery' })
  assert.equal(
    (
      await e2e.client.request(`/api/staff/v1/notifications/${notificationId}/read`, {
        method: 'PATCH',
      })
    ).status,
    403,
  )
  const bootstrap = await e2e.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')
  const path = `/api/staff/v1/notifications/${notificationId}/read`
  for (const expectedUnread of [1, 1]) {
    const marked = await e2e.client.request(path, {
      method: 'PATCH',
      headers: csrfHeaders(bootstrap.data.csrfToken),
    })
    assert.equal(marked.status, 200)
    assert.deepEqual(((await marked.json()) as Envelope<Row>).data, { ok: true, count: 1 })
    assert.equal(
      (await e2e.client.json<Envelope<{ count: number }>>('/api/staff/v1/notifications/unread-count')).data
        .count,
      expectedUnread,
    )
  }

  const unread = await e2e.client.json<Envelope<{ items: Row[]; total: number }>>(
    '/api/staff/v1/notifications?unreadOnly=true',
  )
  assert.equal(unread.data.total, 1)
  assert.equal(unread.data.items[0]?.id, 'message-a:user:notification-user')

  const all = await e2e.client.request('/api/staff/v1/notifications/read-all', {
    method: 'POST',
    headers: csrfHeaders(bootstrap.data.csrfToken),
  })
  assert.equal(all.status, 200)
  assert.equal(((await all.json()) as Envelope<{ count: number }>).data.count, 1)
  const replay = await e2e.client.request('/api/staff/v1/notifications/read-all', {
    method: 'POST',
    headers: csrfHeaders(bootstrap.data.csrfToken),
  })
  assert.equal(((await replay.json()) as Envelope<{ count: number }>).data.count, 0)

  const listed = await e2e.client.json<Envelope<{ items: Row[]; total: number; unreadCount: number }>>(
    '/api/staff/v1/notifications',
  )
  assert.equal(listed.data.total, 2)
  assert.equal(listed.data.unreadCount, 0)
  assert.ok(listed.data.items.every((item) => item.readAt != null))
})
