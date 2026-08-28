import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import { seedAccountingTestFixture } from './accounting-test-fixture.ts'

const bootTrial = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => app.fixture.call(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await seedAccountingTestFixture(fixture)
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  await app.client.get('/admin/accounting/trial-balance?lang=vi')
  const accounts = (await app.client.call<Row[]>('account.listAccounts', {})).value
  const journals = (await app.client.call<Row[]>('account.listJournals', {})).value
  const accountId = (code: string) => String(accounts.find((row) => row.code === code)?.id)
  const journalId = String(journals.find((row) => row.type === 'general')?.id)

  const entry = async (id: string, date: string, amount: string, post: boolean) => {
    await app.client.call('account.createMove', { id, journalId, moveType: 'entry', date, ref: id })
    await app.client.call('account.addMoveLine', {
      id: `${id}:debit`,
      moveId: id,
      name: `${id} debit`,
      accountId: accountId('BANK'),
      debit: amount,
    })
    await app.client.call('account.addMoveLine', {
      id: `${id}:credit`,
      moveId: id,
      name: `${id} credit`,
      accountId: accountId('REV'),
      credit: amount,
    })
    if (post) await app.client.call('account.postMove', { id })
  }
  await entry('entry-end-day', '2026-06-30T16:30:00.000Z', '125000', true)
  await entry('entry-draft', '2026-06-30T16:45:00.000Z', '900000', false)
  return { app, accountId }
}

test('trial balance HTTP includes the full end day, sorts accounts and preserves locale in drill-down', async (t) => {
  const { app, accountId } = await bootTrial(t)
  const path = '/admin/accounting/trial-balance?lang=vi&dateFrom=2026-06-30&dateTo=2026-06-30'
  const response = await app.client.get(path)
  const html = await response.text()
  assert.equal(response.status, 200)
  assert.match(html, /data-ui="record-workspace"/)
  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="form-page"|data-ui="modal-layer"|mail\.chatter/)
  assert.match(html, /data-ui="date-picker" method="get" action="\/admin\/accounting\/trial-balance"/)
  assert.match(html, /type="hidden" name="lang" value="vi"/)
  assert.match(html, /name="dateFrom"[^>]*value="2026-06-30"/)
  assert.match(html, /name="dateTo"[^>]*value="2026-06-30"/)
  assert.match(html, /125[.,]000/)
  assert.doesNotMatch(html, /900[.,]000/)
  const bank = html.indexOf('>BANK<')
  const revenue = html.indexOf('>REV<')
  assert.ok(bank >= 0 && revenue > bank, 'account rows follow code order')
  assert.match(
    html,
    new RegExp(
      `href="/admin/accounting/general-ledger\\?accountId=${encodeURIComponent(
        accountId('BANK'),
      )}&amp;dateFrom=2026-06-30&amp;dateTo=2026-06-30&amp;lang=vi"`,
    ),
  )

  const ledger = await app.client.get(
    `/admin/accounting/general-ledger?accountId=${encodeURIComponent(
      accountId('BANK'),
    )}&dateFrom=2026-06-30&dateTo=2026-06-30&lang=vi`,
  )
  assert.equal(ledger.status, 200)
  assert.match(await ledger.text(), /125[.,]000/)

  const empty = await app.client.get(
    '/admin/accounting/trial-balance?lang=en&dateFrom=2026-07-01&dateTo=2026-07-01',
  )
  const emptyHtml = await empty.text()
  assert.equal(empty.status, 200)
  assert.match(emptyHtml, /No figures for this period/)
  assert.match(emptyHtml, /type="hidden" name="lang" value="en"/)
})

test('trial balance HTTP explains an inverted range and remains GET-only', async (t) => {
  const { app } = await bootTrial(t)
  const inverted = await app.client.get(
    '/admin/accounting/trial-balance?lang=en&dateFrom=2026-07-01&dateTo=2026-06-30',
  )
  const html = await inverted.text()
  assert.equal(inverted.status, 200)
  assert.match(html, /data-tone="danger"/)
  assert.match(html, /The end date must be on or after the start date/)
  assert.equal((html.match(/data-ui="date-picker-error"/g) ?? []).length, 2)
  assert.match(html, /name="dateFrom"[^>]*value="2026-07-01"/)
  assert.match(html, /name="dateTo"[^>]*value="2026-06-30"/)
  assert.equal((await app.client.request('/admin/accounting/trial-balance', { method: 'POST' })).status, 405)
  assert.equal((await app.client.request('/admin/accounting/trial-balance', { method: 'PUT' })).status, 405)
})
