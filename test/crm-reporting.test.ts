import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { salesReport, type SalesReportInput } from '../packages/ketsuite/src/modules/crm/reporting.ts'
import { closingValues } from '../packages/ketsuite/src/modules/crm/operations.ts'

const base: SalesReportInput = {
  cases: [],
  sales: [],
  timeline: [],
  links: [],
  activities: [],
  start: '2026-09-01T00:00:00.000Z',
  end: '2026-10-01T00:00:00.000Z',
  asOf: '2026-09-20T00:00:00.000Z',
  timezone: 'UTC',
}
const record = (id: string, values: Row = {}): Row => ({
  id,
  kind: 'lead',
  originKind: 'lead',
  createdAt: '2026-09-01T00:00:00.000Z',
  active: true,
  terminalState: 'open',
  stageId: 'new',
  ...values,
})
const interaction = (caseId: string, outcome: string, occurredAt: string): Row => ({
  caseId,
  eventType: 'interaction',
  occurredAt,
  metadata: { outcome, channel: 'phone' },
})

test('CRM reports keep converted leads in the acquisition cohort and mature each window independently', () => {
  const report = salesReport({
    ...base,
    cases: [
      record('converted', {
        kind: 'opportunity',
        convertedAt: '2026-09-10T00:00:00Z',
        terminalState: 'won',
        closedAt: '2026-09-18T00:00:00Z',
      }),
      record('late', { kind: 'opportunity', originKind: null, convertedAt: '2026-09-16T00:00:00Z' }),
      record('young', { createdAt: '2026-09-19T12:00:00Z' }),
      record('direct', { originKind: 'opportunity', kind: 'opportunity' }),
      record('legacy-unknown', { originKind: null, kind: 'opportunity' }),
      record('merged', { mergedIntoId: 'converted' }),
      record('foreign-kind', { kind: 'support' }),
    ],
    timeline: [
      interaction('converted', 'attempted', '2026-09-01T01:00:00Z'),
      interaction('converted', 'reached', '2026-09-02T00:00:00Z'),
      interaction('late', 'unreachable', '2026-09-01T02:00:00Z'),
      { caseId: 'late', eventType: 'activity_done', occurredAt: '2026-09-01T03:00:00Z' },
    ],
  })
  assert.equal(report.period.newLeads, 3)
  assert.deepEqual(report.cohort.contactedWithin24h, { eligible: 2, pending: 1, successes: 1, rate: 50 })
  assert.deepEqual(report.cohort.convertedWithin14d, { eligible: 2, pending: 1, successes: 1, rate: 50 })
  assert.equal(report.cohort.converted, 2)
  assert.equal(report.cohort.won, 1)
  assert.equal(report.coverage.unknownOrigin, 1)
})

test('CRM no mature cohort yields null rates; event order and late logging do not change first contact', () => {
  const report = salesReport({
    ...base,
    cases: [record('young', { createdAt: '2026-09-19T12:00:00Z' })],
    timeline: [
      interaction('young', 'reached', '2026-09-19T18:00:00Z'),
      interaction('young', 'reached', '2026-09-19T13:00:00Z'),
    ],
  })
  assert.equal(report.cohort.contacted, 1)
  assert.equal(report.cohort.contactedWithin24h.rate, null)
  assert.equal(report.cohort.convertedWithin14d.pending, 1)
})

