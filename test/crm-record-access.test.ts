import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branches: null }
  const call = <T = Row>(name: string, input: Record<string, unknown>, actor?: string) =>
    app.fixture.call<T>(name, input, { scope, actor }).then((result) => result.value)

  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await call('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  for (const [id, superuser] of [
    ['admin', true],
    ['agent-a', false],
    ['agent-b', false],
    ['leader-a', false],
    ['manager', false],
    ['viewer', false],
  ] as const) {
    await call('user.createUser', {
      id,
      login: id,
      password: 'correct horse battery',
      name: id,
      defaultCompanyId: 'acme',
      superuser,
    })
    await call('user.grantCompany', { id: `${id}:acme`, userId: id, companyId: 'acme' })
  }
  await call('crm.bootstrap.defaults', { idempotencyKey: 'record-access-defaults' }, 'admin')
  for (const [id, code, leaderUserId] of [
    ['team-a', 'a', 'leader-a'],
    ['team-b', 'b', null],
  ] as const)
    await call(
      'crm.team.save',
      {
        values: { id, code, name: `Team ${code.toUpperCase()}`, leaderUserId, assignmentMode: 'manual' },
        idempotencyKey: `save-${id}`,
      },
      'admin',
    )
  for (const [teamId, userId] of [
    ['team-a', 'agent-a'],
    ['team-a', 'agent-b'],
    ['team-a', 'viewer'],
    ['team-b', 'agent-b'],
  ])
    await call(
      'crm.team.member.save',
      {
        id: `${teamId}:${userId}`,
        teamId,
        userId,
        idempotencyKey: `member-${teamId}-${userId}`,
      },
      'admin',
    )

  for (const values of [
    { id: 'own-a', name: 'Own A', teamId: 'team-a', assigneeUserId: 'agent-a' },
    { id: 'own-b', name: 'Own B', teamId: 'team-a', assigneeUserId: 'agent-b' },
    { id: 'queue-a', name: 'Queue A', teamId: 'team-a' },
    { id: 'queue-b', name: 'Queue B', teamId: 'team-b' },
  ])
    await call('crm.case.save', { ...values, kind: 'lead', idempotencyKey: `case-${values.id}` }, 'admin')
  return { app, call }
}

const ids = (result: Row): string[] => ((result.rows as Row[]) ?? []).map((row) => String(row.id)).sort()

test('CRM record policy keeps self, team queue, leader, and company scopes distinct', async (t) => {
  const { call } = await boot(t)

  assert.deepEqual(ids(await call('crm.case.list', {}, 'agent-a')), ['own-a', 'queue-a'])
  assert.equal(await call('crm.case.get', { id: 'own-b' }, 'agent-a'), null)
  assert.deepEqual(ids(await call('crm.case.list', { assigneeUserId: 'agent-b' }, 'agent-a')), [])

  assert.deepEqual(ids(await call('crm.case.list', {}, 'leader-a')), ['own-a', 'own-b', 'queue-a'])

  await call(
    'crm.access.save',
    {
      id: 'access-manager',
      userId: 'manager',
      viewScope: 'company',
      editScope: 'company',
      assignScope: 'company',
      idempotencyKey: 'access-manager-save',
    },
    'admin',
  )
  assert.deepEqual(ids(await call('crm.case.list', {}, 'manager')), ['own-a', 'own-b', 'queue-a', 'queue-b'])

  await call(
    'crm.access.save',
    {
      id: 'access-viewer',
      userId: 'viewer',
      viewScope: 'team',
      editScope: 'none',
      assignScope: 'none',
      idempotencyKey: 'access-viewer-save',
    },
    'admin',
  )
  assert.deepEqual(ids(await call('crm.case.list', {}, 'viewer')), ['own-a', 'own-b', 'queue-a'])
  const refused = await call<Row>(
    'crm.case.move',
    {
      id: 'own-a',
      stageId: 'crm-stage-qualified',
      expectedVersion: 1,
      idempotencyKey: 'viewer-move-refused',
    },
    'viewer',
  )
  assert.equal(refused.ok, false)
})

test('CRM assignment uses claim for queue work and audited CAS for reassignment', async (t) => {
  const { call } = await boot(t)

  const claim = await call<Row>(
    'crm.case.assign',
    {
      id: 'queue-a',
      teamId: 'team-a',
      expectedVersion: 1,
      idempotencyKey: 'claim-queue-a',
    },
    'agent-a',
  )
  assert.equal(claim.ok, true)
  assert.equal(claim.assigneeUserId, 'agent-a')

  const bypass = await call<Row>(
    'crm.case.assign',
    {
      id: 'own-a',
      teamId: 'team-a',
      assigneeUserId: 'agent-b',
      expectedVersion: 1,
      idempotencyKey: 'assign-cannot-reassign',
    },
    'leader-a',
  )
  assert.equal(bypass.ok, false)

  const moved = await call<Row>(
    'crm.case.reassign',
    {
      id: 'own-a',
      teamId: 'team-a',
      assigneeUserId: 'agent-b',
      reasonCode: 'workload_balance',
      expectedVersion: 1,
      idempotencyKey: 'reassign-own-a',
    },
    'leader-a',
  )
  assert.equal(moved.ok, true)
  assert.equal(moved.version, 2)

  const replay = await call<Row>(
    'crm.case.reassign',
    {
      id: 'own-a',
      teamId: 'team-a',
      assigneeUserId: 'agent-b',
      reasonCode: 'workload_balance',
      expectedVersion: 1,
      idempotencyKey: 'reassign-own-a',
    },
    'leader-a',
  )
  assert.equal(replay.ok, true)
  assert.equal(replay.version, 2)

  const stale = await call<Row>(
    'crm.case.reassign',
    {
      id: 'own-b',
      teamId: 'team-a',
      assigneeUserId: 'agent-a',
      reasonCode: 'absence',
      expectedVersion: 99,
      idempotencyKey: 'reassign-own-b-stale',
    },
    'leader-a',
  )
  assert.equal(stale.ok, false)
  assert.equal((stale.errors as Row[])[0]?.code, 'crm.error.stageConflict')

  const detail = await call<Row>('crm.case.get', { id: 'own-a' }, 'leader-a')
  const audit = (detail.timeline as Row[]).find((entry) => entry.eventType === 'reassigned')
  assert.deepEqual(audit?.metadata, {
    fromTeamId: 'team-a',
    fromAssigneeUserId: 'agent-a',
    toTeamId: 'team-a',
    toAssigneeUserId: 'agent-b',
    reasonCode: 'workload_balance',
    reasonNote: null,
  })
})
