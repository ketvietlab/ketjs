import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { defineFn, eq, from, localDateTimeToUtc } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { hashPassword, verifyPassword } from '../user/password.ts'

type Issue = { field: string; code: string; params?: Record<string, unknown> }
const issue = (field: string, code: string, params?: Record<string, unknown>): Issue => ({
  field,
  code,
  ...(params ? { params } : {}),
})
const invalid = (...errors: Issue[]) => ({ ok: false, errors })
const now = () => new Date().toISOString()
const digest = (value: string) => createHash('sha256').update(value).digest('hex')
const secret = () => randomBytes(32).toString('base64url')
const qrSecret = () => randomBytes(16).toString('base64url')
const clean = (value: unknown) => String(value ?? '').trim()
const minutes = (ms: number) => Math.max(0, Math.round(ms / 60_000))
const effectiveStart = (row: Row) => String(row.correctedStartAt ?? row.startAt)
const effectiveStop = (row: Row) => String(row.correctedStopAt ?? row.stopAt ?? '')
const csv = (value: unknown) => {
  const text = String(value ?? '')
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

const employeeForActor = async (ctx: Ctx): Promise<Row | null> => {
  if (!ctx.actor) return null
  const E = ctx.table('hr.Employee')
  return ctx.db.one(from(E).where(eq(E.userId, ctx.actor), eq(E.active, true)))
}

const policyFor = async (ctx: Ctx): Promise<Row> =>
  (await ctx.db.select('attendance.Policy', { id: 'default' }))[0] ?? {
    id: 'default',
    timezone: 'Asia/Ho_Chi_Minh',
    lateGraceMinutes: 5,
    earlyGraceMinutes: 5,
    roundingMinutes: 1,
    overtimeMinimumMinutes: 30,
  }

const monthBounds = (month: string, timezone: string): [string, string] => {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('month')
  const [year, number] = month.split('-').map(Number)
  if (number < 1 || number > 12) throw new Error('month')
  const next = new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7)
  return [localDateTimeToUtc(`${month}-01T00:00`, timezone), localDateTimeToUtc(`${next}-01T00:00`, timezone)]
}

const periodLockedAt = async (ctx: Ctx, instant: string) => {
  const periods = await ctx.db.select('attendance.Period', {})
  for (const period of periods) {
    if (period.state !== 'locked') continue
    const [from, to] = monthBounds(String(period.month), String(period.timezone))
    if (instant >= from && instant < to) return period
  }
  return null
}

const failThrottle = async (ctx: Ctx, id: string) => {
  const row = (await ctx.db.select('attendance.Throttle', { id }))[0]
  const failures = Math.min(20, Number(row?.failures ?? 0) + 1)
  const blockedUntil = failures >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null
  if (row) await ctx.db.update('attendance.Throttle', { id }, { failures, blockedUntil, updatedAt: now() })
  else await ctx.db.insert('attendance.Throttle', { id, failures, blockedUntil, updatedAt: now() })
}

const clearThrottle = async (ctx: Ctx, id: string) => {
  const row = (await ctx.db.select('attendance.Throttle', { id }))[0]
  if (row)
    await ctx.db.update('attendance.Throttle', { id }, { failures: 0, blockedUntil: null, updatedAt: now() })
}

type ClockInput = {
  employee: Row
  branchId: string
  source: string
  kioskId?: string
  actorUserId?: string
  networkFingerprint?: string
  userAgent?: string
}

