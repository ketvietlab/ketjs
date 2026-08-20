import { randomUUID } from 'node:crypto'
import { assertTimezone, defineFn, deleteFrom, eq, from, localDateTimeToUtc } from 'ketjs'
import type { Ctx, FnSpec, Row } from 'ketjs'
import { LEAVE_PORTIONS } from './types.ts'

type Issue = { field: string; code: string; params?: Record<string, unknown> }
const issue = (field: string, code: string, params?: Record<string, unknown>): Issue => ({
  field,
  code,
  ...(params ? { params } : {}),
})
const invalid = (...errors: Issue[]) => ({ ok: false, errors })
const now = () => new Date().toISOString()
const clean = (value: unknown) => String(value ?? '').trim()
const dateMs = (value: unknown) => Date.parse(`${String(value)}T00:00:00.000Z`)
const dayText = (instant: number) => new Date(instant).toISOString().slice(0, 10)
const addDays = (value: string, days: number) => dayText(dateMs(value) + days * 86_400_000)
const daysBetween = (from: string, to: string) => Math.floor((dateMs(to) - dateMs(from)) / 86_400_000)
const isTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
const decimal = (value: unknown) => Number.parseFloat(String(value ?? 0))

const employeeForActor = async (ctx: Ctx): Promise<Row | null> => {
  if (!ctx.actor) return null
  const E = ctx.table('hr.Employee')
  return ctx.db.one(from(E).where(eq(E.userId, ctx.actor), eq(E.active, true)))
}

const branchExists = async (ctx: Ctx, id: unknown) => {
  const B = ctx.table('company.Branch')
  return ctx.db.one(from(B).where(eq(B.id, id), eq(B.active, true)))
}
const activeBranch = (ctx: Ctx, id: unknown) => Boolean(ctx.scope.branch && String(id) === ctx.scope.branch)

const shiftTimes = (date: string, template: Row) => {
  const timezone = assertTimezone(String(template.timezone))
  const startTime = String(template.startTime)
  const endTime = String(template.endTime)
  const stopDate = endTime <= startTime ? addDays(date, 1) : date
  return {
    startAt: localDateTimeToUtc(`${date}T${startTime}`, timezone),
    stopAt: localDateTimeToUtc(`${stopDate}T${endTime}`, timezone),
    timezone,
  }
}

const overlaps = async (ctx: Ctx, employeeId: string, startAt: string, stopAt: string, exceptId?: string) => {
  const rows = await ctx.db.select('hr.Shift', { employeeId })
  return rows.some(
    (row) =>
      row.id !== exceptId &&
      row.state !== 'cancelled' &&
      Date.parse(String(row.startAt)) < Date.parse(stopAt) &&
      Date.parse(String(row.stopAt)) > Date.parse(startAt),
  )
}

const saveSimple = (
  model: 'hr.Department' | 'hr.Job' | 'hr.LeaveType',
  fields: string[],
  defaults: Record<string, unknown> = {},
): FnSpec =>
  defineFn({
    input: { id: 'id', name: 'text', code: 'text?', parentId: 'id?', paid: 'bool?', active: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [`read:${model}`, `write:${model}`],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      if (!clean(a.name)) return invalid(issue('name', 'hr.error.required'))
      const existing = (await ctx.db.select(model, { id: a.id }))[0]
      const values: Record<string, unknown> = { ...defaults, ...a }
      for (const key of Object.keys(values)) if (!fields.includes(key) && key !== 'id') delete values[key]
      values.name = clean(a.name)
      if ('code' in values) values.code = clean(a.code).toUpperCase()
      if (existing) await ctx.db.update(model, { id: a.id }, values)
      else await ctx.db.insert(model, { id: a.id, ...values })
      return { ok: true, id: a.id }
    },
  })

