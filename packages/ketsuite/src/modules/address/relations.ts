import type { RelationDef } from 'ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'address.Country': {
    catalogs: { hasMany: 'address.Catalog', by: 'countryId' },
    divisions: { hasMany: 'address.Division', by: 'countryId' },
    currentCatalog: { hasMany: 'address.CurrentCatalog', by: 'countryId' },
  },
  'address.Catalog': {
    country: { belongsTo: 'address.Country', by: 'countryId' },
    divisions: { hasMany: 'address.Division', by: 'catalogId' },
  },
  'address.CurrentCatalog': {
    country: { belongsTo: 'address.Country', by: 'countryId' },
    catalog: { belongsTo: 'address.Catalog', by: 'catalogId' },
  },
  'address.Division': {
    country: { belongsTo: 'address.Country', by: 'countryId' },
    catalog: { belongsTo: 'address.Catalog', by: 'catalogId' },
    parent: { belongsTo: 'address.Division', by: 'parentId' },
    children: { hasMany: 'address.Division', by: 'parentId' },
  },
}
