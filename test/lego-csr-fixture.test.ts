import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SESSION_COOKIE } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { legoDeployment, seedLegoFixture } from '../bench/lego-csr-fixture.ts'

test('lego CSR fixture: ten release-time extensions serve indexed data through every mode', async (t) => {
  const deployment = await createTestDeployment(legoDeployment(10), { worker: false })
  t.after(() => deployment.close())
  const seeded = await seedLegoFixture(deployment, 100)
  assert.equal(seeded.partnerCount, 100)
  assert.equal(seeded.metricCount, 100)
  const session = deployment.client.jar.get(SESSION_COOKIE)
  assert.ok(session)

  const live = deployment.deployment.manifest
  assert.equal(live.browser.screens['partner_backend.partners']?.columns.length, 16)
  assert.equal(live.browser.fills.length, 10)

  for (const mode of ['ssr-current', 'ssr-matched', 'csr-two-stage', 'csr-planned']) {
    const response = await deployment.client.get(`/admin/partner/partners?prototype=${mode}`, {
      headers: { accept: 'text/html' },
    })
    assert.equal(response.status, 200, mode)
    const markup = await response.text()
    if (mode !== 'ssr-current') assert.match(markup, /metric-09/, mode)
    if (mode === 'csr-planned') assert.doesNotMatch(markup, /contactConsent/, mode)
    if (mode.startsWith('csr-')) {
      assert.match(markup, /viewer/, mode)
      assert.match(markup, /projection/, mode)
      assert.equal(markup.includes(session), false, `${mode} serialized the raw session`)
      assert.doesNotMatch(markup, /lego-local-only/, mode)
    }
  }
  const data = await deployment.client.json<{ total: number; rows: Array<Record<string, unknown>> }>(
    '/admin/partner/partners/browser-data',
  )
  assert.equal(data.total, 100)
  assert.deepEqual(Object.keys(data.rows[0] ?? {}).sort(), [
    'active',
    'email',
    'id',
    'kind',
    'name',
    'phone',
    'ref',
  ])
})
