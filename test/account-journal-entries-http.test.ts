import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const bootEntries = async (t: TestContext) => {
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
  return app
}

test('journal entries HTTP keeps list filters, URL modal, locale and safe return state', async (t) => {
  const app = await bootEntries(t)
  const path = '/admin/accounting/entries'

  const initial = await app.client.get(`${path}?lang=vi`)
  const initialHtml = await initial.text()
  assert.equal(initial.status, 200)
  assert.match(initialHtml, /data-ui="list-page"/)
  assert.match(initialHtml, /href="\/admin\/accounting\/entries\?lang=vi&amp;create=1"/)
  assert.doesNotMatch(initialHtml, /id="journal-entry-create-form"|data-ui="modal-layer"|mail\.chatter/)

  const journals = (await app.client.call<Row[]>('account.listJournals', {})).value
  const generalJournalId = String(journals.find((row) => row.type === 'general')?.id)
  await app.client.call('partner.savePartner', {
    id: 'entry-partner',
    kind: 'company',
    name: 'Đối tác bút toán',
  })
  await app.client.call('account.createMove', {
    id: 'draft-search-entry',
    journalId: generalJournalId,
    moveType: 'entry',
    ref: 'NEEDLE-ENTRY',
  })

  const modal = await app.client.get(`${path}?lang=vi&state=draft&q=NEEDLE-ENTRY&create=1`)
  const modalHtml = await modal.text()
  assert.equal(modal.status, 200)
  assert.match(modalHtml, /data-ui="list-page"/)
  assert.match(modalHtml, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(modalHtml, /id="journal-entry-create-form"/)
  assert.match(modalHtml, /name="journalId"/)
  assert.match(modalHtml, /name="moveType"/)
  assert.match(modalHtml, /name="date"/)
  assert.match(modalHtml, /name="ref"/)
  assert.match(modalHtml, /data-island="backend\.relation-select"/)
  assert.match(modalHtml, /type="hidden" name="id" value="[^"]+"/)
  assert.match(
    modalHtml,
    /action="\/admin\/accounting\/entries\?lang=vi&amp;state=draft&amp;q=NEEDLE-ENTRY&amp;create=1"/,
  )
  assert.match(modalHtml, /href="\/admin\/accounting\/entries\?lang=vi&amp;state=draft&amp;q=NEEDLE-ENTRY"/)
  assert.match(modalHtml, /data-row-href="\/admin\/accounting\/entries\/draft-search-entry\?lang=vi"/)

  const unsupported = await app.client.request(`${path}?lang=vi`, { method: 'PUT' })
  assert.equal(unsupported.status, 405)
  const crossSite = await app.client.post(
    `${path}?lang=vi&create=1`,
    new URLSearchParams({ id: 'cross-site-entry', journalId: generalJournalId, moveType: 'entry' }),
    {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://cross-site.example',
      },
      redirect: 'manual',
    },
  )
  assert.equal(crossSite.status, 403)
})

test('journal entry collection POST preserves rejected fields and is retry-idempotent', async (t) => {
  const app = await bootEntries(t)
  const path = '/admin/accounting/entries'
  await app.client.get(`${path}?lang=vi`)
  const journals = (await app.client.call<Row[]>('account.listJournals', {})).value
  const generalJournalId = String(journals.find((row) => row.type === 'general')?.id)

  const rejected = await app.client.post(
    `${path}?lang=vi&state=draft`,
    new URLSearchParams({
      id: 'entry-retry-token',
      journalId: 'missing-journal',
      moveType: 'entry',
      date: '2026-08-27',
      ref: 'Giá trị nhập dở',
      partnerId: 'missing-partner',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  const rejectedHtml = await rejected.text()
  assert.equal(rejected.status, 200)
  assert.match(rejectedHtml, /data-ui="list-page"/)
  assert.match(rejectedHtml, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(rejectedHtml, /data-ui="form-errors" role="alert"/)
  assert.match(rejectedHtml, /type="hidden" name="id" value="entry-retry-token"/)
  assert.match(rejectedHtml, /name="journalId"[\s\S]*?aria-invalid="true"/)
  assert.match(rejectedHtml, /name="date"[^>]*value="2026-08-27"/)
  assert.match(rejectedHtml, /name="ref"[^>]*value="Giá trị nhập dở"/)
  assert.match(rejectedHtml, /&quot;value&quot;:&quot;missing-partner&quot;/)
  assert.match(rejectedHtml, /href="\/admin\/accounting\/entries\?lang=vi&amp;state=draft"/)

  const body = new URLSearchParams({
    id: 'entry-retry-token',
    journalId: generalJournalId,
    moveType: 'entry',
    date: '2026-08-27',
    ref: 'Bút toán retry',
  })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const saved = await app.client.post(`${path}?lang=en&create=1`, body, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      redirect: 'manual',
    })
    assert.equal(saved.status, 303)
    assert.equal(saved.headers.get('location'), '/admin/accounting/entries/entry-retry-token?lang=en')
  }
  const entries = (await app.client.call<Row[]>('account.listMoves', { moveType: 'entry' })).value
  assert.equal(entries.filter((row) => row.id === 'entry-retry-token').length, 1)
  assert.equal(entries.find((row) => row.id === 'entry-retry-token')?.ref, 'Bút toán retry')
})