const clock = async (ctx: Ctx, input: ClockInput) => {
  const occurredAt = now()
  if (!ctx.scope.branch || input.branchId !== ctx.scope.branch)
    return invalid(issue('branchId', 'attendance.error.branch'))
  if (await periodLockedAt(ctx, occurredAt))
    return invalid(issue('occurredAt', 'attendance.error.periodLocked'))
  return ctx.tx(async (tx) => {
    const stateId = String(input.employee.id)
    let state = (await tx.db.select('attendance.ClockState', { id: stateId }))[0]
    if (!state) {
      await tx.db.insertIfAbsent('attendance.ClockState', {
        id: stateId,
        employeeId: input.employee.id,
        openSessionId: null,
        version: 0,
      })
      state = (await tx.db.select('attendance.ClockState', { id: stateId }))[0]
    }
    const version = Number(state.version)
    const punchId = randomUUID()
    if (!state.openSessionId) {
      const sessionId = randomUUID()
      const claimed = await tx.db.compareAndSet(
        'attendance.ClockState',
        { id: stateId },
        { version, openSessionId: null },
        { openSessionId: sessionId, version: version + 1 },
      )
      if (!('dryRun' in claimed) && !claimed.matched)
        return invalid(issue('employeeId', 'attendance.error.invalid'))
      await tx.db.insert('attendance.Punch', {
        id: punchId,
        employeeId: input.employee.id,
        sessionId,
        kind: 'in',
        occurredAt,
        timezone: input.employee.timezone,
        source: input.source,
        kioskId: input.kioskId ?? null,
        actorUserId: input.actorUserId ?? null,
        networkFingerprint: input.networkFingerprint ?? null,
        userAgent: input.userAgent ?? null,
        createdAt: occurredAt,
      })
      await tx.db.insert('attendance.Session', {
        id: sessionId,
        employeeId: input.employee.id,
        checkInPunchId: punchId,
        checkOutPunchId: null,
        startAt: occurredAt,
        stopAt: null,
        correctedStartAt: null,
        correctedStopAt: null,
        state: 'open',
        version: 1,
      })
      return { ok: true, employeeId: input.employee.id, kind: 'in', occurredAt, sessionId }
    }
    const sessionId = String(state.openSessionId)
    const session = (await tx.db.select('attendance.Session', { id: sessionId }))[0]
    if (!session) return invalid(issue('sessionId', 'attendance.error.missing'))
    const claimed = await tx.db.compareAndSet(
      'attendance.ClockState',
      { id: stateId },
      { version, openSessionId: sessionId },
      { openSessionId: null, version: version + 1 },
    )
    if (!('dryRun' in claimed) && !claimed.matched)
      return invalid(issue('employeeId', 'attendance.error.invalid'))
    await tx.db.insert('attendance.Punch', {
      id: punchId,
      employeeId: input.employee.id,
      sessionId,
      kind: 'out',
      occurredAt,
      timezone: input.employee.timezone,
      source: input.source,
      kioskId: input.kioskId ?? null,
      actorUserId: input.actorUserId ?? null,
      networkFingerprint: input.networkFingerprint ?? null,
      userAgent: input.userAgent ?? null,
      createdAt: occurredAt,
    })
    await tx.db.update(
      'attendance.Session',
      { id: sessionId },
      {
        checkOutPunchId: punchId,
        stopAt: occurredAt,
        state: 'closed',
        version: Number(session.version) + 1,
      },
    )
    return { ok: true, employeeId: input.employee.id, kind: 'out', occurredAt, sessionId }
  })
}

