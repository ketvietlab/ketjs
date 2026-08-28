import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import { seedAccountingTestFixture } from './accounting-test-fixture.ts'

const clean = (html: string): string => html.replace(/<!--[^>]*-->/g, '')

const bootStatement = async (t: TestContext, populate = false) => {
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
  await seedAccountingTestFixture(fixture)
  await fixture('partner.savePartner', {
    id: 'customer',
    kind: 'company',
    name: 'Customer ABC',
    ref: 'CUS-001',
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
    const moveId = 'partner-statement:move'
    await app.client.call('account.createMove', {
      id: moveId,
      journalId,
      moveType: 'entry',
      partnerId: 'customer',
      date: '2026-06-30T16:30:00.000Z',
      ref: 'statement-marker',
    })
    for (let index = 0; index < 32; index += 1) {
      const suffix = String(index).padStart(2, '0')
      await app.client.call('account.addMoveLine', {
        id: `${moveId}:receivable:${suffix}`,
        moveId,
        name: `statement-marker-${suffix}`,
        accountId: accountId('AR'),
        debit: '1000',
        sequence: index + 1,
      })
    }
    await app.client.call('account.addMoveLine', {
      id: `${moveId}:counterpart`,
      moveId,
      name: 'statement counterpart',
      accountId: accountId('REV'),
      credit: '32000',
      sequence: 100,
    })
    await app.client.call('account.postMove', { id: moveId })
  }
  return { app, fixture }
}

test('partner statement HTTP keeps exact totals while paging, searching, and filtering inclusive days', async (t) => {
  const { app } = await bootStatement(t, true)
  const base =
    '/admin/accounting/partner-statement?partnerId=customer&dateFrom=2026-06-30&dateTo=2026-06-30&lang=en'
  const response = await app.client.get(base)
  const html = clean(await response.text())
  assert.equal(response.status, 200)
  assert.match(html, /data-ui="record-workspace"/)
  assert.doesNotMatch(html, /data-ui="list-page"|data-ui="form-page"|data-ui="modal-layer"|mail\.chatter/)
  assert.equal((html.match(/data-ui="row"/g) ?? []).length, 30)
  assert.equal((html.match(/data-ui="record-fact-value">[^<]*32[,.]000/g) ?? []).length, 2)
  assert.match(html, /data-ui="pager-range">1-30 \/ 32</)
  assert.match(
    html,
    /href="\/admin\/accounting\/partner-statement\?partnerId=customer&amp;dateFrom=2026-06-30&amp;dateTo=2026-06-30&amp;lang=en&amp;page=2"/,
  )
  assert.match(html, /type="hidden" name="lang" value="en"/)
  assert.match(html, /name="dateFrom" value="2026-06-30"/)
  assert.match(html, /name="dateTo" value="2026-06-30"/)
  assert.match(html, /AR · Trade receivables/)
  assert.match(html, /href="\/admin\/accounting\/entries\/partner-statement%3Amove\?lang=en"/)

  const secondHtml = clean(await (await app.client.get(`${base}&page=2`)).text())
  assert.equal((secondHtml.match(/data-ui="row"/g) ?? []).length, 2)
  assert.equal((secondHtml.match(/data-ui="record-fact-value">[^<]*32[,.]000/g) ?? []).length, 2)
  assert.match(secondHtml, /statement-marker-31/)

  const searchedHtml = clean(await (await app.client.get(`${base}&q=statement-marker-31`)).text())
  assert.equal((searchedHtml.match(/data-ui="row"/g) ?? []).length, 1)
  assert.match(searchedHtml, /data-ui="record-fact-value">[^<]*1[,.]000/)
  assert.match(searchedHtml, /name="q" value="statement-marker-31"/)
  assert.match(searchedHtml, /type="hidden" name="q" value="statement-marker-31"/)
  assert.doesNotMatch(searchedHtml, /data-ui="pager"/)

  const accountHtml = clean(await (await app.client.get(`${base}&q=Receivables`)).text())
  assert.equal((accountHtml.match(/data-ui="row"/g) ?? []).length, 30)

  const overviewHtml = clean(
    await (await app.client.get('/admin/accounting?lang=en&dateFrom=2026-06-30&dateTo=2026-06-30')).text(),
  )
  assert.match(
    overviewHtml,
    /href="\/admin\/accounting\/partner-statement\?partnerId=customer&amp;dateFrom=2026-06-30&amp;dateTo=2026-06-30&amp;lang=en"/,
  )
})

test('partner statement HTTP explains rejected filters, stays GET-only, and avoids unrelated permissions', async (t) => {
  const { app, fixture } = await bootStatement(t)
  await fixture('partner.archivePartner', { id: 'customer', active: false })
  const archived = await app.client.get('/admin/accounting/partner-statement?partnerId=customer&lang=en')
  const archivedHtml = clean(await archived.text())
  assert.equal(archived.status, 200)
  assert.match(archivedHtml, /CUS-001 · Customer ABC/)
  assert.doesNotMatch(archivedHtml, /The selected partner is no longer available/)

  const inverted = await app.client.get(
    '/admin/accounting/partner-statement?partnerId=customer&dateFrom=2026-07-01&dateTo=2026-06-30&lang=en',
  )
  const invertedHtml = clean(await inverted.text())
  assert.equal(inverted.status, 200)
  assert.match(invertedHtml, /The end date must be on or after the start date/)
  assert.match(invertedHtml, /name="dateFrom"[^>]*value="2026-07-01"/)
  assert.match(invertedHtml, /name="dateTo"[^>]*value="2026-06-30"/)
  assert.equal((invertedHtml.match(/data-ui="row"/g) ?? []).length, 0)

  const unavailable = await app.client.get(
    '/admin/accounting/partner-statement?partnerId=retired-partner&lang=en',
  )
  const unavailableHtml = clean(await unavailable.text())
  assert.equal(unavailable.status, 200)
  assert.match(unavailableHtml, /The selected partner is no longer available/)
  assert.match(unavailableHtml, /retired-partner/)
  assert.match(unavailableHtml, /Partner no longer available/)

  assert.equal(
    (await app.client.request('/admin/accounting/partner-statement', { method: 'POST' })).status,
    405,
  )
  assert.equal(
    (await app.client.request('/admin/accounting/partner-statement', { method: 'PUT' })).status,
    405,
  )

  await fixture('user.createUser', {
    id: 'statement-reader',
    login: 'statement-reader',
    password: 'correct horse',
    name: 'Statement Reader',
    defaultCompanyId: 'acme',
    superuser: false,
  })
  await fixture('user.grantCompany', {
    id: 'statement-reader:acme',
    userId: 'statement-reader',
    companyId: 'acme',
  })
  await fixture('user.saveRole', { id: 'statement-reader-role', name: 'Statement reader' })
  for (const fnKey of [
    'account.initializeCompany',
    'account.listAccounts',
    'company.listCompanies',
    'partner.listPartners',
    'account.partnerStatement',
  ])
    await fixture('user.grantFunction', {
      id: `statement-reader-role:${fnKey}`,
      roleId: 'statement-reader-role',
      fnKey,
    })
  await fixture('user.assignRole', {
    id: 'statement-reader:role',
    userId: 'statement-reader',
    roleId: 'statement-reader-role',
  })
  await app.client.logout()
  await app.client.login({ login: 'statement-reader', password: 'correct horse' })
  const permitted = await app.client.get('/admin/accounting/partner-statement?lang=en')
  assert.equal(permitted.status, 200)
  assert.match(await permitted.text(), /data-ui="record-workspace"/)
})
