import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const bootDefaults = async (t: TestContext) => {
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
  await fixture('product.saveCategory', { id: 'services', name: 'Dịch vụ' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  return app
}

test('account defaults HTTP keeps relations, locale, CSRF, rejected values and separate POST actions', async (t) => {
  const app = await bootDefaults(t)
  const path = '/admin/accounting/defaults'

  const page = await app.client.get(`${path}?lang=vi`)
  const html = await page.text()
  assert.equal(page.status, 200)
  assert.match(html, /data-ui="form-page" data-scope="account-defaults-form-page"/)
  assert.match(html, /id="account-defaults-form"/)
  assert.match(html, /id="account-category-form"/)
  assert.match(html, /name="action" value="category"/)
  assert.match(html, /action="\/admin\/accounting\/defaults\?lang=vi"/)
  assert.match(html, /Chưa nhóm nào có tài khoản riêng/)
  assert.equal((html.match(/data-island="backend\.relation-select"/g) ?? []).length, 6)
  assert.match(html, /&quot;listFunction&quot;:&quot;account\.listAccounts&quot;/)
  assert.doesNotMatch(html, /data-ui="record-workspace"|data-ui="modal-layer"|mail\.chatter/)
  const initialDefaults = (await app.client.call<Row>('account.getDefaults', {})).value

  const unsupported = await app.client.request(`${path}?lang=vi`, { method: 'PUT' })
  assert.equal(unsupported.status, 405)

  const crossSite = await app.client.post(
    `${path}?lang=vi`,
    new URLSearchParams({ incomeAccountId: 'missing-account' }),
    {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://cross-site.example',
      },
      redirect: 'manual',
    },
  )
  assert.equal(crossSite.status, 403)

  const rejected = await app.client.post(
    `${path}?lang=vi`,
    new URLSearchParams({
      incomeAccountId: 'missing-account',
      expenseAccountId: 'also-missing',
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  const rejectedHtml = await rejected.text()
  assert.equal(rejected.status, 200)
  assert.match(rejectedHtml, /data-ui="form-page"/)
  assert.match(rejectedHtml, /data-ui="form-errors" role="alert"/)
  assert.match(rejectedHtml, /&quot;value&quot;:&quot;missing-account&quot;/)
  assert.match(rejectedHtml, /&quot;value&quot;:&quot;also-missing&quot;/)

  const accounts = (await app.client.call<Row[]>('account.listAccounts', {})).value
  const idOf = (code: string) => String(accounts.find((row) => row.code === code)?.id)
  const savedDefaults = await app.client.post(
    `${path}?lang=en`,
    new URLSearchParams({ incomeAccountId: idOf('515'), receivableAccountId: idOf('1311') }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(savedDefaults.status, 303)
  assert.equal(savedDefaults.headers.get('location'), '/admin/accounting/defaults?lang=en')
  const defaults = (await app.client.call<Row>('account.getDefaults', {})).value
  assert.equal(defaults.incomeAccountId, idOf('515'))
  assert.equal(defaults.receivableAccountId, idOf('1311'))
  assert.equal(defaults.expenseAccountId, initialDefaults.expenseAccountId)
  assert.equal(defaults.payableAccountId, initialDefaults.payableAccountId)

  const rejectedCategory = await app.client.post(
    `${path}?lang=vi&editCategory=services`,
    new URLSearchParams({
      action: 'category',
      categoryId: 'services',
      incomeAccountId: 'missing-category-income',
      expenseAccountId: idOf('632'),
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  const rejectedCategoryHtml = await rejectedCategory.text()
  assert.equal(rejectedCategory.status, 200)
  assert.match(rejectedCategoryHtml, /Đặt tài khoản cho nhóm sản phẩm/)
  assert.match(rejectedCategoryHtml, /name="categoryId"[\s\S]*?value="services"[^>]*selected/)
  assert.match(rejectedCategoryHtml, /&quot;value&quot;:&quot;missing-category-income&quot;/)
  assert.match(rejectedCategoryHtml, new RegExp(`&quot;value&quot;:&quot;${idOf('632')}&quot;`))

  const savedCategory = await app.client.post(
    `${path}?lang=en&editCategory=services`,
    new URLSearchParams({
      action: 'category',
      categoryId: 'services',
      incomeAccountId: idOf('515'),
      expenseAccountId: idOf('632'),
    }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(savedCategory.status, 303)
  assert.equal(savedCategory.headers.get('location'), '/admin/accounting/defaults?lang=en')
  const categoryRows = (await app.client.call<Row[]>('account.listCategoryAccounts', {})).value
  assert.equal(categoryRows[0]?.categoryId, 'services')
  assert.equal(categoryRows[0]?.incomeAccountId, idOf('515'))
  assert.equal(categoryRows[0]?.expenseAccountId, idOf('632'))

  const edited = await (await app.client.get(`${path}?lang=en&editCategory=services`)).text()
  assert.match(edited, /Edit a product category/)
  assert.match(edited, /href="\/admin\/accounting\/defaults\?lang=en"/)
  assert.match(edited, /515 ·/)
  assert.match(edited, /632 ·/)
})
