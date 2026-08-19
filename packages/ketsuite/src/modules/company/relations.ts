import type { RelationDef } from 'ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'company.Company': {
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
    parent: { belongsTo: 'company.Company', by: 'parentId' },
    children: { hasMany: 'company.Company', by: 'parentId' },
  },
}