test('CRM period flows, current pipeline and cohort conversions remain separate and reconcile exactly', () => {
  const report = salesReport({
    ...base,
    cases: [
      record('old-win', {
        createdAt: '2026-08-01T00:00:00Z',
        kind: 'opportunity',
        closedAt: '2026-09-05T00:00:00Z',
        terminalState: 'won',
        assigneeUserId: 'new-owner',
        closedAssigneeUserId: 'closer',
        closedTeamId: 'old-team',
        closedOwnershipRecordedAt: '2026-09-05T00:00:00Z',
      }),
      record('loss', {
        kind: 'opportunity',
        closedAt: '2026-09-06T00:00:00Z',
        terminalState: 'lost',
        active: false,
      }),
      record('open-a', { kind: 'opportunity', assigneeUserId: 'a', teamId: 'team', stageId: 'qualified' }),
      record('open-b', { kind: 'opportunity', stageId: 'proposal' }),
    ],
    sales: [
      { caseId: 'open-a', expectedRevenue: '9007199254740993.10', probability: '50' },
      { caseId: 'open-b', expectedRevenue: '0.20' },
      { caseId: 'loss', lostReason: 'Free text should not become a category' },
    ],
  })
  assert.equal(report.period.won, 1)
  assert.equal(report.period.lost, 1)
  assert.equal(report.period.winRate, 50)
  assert.equal(report.period.medianSalesCycleDays, 35)
  assert.equal(report.cohort.won, 0)
  assert.equal(report.pipeline.expectedRevenue, '9007199254740993.3')
  assert.equal(report.pipeline.weightedRevenue, '4503599627370496.55')
  assert.equal(
    report.teams.reduce((sum, row) => sum + row.openCount, 0),
    report.pipeline.count,
  )
  assert.equal(report.teams.find((row) => row.assigneeUserId === 'closer')?.won, 1)
  assert.equal(
    report.teams.find((row) => row.assigneeUserId === 'new-owner'),
    undefined,
  )
  assert.equal(report.teams.find((row) => row.ownership === 'unknown')?.lost, 1)
  assert.deepEqual(report.lostReasons, [{ code: 'not_recorded', count: 1 }])
})

test('CRM risks use customer contact and date-level activity deadlines; overlapping risks count a case once', () => {
  const report = salesReport({
    ...base,
    timezone: 'Asia/Ho_Chi_Minh',
    asOf: '2026-09-19T18:00:00Z',
    cases: [
      record('a', { kind: 'opportunity', updatedAt: '2026-09-19T17:00:00Z' }),
      record('b', { kind: 'opportunity' }),
    ],
    timeline: [
      { caseId: 'a', eventType: 'assigned', occurredAt: '2026-09-19T17:00:00Z' },
      interaction('b', 'reached', '2026-09-19T17:00:00Z'),
    ],
    links: [
      { caseId: 'a', activityId: 'late' },
      { caseId: 'b', activityId: 'today' },
      { caseId: 'a', activityId: 'done' },
    ],
    activities: [
      { id: 'late', dueDate: '2026-09-18', active: true },
      { id: 'today', dueDate: '2026-09-20', active: true },
      { id: 'done', dueDate: '2026-09-01', active: true, doneAt: '2026-09-02T00:00:00Z' },
    ],
  })
  assert.equal(report.health.atRiskCount, 1)
  assert.equal(report.health.overdue.count, 1)
  assert.equal(report.health.noRecordedContact14d.count, 1)
  assert.equal(report.risks[0]?.overdueDays, 2)
  assert.equal(report.health.noNextStep.count, 0)
})

test('CRM closes retain owner snapshots on edits, clear on reopening and capture a new outcome', () => {
  const timestamp = '2026-09-01T00:00:00Z'
  const first = closingValues({ terminalState: 'open', assigneeUserId: 'a', teamId: 'x' }, 'won', timestamp)
  assert.equal(first.closedAssigneeUserId, 'a')
  assert.deepEqual(
    closingValues({ ...first, terminalState: 'won', assigneeUserId: 'b' }, 'won', '2026-09-02T00:00:00Z'),
    { closedAt: timestamp },
  )
  assert.equal(
    closingValues({ ...first, terminalState: 'won' }, 'open', timestamp).closedOwnershipRecordedAt,
    null,
  )
  assert.equal(
    closingValues({ ...first, terminalState: 'won', assigneeUserId: 'b' }, 'lost', '2026-09-02T00:00:00Z')
      .closedAssigneeUserId,
    'b',
  )
  assert.deepEqual(
    closingValues({ terminalState: 'won', closedAt: timestamp, assigneeUserId: 'b' }, 'won', timestamp),
    { closedAt: timestamp },
  )
})

test('CRM reporting uses half-open periods and emits empty months', () => {
  const report = salesReport({
    ...base,
    start: '2026-07-01T00:00:00Z',
    cases: [
      record('boundary', { createdAt: '2026-06-30T23:59:59Z' }),
      record('start', { createdAt: '2026-07-01T00:00:00Z' }),
      record('end', { createdAt: base.asOf }),
    ],
  })
  assert.equal(report.period.newLeads, 1)
  assert.deepEqual(
    report.trend.map((row) => row.month),
    ['2026-07', '2026-08', '2026-09'],
  )
  assert.equal(report.trend[0]?.winRate, null)
})