const recompute = async (ctx: Ctx, period: Row) => {
  const [from, to] = monthBounds(String(period.month), String(period.timezone))
  const shifts = (await ctx.db.select('hr.Shift', {})).filter(
    (row) => row.state === 'published' && String(row.startAt) >= from && String(row.startAt) < to,
  )
  const sessions = (await ctx.db.select('attendance.Session', {})).filter((row) => row.state === 'closed')
  const leaves = (await ctx.db.select('hr.LeaveRequest', {})).filter((row) => row.state === 'approved')
  const policy = await policyFor(ctx)
  const overtimeRows = await ctx.db.select('attendance.Overtime', {})
  for (const shift of shifts) {
    const matching = sessions.filter(
      (session) =>
        session.employeeId === shift.employeeId &&
        effectiveStart(session) < String(shift.stopAt) &&
        effectiveStop(session) > String(shift.startAt),
    )
    const starts = matching.map((row) => Date.parse(effectiveStart(row)))
    const stops = matching.map((row) => Date.parse(effectiveStop(row)))
    const first = starts.length ? Math.min(...starts) : Number.NaN
    const last = stops.length ? Math.max(...stops) : Number.NaN
    const workedMinutes = matching.reduce(
      (sum, row) => sum + minutes(Date.parse(effectiveStop(row)) - Date.parse(effectiveStart(row))),
      0,
    )
    const plannedMinutes = Math.max(
      0,
      minutes(Date.parse(String(shift.stopAt)) - Date.parse(String(shift.startAt))) -
        Number(shift.breakMinutes ?? 0),
    )
    const round = Math.max(1, Number(policy.roundingMinutes))
    const roundedWorked = Math.round(workedMinutes / round) * round
    const lateMinutes = Number.isNaN(first)
      ? plannedMinutes
      : Math.max(0, minutes(first - Date.parse(String(shift.startAt))) - Number(policy.lateGraceMinutes))
    const earlyMinutes = Number.isNaN(last)
      ? plannedMinutes
      : Math.max(0, minutes(Date.parse(String(shift.stopAt)) - last) - Number(policy.earlyGraceMinutes))
    const rawOvertime = Math.max(0, roundedWorked - plannedMinutes)
    const overtimeMinutes = rawOvertime >= Number(policy.overtimeMinimumMinutes) ? rawOvertime : 0
    const leave = leaves.find(
      (row) =>
        row.employeeId === shift.employeeId &&
        String(row.dateFrom) <= String(shift.localDate) &&
        String(row.dateTo) >= String(shift.localDate),
    )
    const leaveMinutes = leave
      ? leave.portion === 'full'
        ? plannedMinutes
        : Math.round(plannedMinutes / 2)
      : 0
    const exception = !matching.length ? (leave ? null : 'missing_attendance') : null
    let overtime = overtimeRows.find((row) => row.shiftId === shift.id)
    if (overtimeMinutes && !overtime) {
      const id = `overtime:${shift.id}`
      await ctx.db.insertIfAbsent('attendance.Overtime', {
        id,
        employeeId: shift.employeeId,
        shiftId: shift.id,
        minutes: overtimeMinutes,
        state: 'requested',
        decidedAt: null,
        decidedBy: null,
        decisionNote: null,
      })
      overtime = { id, state: 'requested', minutes: overtimeMinutes }
    } else if (overtime && overtime.state === 'requested' && Number(overtime.minutes) !== overtimeMinutes) {
      await ctx.db.update('attendance.Overtime', { id: overtime.id }, { minutes: overtimeMinutes })
      overtime.minutes = overtimeMinutes
    }
    const entryId = `${period.id}:${shift.id}`
    const values = {
      periodId: period.id,
      employeeId: shift.employeeId,
      shiftId: shift.id,
      localDate: shift.localDate,
      plannedMinutes,
      workedMinutes: roundedWorked,
      lateMinutes,
      earlyMinutes,
      leaveMinutes,
      overtimeMinutes,
      approvedOvertimeMinutes: overtime?.state === 'approved' ? Number(overtime.minutes) : 0,
      exception,
      updatedAt: now(),
    }
    if ((await ctx.db.select('attendance.WorkEntry', { id: entryId }))[0])
      await ctx.db.update('attendance.WorkEntry', { id: entryId }, values)
    else await ctx.db.insert('attendance.WorkEntry', { id: entryId, ...values })
  }
  return ctx.db.select('attendance.WorkEntry', { periodId: period.id })
}

