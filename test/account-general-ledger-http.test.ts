import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const clean = (html: string): string => html.replace(/<!--[^>]*-->/g, '')

const bootLedger = async (t: TestContext, populate = false) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => app.fixture.call(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme-party',
    currency: 'VND',
  })
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
  await app.client.call('account.initializeCompany', {})
  const accounts = (await app.client.call<Row[]>('account.listAccounts', {})).value
  const journals = (await app.client.call<Row[]>('account.listJournals', {})).value
  const accountId = (code: string) => String(accounts.find((row) => row.code === code)?.id)
  const journalId = String(journals.find((row) => row.type === 'general')?.id)

  if (populate) {
    for (let index = 0; index < 16; index += 1) {
      const suffix = String(index).padStart(2, '0')
      const moveId = `ledger:${suffix}`
      await app.client.call('account.createMove', {
        id: moveId,
        journalId,
        moveType: 'entry',
        date: '2026-06-30T16:30:00.000Z',
        ref: `marker-${suffix}`,
      })
      await app.client.call('account.addMoveLine', {
        id: `${moveId}:debit`,
        moveId,
        name: `marker-${suffix} debit`,
        accountId: accountId('112'),
        debit: '1000',
        sequence: 10,
      })
      await app.client.call('account.addMoveLine', {
        id: `${moveId}:credit`,
        moveId,
        name: `marker-${suffix} credit`,
        accountId: accountId('511'),
        credit: '1000',
        sequence: 20,
      })
      await app.client.call('account.postMove', { id: moveId })
    }
  }
  return { app, fixture }
}

test('general ledger HTTP keeps exact totals while paging and searching the inclusive end day', async (t) => {
  const { app } = await bootLedger(t, true)
  const base = '/admin/accounting/general-ledger?lang=en&dateFrom=2026-06-30&dateTo=2026-06-30'
  const response = await app.client.get(base)
  const html = clean(await response.text())
  assert.equal(response.status, 200)
  assert.match(html, /data-ui="record-workspace"/)
  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="form-page"|data-ui="modal-layer"|mail\.chatter/)
  assert.equal((html.match(/data-ui="row"/g) ?? []).length, 30)
  assert.match(html, /data-ui="record-fact-value">32</)
  assert.equal((html.match(/data-ui="record-fact-value">[^<]*16[,.]000/g) ?? []).length, 2)
  assert.match(html, /data-ui="pager-range">1-30 \/ 32</)
  assert.match(
    html,
    /href="\/admin\/accounting\/general-ledger\?lang=en&amp;dateFrom=2026-06-30&amp;dateTo=2026-06-30&amp;page=2"/,
  )
  assert.match(html, /name="dateFrom" value="2026-06-30"/)
  assert.match(html, /name="dateTo" value="2026-06-30"/)
  assert.match(html, /type="hidden" name="lang" value="en"/)
  assert.match(html, /href="\/admin\/accounting\/entries\/ledger%3A00\?lang=en"/)

  const secondHtml = clean(await (await app.client.get(`${base}&page=2`)).text())
  assert.equal((secondHtml.match(/data-ui="row"/g) ?? []).length, 2)
  assert.match(secondHtml, /data-ui="record-fact-value">32</)
  assert.match(secondHtml, /marker-15 debit/)
  assert.match(secondHtml, /marker-15 credit/)

  const searchedHtml = clean(await (await app.client.get(`${base}&q=marker-15`)).text())
  assert.equal((searchedHtml.match(/data-ui="row"/g) ?? []).length, 2)
  assert.match(searchedHtml, /data-ui="record-fact-value">2</)
  assert.match(searchedHtml, /name="q" value="marker-15"/)
  assert.match(searchedHtml, /type="hidden" name="q" value="marker-15"/)
  assert.doesNotMatch(searchedHtml, /data-ui="pager"/)

  const localizedAccountHtml = clean(await (await app.client.get(`${base}&q=Revenue`)).text())
  assert.equal((localizedAccountHtml.match(/data-ui="row"/g) ?? []).length, 16)
  assert.match(localizedAccountHtml, /511 · Revenue/)
})

test('general ledger HTTP explains rejected filters, remains GET-only, and avoids unrelated permissions', async (t) => {
  const { app, fixture } = await bootLedger(t)
  const inverted = await app.client.get(
    '/admin/accounting/general-ledger?lang=en&dateFrom=2026-07-01&dateTo=2026-06-30',
  )
  const invertedHtml = clean(await inverted.text())
  assert.equal(inverted.status, 200)
  assert.match(invertedHtml, /The end date must be on or after the start date/)
  assert.match(invertedHtml, /name="dateFrom"[^>]*value="2026-07-01"/)
  assert.match(invertedHtml, /name="dateTo"[^>]*value="2026-06-30"/)
  assert.match(invertedHtml, /data-ui="record-fact-value">0</)

  const unavailable = await app.client.get(
    '/admin/accounting/general-ledger?lang=en&accountId=retired-ledger-account',
  )
  const unavailableHtml = clean(await unavailable.text())
  assert.equal(unavailable.status, 200)
  assert.match(unavailableHtml, /The selected account is no longer available/)
  assert.match(unavailableHtml, /retired-ledger-account/)
  assert.match(unavailableHtml, /Account no longer available/)

  assert.equal((await app.client.request('/admin/accounting/general-ledger', { method: 'POST' })).status, 405)
  assert.equal((await app.client.request('/admin/accounting/general-ledger', { method: 'PUT' })).status, 405)

  await fixture('user.createUser', {
    id: 'ledger-reader',
    login: 'ledger-reader',
    password: 'correct horse',
    name: 'Ledger Reader',
    defaultCompanyId: 'acme',
    superuser: false,
  })
  await fixture('user.grantCompany', {
    id: 'ledger-reader:acme',
    userId: 'ledger-reader',
    companyId: 'acme',
  })
  await fixture('user.saveRole', { id: 'ledger-reader-role', name: 'Ledger reader' })
  for (const fnKey of [
    'account.initializeCompany',
    'account.listAccounts',
    'company.listCompanies',
    'account.generalLedger',
  ])
    await fixture('user.grantFunction', {
      id: `ledger-reader-role:${fnKey}`,
      roleId: 'ledger-reader-role',
      fnKey,
    })
  await fixture('user.assignRole', {
    id: 'ledger-reader:role',
    userId: 'ledger-reader',
    roleId: 'ledger-reader-role',
  })
  await app.client.logout()
  await app.client.login({ login: 'ledger-reader', password: 'correct horse' })
  const permitted = await app.client.get('/admin/accounting/general-ledger?lang=en')
  assert.equal(permitted.status, 200)
  assert.match(await permitted.text(), /data-ui="record-workspace"/)
})
