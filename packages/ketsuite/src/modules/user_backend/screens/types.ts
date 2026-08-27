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
  assignments?: Array<{ roleId: string }>
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
  grants?: Array<{ fnKey: string }>
}
