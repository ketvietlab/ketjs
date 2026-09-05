import type { ModelDef } from '@ketvietlab/ketjs'

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
  /**
   * How often one visitor may submit the public form.
   *
   * Shared rather than company scoped on purpose: the endpoint answers before a
   * company is established, and a limit that lived inside a tenant would be
   * bypassed by pointing at another one.
   */
  SubmissionRateLimit: {
    scope: 'shared',
    fields: {
      id: 'id',
      bucket: 'text',
      key: 'text',
      windowStartedAt: 'datetime',
      count: 'int',
    },
    indexes: { bucket_key: { fields: ['bucket', 'key'], unique: true } },
  },
}
