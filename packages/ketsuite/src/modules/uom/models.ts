import type { ModelDef } from 'ketjs'

/** Odoo 19 models UoMs as relative trees, not categories. */
export const models: Record<string, ModelDef> = {
  Precision: {
    scope: 'shared',
    fields: { id: 'id', digits: 'int' },
  },
  Unit: {
    scope: 'shared',
    fields: {
      id: 'id',
      name: 'text',
      sequence: 'int',
      relativeFactor: 'decimal',
      relativeUomId: 'ref:uom.Unit?',
      factor: 'decimal',
      rounding: 'decimal',
      parentPath: 'text',
      active: 'bool',
    },
    indexes: {
      parent: { fields: ['relativeUomId'] },
      parent_path: { fields: ['parentPath'] },
    },
  },
}
