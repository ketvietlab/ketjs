import type { ModelDef } from '@ketvietlab/ketjs'

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
      // Named `absoluteFactor`, not `factor`, because it means the reciprocal of
      // what the old `factor` column held: how many root units make one of this
      // unit, where `factor` was how many of this unit make one reference. Reusing
      // the name would have left planMigration with a decimal column called
      // `factor` before and after, no op to emit, no destructive flag to demand —
      // and every stored row silently meaning its own inverse. The rename forces
      // DROP_COLUMN plus ADD_COLUMN, so the upgrade cannot happen by accident.
      absoluteFactor: 'decimal',
      rounding: 'decimal',
      parentPath: 'text',
      locked: 'bool',
      active: 'bool',
    },
    indexes: {
      parent: { fields: ['relativeUomId'] },
      parent_path: { fields: ['parentPath'] },
    },
  },
}
