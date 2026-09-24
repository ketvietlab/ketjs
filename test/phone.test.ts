import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { tableNameFor, type Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { normalizePhone, phoneKey, phoneSearchFragment } from '../packages/ketsuite/src/phone.ts'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

test('phone: every Vietnamese spelling of one subscriber is one E.164 number', () => {
  for (const spelling of [
    '0708580468',
    '0708 580 468',
    '070.858.0468',
    '+84708580468',
    '+84 708 580 468',
    '+84 0708 580 468',
    '0084708580468',
    '84708580468',
    '708580468',
    '０７０８５８０４６８',
  ])
    assert.equal(normalizePhone(spelling), '+84708580468', spelling)
  assert.equal(normalizePhone('02438251234'), '+842438251234', 'landlines keep their area code')
})

test('phone: a number that cannot be read is kept, never given a guessed country', () => {
  assert.equal(normalizePhone('+6591234567'), '+6591234567')
  assert.equal(normalizePhone('12345'), null)
  assert.equal(normalizePhone('123456789'), null, 'nine digits that are not a Vietnamese number stay unread')
  assert.equal(normalizePhone(''), null)
  assert.equal(normalizePhone('không có'), null)
  assert.equal(phoneKey('12345'), '12345')
  assert.equal(phoneKey('0708580468'), '+84708580468')
  assert.equal(phoneKey(null), null)
})

test('phone: a partial search matches the stored E.164 number', () => {
  assert.equal(phoneSearchFragment('0708'), '+84708')
  assert.equal(phoneSearchFragment('580 468'), '580468')
  assert.equal(phoneSearchFragment('0708580468'), '+84708580468')
  assert.equal(phoneSearchFragment('Minh Anh'), null)
})

async function boot(t: TestContext) {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const call = async <T = Row>(name: string, input: Record<string, unknown> = {}) =>
    ((await e2e.fixture.call(name, input, { scope })) as { value: T }).value
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  return { e2e, call }
}

test('phone: partners are stored, found and backfilled by E.164', async (t) => {
  const { e2e, call } = await boot(t)
  await call('partner.savePartner', { id: 'minh', kind: 'person', name: 'Minh Anh', phone: '0708 580 468' })
  const stored = async (id: string) =>
    (
      await e2e.adapter!.all(
        `SELECT phone FROM ${e2e.adapter!.quoteIdent(tableNameFor('partner.Partner'))} WHERE id = '${id}'`,
      )
    )[0]?.phone
  assert.equal(await stored('minh'), '+84708580468')

  for (const search of ['0708580468', '+84 708 580 468', '0708', '580468']) {
    const rows = await call<Row[]>('partner.listPartners', { search })
    assert.deepEqual(
      rows.map((row) => row.id),
      ['minh'],
      search,
    )
  }

  // A row written before normalisation, as older builds stored it.
  await call('partner.savePartner', { id: 'legacy', kind: 'person', name: 'Khách cũ', phone: '0909000123' })
  await e2e.adapter!.exec(
    `UPDATE ${e2e.adapter!.quoteIdent(tableNameFor('partner.Partner'))} SET phone = '0909000123' WHERE id = 'legacy'`,
  )
  const first = await call<Row>('partner.normalizePartnerPhones', { limit: 1 })
  assert.equal(first.scanned, 1)
  assert.ok(first.next)
  let next: unknown = first.next
  let changed = Number(first.changed)
  while (next) {
    const page = await call<Row>('partner.normalizePartnerPhones', { after: next, limit: 1 })
    changed += Number(page.changed)
    next = page.next
  }
  assert.equal(changed, 1)
  assert.equal(await stored('legacy'), '+84909000123')
  const again = await call<Row>('partner.normalizePartnerPhones', { limit: 5_000 })
  assert.equal(again.changed, 0, 'rerunning changes nothing')
})
