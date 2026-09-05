export type UserRow = {
  id: string
  login: string
  name: string
  email?: string | null
  timezone?: string | null
  partnerId?: string | null
  defaultCompanyId?: string | null
  defaultBranchId?: string | null
  accessKind: string
  securityVersion: number
  lastLoginAt?: string | null
  passwordReady: boolean
  active: boolean
  superuser: boolean
  memberships?: Array<{ companyId: string }>
  branchMemberships?: Array<{ branchId: string }>
  assignments?: Array<{
    id?: string
    roleId: string
    scopeKind?: string | null
    companyId?: string | null
    branchId?: string | null
    scopeKey?: string | null
  }>
}

export type SessionRow = {
  id: string
  current: boolean
  company: string | null
  branch: string | null
  createdAt: number
  expiresAt: number
}

export type RoleRow = {
  id: string
  name: string
  description?: string | null
  mode?: string | null
  templateKey?: string | null
  templateVersion?: number | null
  templateDigest?: string | null
  revision?: number | null
  assignmentCount?: number
  healthIssues?: string[]
  grants?: Array<{ fnKey: string }>
  grantSources?: Array<{
    fnKey: string
    sourceKind: string
    sourceKey: string
    sourceVersion?: number | null
  }>
}

export type PermissionRow = {
  key: string
  module: string
  moduleLabel: string
  task: string
  label: string
  checked: boolean
}
