import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'
import { seedAccountingTestFixture } from './accounting-test-fixture.ts'

const formHeaders = { 'content-type': 'application/x-www-form-urlencoded' }
const post = { headers: formHeaders, redirect: 'manual' as const }

const bootPayments = async (t: TestContext) => {
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
  await app.client.get('/admin/accounting/payments?lang=vi')
  await app.client.call('partner.savePartner', {
    id: 'customer-payment',
    kind: 'company',
    name: 'Khách hàng thanh toán',
  })
  const accounts = (await app.client.call<Row[]>('account.listAccounts', {})).value
  const journals = (await app.client.call<Row[]>('account.listJournals', {})).value
  return {
    app,
    bankId: String(journals.find((row) => row.type === 'bank')?.id),
    receivableId: String(accounts.find((row) => row.code === 'AR')?.id),
  }
}

test('payments HTTP separates a filtered ListPage from its stable full FormPage', async (t) => {
  const { app, bankId, receivableId } = await bootPayments(t)
  const path = '/admin/accounting/payments'
  await app.client.call('account.registerPayment', {
    id: 'payment-http-list',
    name: 'PAY/HTTP/LIST',
    paymentType: 'inbound',
    partnerType: 'customer',
    partnerId: 'customer-payment',
    journalId: bankId,
    destinationAccountId: receivableId,
    amount: '125000',
    memo: 'NEEDLE PAYMENT',
  })

  const returnTo = `${path}?lang=vi&state=paid&type=inbound&partnerType=customer&q=NEEDLE+PAYMENT`
  const list = await app.client.get(returnTo)
  const listHtml = await list.text()
  assert.equal(list.status, 200)
  assert.match(listHtml, /data-ui="list-page"/)
  assert.match(listHtml, /PAY\/HTTP\/LIST/)
  assert.match(listHtml, /Khách hàng thanh toán/)
  assert.match(listHtml, /data-row-href="\/admin\/accounting\/entries\/payment-http-list%3Amove\?lang=vi"/)
  assert.ok((listHtml.match(/data-ui="facet"/g) ?? []).length >= 3)
  assert.match(listHtml, /href="\/admin\/accounting\/payments\/new\?lang=vi&amp;returnTo=/)
  assert.doesNotMatch(listHtml, /payment-register-form|data-ui="modal-layer"|mail\.chatter/)

  const create = await app.client.get(`${path}/new?lang=vi&returnTo=${encodeURIComponent(returnTo)}`)
  const createHtml = await create.text()
  assert.equal(create.status, 200)
  assert.match(createHtml, /data-ui="form-page" data-scope="account-payment-form-page"/)
  assert.match(createHtml, /id="payment-register-form"/)
  for (const name of [
    'name',
    'paymentType',
    'partnerType',
    'partnerId',
    'journalId',
    'destinationAccountId',
    'amount',
    'date',
    'memo',
    'paymentReference',
    'reconcileLineId',
  ])
    assert.match(createHtml, new RegExp(`name="${name}"`), name)
  assert.equal((createHtml.match(/data-island="backend\.relation-select"/g) ?? []).length, 2)
  assert.match(createHtml, /type="hidden" name="action" value="register"/)
  assert.match(createHtml, /type="hidden" name="id" value="[^"]+"/)
  assert.match(createHtml, /href="\/admin\/accounting\/payments\?lang=vi&amp;state=paid/)
  assert.doesNotMatch(createHtml, /data-ui="list-page"|data-ui="modal-layer"|mail\.chatter/)

  const unsafe = await (await app.client.get(`${path}/new?lang=en&returnTo=https://evil.example/`)).text()
  assert.match(unsafe, /href="\/admin\/accounting\/payments\?lang=en"/)
  assert.doesNotMatch(unsafe, /evil\.example/)
  assert.equal((await app.client.request(`${path}/new`, { method: 'PUT' })).status, 405)
  for (const target of [path, `${path}/new`]) {
    const forged = await app.client.post(
      target,
      new URLSearchParams({ action: 'register', id: 'forged-payment' }),
      {
        headers: { ...formHeaders, origin: 'https://cross-site.example' },
        redirect: 'manual',
      },
    )
    assert.equal(forged.status, 403)
  }
})

test('payment POST retains every rejected value and retries one stable record', async (t) => {
  const { app, bankId, receivableId } = await bootPayments(t)
  const path = '/admin/accounting/payments'
  const returnTo = `${path}?lang=vi&state=paid`
  const formPath = `${path}/new?lang=vi&returnTo=${encodeURIComponent(returnTo)}`
  const rejected = await app.client.post(
    formPath,
    new URLSearchParams({
      action: 'register',
      id: 'payment-retry-token',
      name: 'PAY/RETRY',
      paymentType: 'inbound',
      partnerType: 'customer',
      partnerId: 'customer-payment',
      journalId: bankId,
      destinationAccountId: 'missing-control-account',
      amount: '225000',
      date: '2026-08-27',
      memo: 'Giá trị nhập dở',
      paymentReference: 'REF-RETRY',
      reconcileLineId: 'missing-open-item',
    }),
    post,
  )
  const rejectedHtml = await rejected.text()
  assert.equal(rejected.status, 200)
  assert.match(rejectedHtml, /data-ui="form-page"/)
  assert.match(rejectedHtml, /type="hidden" name="id" value="payment-retry-token"/)
  assert.match(rejectedHtml, /name="name"[^>]*value="PAY\/RETRY"/)
  assert.match(rejectedHtml, /name="amount"[^>]*value="225000"/)
  assert.match(rejectedHtml, /name="date"[^>]*value="2026-08-27"/)
  assert.match(rejectedHtml, /name="memo"[^>]*value="Giá trị nhập dở"/)
  assert.match(rejectedHtml, /name="paymentReference"[^>]*value="REF-RETRY"/)
  assert.match(rejectedHtml, /&quot;value&quot;:&quot;customer-payment&quot;/)
  assert.match(rejectedHtml, /&quot;value&quot;:&quot;missing-control-account&quot;/)
  assert.match(rejectedHtml, /<option value="missing-open-item" selected="true">/)
  assert.match(rejectedHtml, /href="\/admin\/accounting\/payments\?lang=vi&amp;state=paid"/)

  const body = new URLSearchParams({
    action: 'register',
    id: 'payment-retry-token',
    name: 'PAY/RETRY',
    paymentType: 'inbound',
    partnerType: 'customer',
    partnerId: 'customer-payment',
    journalId: bankId,
    destinationAccountId: receivableId,
    amount: '225000',
    memo: 'Thanh toán retry hoàn chỉnh',
    paymentReference: 'REF-RETRY',
  })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const saved = await app.client.post(formPath, new URLSearchParams(body), post)
    assert.equal(saved.status, 303)
    assert.equal(saved.headers.get('location'), returnTo)
  }
  const payments = (await app.client.call<Row[]>('account.listPayments', {})).value
  assert.equal(payments.filter((row) => row.id === 'payment-retry-token').length, 1)

  const invalidAction = await app.client.post(
    `${path}/new?lang=vi`,
    new URLSearchParams({ action: 'archive', id: 'payment-wrong-action' }),
    post,
  )
  assert.equal(invalidAction.status, 400)
  assert.ok(
    !(await app.client.call<Row[]>('account.listPayments', {})).value.some(
      (row) => row.id === 'payment-wrong-action',
    ),
  )

  const legacy = await app.client.post(
    `${path}?lang=en`,
    new URLSearchParams({
      id: 'payment-legacy-post',
      name: 'PAY/LEGACY',
      paymentType: 'inbound',
      partnerType: 'customer',
      partnerId: 'customer-payment',
      journalId: bankId,
      destinationAccountId: receivableId,
      amount: '1000',
    }),
    post,
  )
  assert.equal(legacy.status, 303)
  assert.equal(legacy.headers.get('location'), `${path}?lang=en`)
})
