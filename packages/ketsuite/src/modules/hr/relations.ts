import type { RelationDef } from 'ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'hr.Department': {
    parent: { belongsTo: 'hr.Department', by: 'parentId' },
    children: { hasMany: 'hr.Department', by: 'parentId' },
  },
  'hr.Employee': {
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
    user: { belongsTo: 'user.User', by: 'userId' },
    department: { belongsTo: 'hr.Department', by: 'departmentId' },
    job: { belongsTo: 'hr.Job', by: 'jobId' },
  },
  'hr.Rotation': { slots: { hasMany: 'hr.RotationSlot', by: 'rotationId' } },
  'hr.Roster': { shifts: { hasMany: 'hr.Shift', by: 'rosterId' } },
  'hr.LeaveRequest': {
    employee: { belongsTo: 'hr.Employee', by: 'employeeId' },
    leaveType: { belongsTo: 'hr.LeaveType', by: 'leaveTypeId' },
  },
}
