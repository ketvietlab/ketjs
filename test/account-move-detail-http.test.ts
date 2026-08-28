import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const bootMoves = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => app.fixture.call(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
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
  await app.client.get('/admin/accounting?lang=vi')
  return app
}

test('shared accounting detail aliases render FormPage with one-third collaboration and document semantics', async (t) => {
  const app = await bootMoves(t)
  await app.client.call('partner.savePartner', { id: 'customer', kind: 'company', name: 'Khách hàng' })
  await app.client.call('partner.savePartner', { id: 'vendor', kind: 'company', name: 'Nhà cung cấp' })
  const journals = (await app.client.call<Row[]>('account.listJournals', {})).value
  const journal = (type: string) => String(journals.find((row) => row.type === type)?.id)
  await app.client.call('account.createMove', {
    id: 'entry-detail',
    journalId: journal('general'),
    moveType: 'entry',
    ref: 'Điều chỉnh HTTP',
  })
  await app.client.call('account.createInvoice', {
    id: 'customer-detail',
    journalId: journal('sale'),
    moveType: 'out_invoice',
    partnerId: 'customer',
    description: 'Doanh thu HTTP',
    quantity: '1',
    priceUnit: '100000',
  })
  await app.client.call('account.createInvoice', {
    id: 'vendor-detail',
    journalId: journal('purchase'),
    moveType: 'in_invoice',
    partnerId: 'vendor',
    description: 'Chi phí HTTP',
    quantity: '1',
    priceUnit: '80000',
  })

  for (const [path, id] of [
    ['/admin/accounting/entries/entry-detail', 'entry-detail'],
    ['/admin/accounting/customer-invoices/customer-detail', 'customer-detail'],
    ['/admin/accounting/vendor-bills/vendor-detail', 'vendor-detail'],
  ]) {
    const response = await app.client.get(`${path}?lang=vi`)
    const html = await response.text()
    assert.equal(response.status, 200, path)
    assert.match(html, /data-ui="form-page" data-scope="account-move-detail-form-page" data-has-aside="true"/)
    assert.match(html, /data-ui="form-page-layout"[\s\S]*?data-ui="form-page-aside"/)
    assert.match(html, /data-island="mail\.chatter"/)
    assert.match(html, /data-island="activity\.record"/)
    assert.ok(html.includes(`action="${path}?lang=vi"`))
    assert.match(html, /name="action" value="post"/)
    assert.match(html, /name="expectedRevision" value="0"/)
    assert.match(html, /id="account-move-line-form"/)
    assert.match(html, /name="lineId" value="[^"]+"/)
    assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="record-aside"/)
    assert.ok(html.includes(id === 'entry-detail' ? 'Điều chỉnh HTTP' : 'Bút toán nháp'))
  }

  const wrongAlias = await app.client.request('/admin/accounting/customer-invoices/vendor-detail?lang=vi', {
    redirect: 'manual',
  })
  assert.equal(wrongAlias.status, 303)
  assert.equal(wrongAlias.headers.get('location'), '/admin/accounting/vendor-bills/vendor-detail?lang=vi')
  const wrongAliasPost = await app.client.post(
    '/admin/accounting/entries/customer-detail?lang=en',
    new URLSearchParams({ action: 'post', expectedRevision: '0' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(wrongAliasPost.status, 303)
  assert.equal(
    wrongAliasPost.headers.get('location'),
    '/admin/accounting/customer-invoices/customer-detail?lang=en',
  )
  assert.equal(
    (await app.client.call<Row>('account.getMove', { id: 'customer-detail' })).value.state,
    'draft',
    'a POST through the wrong alias must redirect before mutating the document',
  )

  assert.equal(
    (await app.client.request('/admin/accounting/entries/entry-detail', { method: 'PUT' })).status,
    405,
  )
  assert.equal((await app.client.get('/admin/accounting/entries/missing-move')).status, 404)
})

test('move detail HTTP preserves CSRF, rejected line values, version checks and stable retry IDs', async (t) => {
  const app = await bootMoves(t)
  const accounts = (await app.client.call<Row[]>('account.listAccounts', {})).value
  const journals = (await app.client.call<Row[]>('account.listJournals', {})).value
  const accountId = (code: string) => String(accounts.find((row) => row.code === code)?.id)
  const generalJournalId = String(journals.find((row) => row.type === 'general')?.id)
  const path = '/admin/accounting/entries/entry-write'
  await app.client.call('account.createMove', {
    id: 'entry-write',
    journalId: generalJournalId,
    moveType: 'entry',
  })
  await app.client.call('account.addMoveLine', {
    id: 'entry-write:debit',
    moveId: 'entry-write',
    name: 'Nợ',
    accountId: accountId('112'),
    debit: '100000',
  })
  await app.client.call('account.addMoveLine', {
    id: 'entry-write:credit',
    moveId: 'entry-write',
    name: 'Có',
    accountId: accountId('511'),
    credit: '100000',
  })

  const crossSite = await app.client.post(
    `${path}?lang=vi`,
    new URLSearchParams({ action: 'post', expectedRevision: '0' }),
    {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://cross-site.example',
      },
      redirect: 'manual',
    },
  )
  assert.equal(crossSite.status, 403)

  const stale = await app.client.post(
    `${path}?lang=vi`,
    new URLSearchParams({ action: 'post', expectedRevision: '99' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  const staleHtml = await stale.text()
  assert.equal(stale.status, 200)
  assert.match(staleHtml, /data-ui="form-page"/)
  assert.match(staleHtml, /data-ui="notice"[^>]*data-tone="danger"/)
  assert.equal((await app.client.call<Row>('account.getMove', { id: 'entry-write' })).value.state, 'draft')

  const posted = await app.client.post(
    `${path}?lang=vi`,
    new URLSearchParams({ action: 'post', expectedRevision: '2' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(posted.status, 303)
  assert.equal(posted.headers.get('location'), `${path}?lang=vi`)
  const postedHtml = await (await app.client.get(`${path}?lang=vi`)).text()
  const reversalId = /name="reversalId" value="([^"]+)"/.exec(postedHtml)?.[1]
  assert.ok(reversalId)
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const reversed = await app.client.post(
      `${path}?lang=vi`,
      new URLSearchParams({ action: 'reverse', reversalId }),
      { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
    )
    assert.equal(reversed.status, 303)
    assert.equal(reversed.headers.get('location'), `/admin/accounting/entries/${reversalId}?lang=vi`)
  }
  const moves = (await app.client.call<Row[]>('account.listMoves', { moveType: 'entry' })).value
  assert.equal(moves.filter((row) => row.id === reversalId).length, 1)

  const linePath = '/admin/accounting/entries/entry-line-retry'
  await app.client.call('account.createMove', {
    id: 'entry-line-retry',
    journalId: generalJournalId,
    moveType: 'entry',
  })
  for (const action of ['', 'typo']) {
    const unknown = await app.client.post(
      `${linePath}?lang=vi`,
      new URLSearchParams({
        ...(action ? { action } : {}),
        lineId: `unknown-${action || 'missing'}`,
        name: 'Không được thêm',
        accountId: accountId('112'),
        debit: '10',
        credit: '0',
      }),
      { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
    )
    assert.equal(unknown.status, 400)
  }
  assert.equal(
    ((await app.client.call<Row>('account.getMove', { id: 'entry-line-retry' })).value.lines as Row[]).length,
    0,
    'unknown and missing commands must not fall through to addMoveLine',
  )

  const missingAccount = await app.client.post(
    `${linePath}?lang=vi`,
    new URLSearchParams({
      action: 'add-line',
      lineId: 'missing-account-line',
      name: 'Tài khoản vừa bị xoá',
      accountId: 'missing-account',
      debit: '10',
      credit: '0',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  const missingAccountHtml = await missingAccount.text()
  assert.equal(missingAccount.status, 200)
  assert.match(missingAccountHtml, /<option value="missing-account" selected="true">/)
  assert.match(missingAccountHtml, /name="accountId"[^>]*aria-invalid="true"/)

  const invalid = await app.client.post(
    `${linePath}?lang=vi`,
    new URLSearchParams({
      action: 'add-line',
      lineId: 'stable-line-id',
      name: 'Dòng nhập dở',
      accountId: accountId('112'),
      partnerId: 'partner-draft',
      debit: '10',
      credit: '10',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  const invalidHtml = await invalid.text()
  assert.equal(invalid.status, 200)
  assert.match(invalidHtml, /name="lineId" value="stable-line-id"/)
  assert.match(invalidHtml, /name="name"[^>]*value="Dòng nhập dở"/)
  assert.match(invalidHtml, /name="debit"[^>]*value="10"[^>]*aria-invalid="true"/)
  assert.match(invalidHtml, /name="credit"[^>]*value="10"/)

  const corrected = new URLSearchParams({
    action: 'add-line',
    lineId: 'stable-line-id',
    name: 'Dòng hoàn chỉnh',
    accountId: accountId('112'),
    debit: '10',
    credit: '0',
  })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const saved = await app.client.post(`${linePath}?lang=vi`, corrected, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    })
    assert.equal(saved.status, 303)
    assert.equal(saved.headers.get('location'), `${linePath}?lang=vi`)
  }
  const lineMove = (await app.client.call<Row>('account.getMove', { id: 'entry-line-retry' }))
    .value as Row & {
    lines: Row[]
  }
  assert.equal(lineMove.lines.filter((line) => line.id === 'stable-line-id').length, 1)

  const cancelPath = '/admin/accounting/entries/entry-cancel-cas'
  await app.client.call('account.createMove', {
    id: 'entry-cancel-cas',
    journalId: generalJournalId,
    moveType: 'entry',
  })
  const staleCancel = await app.client.post(
    `${cancelPath}?lang=en`,
    new URLSearchParams({ action: 'cancel', expectedRevision: '99' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(staleCancel.status, 200)
  assert.match(await staleCancel.text(), /data-ui="notice"[^>]*data-tone="danger"/)
  assert.equal(
    (await app.client.call<Row>('account.getMove', { id: 'entry-cancel-cas' })).value.state,
    'draft',
  )
  const cancelled = await app.client.post(
    `${cancelPath}?lang=en`,
    new URLSearchParams({ action: 'cancel', expectedRevision: '0' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(cancelled.status, 303)
  assert.equal(cancelled.headers.get('location'), `${cancelPath}?lang=en`)
  assert.equal(
    (await app.client.call<Row>('account.getMove', { id: 'entry-cancel-cas' })).value.state,
    'cancel',
  )
})
