import type { Row } from '@ketvietlab/ketjs'
import { addDecimals, multiplyDecimals } from '../account/money.ts'

export const LOST_REASON_CODES = ['budget', 'fit', 'competitor', 'no_need', 'other'] as const
export const INTERACTION_CHANNELS = ['phone', 'email', 'chat', 'meeting', 'other'] as const
export const INTERACTION_OUTCOMES = ['attempted', 'reached', 'unreachable'] as const
const DAY = 86_400_000
const time = (value: unknown): number => (value ? Date.parse(String(value)) : Number.NaN)
const metadata = (row: Row): Row => {
  if (typeof row.metadata === 'string') {
    try {
      return JSON.parse(row.metadata) as Row
    } catch {
      return {}
    }
  }
  return (row.metadata ?? {}) as Row
}
const rate = (numerator: number, denominator: number): number | null =>
  denominator ? (numerator / denominator) * 100 : null
const median = (values: number[]): number | null => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length ? (sorted[middle]! + sorted[Math.floor((sorted.length - 1) / 2)]!) / 2 : null
}

/** Nullable origin is deliberate: an old direct opportunity has no provable acquisition kind. */
export const acquisitionKind = (row: Row, events: Row[] = []): string | null => {
  if (row.originKind === 'lead' || row.originKind === 'opportunity') return row.originKind
  if (row.kind === 'lead' || row.convertedAt || events.some((event) => event.eventType === 'converted'))
    return 'lead'
  return null
}

export type SalesReportInput = {
  cases: Row[]
  sales: Row[]
  timeline: Row[]
  links: Row[]
  activities: Row[]
  start: string
  end: string
  asOf: string
  timezone: string
}

