import type { RelationDef } from '@ketvietlab/ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'user.User': {
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
    memberships: { hasMany: 'user.Membership', by: 'userId' },
    branchMemberships: { hasMany: 'user.BranchMembership', by: 'userId' },
    assignments: { hasMany: 'user.Assignment', by: 'userId' },
    authTokens: { hasMany: 'user.AuthToken', by: 'userId' },
  },
  'user.Membership': {
    user: { belongsTo: 'user.User', by: 'userId' },
    company: { belongsTo: 'company.Company', by: 'companyId' },
  },
  'user.BranchMembership': {
    user: { belongsTo: 'user.User', by: 'userId' },
    branch: { belongsTo: 'company.Branch', by: 'branchId' },
  },
  'user.Role': {
    grants: { hasMany: 'user.Grant', by: 'roleId' },
  },
  'user.Grant': {
    role: { belongsTo: 'user.Role', by: 'roleId' },
  },
  'user.Assignment': {
    user: { belongsTo: 'user.User', by: 'userId' },
    role: { belongsTo: 'user.Role', by: 'roleId' },
  },
  'user.AuthToken': {
    user: { belongsTo: 'user.User', by: 'userId' },
  },
}
