import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  /**
   * Durable receipt for a staff accounting command.
   *
   * Framework idempotency makes POST retries safe. Mobile clients also have an
   * explicit reconciliation GET, so the facade keeps the small piece of command
   * identity needed to answer that read without ever re-running a mutation.
   */
  InvoiceCommand: {
    scope: 'company',
    fields: {
      id: 'id',
      actorId: 'text',
      invoiceId: 'ref:account.Move',
      operation: 'text',
      requestHash: 'text',
      expectedVersion: 'text',
      expectedRevision: 'int',
      journalId: 'ref:account.Journal?',
      state: 'text',
      outcome: 'text?',
      createdAt: 'datetime',
      completedAt: 'datetime?',
    },
    indexes: {
      actor_operation: { fields: ['companyId', 'actorId', 'operation', 'id'], unique: true },
    },
  },
}
