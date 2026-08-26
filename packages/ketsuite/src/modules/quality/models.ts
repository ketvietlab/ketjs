import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  Template: {
    scope: 'company',
    fields: {
      id: 'id',
      version: 'text',
      hash: 'text',
      active: 'bool',
      createdAt: 'datetime',
      updatedAt: 'datetime',
    },
    indexes: { version: { fields: ['companyId', 'version'], unique: true } },
  },
  Step: {
    scope: 'company',
    fields: {
      id: 'id',
      templateId: 'ref:quality.Template',
      sequence: 'int',
      code: 'text',
      label: 'text',
      instruction: 'text',
      type: 'text',
      required: 'bool',
      minimum: 'decimal?',
      maximum: 'decimal?',
      uom: 'text?',
      photoMimeTypes: 'json',
      photoMaxBytes: 'int?',
    },
    indexes: {
      sequence: { fields: ['companyId', 'templateId', 'sequence'], unique: true },
      code: { fields: ['companyId', 'templateId', 'code'], unique: true },
    },
  },
  Requirement: {
    scope: 'company',
    fields: {
      id: 'id',
      warehouseId: 'ref:stock.Warehouse',
      templateId: 'ref:quality.Template',
      state: 'text',
      revision: 'int',
      createdAt: 'datetime',
      updatedAt: 'datetime',
    },
    indexes: { state: { fields: ['companyId', 'warehouseId', 'state', 'updatedAt'] } },
  },
  Photo: {
    scope: 'company',
    fields: {
      id: 'id',
      requirementId: 'ref:quality.Requirement',
      stepId: 'ref:quality.Step',
      checksum: 'text',
      mimeType: 'text',
      byteCount: 'int',
      altText: 'text',
      storeKey: 'text',
      createdAt: 'datetime',
    },
    indexes: {
      checksum: { fields: ['companyId', 'requirementId', 'stepId', 'checksum'], unique: true },
    },
  },
  Attempt: {
    scope: 'company',
    fields: {
      id: 'id',
      requirementId: 'ref:quality.Requirement',
      sequence: 'int',
      outcome: 'text',
      results: 'json',
      submittedAt: 'datetime',
      submittedByUserId: 'ref:user.User?',
    },
    indexes: { sequence: { fields: ['companyId', 'requirementId', 'sequence'], unique: true } },
  },
  Review: {
    scope: 'company',
    fields: {
      id: 'id',
      requirementId: 'ref:quality.Requirement',
      outcome: 'text',
      decidedAt: 'datetime',
      decidedByUserId: 'ref:user.User?',
    },
    indexes: { requirement: { fields: ['companyId', 'requirementId', 'decidedAt'] } },
  },
}
