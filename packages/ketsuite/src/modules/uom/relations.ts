import type { RelationDef } from 'ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'uom.Category': { units: { hasMany: 'uom.Unit', by: 'categoryId' } },
  'uom.Unit': { category: { belongsTo: 'uom.Category', by: 'categoryId' } },
}