export const functions: Record<string, FnSpec> = {
  'policy.save': defineFn({
    input: {
      timezone: 'text',
      lateGraceMinutes: 'int',
      earlyGraceMinutes: 'int',
      roundingMinutes: 'int',
      overtimeMinimumMinutes: 'int',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:attendance.Policy', 'write:attendance.Policy'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      if (![1, 5, 10, 15].includes(Number(a.roundingMinutes)))
        return invalid(issue('roundingMinutes', 'attendance.error.invalid'))
      const values = { ...a, updatedAt: now() }
      if ((await ctx.db.select('attendance.Policy', { id: 'default' }))[0])
        await ctx.db.update('attendance.Policy', { id: 'default' }, values)
      else await ctx.db.insert('attendance.Policy', { id: 'default', ...values })
      return { ok: true, id: 'default' }
    },
  }),

  'kiosk.manageIssue': defineFn({
    input: { id: 'id?', name: 'text', branchId: 'id' },
    output: { ok: 'bool', id: 'id?', secret: 'text?', errors: 'json?' },
    effects: ['write:attendance.Kiosk'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      if (!ctx.scope.branch || String(a.branchId) !== ctx.scope.branch)
        return invalid(issue('branchId', 'attendance.error.branch'))
      const id = String(a.id ?? randomUUID()),
        value = secret()
      await ctx.db.insert('attendance.Kiosk', {
        id,
        name: clean(a.name),
        secretDigest: digest(value),
        active: true,
        createdAt: now(),
        lastUsedAt: null,
      })
      return { ok: true, id, secret: value }
    },
  }),

  'credential.managePin': defineFn({
    input: { employeeId: 'id', pin: 'text' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:attendance.Credential', 'write:attendance.Credential'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const pin = clean(a.pin)
      if (!/^\d{4,12}$/.test(pin)) return invalid(issue('pin', 'attendance.error.invalid'))
      const existing = (await ctx.db.select('attendance.Credential', { employeeId: a.employeeId }))[0]
      const id = String(existing?.id ?? `employee:${a.employeeId}`)
      const values = { employeeId: a.employeeId, pinHash: hashPassword(pin), active: true, updatedAt: now() }
      if (existing) await ctx.db.update('attendance.Credential', { id }, values)
      else await ctx.db.insert('attendance.Credential', { id, ...values, qrDigest: null, qrIssuedAt: null })
      return { ok: true, id }
    },
  }),

  'credential.manageQr': defineFn({
    input: { employeeId: 'id' },
    output: { ok: 'bool', id: 'id?', secret: 'text?', errors: 'json?' },
    effects: ['read:attendance.Credential', 'write:attendance.Credential'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const value = qrSecret()
      const existing = (await ctx.db.select('attendance.Credential', { employeeId: a.employeeId }))[0]
      const id = String(existing?.id ?? `employee:${a.employeeId}`)
      const values = {
        employeeId: a.employeeId,
        qrDigest: digest(value),
        qrIssuedAt: now(),
        active: true,
        updatedAt: now(),
      }
      if (existing) await ctx.db.update('attendance.Credential', { id }, values)
      else await ctx.db.insert('attendance.Credential', { id, ...values, pinHash: null })
      return { ok: true, id, secret: value }
    },
  }),

  'punch.kiosk': defineFn({
    input: {
      kioskSecret: 'text',
      employeeCode: 'text?',
      pin: 'text?',
      qr: 'text?',
      networkFingerprint: 'text?',
      userAgent: 'text?',
    },
    output: {
      ok: 'bool',
      employeeId: 'id?',
      kind: 'text?',
      occurredAt: 'datetime?',
      sessionId: 'id?',
      errors: 'json?',
    },
    effects: [
      'read:attendance.Kiosk',
      'write:attendance.Kiosk',
      'read:attendance.Credential',
      'read:attendance.Throttle',
      'write:attendance.Throttle',
      'read:hr.Employee',
      'read:attendance.Period',
      'read:attendance.ClockState',
      'write:attendance.ClockState',
      'read:attendance.Session',
      'write:attendance.Session',
      'write:attendance.Punch',
    ],
    anonymous: true,
    idempotent: false,
    handler: async (ctx: Ctx, a) => {
      const kiosk = (await ctx.db.select('attendance.Kiosk', {})).find(
        (row) => row.active && row.secretDigest === digest(String(a.kioskSecret)),
      )
      if (!kiosk) return invalid(issue('kioskSecret', 'attendance.error.kiosk'))
      let employee: Row | undefined
      let credential: Row | undefined
      let source: string
      if (a.qr) {
        credential = (await ctx.db.select('attendance.Credential', {})).find(
          (row) => row.active && row.qrDigest === digest(String(a.qr)),
        )
        employee = credential
          ? (await ctx.db.select('hr.Employee', { id: credential.employeeId }))[0]
          : undefined
        source = 'kiosk_qr'
      } else {
        employee = (await ctx.db.select('hr.Employee', {})).find(
          (row) => row.active && String(row.code).toUpperCase() === clean(a.employeeCode).toUpperCase(),
        )
        credential = employee
          ? (await ctx.db.select('attendance.Credential', { employeeId: employee.id }))[0]
          : undefined
        source = 'kiosk_pin'
      }
      const throttleId = digest(`${kiosk.id}\n${clean(a.employeeCode)}\n${clean(a.networkFingerprint)}`)
      const throttle = (await ctx.db.select('attendance.Throttle', { id: throttleId }))[0]
      if (throttle?.blockedUntil && Date.parse(String(throttle.blockedUntil)) > Date.now())
        return invalid(issue('pin', 'attendance.error.throttled'))
      const valid = Boolean(
        employee &&
          credential?.active &&
          (source === 'kiosk_qr'
            ? credential.qrDigest === digest(String(a.qr))
            : credential.pinHash && verifyPassword(String(a.pin ?? ''), String(credential.pinHash))),
      )
      if (!valid) {
        await failThrottle(ctx, throttleId)
        return invalid(issue('pin', 'attendance.error.credential'))
      }
      await clearThrottle(ctx, throttleId)
      await ctx.db.update('attendance.Kiosk', { id: kiosk.id }, { lastUsedAt: now() })
      return clock(ctx, {
        employee: employee!,
        branchId: String(kiosk.branchId),
        source,
        kioskId: String(kiosk.id),
        networkFingerprint: a.networkFingerprint ? String(a.networkFingerprint) : undefined,
        userAgent: a.userAgent ? String(a.userAgent) : undefined,
      })
    },
  }),

  'punch.self': defineFn({
    input: {},
    output: {
      ok: 'bool',
      employeeId: 'id?',
      kind: 'text?',
      occurredAt: 'datetime?',
      sessionId: 'id?',
      errors: 'json?',
    },
    effects: [
      'read:hr.Employee',
      'read:attendance.Period',
      'read:attendance.ClockState',
      'write:attendance.ClockState',
      'read:attendance.Session',
      'write:attendance.Session',
      'write:attendance.Punch',
    ],
    handler: async (ctx: Ctx) => {
      const employee = await employeeForActor(ctx)
      if (!employee) return invalid(issue('employeeId', 'attendance.error.employeeUser'))
      return clock(ctx, {
        employee,
        branchId: String(employee.homeBranchId),
        source: 'account',
        actorUserId: ctx.actor ?? undefined,
      })
    },
  }),

  'session.mine': defineFn({
    input: { month: 'text?' },
    output: {
      id: 'id',
      branchId: 'id',
      startAt: 'datetime',
      stopAt: 'datetime?',
      correctedStartAt: 'datetime?',
      correctedStopAt: 'datetime?',
      state: 'text',
    },
    effects: ['read:hr.Employee', 'read:attendance.Session', 'read:attendance.Policy'],
    handler: async (ctx: Ctx, a) => {
      const employee = await employeeForActor(ctx)
      if (!employee) return []
      const rows = await ctx.db.select('attendance.Session', { employeeId: employee.id })
      if (!a.month) return rows
      const policy = await policyFor(ctx),
        [from, to] = monthBounds(String(a.month), String(policy.timezone))
      return rows.filter((row) => String(row.startAt) >= from && String(row.startAt) < to)
    },
  }),

  'correction.request': defineFn({
    input: {
      id: 'id?',
      sessionId: 'id',
      requestedStartAt: 'datetime',
      requestedStopAt: 'datetime',
      reason: 'text',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:hr.Employee',
      'read:attendance.Session',
      'read:attendance.Correction',
      'write:attendance.Correction',
    ],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const employee = await employeeForActor(ctx)
      if (!employee) return invalid(issue('employeeId', 'attendance.error.employeeUser'))
      const session = (await ctx.db.select('attendance.Session', { id: a.sessionId }))[0]
      if (!session || session.employeeId !== employee.id)
        return invalid(issue('sessionId', 'attendance.error.missing'))
      if (Date.parse(String(a.requestedStopAt)) <= Date.parse(String(a.requestedStartAt)))
        return invalid(issue('requestedStopAt', 'attendance.error.correctionRange'))
      const id = String(a.id ?? randomUUID())
      await ctx.db.insert('attendance.Correction', {
        id,
        sessionId: a.sessionId,
        employeeId: employee.id,
        requestedStartAt: a.requestedStartAt,
        requestedStopAt: a.requestedStopAt,
        reason: clean(a.reason),
        state: 'requested',
        requestedAt: now(),
        decidedAt: null,
        decidedBy: null,
        decisionNote: null,
      })
      return { ok: true, id }
    },
  }),

  'correction.manageDecision': defineFn({
    input: { id: 'id', decision: 'text', note: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:attendance.Correction',
      'write:attendance.Correction',
      'read:attendance.Session',
      'write:attendance.Session',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const row = (await ctx.db.select('attendance.Correction', { id: a.id }))[0]
      if (!row) return invalid(issue('id', 'attendance.error.missing'))
      if (row.state !== 'requested') return { ok: true, id: row.id }
      if (!['approved', 'rejected'].includes(String(a.decision)))
        return invalid(issue('decision', 'attendance.error.invalid'))
      await ctx.tx(async (tx) => {
        if (a.decision === 'approved') {
          const session = (await tx.db.select('attendance.Session', { id: row.sessionId }))[0]
          await tx.db.update(
            'attendance.Session',
            { id: row.sessionId },
            {
              correctedStartAt: row.requestedStartAt,
              correctedStopAt: row.requestedStopAt,
              version: Number(session.version) + 1,
            },
          )
        }
        await tx.db.update(
          'attendance.Correction',
          { id: a.id },
          {
            state: a.decision,
            decidedAt: now(),
            decidedBy: ctx.actor ?? null,
            decisionNote: a.note ?? null,
          },
        )
      })
      return { ok: true, id: a.id }
    },
  }),

  'overtime.manageDecision': defineFn({
    input: { id: 'id', decision: 'text', note: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:attendance.Overtime', 'write:attendance.Overtime'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const row = (await ctx.db.select('attendance.Overtime', { id: a.id }))[0]
      if (!row) return invalid(issue('id', 'attendance.error.missing'))
      if (!['approved', 'rejected'].includes(String(a.decision)))
        return invalid(issue('decision', 'attendance.error.invalid'))
      await ctx.db.update(
        'attendance.Overtime',
        { id: a.id },
        {
          state: a.decision,
          decidedAt: now(),
          decidedBy: ctx.actor ?? null,
          decisionNote: a.note ?? null,
        },
      )
      return { ok: true, id: a.id }
    },
  }),

  'period.report': defineFn({
    input: { month: 'text' },
    output: { id: 'id', month: 'text', timezone: 'text', state: 'text', version: 'int', entries: 'json?' },
    effects: [
      'read:attendance.Policy',
      'read:attendance.Period',
      'write:attendance.Period',
      'read:hr.Shift',
      'read:attendance.Session',
      'read:hr.LeaveRequest',
      'read:attendance.Overtime',
      'write:attendance.Overtime',
      'read:attendance.WorkEntry',
      'write:attendance.WorkEntry',
    ],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const month = String(a.month)
      let policy: Row
      try {
        policy = await policyFor(ctx)
        monthBounds(month, String(policy.timezone))
      } catch {
        return null
      }
      let period = (await ctx.db.select('attendance.Period', { month }))[0]
      if (!period) {
        await ctx.db.insert('attendance.Period', {
          id: month,
          month,
          timezone: policy.timezone,
          state: 'open',
          version: 1,
          lockedAt: null,
          lockedBy: null,
          reopenedAt: null,
          reopenedBy: null,
          reopenReason: null,
        })
        period = (await ctx.db.select('attendance.Period', { month }))[0]
      }
      const entries =
        period.state === 'locked'
          ? await ctx.db.select('attendance.WorkEntry', { periodId: period.id })
          : await recompute(ctx, period)
      return { ...period, entries }
    },
  }),

  'period.manageClose': defineFn({
    input: { month: 'text' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: [
      'read:attendance.Policy',
      'read:attendance.Period',
      'write:attendance.Period',
      'read:hr.Shift',
      'read:attendance.Session',
      'read:hr.LeaveRequest',
      'read:attendance.Correction',
      'read:attendance.Overtime',
      'write:attendance.Overtime',
      'read:attendance.WorkEntry',
      'write:attendance.WorkEntry',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const month = String(a.month),
        policy = await policyFor(ctx)
      let bounds: [string, string]
      try {
        bounds = monthBounds(month, String(policy.timezone))
      } catch {
        return invalid(issue('month', 'attendance.error.periodMonth'))
      }
      let period = (await ctx.db.select('attendance.Period', { month }))[0]
      if (!period) {
        await ctx.db.insert('attendance.Period', {
          id: month,
          month,
          timezone: policy.timezone,
          state: 'open',
          version: 1,
          lockedAt: null,
          lockedBy: null,
          reopenedAt: null,
          reopenedBy: null,
          reopenReason: null,
        })
        period = (await ctx.db.select('attendance.Period', { month }))[0]
      }
      if (period.state === 'locked') return { ok: true, id: period.id, version: period.version }
      const open = (await ctx.db.select('attendance.Session', {})).some(
        (row) => row.state === 'open' && String(row.startAt) >= bounds[0] && String(row.startAt) < bounds[1],
      )
      if (open) return invalid(issue('month', 'attendance.error.periodOpenSession'))
      const entries = await recompute(ctx, period)
      if (entries.some((entry) => entry.exception))
        return invalid(issue('month', 'attendance.error.periodErrors'))
      const pendingCorrections = (await ctx.db.select('attendance.Correction', {})).some(
        (row) =>
          row.state === 'requested' &&
          String(row.requestedStartAt) >= bounds[0] &&
          String(row.requestedStartAt) < bounds[1],
      )
      const shiftIds = new Set(
        (await ctx.db.select('hr.Shift', {}))
          .filter((row) => String(row.startAt) >= bounds[0] && String(row.startAt) < bounds[1])
          .map((row) => row.id),
      )
      const pendingOvertime = (await ctx.db.select('attendance.Overtime', {})).some(
        (row) => row.state === 'requested' && shiftIds.has(row.shiftId),
      )
      if (pendingCorrections || pendingOvertime)
        return invalid(issue('month', 'attendance.error.periodPending'))
      const version = Number(period.version) + 1
      await ctx.db.update(
        'attendance.Period',
        { id: period.id },
        { state: 'locked', version, lockedAt: now(), lockedBy: ctx.actor ?? null },
      )
      return { ok: true, id: period.id, version }
    },
  }),

  'period.manageReopen': defineFn({
    input: { month: 'text', reason: 'text' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: ['read:attendance.Period', 'write:attendance.Period'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      if (!clean(a.reason)) return invalid(issue('reason', 'attendance.error.required'))
      const period = (await ctx.db.select('attendance.Period', { month: a.month }))[0]
      if (!period) return invalid(issue('month', 'attendance.error.missing'))
      if (period.state === 'open') return { ok: true, id: period.id, version: period.version }
      const version = Number(period.version) + 1
      await ctx.db.update(
        'attendance.Period',
        { id: period.id },
        {
          state: 'open',
          version,
          reopenedAt: now(),
          reopenedBy: ctx.actor ?? null,
          reopenReason: clean(a.reason),
        },
      )
      return { ok: true, id: period.id, version }
    },
  }),

  'period.export': defineFn({
    input: { month: 'text' },
    output: { month: 'text', filename: 'text', contentType: 'text', csv: 'text' },
    effects: [
      'read:attendance.Period',
      'read:attendance.WorkEntry',
      'read:hr.Employee',
      'read:partner.Partner',
    ],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const period = (await ctx.db.select('attendance.Period', { month: a.month }))[0]
      if (!period) return null
      const entries = await ctx.db.select('attendance.WorkEntry', { periodId: period.id })
      const employees = await ctx.db.select('hr.Employee', {}),
        partners = await ctx.db.select('partner.Partner', {})
      const lines = [
        [
          'employee_code',
          'employee_name',
          'date',
          'planned_minutes',
          'worked_minutes',
          'late_minutes',
          'early_minutes',
          'leave_minutes',
          'overtime_minutes',
          'approved_overtime_minutes',
          'exception',
        ],
      ]
      for (const entry of entries) {
        const employee = employees.find((row) => row.id === entry.employeeId)
        const partner = partners.find((row) => row.id === employee?.partnerId)
        lines.push(
          [
            employee?.code,
            partner?.name,
            entry.localDate,
            entry.plannedMinutes,
            entry.workedMinutes,
            entry.lateMinutes,
            entry.earlyMinutes,
            entry.leaveMinutes,
            entry.overtimeMinutes,
            entry.approvedOvertimeMinutes,
            entry.exception,
          ].map(String),
        )
      }
      return {
        month: a.month,
        filename: `attendance-${a.month}.csv`,
        contentType: 'text/csv; charset=utf-8',
        csv: `\uFEFF${lines.map((line) => line.map(csv).join(',')).join('\n')}\n`,
      }
    },
  }),
}
