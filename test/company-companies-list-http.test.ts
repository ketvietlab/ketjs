import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

async function bootCompanies(t: TestContext) {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'company-00', branch: 'root:company-00', branches: ['root:company-00'] }
  const fixture = async (name: string, input: Record<string, unknown>, actor?: string) =>
    (await e2e.fixture.call<Row>(name, input, { scope, actor })).value

  for (let index = 0; index < 32; index++) {
    const suffix = String(index).padStart(2, '0')
    const id = `company-${suffix}`
    const name =
      index === 5
        ? 'Display Needle Holdings'
        : index === 31
          ? 'Special Archived Company'
          : `Company ${suffix}`
    await fixture('partner.savePartner', { id: `partner-${suffix}`, kind: 'company', name })
    await fixture('company.saveCompany', {
      id,
      code: `C${suffix}`,
      partnerId: `partner-${suffix}`,
      currency: index === 7 ? 'EUR' : index === 8 ? 'USD' : 'VND',
    })
  }
  await fixture('user.archiveCompany', { id: 'company-31', active: false })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    defaultCompanyId: 'company-00',
    defaultBranchId: 'root:company-00',
    superuser: true,
  })
  await fixture('user.grantCompany', {
    id: 'admin:company-00',
    userId: 'admin',
    companyId: 'company-00',
  })
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  return e2e
}

test('company list HTTP keeps stable order, exact archived inclusion, paging and locale-safe chrome', async (t) => {
  const e2e = await bootCompanies(t)
  const first = await (await e2e.client.get('/admin/companies?lang=en')).text()
  assert.match(first, /data-ui="list-page"/)
  assert.match(first, /data-ui="list-chrome" data-layout="command"/)
  assert.match(first, /1-30 \/ 31/)
  assert.match(
    first,
    /data-row-href="\/admin\/companies\/company-00\?lang=en&amp;returnTo=%2Fadmin%2Fcompanies%3Flang%3Den"/,
  )
  assert.doesNotMatch(first, /company-30|company-31|Special Archived Company/)
  assert.ok(first.indexOf('/admin/companies/company-00') < first.indexOf('/admin/companies/company-01'))
  assert.match(
    first,
    /href="\/admin\/companies\/new\?lang=en&amp;returnTo=%2Fadmin%2Fcompanies%3Flang%3Den"/,
  )
  assert.match(first, /href="\/admin\/companies\/hierarchy\?lang=en"/)

  const activeSecond = await (await e2e.client.get('/admin/companies?page=2&lang=en')).text()
  assert.match(activeSecond, /31-31 \/ 31/)
  assert.match(activeSecond, /company-30/)
  assert.doesNotMatch(activeSecond, /company-31|Special Archived Company/)

  const archivedSecond = await (await e2e.client.get('/admin/companies?archived=1&page=2&lang=en')).text()
  assert.match(archivedSecond, /31-32 \/ 32/)
  assert.match(archivedSecond, /company-30/)
  assert.match(archivedSecond, /company-31/)
  assert.match(archivedSecond, /Special Archived Company/)
  assert.ok(
    archivedSecond.indexOf('/admin/companies/company-30') <
      archivedSecond.indexOf('/admin/companies/company-31'),
  )

  for (const value of ['0', 'true', 'yes']) {
    const exact = await (await e2e.client.get(`/admin/companies?archived=${value}&lang=en`)).text()
    assert.doesNotMatch(exact, /company-31|Special Archived Company/, value)
  }

  const stateful = await (await e2e.client.get('/admin/companies?q=Company&archived=1&page=2&lang=en')).text()
  assert.match(stateful, /name="q"[^>]*value="Company"/)
  assert.match(stateful, /type="hidden" name="archived" value="1"/)
  assert.match(stateful, /type="hidden" name="lang" value="en"/)
  assert.match(stateful, /href="\/admin\/companies\?q=Company&amp;lang=en"/)
  assert.doesNotMatch(stateful, /href="\/admin\/companies\?q=Company&amp;page=2&amp;lang=en"/)
  assert.equal((await e2e.client.request('/admin/companies?lang=en', { method: 'PUT' })).status, 405)
})

test('company list HTTP searches code, display name and currency before exact paging', async (t) => {
  const e2e = await bootCompanies(t)
  const byCode = await (await e2e.client.get('/admin/companies?q=C05&lang=en')).text()
  assert.match(byCode, /Display Needle Holdings/)
  assert.match(byCode, /Companies: 1/)
  assert.doesNotMatch(byCode, /data-ui="pager"/)

  const byName = await (await e2e.client.get('/admin/companies?q=needle&lang=en')).text()
  assert.match(byName, /C05/)
  assert.doesNotMatch(byName, /C04|C06/)

  const byCurrency = await (await e2e.client.get('/admin/companies?q=eur&lang=en')).text()
  assert.match(byCurrency, /C07/)
  assert.doesNotMatch(byCurrency, /C08/)

  const archived = await (
    await e2e.client.get('/admin/companies?q=special%20archived&archived=1&lang=en')
  ).text()
  assert.match(archived, /Special Archived Company/)
  const activeOnly = await (await e2e.client.get('/admin/companies?q=special%20archived&lang=en')).text()
  assert.match(activeOnly, /No companies yet/)
  assert.doesNotMatch(activeOnly, /Special Archived Company/)
})
