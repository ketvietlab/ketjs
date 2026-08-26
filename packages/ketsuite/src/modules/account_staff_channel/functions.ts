import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec, Row } from '@ketvietlab/ketjs'

const operations = ['collect_payment', 'post', 'cancel_draft'] as const
const now = (): string => new Date().toISOString()
const invalid = (field: string, code: string) => ({
  ok: false,
  errors: [{ field, code: `account_staff_channel.error.${code}`, message: code }],
})

const sameCommand = (row: Row, args: Row): boolean =>
  String(row.actorId) === String(args.actorId) &&
  String(row.invoiceId) === String(args.invoiceId) &&
  String(row.operation) === String(args.operation) &&
  String(row.requestHash) === String(args.requestHash) &&
  String(row.expectedVersion) === String(args.expectedVersion) &&
  (args.expectedRevision === undefined || Number(row.expectedRevision) === Number(args.expectedRevision)) &&
  String(row.journalId ?? '') === String(args.journalId ?? '')

const commandOutput = (row: Row) => ({
  ok: true,
  id: row.id,
  state: row.state,
  outcome: row.outcome ?? null,
  journalId: row.journalId ?? null,
  expectedRevision: Number(row.expectedRevision),
})

export const functions: Record<string, FnSpec> = {
  beginInvoiceCommand: defineFn({
    input: {
      id: 'id',
      actorId: 'text',
      invoiceId: 'id',
      operation: 'text',
      requestHash: 'text',
      expectedVersion: 'text',
      expectedRevision: 'int',
      journalId: 'id?',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      state: 'text?',
      outcome: 'text?',
      journalId: 'id?',
      expectedRevision: 'int?',
      errors: 'json?',
    },
    effects: ['read:account_staff_channel.InvoiceCommand', 'write:account_staff_channel.InvoiceCommand'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!operations.includes(args.operation as (typeof operations)[number]))
        return invalid('operation', 'commandOperationInvalid')
      const existing = (await ctx.db.select('account_staff_channel.InvoiceCommand', { id: args.id }))[0]
      if (existing)
        return sameCommand(existing, args) ? commandOutput(existing) : invalid('id', 'commandConflict')
      const held = await ctx.db.insertIfAbsent('account_staff_channel.InvoiceCommand', {
        ...args,
        journalId: args.journalId ?? null,
        state: 'processing',
        outcome: null,
        createdAt: now(),
        completedAt: null,
      })
      if ('dryRun' in held || held.inserted) return { ok: true, id: args.id, state: 'processing' }
      const raced = (await ctx.db.select('account_staff_channel.InvoiceCommand', { id: args.id }))[0]
      return raced && sameCommand(raced, args) ? commandOutput(raced) : invalid('id', 'commandConflict')
    },
  }),
  completeInvoiceCommand: defineFn({
    input: {
      id: 'id',
      actorId: 'text',
      invoiceId: 'id',
      operation: 'text',
      requestHash: 'text',
      expectedVersion: 'text',
      expectedRevision: 'int',
      journalId: 'id?',
      outcome: 'text',
    },
    output: {
      ok: 'bool',
      id: 'id?',
      state: 'text?',
      outcome: 'text?',
      journalId: 'id?',
      expectedRevision: 'int?',
      errors: 'json?',
    },
    effects: ['read:account_staff_channel.InvoiceCommand', 'write:account_staff_channel.InvoiceCommand'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const existing = (await ctx.db.select('account_staff_channel.InvoiceCommand', { id: args.id }))[0]
      if (!existing) return invalid('id', 'commandMissing')
      if (!sameCommand(existing, args)) return invalid('id', 'commandConflict')
      if (existing.state === 'completed')
        return existing.outcome === args.outcome
          ? commandOutput(existing)
          : invalid('outcome', 'commandConflict')
      await ctx.db.update(
        'account_staff_channel.InvoiceCommand',
        { id: args.id },
        { state: 'completed', outcome: args.outcome, completedAt: now() },
      )
      const completed = (await ctx.db.select('account_staff_channel.InvoiceCommand', { id: args.id }))[0]!
      return commandOutput(completed)
    },
  }),
  getInvoiceCommand: defineFn({
    input: {
      id: 'id',
      actorId: 'text',
      invoiceId: 'id',
      operation: 'text',
      requestHash: 'text',
      expectedVersion: 'text',
      journalId: 'id?',
    },
    output: {
      found: 'bool',
      conflict: 'bool',
      state: 'text?',
      outcome: 'text?',
      journalId: 'id?',
      expectedRevision: 'int?',
    },
    effects: ['read:account_staff_channel.InvoiceCommand'],
    agent: true,
    handler: async (ctx, args) => {
      const row = (await ctx.db.select('account_staff_channel.InvoiceCommand', { id: args.id }))[0]
      if (!row) return { found: false, conflict: false }
      if (!sameCommand(row, args)) return { found: false, conflict: true }
      return {
        found: true,
        conflict: false,
        state: row.state,
        outcome: row.outcome ?? null,
        journalId: row.journalId ?? null,
        expectedRevision: Number(row.expectedRevision),
      }
    },
  }),
}
