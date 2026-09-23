// What the search-filter bar offers on the company list.
//
// The list reads every legal entity the reader may see and narrows it in
// memory, so the spec covers exactly the columns its table renders. Declaring
// `active` is what gives the bar its archived toggle; the same `?archived=1`
// also tells `company.listCompanies` to include archived entities, so the
// toggle stays one control over one URL.
import { defineRowList } from '../backend/row-list.ts'

export const companyListSearch = defineRowList({
  key: 'company.companies',
  searchable: [{ key: 'code' }, { key: 'name' }, { key: 'currency' }],
  filterable: [
    { key: 'code', label: 'company_backend.field.code', type: 'text' },
    { key: 'name', label: 'company_backend.field.name', type: 'text' },
    { key: 'currency', label: 'company_backend.field.currency', type: 'text' },
    { key: 'active', label: 'company_backend.field.state', type: 'boolean' },
  ],
  groupable: [{ key: 'currency', label: 'company_backend.field.currency' }],
  sortable: [
    { key: 'code', label: 'company_backend.field.code' },
    { key: 'name', label: 'company_backend.field.name' },
  ],
})
