export type CatalogRow = {
  countryCode: string
  version: string
  recommended: boolean
  installed?: boolean
  status?: string | null
  recordCount?: number | null
  codeSystem?: string | null
  effectiveFrom?: string | null
}

export type DivisionRow = {
  id: string
  code: string
  parentId?: string | null
  officialName: string
  shortName?: string | null
  kind: string
  level: number
}
