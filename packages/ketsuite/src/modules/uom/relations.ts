import type { RelationDef } from '@ketvietlab/ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'uom.Unit': {
    relativeUom: { belongsTo: 'uom.Unit', by: 'relativeUomId' },
    relatedUoms: { hasMany: 'uom.Unit', by: 'relativeUomId' },
  },
}
