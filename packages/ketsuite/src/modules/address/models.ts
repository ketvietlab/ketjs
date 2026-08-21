import type { ModelDef } from '@ketvietlab/ketjs'

/**
 * Global address reference data. The rows are shared because an administrative
 * boundary does not change when a request switches company. Tenant-specific
 * address books remain in partner.Address.
 */
export const models: Record<string, ModelDef> = {
  Country: {
    scope: 'shared',
    fields: {
      id: 'id',
      code: 'text',
      alpha3: 'text?',
      numericCode: 'text?',
      name: 'text',
      officialName: 'text?',
      localName: 'text?',
      callingCode: 'text?',
      policy: 'json?',
      active: 'bool',
    },
    indexes: {
      code: { fields: ['code'], unique: true },
      alpha3: { fields: ['alpha3'], unique: true },
    },
  },

  Catalog: {
    scope: 'shared',
    fields: {
      id: 'id',
      countryId: 'ref:address.Country',
      version: 'text',
      codeSystem: 'text',
      authority: 'text',
      legalBasis: 'text?',
      sourceUrl: 'text?',
      sourceAttribution: 'json?',
      sourceFiles: 'json?',
      checksum: 'text',
      effectiveFrom: 'date',
      status: 'text',
      recordCount: 'int',
      counts: 'json',
      importedAt: 'datetime?',
    },
    indexes: {
      country_version: { fields: ['countryId', 'version'], unique: true },
      country_checksum: { fields: ['countryId', 'checksum'], unique: true },
    },
  },

  CurrentCatalog: {
    scope: 'shared',
    fields: {
      id: 'id',
      countryId: 'ref:address.Country',
      catalogId: 'ref:address.Catalog',
      version: 'int',
      activatedAt: 'datetime',
    },
    indexes: {
      country: { fields: ['countryId'], unique: true },
      catalog: { fields: ['catalogId'], unique: true },
    },
  },

  Division: {
    scope: 'shared',
    fields: {
      id: 'id',
      countryId: 'ref:address.Country',
      catalogId: 'ref:address.Catalog',
      parentId: 'ref:address.Division?',
      code: 'text',
      officialName: 'text',
      shortName: 'text?',
      kind: 'text',
      level: 'int',
      active: 'bool',
    },
    indexes: {
      catalog_code: { fields: ['catalogId', 'code'], unique: true },
      catalog_parent: { fields: ['catalogId', 'parentId', 'active'] },
      catalog_name: { fields: ['catalogId', 'officialName'] },
    },
  },

  DivisionTransition: {
    scope: 'shared',
    fields: {
      id: 'id',
      countryId: 'ref:address.Country',
      fromCatalogId: 'ref:address.Catalog',
      toCatalogId: 'ref:address.Catalog',
      kind: 'text',
      fromCodes: 'json',
      toCodes: 'json',
      legalBasis: 'text?',
    },
  },
}
