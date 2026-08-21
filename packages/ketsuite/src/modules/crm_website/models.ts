import type { ModelDef } from 'ketjs'

export const models: Record<string, ModelDef> = {
  Submission: {
    scope: 'company',
    fields: {
      id: 'id',
      idempotencyKey: 'text',
      caseId: 'ref:crm.Case?',
      locale: 'text',
      submittedAt: 'datetime',
      sourceFingerprint: 'text?',
    },
    indexes: { idempotency: { fields: ['companyId', 'idempotencyKey'], unique: true } },
  },
}