/** Pure projection; callers must supply only company-scoped, record-authorized rows. */
export function salesReport(input: SalesReportInput) {
  const { start, end, asOf, timezone } = input
  const cutoff = time(asOf)
  const endTime = Math.min(time(end), cutoff)
  const inPeriod = (value: unknown) => time(value) >= time(start) && time(value) < endTime
  const localDate = (value: unknown) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(String(value)))
  const today = localDate(asOf)
  const cases = input.cases.filter(
    (row) => ['lead', 'opportunity'].includes(String(row.kind)) && !row.mergedIntoId,
  )
  const details = new Map(input.sales.map((row) => [String(row.caseId), row]))
  const events = new Map<string, Row[]>()
  for (const event of input.timeline) {
    if (time(event.occurredAt) > cutoff) continue
    const id = String(event.caseId)
    events.set(id, [...(events.get(id) ?? []), event])
  }
  const amount = (rows: Row[]) =>
    rows.reduce(
      (sum, row) => addDecimals(sum, String(details.get(String(row.id))?.expectedRevenue ?? '0')),
      '0',
    )
  const origin = (row: Row) => acquisitionKind(row, events.get(String(row.id)))
  const leads = cases.filter((row) => origin(row) === 'lead' && inPeriod(row.createdAt))
  const reached = (row: Row) =>
    (events.get(String(row.id)) ?? []).filter(
      (event) =>
        event.eventType === 'interaction' &&
        metadata(event).outcome === 'reached' &&
        time(event.occurredAt) >= time(row.createdAt),
    )
  const convertedTime = (row: Row) => {
    const times = [
      time(row.convertedAt),
      ...(events.get(String(row.id)) ?? [])
        .filter((event) => event.eventType === 'converted')
        .map((event) => time(event.occurredAt)),
    ].filter((value) => Number.isFinite(value) && value >= time(row.createdAt) && value <= cutoff)
    return times.length ? Math.min(...times) : Number.NaN
  }
  const windowMetric = (days: number, eventTime: (row: Row) => number) => {
    const eligible = leads.filter((row) => time(row.createdAt) + days * DAY <= cutoff)
    const successes = eligible.filter((row) => eventTime(row) <= time(row.createdAt) + days * DAY).length
    return {
      eligible: eligible.length,
      pending: leads.length - eligible.length,
      successes,
      rate: rate(successes, eligible.length),
    }
  }
  const firstContact = (row: Row) => {
    const times = reached(row).map((event) => time(event.occurredAt))
    return times.length ? Math.min(...times) : Number.NaN
  }
  const closed = cases.filter(
    (row) =>
      row.kind === 'opportunity' &&
      ['won', 'lost'].includes(String(row.terminalState)) &&
      inPeriod(row.closedAt),
  )
  const won = closed.filter((row) => row.terminalState === 'won')
  const lost = closed.filter((row) => row.terminalState === 'lost')
  const open = cases.filter(
    (row) => row.active !== false && row.kind === 'opportunity' && row.terminalState === 'open',
  )
  const active = new Map(
    input.activities
      .filter((row) => row.active !== false && !row.doneAt && !row.canceledAt)
      .map((row) => [String(row.id), row]),
  )
  const scheduled = new Map<string, Row[]>()
  for (const link of input.links) {
    const activity = active.get(String(link.activityId))
    if (activity)
      scheduled.set(String(link.caseId), [...(scheduled.get(String(link.caseId)) ?? []), activity])
  }
  const risks = open
    .map((row) => {
      const activities = scheduled.get(String(row.id)) ?? []
      const overdue = activities.filter((activity) => String(activity.dueDate) < today)
      const contacts = reached(row)
      const latest = contacts.length
        ? Math.max(...contacts.map((event) => time(event.occurredAt)))
        : time(row.createdAt)
      const reasons = [
        ...(!activities.length ? ['no_next_step'] : []),
        ...(overdue.length ? ['overdue_activity'] : []),
        ...(cutoff - latest > 14 * DAY ? ['no_recorded_contact_14d'] : []),
      ]
      return {
        id: row.id,
        reasons,
        contactHistory: contacts.length ? 'recorded' : 'not_recorded',
        overdueDays: overdue.length
          ? Math.max(
              ...overdue.map((activity) =>
                Math.floor((Date.parse(today) - Date.parse(String(activity.dueDate))) / DAY),
              ),
            )
          : 0,
      }
    })
    .filter((row) => row.reasons.length)
  const riskGroup = (reason: string) => {
    const ids = new Set(risks.filter((row) => row.reasons.includes(reason)).map((row) => row.id))
    return { count: ids.size, expectedRevenue: amount(open.filter((row) => ids.has(row.id))) }
  }
  const teams = new Map<
    string,
    {
      teamId: unknown
      assigneeUserId: unknown
      ownership: string
      openCount: number
      expectedRevenue: string
      won: number
      lost: number
    }
  >()
  const teamRow = (row: Row, closing: boolean) => {
    const ownership = closing && !row.closedOwnershipRecordedAt ? 'unknown' : 'recorded'
    const teamId = ownership === 'unknown' ? null : ((closing ? row.closedTeamId : row.teamId) ?? null)
    const assigneeUserId =
      ownership === 'unknown' ? null : ((closing ? row.closedAssigneeUserId : row.assigneeUserId) ?? null)
    const key = JSON.stringify([ownership, teamId, assigneeUserId])
    let group = teams.get(key)
    if (!group) {
      group = { teamId, assigneeUserId, ownership, openCount: 0, expectedRevenue: '0', won: 0, lost: 0 }
      teams.set(key, group)
    }
    return group
  }
  for (const row of open) {
    const group = teamRow(row, false)
    group.openCount++
    group.expectedRevenue = addDecimals(
      group.expectedRevenue,
      String(details.get(String(row.id))?.expectedRevenue ?? '0'),
    )
  }
  for (const row of closed) {
    const group = teamRow(row, true)
    if (row.terminalState === 'won') group.won++
    else group.lost++
  }
  const stages = new Map<string, Row[]>()
  for (const row of open) stages.set(String(row.stageId), [...(stages.get(String(row.stageId)) ?? []), row])
  const lostReasons = new Map<string, number>()
  for (const row of lost) {
    const value = String(details.get(String(row.id))?.lostReasonCode ?? '')
    const code = LOST_REASON_CODES.includes(value as never) ? value : 'not_recorded'
    lostReasons.set(code, (lostReasons.get(code) ?? 0) + 1)
  }
  const trend = new Map<string, { month: string; won: number; lost: number }>()
  // Empty months are explicit; no chart should silently connect missing buckets.
  const firstMonth = localDate(start).slice(0, 7)
  const lastMonth = localDate(new Date(Math.max(time(start), endTime - 1)).toISOString()).slice(0, 7)
  for (let month = firstMonth; month <= lastMonth; ) {
    trend.set(month, { month, won: 0, lost: 0 })
    const [year, number] = month.split('-').map(Number)
    month = number === 12 ? `${year! + 1}-01` : `${year}-${String(number! + 1).padStart(2, '0')}`
  }
  for (const row of closed) {
    const bucket = trend.get(localDate(row.closedAt).slice(0, 7))!
    if (row.terminalState === 'won') bucket.won++
    else bucket.lost++
  }
  const cycles = won
    .map((row) => (time(row.closedAt) - time(row.createdAt)) / DAY)
    .filter((days) => Number.isFinite(days) && days >= 0)
  const cohortConverted = leads.filter((row) => Number.isFinite(convertedTime(row)))
  const unknownOrigin = cases.filter((row) => inPeriod(row.createdAt) && !origin(row)).length
  return {
    meta: {
      start,
      end,
      effectiveEnd: new Date(endTime).toISOString(),
      asOf,
      timezone,
      activityResolution: 'day',
      pipelineBasis: 'current',
      outcomeBasis: 'latest_case_outcome',
      cohortBasis: 'lead_created_in_period',
    },
    period: {
      newLeads: leads.length,
      won: won.length,
      lost: lost.length,
      winRate: rate(won.length, closed.length),
      medianSalesCycleDays: median(cycles),
    },
    cohort: {
      leads: leads.length,
      contacted: leads.filter((row) => Number.isFinite(firstContact(row))).length,
      converted: cohortConverted.length,
      won: cohortConverted.filter((row) => row.terminalState === 'won' && time(row.closedAt) <= cutoff)
        .length,
      contactedWithin24h: windowMetric(1, firstContact),
      convertedWithin14d: windowMetric(14, convertedTime),
    },
    pipeline: {
      count: open.length,
      expectedRevenue: amount(open),
      weightedRevenue: open.reduce((sum, row) => {
        const detail = details.get(String(row.id))
        return addDecimals(
          sum,
          multiplyDecimals(
            String(detail?.expectedRevenue ?? '0'),
            String(detail?.probability ?? '0'),
            '0.01',
          ),
        )
      }, '0'),
      stages: [...stages].map(([stageId, rows]) => ({
        stageId,
        count: rows.length,
        expectedRevenue: amount(rows),
      })),
    },
    health: {
      noNextStep: riskGroup('no_next_step'),
      overdue: riskGroup('overdue_activity'),
      noRecordedContact14d: riskGroup('no_recorded_contact_14d'),
      atRiskCount: risks.length,
    },
    risks,
    teams: [...teams.values()],
    lostReasons: [...lostReasons].map(([code, count]) => ({ code, count })),
    trend: [...trend.values()].map((row) => ({ ...row, winRate: rate(row.won, row.won + row.lost) })),
    coverage: {
      unknownOrigin,
      unknownClosingOwnership: closed.filter((row) => !row.closedOwnershipRecordedAt).length,
      missingLostReasonCode: lostReasons.get('not_recorded') ?? 0,
      leadsWithoutRecordedContact: leads.filter((row) => !reached(row).length).length,
      contactBasis: 'explicit_reached_interactions_only',
      conversionMetric: 'converted_to_opportunity_not_qualification',
    },
  }
}
