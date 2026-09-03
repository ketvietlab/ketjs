import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite)
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })

  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', { id: 'admin-party', kind: 'person', name: 'Administrator' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    partnerId: 'admin-party',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', {
    id: 'admin:acme',
    userId: 'admin',
    companyId: 'acme',
  })
  await app.client.login({ login: 'admin', password: 'correct horse' })

  const call = async <T = Row>(name: string, input: Record<string, unknown>) =>
    (await app.client.call<T>(name, input)).value
  for (const [id, key, name] of [
    ['platform', 'PLAT', 'Internal platform'],
    ['sales', 'SALE', 'Sales workspace'],
  ]) {
    await call('flow.project.save', {
      values: { id, key, name },
      idempotencyKey: `project-${id}`,
    })
  }
  for (let index = 1; index <= 52; index++) {
    const number = String(index).padStart(2, '0')
    await call('flow.page.save', {
      id: `guide-${number}`,
      projectId: index === 52 ? 'sales' : 'platform',
      title: `Guide ${number}`,
      idempotencyKey: `page-guide-${number}`,
    })
  }
  return app
}

test('flow all pages route: ListPage preserves cross-project links, search state, locale and paging', async (t) => {
  const app = await boot(t)
  const firstPath = '/admin/flow/pages?q=Guide&filter=project%3Aplatform&group=project&lang=en'
  const first = await app.client.get(firstPath)
  const firstHtml = await first.text()
  const firstText = firstHtml.replace(/<!--k\[?-->/g, '')

  assert.equal(first.status, 200)
  assert.match(firstHtml, /data-ui="list-page"/)
  assert.doesNotMatch(firstHtml, /data-ui="record-workspace"|data-ui="form-page"|livedoc\.editor/)
  assert.match(firstText, /data-ui="list-page-title">All docs/)
  assert.match(firstText, /data-ui="list-page-footer">All docs: 52/)
  assert.match(firstHtml, /name="q"[^>]*value="Guide"/)
  assert.match(firstHtml, /name="filter" value="project:platform"/)
  assert.match(firstHtml, /name="group" value="project"/)
  assert.match(firstHtml, /name="lang" value="en"/)
  assert.equal(firstHtml.match(/data-ui="row"/g)?.length, 50)
  assert.match(firstText, /data-ui="pager-range">1-50 \/ 52/)
  assert.match(
    firstHtml,
    /href="\/admin\/flow\/pages\?q=Guide&amp;filter=project%3Aplatform&amp;group=project&amp;lang=en&amp;page=2"/,
  )
  assert.match(firstHtml, /href="\/admin\/flow\/pages\/guide-[0-9]+\?lang=en"/)
  assert.match(firstHtml, /href="\/admin\/flow\/projects\/(?:platform|sales)\/pages\?lang=en"/)
  assert.match(firstText, /Internal platform|Sales workspace/)

  const second = await app.client.get(`${firstPath}&page=2`)
  const secondHtml = await second.text()
  const secondText = secondHtml.replace(/<!--k\[?-->/g, '')
  assert.equal(second.status, 200)
  assert.equal(secondHtml.match(/data-ui="row"/g)?.length, 2)
  assert.match(secondText, /data-ui="pager-range">51-52 \/ 52/)
  assert.match(
    secondHtml,
    /href="\/admin\/flow\/pages\?q=Guide&amp;filter=project%3Aplatform&amp;group=project&amp;lang=en"/,
  )
  assert.doesNotMatch(secondHtml, /name="page"/)

  const empty = await app.client.get('/admin/flow/pages?q=does-not-exist&lang=en')
  const emptyHtml = await empty.text()
  assert.equal(empty.status, 200)
  assert.match(emptyHtml, /data-ui="list-page"/)
  assert.match(emptyHtml.replace(/<!--k\[?-->/g, ''), /All docs: 0/)
  assert.match(emptyHtml.replace(/<!--k\[?-->/g, ''), /Nothing here yet/)

  const refused = await app.client.post('/admin/flow/pages?lang=en', new URLSearchParams(), {
    redirect: 'manual',
  })
  assert.equal(refused.status, 405)
})
