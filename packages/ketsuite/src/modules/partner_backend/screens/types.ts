export type PartnerListSummary = {
  total: number
  customers: number
  suppliers: number
  archived: number
  allHref: string
  customersHref: string
  suppliersHref: string
  archivedHref: string
  active: 'all' | 'customers' | 'suppliers' | 'archived'
}

export type PartnerListRow = {
  id: string
  kind: string
  name: string
  ref?: string | null
  email?: string | null
  phone?: string | null
  active: boolean
}

export type AddressRow = {
  id: string
  use: string
  street1: string
  street2?: string | null
  locality?: string | null
  postalCode?: string | null
  countryCode: string
  countryId?: string | null
  divisionId?: string | null
  divisionText?: string | null
  oneLine?: string | null
  isDefault?: boolean
}

export type PartnerDetail = PartnerListRow & {
  parentId?: string | null
  vat?: string | null
  lang?: string | null
  addresses: AddressRow[]
  roles: Array<{ role: string }>
}
