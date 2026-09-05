import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const boot = async (t: TestContext, epicCount = 52) => {
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
  for (let index = 1; index <= epicCount; index += 1) {
    const number = String(index).padStart(3, '0')
    await call('flow.epic.save', {
      values: {
        id: `release-${number}`,
        projectId: index === epicCount ? 'sales' : 'platform',
        title: `Release ${number}`,
      },
      idempotencyKey: `epic-release-${number}`,
    })
  }
  await call('flow.epic.save', {
    values: { id: 'archived-release', projectId: 'platform', title: 'Release archived' },
    idempotencyKey: 'epic-archived-release',
  })
  await call('flow.epic.archive', { id: 'archived-release' })
  return { app, call }
}

test('flow all epics route: ListPage preserves stable cross-project paging, locale and search state', async (t) => {
  const { app } = await boot(t)
  const firstPath = '/admin/flow/epics?q=Release&filter=project%3Aplatform&group=project&lang=en'
  const first = await app.client.get(firstPath)
  const firstHtml = await first.text()
  const firstText = firstHtml.replace(/<!--k\[?-->/g, '')

  assert.equal(first.status, 200)
  assert.match(firstHtml, /data-ui="list-page"/)
  assert.doesNotMatch(
    firstHtml,
    /data-ui="record-workspace"|data-ui="form-page"|data-ui="modal-layer"|livedoc\.editor/,
  )
  assert.match(firstText, /data-ui="list-page-title">All epics/)
  assert.match(firstText, /data-ui="list-page-footer">All epics: 52/)
  assert.match(firstHtml, /name="q"[^>]*value="Release"/)
  assert.match(firstHtml, /name="filter" value="project:platform"/)
  assert.match(firstHtml, /name="group" value="project"/)
  assert.match(firstHtml, /name="lang" value="en"/)
  assert.equal(firstHtml.match(/data-ui="row"/g)?.length, 50)
  assert.match(firstText, /data-ui="pager-range">1-50 \/ 52/)
  assert.match(
    firstHtml,
    /href="\/admin\/flow\/epics\?q=Release&amp;filter=project%3Aplatform&amp;group=project&amp;lang=en&amp;page=2"/,
  )
  assert.match(firstHtml, /href="\/admin\/flow\/epics\/release-[0-9]+\?lang=en"/)
  assert.match(firstHtml, /href="\/admin\/flow\/projects\/platform\/epics\?lang=en"/)
  assert.match(firstText, /Internal platform/)
  assert.doesNotMatch(firstText, /Release archived/)

  const second = await app.client.get(`${firstPath}&page=2`)
  const secondHtml = await second.text()
  const secondText = secondHtml.replace(/<!--k\[?-->/g, '')
  assert.equal(second.status, 200)
  assert.equal(secondHtml.match(/data-ui="row"/g)?.length, 2)
  assert.match(secondText, /data-ui="pager-range">51-52 \/ 52/)
  assert.match(secondHtml, /href="\/admin\/flow\/projects\/sales\/epics\?lang=en"/)
  assert.match(
    secondHtml,
    /href="\/admin\/flow\/epics\?q=Release&amp;filter=project%3Aplatform&amp;group=project&amp;lang=en"/,
  )
  assert.doesNotMatch(secondHtml, /name="page"/)

  const filtered = await app.client.get('/admin/flow/epics?q=052&lang=en')
  const filteredHtml = await filtered.text()
  const filteredText = filteredHtml.replace(/<!--k\[?-->/g, '')
  assert.equal(filtered.status, 200)
  assert.match(filteredText, /All epics: 1/)
  assert.match(filteredText, /Release 052/)
  assert.match(filteredText, /Sales workspace/)

  const empty = await app.client.get('/admin/flow/epics?q=does-not-exist&lang=en')
  const emptyHtml = await empty.text()
  assert.equal(empty.status, 200)
  assert.match(emptyHtml.replace(/<!--k\[?-->/g, ''), /All epics: 0/)
  assert.match(emptyHtml.replace(/<!--k\[?-->/g, ''), /Nothing here yet/)

  const refused = await app.client.post('/admin/flow/epics?lang=en', new URLSearchParams(), {
    redirect: 'manual',
  })
  assert.equal(refused.status, 405)
  assert.equal((await app.client.request('/admin/flow/epics?lang=en', { method: 'PUT' })).status, 405)
})

test('flow epic listAll domain: total and page boundaries exceed the former per-project caps', async (t) => {
  const { call } = await boot(t, 205)

  const first = await call<{ rows: Row[]; total: number }>('flow.epic.listAll', {
    search: 'Release',
    cursor: 0,
    limit: 200,
  })
  assert.equal(first.total, 205)
  assert.equal(first.rows.length, 200)
  assert.equal(first.rows[0]?.id, 'release-001')

  const last = await call<{ rows: Row[]; total: number }>('flow.epic.listAll', {
    search: 'Release',
    cursor: 200,
    limit: 50,
  })
  assert.equal(last.total, 205)
  assert.equal(last.rows.length, 5)
  assert.equal(last.rows.at(-1)?.id, 'release-205')
  assert.ok(!last.rows.some((row) => row.id === 'archived-release'))

  for (let index = 1; index <= 201; index += 1) {
    const number = String(index).padStart(3, '0')
    await call('flow.project.save', {
      values: { id: `project-${number}`, key: `P${number}`, name: `Project ${number}` },
      idempotencyKey: `project-cap-${number}`,
    })
  }
  await call('flow.epic.save', {
    values: {
      id: 'project-cap-boundary',
      projectId: 'project-201',
      title: 'Project cap boundary',
    },
    idempotencyKey: 'epic-project-cap-boundary',
  })
  const beyondProjectCap = await call<{ rows: Row[]; total: number }>('flow.epic.listAll', {
    search: 'Project cap boundary',
    cursor: 0,
    limit: 50,
  })
  assert.equal(beyondProjectCap.total, 1)
  assert.equal(beyondProjectCap.rows[0]?.projectId, 'project-201')
  assert.equal(beyondProjectCap.rows[0]?.projectName, 'Project 201')
})
