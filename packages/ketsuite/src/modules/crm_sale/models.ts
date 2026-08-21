import type { ModelDef } from 'ketjs'

export const models: Record<string, ModelDef> = {
  OpportunityQuotation: {
    scope: 'company',
    fields: {
      id: 'id',
      caseId: 'ref:crm.Case',
      salesOrderId: 'ref:sale.Order',
      createdAt: 'datetime',
    },
    indexes: {
      order: { fields: ['companyId', 'salesOrderId'], unique: true },
      opportunity: { fields: ['companyId', 'caseId', 'createdAt'] },
    },
  },
}
