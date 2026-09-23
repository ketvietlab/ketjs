import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import { tableNameFor } from '@ketvietlab/ketjs'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

import { renderCaseModal, type CaseModalPayload } from './crm-case-modal-helper.ts'

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('partner.savePartner', {
    id: 'customer',
    kind: 'person',
    name: 'Nguyễn Minh',
    email: 'minh@example.test',
  })
  await fixture('company.saveCompany', { id: 'acme', code: 'ACME', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    partnerId: 'customer',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  const call = async <T = Row>(name: string, input: Record<string, unknown> = {}) =>
    (await app.client.call<T>(name, input)).value
  await call('crm.bootstrap.defaults', { idempotencyKey: 'crm-defaults' })
  return { app, call }
}

test('CRM reporting HTTP: origin, interactions, categorized loss, conflicts, ownership and access isolation', async (t) => {
  const { app, call } = await boot(t)
  const id = 'report-lead'
  assert.equal(
    (
      await call('crm.case.save', {
        id,
        kind: 'lead',
        name: 'Report lead',
        expectedRevenue: '123.45',
        idempotencyKey: 'report-create-001',
      })
    ).ok,
    true,
  )
  let row = await call('crm.case.get', { id })
  assert.equal(row.originKind, 'lead')
  const createdAt = new Date(Date.now() - 20 * 86400000).toISOString()
  await app.fixture.withTenant('', async ({ adapter }) => {
    await adapter.run(
      `UPDATE ${adapter.quoteIdent(tableNameFor('crm.Case'))} SET ${adapter.quoteIdent('createdAt')} = ? WHERE id = ?`,
      [createdAt, id],
    )
  })
  const contactTime = new Date(Date.parse(createdAt) + 3600000).toISOString()
  const interactionInput = {
    id,
    expectedVersion: row.version,
    channel: 'phone',
    outcome: 'reached',
    occurredAt: contactTime,
    note: 'Spoke to buyer',
    idempotencyKey: 'interaction-report-001',
  }
  assert.equal((await call('crm.case.logInteraction', interactionInput)).ok, true)
  assert.equal(
    (await call('crm.case.logInteraction', interactionInput)).ok,
    true,
    'retry replays the same result',
  )
  row = await call('crm.case.get', { id })
  assert.equal((row.timeline as Row[]).filter((event) => event.eventType === 'interaction').length, 1)
  assert.equal(
    (
      await call('crm.case.logInteraction', {
        ...interactionInput,
        expectedVersion: row.version,
        occurredAt: new Date(Date.now() + 86400000).toISOString(),
        idempotencyKey: 'future-report-001',
      })
    ).ok,
    false,
  )
  assert.equal(
    (
      await call('crm.case.logInteraction', {
        ...interactionInput,
        expectedVersion: 0,
        idempotencyKey: 'stale-report-001',
      })
    ).ok,
    false,
  )
  assert.equal(
    (
      await call('crm.case.convertLead', {
        id,
        expectedVersion: row.version,
        idempotencyKey: 'convert-report-001',
      })
    ).ok,
    true,
  )
  row = await call('crm.case.get', { id })
  assert.equal(row.originKind, 'lead')
  const lost = {
    id,
    expectedVersion: row.version,
    lostReason: 'Budget deferred',
    lostReasonCode: 'budget',
    idempotencyKey: 'lost-report-001',
  }
  assert.equal((await call('crm.case.markLost', lost)).ok, true)
  assert.equal(
    (
      await call('crm.case.markLost', {
        ...lost,
        lostReason: 'Stale overwrite',
        lostReasonCode: 'competitor',
        idempotencyKey: 'lost-stale-report-001',
      })
    ).ok,
    false,
  )
  row = await call('crm.case.get', { id })
  assert.equal((row.salesDetail as Row).lostReason, 'Budget deferred')
  assert.equal((row.salesDetail as Row).lostReasonCode, 'budget')
  assert.ok(row.closedOwnershipRecordedAt)
  assert.equal(row.closedAssigneeUserId, null, 'unassigned close is recorded, not inferred from the caller')
  const parameters = {
    start: new Date(Date.now() - 30 * 86400000).toISOString(),
    end: new Date(Date.now() + 86400000).toISOString(),
    timezone: 'Asia/Ho_Chi_Minh',
  }
  const report = await call('crm.report.sales', parameters)
  assert.equal(report.ok, true)
  assert.equal((report.meta as Row).currency, 'VND')
  assert.equal((report.period as Row).newLeads, 1)
  assert.equal((report.period as Row).lost, 1)
  assert.deepEqual(report.lostReasons, [{ code: 'budget', count: 1 }])
  assert.equal(((report.cohort as Row).contactedWithin24h as Row).successes, 1)
  assert.equal(((report.cohort as Row).convertedWithin14d as Row).successes, 0)
  assert.equal((report.coverage as Row).unknownClosingOwnership, 0)
  assert.equal((await call('crm.report.sales', { ...parameters, timezone: 'Invalid/Zone' })).ok, false)
  assert.equal((await call('crm.report.sales', { ...parameters, start: parameters.end })).ok, false)
  const payload = await call<CaseModalPayload>('crm.case.modalContext', { id, locale: 'en' })
  assert.match(renderCaseModal(payload, 'overview', 'interaction'), /Reached customer/u)
  assert.match(renderCaseModal(payload, 'overview', 'close'), /name="lostReasonCode"/u)
  assert.match(renderCaseModal(payload, 'timeline'), /Phone · Reached customer/u)
  const scope = { company: 'acme', branches: null }
  await app.fixture.call(
    'user.createUser',
    {
      id: 'outsider',
      login: 'outsider',
      password: 'correct horse',
      name: 'Outsider',
      defaultCompanyId: 'acme',
    },
    { scope },
  )
  const restricted = (
    await app.fixture.call<Row>('crm.report.sales', parameters, { scope, actor: 'outsider' })
  ).value
  assert.equal((restricted.period as Row).newLeads, 0)
  assert.deepEqual(restricted.teams, [])
  const foreign = (
    await app.fixture.call<Row>('crm.report.sales', parameters, {
      scope: { company: 'other', branches: null },
      actor: 'admin',
    })
  ).value
  assert.equal((foreign.period as Row).lost, 0)
  const refused = (
    await app.fixture.call<Row>(
      'crm.case.logInteraction',
      { ...interactionInput, expectedVersion: row.version, idempotencyKey: 'outsider-report-001' },
      { scope, actor: 'outsider' },
    )
  ).value
  assert.equal(refused.ok, false)
  assert.equal(
    (
      await call('crm.case.move', {
        id,
        stageId: 'crm-stage-qualified',
        expectedVersion: row.version,
        idempotencyKey: 'reopen-report-001',
      })
    ).ok,
    true,
  )
  row = await call('crm.case.get', { id })
  assert.equal(row.closedOwnershipRecordedAt, null)
  assert.equal((row.salesDetail as Row).lostReasonCode, null)
  assert.equal(
    (
      await call('crm.case.move', {
        id,
        stageId: 'crm-stage-won',
        expectedVersion: row.version,
        idempotencyKey: 'move-won-report-001',
      })
    ).ok,
    true,
  )
  row = await call('crm.case.get', { id })
  assert.ok(row.closedOwnershipRecordedAt)
  assert.equal(row.originKind, 'lead')
})

test('CRM snapshots attribute a win to its closing owner after reassignment and every terminal write path', async (t) => {
  const { app, call } = await boot(t)
  const scope = { company: 'acme', branches: null }
  await app.fixture.call(
    'user.createUser',
    {
      id: 'successor',
      login: 'successor',
      password: 'correct horse',
      name: 'Successor',
      defaultCompanyId: 'acme',
    },
    { scope },
  )
  for (const userId of ['admin', 'successor'])
    assert.equal(
      (
        await call('crm.team.member.save', {
          id: `sales-${userId}`,
          teamId: 'crm-team-sales',
          userId,
          idempotencyKey: `member-${userId}-report`,
        })
      ).ok,
      true,
    )
  const create = async (id: string, kind: string, stageId?: string) => {
    assert.equal(
      (
        await call('crm.case.save', {
          id,
          kind,
          name: id,
          teamId: 'crm-team-sales',
          assigneeUserId: 'admin',
          ...(stageId ? { stageId } : {}),
          idempotencyKey: `create-${id}-report`,
        })
      ).ok,
      true,
    )
    return call('crm.case.get', { id })
  }
  let row = await create('assigned-win', 'opportunity')
  assert.equal(
    (
      await call('crm.case.markWon', {
        id: row.id,
        expectedVersion: row.version,
        idempotencyKey: 'assigned-win-close',
      })
    ).ok,
    true,
  )
  row = await call('crm.case.get', { id: row.id })
  const closedAt = row.closedAt
  assert.equal(
    (
      await call('crm.case.reassign', {
        id: row.id,
        teamId: 'crm-team-sales',
        assigneeUserId: 'successor',
        reasonCode: 'workload_balance',
        expectedVersion: row.version,
        idempotencyKey: 'assigned-win-reassign',
      })
    ).ok,
    false,
  )
  row = await call('crm.case.get', { id: row.id })
  // Reassignment of a closed case is forbidden. A downstream import can still
  // change present ownership; historical attribution must use the snapshot.
  await app.fixture.withTenant('', async ({ adapter }) => {
    await adapter.run(
      `UPDATE ${adapter.quoteIdent(tableNameFor('crm.Case'))} SET ${adapter.quoteIdent('assigneeUserId')} = ? WHERE id = ?`,
      ['successor', row.id],
    )
  })
  row = await call('crm.case.get', { id: row.id })
  assert.equal(row.assigneeUserId, 'successor')
  assert.equal(row.closedAssigneeUserId, 'admin')
  assert.equal(row.closedAt, closedAt)
  const report = await call('crm.report.sales', {
    start: new Date(Date.now() - 86400000).toISOString(),
    end: new Date(Date.now() + 86400000).toISOString(),
  })
  assert.equal((report.teams as Row[]).find((team) => team.assigneeUserId === 'admin')?.won, 1)
  assert.equal(
    (report.teams as Row[]).find((team) => team.assigneeUserId === 'successor'),
    undefined,
  )
  const createdWon = await create('created-won', 'opportunity', 'crm-stage-won')
  assert.equal(createdWon.originKind, 'opportunity')
  assert.equal(createdWon.closedAssigneeUserId, 'admin')
  let lead = await create('converted-won', 'lead')
  assert.equal(
    (
      await call('crm.case.convertLead', {
        id: lead.id,
        stageId: 'crm-stage-won',
        expectedVersion: lead.version,
        idempotencyKey: 'converted-won-report',
      })
    ).ok,
    true,
  )
  lead = await call('crm.case.get', { id: lead.id })
  assert.equal(lead.originKind, 'lead')
  assert.equal(lead.closedAssigneeUserId, 'admin')
  assert.ok(lead.closedAt)
})