export const functions: Record<string, FnSpec> = {
  'department.save': saveSimple('hr.Department', ['name', 'parentId', 'active'], { active: true }),
  'job.save': saveSimple('hr.Job', ['name', 'active'], { active: true }),
  'leaveType.save': saveSimple('hr.LeaveType', ['name', 'code', 'paid', 'active'], {
    paid: true,
    active: true,
  }),

  'employee.manageList': defineFn({
    input: { includeArchived: 'bool?' },
    output: {
      id: 'id',
      code: 'text',
      name: 'text',
      partnerId: 'id',
      userId: 'id?',
      departmentId: 'id?',
      jobId: 'id?',
      homeBranchId: 'id',
      timezone: 'text',
      startDate: 'date',
      endDate: 'date?',
      active: 'bool',
    },
    effects: ['read:hr.Employee', 'read:partner.Partner'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const E = ctx.table('hr.Employee')
      let q = from(E).preload('partner')
      if (a.includeArchived !== true) q = q.where(eq(E.active, true))
      return (await ctx.db.all(q)).map((row) => ({
        ...row,
        name: String((row.partner as Row | null)?.name ?? row.code),
      }))
    },
  }),

  'employee.save': defineFn({
    input: {
      id: 'id',
      code: 'text',
      partnerId: 'id',
      userId: 'id?',
      departmentId: 'id?',
      jobId: 'id?',
      homeBranchId: 'id',
      timezone: 'text',
      startDate: 'date',
      endDate: 'date?',
      active: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:hr.Employee',
      'write:hr.Employee',
      'read:partner.Partner',
      'read:partner.Role',
      'write:partner.Role',
      'read:company.Branch',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const code = clean(a.code).toUpperCase()
      if (!code) return invalid(issue('code', 'hr.error.required'))
      const partner = (await ctx.db.select('partner.Partner', { id: a.partnerId }))[0]
      if (partner?.kind !== 'person') return invalid(issue('partnerId', 'hr.error.partner'))
      if (!(await branchExists(ctx, a.homeBranchId))) return invalid(issue('homeBranchId', 'hr.error.branch'))
      try {
        assertTimezone(String(a.timezone))
      } catch {
        return invalid(issue('timezone', 'hr.error.timezone'))
      }
      const rows = await ctx.db.select('hr.Employee', {})
      if (
        rows.some(
          (row) =>
            row.id !== a.id &&
            (row.code === code || row.partnerId === a.partnerId || (a.userId && row.userId === a.userId)),
        )
      )
        return invalid(issue('code', 'hr.error.unique'))
      const existing = rows.find((row) => row.id === a.id)
      const values = {
        code,
        partnerId: a.partnerId,
        userId: a.userId ?? null,
        departmentId: a.departmentId ?? null,
        jobId: a.jobId ?? null,
        homeBranchId: a.homeBranchId,
        timezone: a.timezone,
        startDate: a.startDate,
        endDate: a.endDate ?? null,
        active: a.active ?? true,
        updatedAt: now(),
      }
      await ctx.tx(async (tx) => {
        if (existing) await tx.db.update('hr.Employee', { id: a.id }, values)
        else await tx.db.insert('hr.Employee', { id: a.id, ...values, createdAt: now() })
        await tx.db.insertIfAbsent('partner.Role', {
          id: `employee:${a.partnerId}`,
          partnerId: a.partnerId,
          role: 'employee',
        })
      })
      return { ok: true, id: a.id }
    },
  }),

  'employee.myProfile': defineFn({
    input: {},
    output: {
      id: 'id',
      code: 'text',
      name: 'text',
      homeBranchId: 'id',
      timezone: 'text',
      active: 'bool',
    },
    effects: ['read:hr.Employee', 'read:partner.Partner'],
    handler: async (ctx: Ctx) => {
      const row = await employeeForActor(ctx)
      if (!row) return null
      const partner = (await ctx.db.select('partner.Partner', { id: row.partnerId }))[0]
      return { ...row, name: String(partner?.name ?? row.code) }
    },
  }),

  'shiftTemplate.save': defineFn({
    input: {
      id: 'id',
      code: 'text',
      name: 'text',
      branchId: 'id',
      startTime: 'text',
      endTime: 'text',
      breakMinutes: 'int?',
      timezone: 'text',
      active: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:hr.ShiftTemplate', 'write:hr.ShiftTemplate', 'read:company.Branch'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      if (!activeBranch(ctx, a.branchId) || !(await branchExists(ctx, a.branchId)))
        return invalid(issue('branchId', 'hr.error.branch'))
      if (!isTime(String(a.startTime)) || !isTime(String(a.endTime)))
        return invalid(issue('startTime', 'hr.error.time'))
      try {
        assertTimezone(String(a.timezone))
      } catch {
        return invalid(issue('timezone', 'hr.error.timezone'))
      }
      const values = {
        code: clean(a.code).toUpperCase(),
        name: clean(a.name),
        startTime: a.startTime,
        endTime: a.endTime,
        breakMinutes: Math.max(0, Number(a.breakMinutes ?? 0)),
        timezone: a.timezone,
        active: a.active ?? true,
      }
      const existing = (await ctx.db.select('hr.ShiftTemplate', { id: a.id }))[0]
      if (existing) await ctx.db.update('hr.ShiftTemplate', { id: a.id }, values)
      else await ctx.db.insert('hr.ShiftTemplate', { id: a.id, ...values })
      return { ok: true, id: a.id }
    },
  }),

  'rotation.save': defineFn({
    input: { id: 'id', name: 'text', cycleWeeks: 'int', slots: 'json?', active: 'bool?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:hr.Rotation',
      'write:hr.Rotation',
      'read:hr.RotationSlot',
      'write:hr.RotationSlot',
      'read:hr.ShiftTemplate',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const cycleWeeks = Number(a.cycleWeeks)
      if (!Number.isInteger(cycleWeeks) || cycleWeeks < 1 || cycleWeeks > 4)
        return invalid(issue('cycleWeeks', 'hr.error.rotationWeeks'))
      const slots = Array.isArray(a.slots) ? (a.slots as Array<Record<string, unknown>>) : []
      for (const slot of slots) {
        const week = Number(slot.weekIndex)
        const weekday = Number(slot.weekday)
        if (week < 0 || week >= cycleWeeks || weekday < 1 || weekday > 7)
          return invalid(issue('slots', 'hr.error.rotationSlot'))
        if (!(await ctx.db.select('hr.ShiftTemplate', { id: slot.shiftTemplateId }))[0])
          return invalid(issue('slots', 'hr.error.missing'))
      }
      await ctx.tx(async (tx) => {
        const existing = (await tx.db.select('hr.Rotation', { id: a.id }))[0]
        const values = { name: clean(a.name), cycleWeeks, active: a.active ?? true }
        if (existing) await tx.db.update('hr.Rotation', { id: a.id }, values)
        else await tx.db.insert('hr.Rotation', { id: a.id, ...values })
        const S = tx.table('hr.RotationSlot')
        await tx.db.del(deleteFrom(S).where(eq(S.rotationId, a.id)))
        for (const slot of slots)
          await tx.db.insert('hr.RotationSlot', {
            id: `${a.id}:${slot.weekIndex}:${slot.weekday}`,
            rotationId: a.id,
            weekIndex: Number(slot.weekIndex),
            weekday: Number(slot.weekday),
            shiftTemplateId: slot.shiftTemplateId,
          })
      })
      return { ok: true, id: a.id }
    },
  }),

  'rotation.assign': defineFn({
    input: {
      id: 'id',
      employeeId: 'id',
      rotationId: 'id',
      branchId: 'id',
      anchorDate: 'date',
      effectiveFrom: 'date',
      effectiveTo: 'date?',
      active: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:hr.Employee',
      'read:hr.Rotation',
      'read:hr.RotationAssignment',
      'write:hr.RotationAssignment',
      'read:company.Branch',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      if (!(await ctx.db.select('hr.Employee', { id: a.employeeId }))[0])
        return invalid(issue('employeeId', 'hr.error.missing'))
      if (!(await ctx.db.select('hr.Rotation', { id: a.rotationId }))[0])
        return invalid(issue('rotationId', 'hr.error.missing'))
      if (!activeBranch(ctx, a.branchId) || !(await branchExists(ctx, a.branchId)))
        return invalid(issue('branchId', 'hr.error.branch'))
      const values = {
        employeeId: a.employeeId,
        rotationId: a.rotationId,
        anchorDate: a.anchorDate,
        effectiveFrom: a.effectiveFrom,
        effectiveTo: a.effectiveTo ?? null,
        active: a.active ?? true,
      }
      const existing = (await ctx.db.select('hr.RotationAssignment', { id: a.id }))[0]
      if (existing) await ctx.db.update('hr.RotationAssignment', { id: a.id }, values)
      else await ctx.db.insert('hr.RotationAssignment', { id: a.id, ...values })
      return { ok: true, id: a.id }
    },
  }),

  'roster.generate': defineFn({
    input: { branchId: 'id', weekStart: 'date' },
    output: { ok: 'bool', id: 'id?', generated: 'int?', errors: 'json?' },
    effects: [
      'read:hr.Roster',
      'write:hr.Roster',
      'read:hr.Shift',
      'write:hr.Shift',
      'read:hr.RotationAssignment',
      'read:hr.Rotation',
      'read:hr.RotationSlot',
      'read:hr.ShiftTemplate',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const weekStart = String(a.weekStart)
      if (!activeBranch(ctx, a.branchId)) return invalid(issue('branchId', 'hr.error.branch'))
      if (new Date(`${weekStart}T00:00:00Z`).getUTCDay() !== 1)
        return invalid(issue('weekStart', 'hr.error.invalid'))
      const rosterId = `${a.branchId}:${weekStart}`
      const existing = (await ctx.db.select('hr.Roster', { id: rosterId }))[0]
      if (existing?.state === 'published') return invalid(issue('weekStart', 'hr.error.rosterPublished'))
      const assignments = (await ctx.db.select('hr.RotationAssignment', { branchId: a.branchId })).filter(
        (row) =>
          row.active &&
          String(row.effectiveFrom) <= addDays(weekStart, 6) &&
          (!row.effectiveTo || String(row.effectiveTo) >= weekStart),
      )
      let generated = 0
      await ctx.tx(async (tx) => {
        if (!existing)
          await tx.db.insert('hr.Roster', {
            id: rosterId,
            weekStart,
            state: 'draft',
            version: 1,
            publishedAt: null,
            publishedBy: null,
            reopenedAt: null,
            reopenedBy: null,
            reopenReason: null,
          })
        for (const assignment of assignments) {
          const rotation = (await tx.db.select('hr.Rotation', { id: assignment.rotationId }))[0]
          if (!rotation?.active) continue
          const slots = await tx.db.select('hr.RotationSlot', { rotationId: rotation.id })
          for (let day = 0; day < 7; day++) {
            const localDate = addDays(weekStart, day)
            if (
              localDate < String(assignment.effectiveFrom) ||
              (assignment.effectiveTo && localDate > String(assignment.effectiveTo))
            )
              continue
            const weeks = Math.floor(daysBetween(String(assignment.anchorDate), localDate) / 7)
            const weekIndex =
              ((weeks % Number(rotation.cycleWeeks)) + Number(rotation.cycleWeeks)) %
              Number(rotation.cycleWeeks)
            const slot = slots.find(
              (row) => Number(row.weekIndex) === weekIndex && Number(row.weekday) === day + 1,
            )
            if (!slot) continue
            const template = (await tx.db.select('hr.ShiftTemplate', { id: slot.shiftTemplateId }))[0]
            if (!template?.active) continue
            const times = shiftTimes(localDate, template)
            const sourceKey = `rotation:${assignment.id}:${localDate}`
            const inserted = await tx.db.insertIfAbsent('hr.Shift', {
              id: sourceKey,
              rosterId,
              employeeId: assignment.employeeId,
              shiftTemplateId: template.id,
              localDate,
              ...times,
              breakMinutes: template.breakMinutes,
              state: 'draft',
              source: 'rotation',
              sourceKey,
              note: null,
              version: 1,
            })
            if ('dryRun' in inserted || inserted.inserted) generated++
          }
        }
      })
      return { ok: true, id: rosterId, generated }
    },
  }),

  'roster.manageList': defineFn({
    input: { branchId: 'id?', weekStart: 'date?' },
    output: { id: 'id', branchId: 'id', weekStart: 'date', state: 'text', version: 'int', shifts: 'json?' },
    effects: ['read:hr.Roster', 'read:hr.Shift', 'read:hr.Employee', 'read:partner.Partner'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      let rows = await ctx.db.select('hr.Roster', {})
      if (a.branchId) rows = rows.filter((row) => row.branchId === a.branchId)
      if (a.weekStart) rows = rows.filter((row) => row.weekStart === a.weekStart)
      const employees = await ctx.db.select('hr.Employee', {})
      const partners = await ctx.db.select('partner.Partner', {})
      return Promise.all(
        rows.map(async (row) => ({
          ...row,
          shifts: (await ctx.db.select('hr.Shift', { rosterId: row.id })).map((shift) => {
            const employee = employees.find((entry) => entry.id === shift.employeeId)
            const partner = partners.find((entry) => entry.id === employee?.partnerId)
            return { ...shift, employeeName: partner?.name ?? employee?.code }
          }),
        })),
      )
    },
  }),

  'roster.managePublish': defineFn({
    input: { id: 'id', version: 'int' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: ['read:hr.Roster', 'write:hr.Roster', 'read:hr.Shift', 'write:hr.Shift'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const row = (await ctx.db.select('hr.Roster', { id: a.id }))[0]
      if (!row) return invalid(issue('id', 'hr.error.missing'))
      if (row.state === 'published') return { ok: true, id: row.id, version: row.version }
      const next = Number(row.version) + 1
      const changed = await ctx.db.compareAndSet(
        'hr.Roster',
        { id: a.id },
        { version: a.version, state: 'draft' },
        { state: 'published', version: next, publishedAt: now(), publishedBy: ctx.actor ?? null },
      )
      if (!('dryRun' in changed) && !changed.matched) return invalid(issue('version', 'hr.error.invalid'))
      for (const shift of await ctx.db.select('hr.Shift', { rosterId: a.id }))
        if (shift.state === 'draft') await ctx.db.update('hr.Shift', { id: shift.id }, { state: 'published' })
      return { ok: true, id: a.id, version: next }
    },
  }),

  'roster.manageReopen': defineFn({
    input: { id: 'id', reason: 'text' },
    output: { ok: 'bool', id: 'id?', version: 'int?', errors: 'json?' },
    effects: ['read:hr.Roster', 'write:hr.Roster', 'read:hr.Shift', 'write:hr.Shift'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      if (!clean(a.reason)) return invalid(issue('reason', 'hr.error.required'))
      const row = (await ctx.db.select('hr.Roster', { id: a.id }))[0]
      if (!row) return invalid(issue('id', 'hr.error.missing'))
      if (row.state === 'draft') return { ok: true, id: row.id, version: row.version }
      const version = Number(row.version) + 1
      await ctx.db.update(
        'hr.Roster',
        { id: a.id },
        {
          state: 'draft',
          version,
          reopenedAt: now(),
          reopenedBy: ctx.actor ?? null,
          reopenReason: clean(a.reason),
        },
      )
      for (const shift of await ctx.db.select('hr.Shift', { rosterId: a.id }))
        if (shift.state === 'published') await ctx.db.update('hr.Shift', { id: shift.id }, { state: 'draft' })
      return { ok: true, id: a.id, version }
    },
  }),

  'shift.save': defineFn({
    input: {
      id: 'id?',
      rosterId: 'id',
      employeeId: 'id',
      shiftTemplateId: 'id?',
      branchId: 'id',
      localDate: 'date',
      startAt: 'datetime',
      stopAt: 'datetime',
      timezone: 'text',
      breakMinutes: 'int?',
      note: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:hr.Roster', 'read:hr.Shift', 'write:hr.Shift'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const roster = (await ctx.db.select('hr.Roster', { id: a.rosterId }))[0]
      if (!roster) return invalid(issue('rosterId', 'hr.error.missing'))
      if (roster.state === 'published') return invalid(issue('rosterId', 'hr.error.rosterPublished'))
      if (!activeBranch(ctx, a.branchId)) return invalid(issue('branchId', 'hr.error.branch'))
      const id = String(a.id ?? randomUUID())
      if (Date.parse(String(a.stopAt)) <= Date.parse(String(a.startAt)))
        return invalid(issue('stopAt', 'hr.error.invalid'))
      if (await overlaps(ctx, String(a.employeeId), String(a.startAt), String(a.stopAt), id))
        return invalid(issue('startAt', 'hr.error.shiftOverlap'))
      const values = {
        rosterId: a.rosterId,
        employeeId: a.employeeId,
        shiftTemplateId: a.shiftTemplateId ?? null,
        timezone: a.timezone,
        breakMinutes: Math.max(0, Number(a.breakMinutes ?? 0)),
        state: 'draft',
        source: 'manual',
        sourceKey: null,
        note: a.note ?? null,
      }
      const existing = (await ctx.db.select('hr.Shift', { id }))[0]
      if (existing)
        await ctx.db.update('hr.Shift', { id }, { ...values, version: Number(existing.version) + 1 })
      else await ctx.db.insert('hr.Shift', { id, ...values, version: 1 })
      return { ok: true, id }
    },
  }),

  'schedule.mine': defineFn({
    input: { dateFrom: 'date', dateTo: 'date' },
    output: {
      id: 'id',
      localDate: 'date',
      startAt: 'datetime',
      stopAt: 'datetime',
      timezone: 'text',
      branchId: 'id',
      breakMinutes: 'int',
      state: 'text',
    },
    effects: ['read:hr.Employee', 'read:hr.Shift'],
    handler: async (ctx: Ctx, a) => {
      const employee = await employeeForActor(ctx)
      if (!employee) return []
      return (await ctx.db.select('hr.Shift', { employeeId: employee.id })).filter(
        (row) =>
          row.state === 'published' &&
          String(row.localDate) >= String(a.dateFrom) &&
          String(row.localDate) <= String(a.dateTo),
      )
    },
  }),

  'leave.manageAllocation': defineFn({
    input: { id: 'id', employeeId: 'id', leaveTypeId: 'id', year: 'int', days: 'decimal', note: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:hr.LeaveAllocation', 'write:hr.LeaveAllocation'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      if (decimal(a.days) < 0) return invalid(issue('days', 'hr.error.invalid'))
      const existing = (await ctx.db.select('hr.LeaveAllocation', { id: a.id }))[0]
      const values = {
        employeeId: a.employeeId,
        leaveTypeId: a.leaveTypeId,
        year: a.year,
        days: a.days,
        note: a.note ?? null,
      }
      if (existing) await ctx.db.update('hr.LeaveAllocation', { id: a.id }, values)
      else await ctx.db.insert('hr.LeaveAllocation', { id: a.id, ...values })
      return { ok: true, id: a.id }
    },
  }),

  'leave.request': defineFn({
    input: {
      id: 'id?',
      employeeId: 'id?',
      leaveTypeId: 'id',
      dateFrom: 'date',
      dateTo: 'date',
      portion: 'text?',
      reason: 'text?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:hr.Employee', 'read:hr.LeaveRequest', 'write:hr.LeaveRequest'],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const own = await employeeForActor(ctx)
      const employeeId = own ? String(own.id) : String(a.employeeId ?? '')
      if (!employeeId) return invalid(issue('employeeId', 'hr.error.employeeUser'))
      const fromDate = String(a.dateFrom),
        toDate = String(a.dateTo)
      if (toDate < fromDate) return invalid(issue('dateTo', 'hr.error.leaveDates'))
      const portion = String(a.portion ?? 'full')
      if (!LEAVE_PORTIONS.includes(portion as never) || (portion !== 'full' && fromDate !== toDate))
        return invalid(issue('portion', 'hr.error.leaveDates'))
      const overlap = (await ctx.db.select('hr.LeaveRequest', { employeeId })).some(
        (row) =>
          !['rejected', 'cancelled'].includes(String(row.state)) &&
          String(row.dateFrom) <= toDate &&
          String(row.dateTo) >= fromDate,
      )
      if (overlap) return invalid(issue('dateFrom', 'hr.error.leaveOverlap'))
      const requestedDays = portion === 'full' ? daysBetween(fromDate, toDate) + 1 : 0.5
      const id = String(a.id ?? randomUUID())
      await ctx.db.insert('hr.LeaveRequest', {
        id,
        employeeId,
        leaveTypeId: a.leaveTypeId,
        dateFrom: fromDate,
        dateTo: toDate,
        portion,
        requestedDays: String(requestedDays),
        reason: a.reason ?? null,
        state: 'requested',
        requestedAt: now(),
        decidedAt: null,
        decidedBy: null,
        decisionNote: null,
      })
      return { ok: true, id }
    },
  }),

  'leave.mine': defineFn({
    input: {},
    output: {
      id: 'id',
      leaveTypeId: 'id',
      dateFrom: 'date',
      dateTo: 'date',
      portion: 'text',
      requestedDays: 'decimal',
      state: 'text',
      reason: 'text?',
    },
    effects: ['read:hr.Employee', 'read:hr.LeaveRequest'],
    handler: async (ctx: Ctx) => {
      const employee = await employeeForActor(ctx)
      return employee ? ctx.db.select('hr.LeaveRequest', { employeeId: employee.id }) : []
    },
  }),

  'leave.manageList': defineFn({
    input: { state: 'text?' },
    output: {
      id: 'id',
      employeeId: 'id',
      leaveTypeId: 'id',
      dateFrom: 'date',
      dateTo: 'date',
      portion: 'text',
      requestedDays: 'decimal',
      state: 'text',
      reason: 'text?',
    },
    effects: ['read:hr.LeaveRequest'],
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const rows = await ctx.db.select('hr.LeaveRequest', {})
      return a.state ? rows.filter((row) => row.state === a.state) : rows
    },
  }),

  'leave.manageDecision': defineFn({
    input: { id: 'id', decision: 'text', note: 'text?' },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: ['read:hr.LeaveRequest', 'write:hr.LeaveRequest', 'read:hr.LeaveAllocation'],
    idempotent: true,
    agent: true,
    handler: async (ctx: Ctx, a) => {
      const row = (await ctx.db.select('hr.LeaveRequest', { id: a.id }))[0]
      if (!row) return invalid(issue('id', 'hr.error.missing'))
      if (row.state !== 'requested') return { ok: true, id: row.id }
      if (!['approved', 'rejected'].includes(String(a.decision)))
        return invalid(issue('decision', 'hr.error.invalid'))
      if (a.decision === 'approved') {
        const year = Number(String(row.dateFrom).slice(0, 4))
        const allocated = (await ctx.db.select('hr.LeaveAllocation', { employeeId: row.employeeId }))
          .filter((entry) => entry.leaveTypeId === row.leaveTypeId && Number(entry.year) === year)
          .reduce((sum, entry) => sum + decimal(entry.days), 0)
        const used = (await ctx.db.select('hr.LeaveRequest', { employeeId: row.employeeId }))
          .filter(
            (entry) =>
              entry.id !== row.id &&
              entry.leaveTypeId === row.leaveTypeId &&
              entry.state === 'approved' &&
              String(entry.dateFrom).startsWith(String(year)),
          )
          .reduce((sum, entry) => sum + decimal(entry.requestedDays), 0)
        if (used + decimal(row.requestedDays) > allocated)
          return invalid(issue('decision', 'hr.error.leaveBalance'))
      }
      await ctx.db.update(
        'hr.LeaveRequest',
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
}
