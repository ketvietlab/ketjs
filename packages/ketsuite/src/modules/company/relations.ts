import type { RelationDef } from 'ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'company.Company': {
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
    parent: { belongsTo: 'company.Company', by: 'parentId' },
    children: { hasMany: 'company.Company', by: 'parentId' },
    branches: { hasMany: 'company.Branch', by: 'companyId' },
  },
  'company.Branch': {
    company: { belongsTo: 'company.Company', by: 'companyId' },
    parent: { belongsTo: 'company.Branch', by: 'parentId' },
    children: { hasMany: 'company.Branch', by: 'parentId' },
  },
}
