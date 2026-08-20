import type { RelationDef } from 'ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'attendance.Session': {
    employee: { belongsTo: 'hr.Employee', by: 'employeeId' },
    punches: { hasMany: 'attendance.Punch', by: 'sessionId' },
  },
  'attendance.Period': { entries: { hasMany: 'attendance.WorkEntry', by: 'periodId' } },
  'attendance.WorkEntry': {
    employee: { belongsTo: 'hr.Employee', by: 'employeeId' },
    shift: { belongsTo: 'hr.Shift', by: 'shiftId' },
  },
}
