export type CompanyRow = {
  id: string
  code: string
  name: string
  partnerId: string
  parentId?: string | null
  currency: string
  active: boolean
  version: number
}

export type BranchRow = {
  id: string
  companyId: string
  code: string
  name: string
  parentId?: string | null
  isRoot?: boolean
  active: boolean
}
