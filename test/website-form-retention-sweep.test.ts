import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createQueue, defineDeployment } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { address, paperTheme, partner, website, websiteForm } from '@ketvietlab/ketsuite'

/**
 * The half of retention that nobody presses a button for.
 *
 * `purgeSubmissions` is covered elsewhere: give it a form and it erases what is
 * past the window. What this file is about is whether anything ever calls it.
 * A retention period enforced only when an administrator remembers is a
 * sentence in a privacy notice, and the sweep is the difference — so the sweep
 * is tested by running it, through the worker, across two legal entities.
 */
const app = defineDeployment({
  name: 'website_form_retention_app',
  headless: true,
  modules: [address, partner, website, websiteForm, paperTheme],
  serve: {},
  worker: { queues: { default: 1 } },
})

const scopeFor = (company: string) => ({ company, branches: null })

const seedCompany = async (
  deployment: Awaited<ReturnType<typeof createTestDeployment>>,
  company: string,
  retentionDays: number | null,
) => {
  const scope = scopeFor(company)
  await deployment.fixture.call(
    'website.saveSite',
    { id: `${company}-site`, name: 'moc', title: 'Mộc', defaultLocale: 'vi', theme: 'theme_paper' },
    { scope },
  )
  await deployment.fixture.call(
    'website_form.saveForm',
    {
      id: `${company}-form`,
      siteId: `${company}-site`,
      name: 'Liên hệ',
      schema: { fields: [{ name: 'email', type: 'email', required: true }] },
      successMessage: 'Đã nhận.',
      ...(retentionDays === null ? {} : { retentionDays }),
    },
    { scope },
  )
  await deployment.fixture.call(
    'website_form.submitForm',
    {
      formId: `${company}-form`,
      payload: { email: `khach@${company}.test` },
      schemaVersion: 1,
      submissionKey: 'a',
    },
    { scope },
  )
}

const listFor = async (deployment: Awaited<ReturnType<typeof createTestDeployment>>, company: string) =>
  (
    await deployment.fixture.call<Array<{ status: string; purgedAt: string | null }>>(
      'website_form.listSubmissions',
      { formId: `${company}-form` },
      { scope: scopeFor(company) },
    )
  ).value

test('retention: the sweep reaches every company that has a window, and only those rows', async (t) => {
  const deployment = await createTestDeployment(app)
  t.after(() => deployment.close())

  await seedCompany(deployment, 'acme', 30)
  await seedCompany(deployment, 'globex', 30)
  // A third company collecting the same form with no window declared. Nothing
  // about the sweep may reach it.
  await seedCompany(deployment, 'initech', null)

  await deployment.fixture.withTenant('', async (tenant) => {
    await tenant.adapter.run('UPDATE website_form_form_submission SET "createdAt" = ?', [
      new Date(Date.now() - 40 * 86_400_000).toISOString(),
    ])
  })

  await deployment.fixture.withTenant('', async (tenant) => {
    const queue = await createQueue(tenant.adapter)
    await queue.enqueue('website_form.retentionSweep', {}, { queue: 'default', maxAttempts: 1 })
  })
  await deployment.drainJobs()

  const completed = deployment.records.of('job_completed').map((record) => record.fn)
  assert.ok(completed.includes('website_form.retentionSweep'), 'the sweep ran')
  assert.equal(
    completed.filter((fn) => fn === 'website_form.purgeExpired').length,
    2,
    'one child per company that declared a window, and no more',
  )

  for (const company of ['acme', 'globex']) {
    const rows = await listFor(deployment, company)
    assert.equal(rows[0]?.status, 'purged', `${company} was swept`)
    assert.ok(rows[0]?.purgedAt, `${company} says when`)
  }
  const untouched = await listFor(deployment, 'initech')
  assert.equal(untouched[0]?.purgedAt, null, 'a company with no window keeps everything')
})

test('retention: a second sweep on the same day does not queue a second pass', async (t) => {
  const deployment = await createTestDeployment(app)
  t.after(() => deployment.close())
  await seedCompany(deployment, 'acme', 30)

  await deployment.fixture.withTenant('', async (tenant) => {
    const queue = await createQueue(tenant.adapter)
    await queue.enqueue('website_form.retentionSweep', {}, { queue: 'default', maxAttempts: 1 })
    await queue.enqueue(
      'website_form.retentionSweep',
      {},
      { queue: 'default', maxAttempts: 1, uniqueKey: 'second' },
    )
  })
  await deployment.drainJobs()

  // A sweep retried after a worker restart finds today's job already queued
  // rather than queueing a second one behind it.
  const children = deployment.records
    .of('job_completed')
    .filter((record) => record.fn === 'website_form.purgeExpired')
  assert.equal(children.length, 1, 'the day key collapsed the duplicate')
})
