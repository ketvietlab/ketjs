import type { ModelDef } from '@ketvietlab/ketjs'

/**
 * The public manufacturing kernel deliberately stops at an executable BOM and
 * stock-backed production order. Approval revisions, operator evidence and
 * workforce scoring are extension concerns rather than hidden flags here.
 */
export const models: Record<string, ModelDef> = {
  Bom: {
    scope: 'company',
    timestamps: true,
    fields: {
      id: 'id',
      code: 'text?',
      productId: 'ref:product.Product',
      productQty: 'decimal',
      productUomId: 'ref:uom.Unit',
      type: 'text',
      active: 'bool',
    },
    indexes: {
      product_active: { fields: ['companyId', 'productId', 'active'] },
      code: { fields: ['companyId', 'code'], unique: true },
    },
  },
  BomLine: {
    scope: 'company',
    fields: {
      id: 'id',
      bomId: 'ref:manufacturing.Bom',
      productId: 'ref:product.Product',
      productQty: 'decimal',
      productUomId: 'ref:uom.Unit',
      operationId: 'ref:manufacturing.Operation?',
      sequence: 'int',
    },
    indexes: { bom_sequence: { fields: ['companyId', 'bomId', 'sequence'] } },
  },
  Byproduct: {
    scope: 'company',
    fields: {
      id: 'id',
      bomId: 'ref:manufacturing.Bom',
      productId: 'ref:product.Product',
      productQty: 'decimal',
      productUomId: 'ref:uom.Unit',
      sequence: 'int',
    },
    indexes: { bom_sequence: { fields: ['companyId', 'bomId', 'sequence'] } },
  },
  WorkCenter: {
    scope: 'company',
    fields: {
      id: 'id',
      code: 'text',
      name: 'text',
      capacity: 'decimal',
      timeEfficiency: 'decimal',
      costPerHour: 'decimal',
      active: 'bool',
    },
    indexes: { code: { fields: ['companyId', 'code'], unique: true } },
  },
  Operation: {
    scope: 'company',
    fields: {
      id: 'id',
      bomId: 'ref:manufacturing.Bom',
      workCenterId: 'ref:manufacturing.WorkCenter',
      name: 'text',
      sequence: 'int',
      durationExpected: 'int',
      instructions: 'text?',
    },
    indexes: { bom_sequence: { fields: ['companyId', 'bomId', 'sequence'] } },
  },
  Production: {
    scope: 'company',
    timestamps: true,
    fields: {
      id: 'id',
      name: 'text',
      bomId: 'ref:manufacturing.Bom',
      productId: 'ref:product.Product',
      productQty: 'decimal',
      productUomId: 'ref:uom.Unit',
      quantityProduced: 'decimal',
      sourceLocationId: 'ref:stock.Location',
      productionLocationId: 'ref:stock.Location',
      destinationLocationId: 'ref:stock.Location',
      rawPickingId: 'ref:stock.Picking?',
      outputPickingId: 'ref:stock.Picking?',
      state: 'text',
      scheduledStart: 'datetime',
      scheduledFinish: 'datetime?',
      startedAt: 'datetime?',
      finishedAt: 'datetime?',
      origin: 'text?',
      version: 'int',
    },
    indexes: {
      state_schedule: { fields: ['companyId', 'state', 'scheduledStart'] },
      product: { fields: ['companyId', 'productId'] },
    },
  },
  ProductionMove: {
    scope: 'company',
    fields: {
      id: 'id',
      productionId: 'ref:manufacturing.Production',
      moveId: 'ref:stock.Move',
      kind: 'text',
      sequence: 'int',
    },
    indexes: {
      move: { fields: ['companyId', 'moveId'], unique: true },
      production_kind: { fields: ['companyId', 'productionId', 'kind', 'sequence'] },
    },
  },
  WorkOrder: {
    scope: 'company',
    fields: {
      id: 'id',
      productionId: 'ref:manufacturing.Production',
      operationId: 'ref:manufacturing.Operation',
      workCenterId: 'ref:manufacturing.WorkCenter',
      name: 'text',
      sequence: 'int',
      state: 'text',
      durationExpected: 'int',
      durationActual: 'int',
      startedAt: 'datetime?',
      finishedAt: 'datetime?',
      version: 'int',
    },
    indexes: {
      production_sequence: { fields: ['companyId', 'productionId', 'sequence'] },
      center_state: { fields: ['companyId', 'workCenterId', 'state'] },
    },
  },
}
