import { createHash } from 'node:crypto'
import { defineFn, isDateText } from '@ketvietlab/ketjs'
import type { FnSpec, Row } from '@ketvietlab/ketjs'
import { insertDraftMove, ledgerOf, postMoveById } from './functions.ts'
import { minorText, moneyMinor } from './money.ts'

type OpeningLineInput = {
  sourceKey: string
  accountId: string
  partnerId?: string | null
  description: string
  debit: string
  credit: string
  dateMaturity?: string | null
}

const now = (): string => new Date().toISOString()
const issue = (field: string, code: string, message: string, params?: Record<string, unknown>) => ({
  field,
  code: `account.error.${code}`,
  message,
  params,
})
const failure = (...errors: ReturnType<typeof issue>[]) => ({ ok: false as const, errors })
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')

const parseLines = (
  value: unknown,
  scale: number,
): { lines: OpeningLineInput[]; debit: bigint; credit: bigint } | { errors: ReturnType<typeof issue>[] } => {
  if (!Array.isArray(value) || value.length < 2)
    return { errors: [issue('lines', 'openingLinesRequired', 'an opening batch needs at least two lines')] }
  const seen = new Set<string>()
  const lines: OpeningLineInput[] = []
  const errors: ReturnType<typeof issue>[] = []
  let debitTotal = 0n
  let creditTotal = 0n
  for (const [at, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      errors.push(issue(`lines.${at}`, 'openingLineInvalid', 'opening line must be an object'))
      continue
    }
    const row = raw as Row
    const sourceKey = String(row.sourceKey ?? '').trim()
    const accountId = String(row.accountId ?? '').trim()
    const description = String(row.description ?? '').trim()
    if (!sourceKey || seen.has(sourceKey))
      errors.push(
        issue(`lines.${at}.sourceKey`, 'openingSourceKey', 'source keys must be present and unique'),
      )
    seen.add(sourceKey)
    if (!accountId) errors.push(issue(`lines.${at}.accountId`, 'accountMissing', 'an account is required'))
    if (!description)
      errors.push(issue(`lines.${at}.description`, 'openingDescriptionRequired', 'a description is required'))
    if (row.dateMaturity != null && !isDateText(row.dateMaturity))
      errors.push(issue(`lines.${at}.dateMaturity`, 'accountingDateInvalid', 'maturity must be a civil date'))
    let debit = 0n
    let credit = 0n
    try {
      debit = moneyMinor(row.debit ?? '0', scale)
      credit = moneyMinor(row.credit ?? '0', scale)
      if (debit < 0n || credit < 0n || (debit > 0n && credit > 0n) || (debit === 0n && credit === 0n))
        errors.push(issue(`lines.${at}`, 'lineSideBoth', 'use exactly one positive debit or credit'))
    } catch {
      errors.push(issue(`lines.${at}`, 'moneyExactString', 'amounts must be exact decimal strings'))
    }
    debitTotal += debit
    creditTotal += credit
    lines.push({
      sourceKey,
      accountId,
      partnerId: row.partnerId == null ? null : String(row.partnerId),
      description,
      debit: minorText(debit, scale),
      credit: minorText(credit, scale),
      dateMaturity: row.dateMaturity == null ? null : String(row.dateMaturity),
    })
  }
  return errors.length
    ? { errors }
    : {
        lines: lines.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey)),
        debit: debitTotal,
        credit: creditTotal,
      }
}

export const openingFunctions: Record<string, FnSpec> = {
  listOpeningBatches: defineFn({
    input: { state: 'text?' },
    effects: ['read:account.OpeningBatch'],
    agent: true,
    handler: async (ctx, args) => {
      const rows = args.state
        ? await ctx.db.select('account.OpeningBatch', { state: args.state })
        : await ctx.db.select('account.OpeningBatch')
      return rows.sort(
        (a, b) =>
          String(b.accountingDate).localeCompare(String(a.accountingDate)) ||
          String(b.id).localeCompare(String(a.id)),
      )
    },
  }),
  getOpeningBatch: defineFn({
    input: { id: 'id' },
    output: { batch: 'json?', lines: 'json' },
    effects: ['read:account.OpeningBatch', 'read:account.OpeningLine'],
    agent: true,
    handler: async (ctx, args) => {
      const batch = (await ctx.db.select('account.OpeningBatch', { id: args.id }))[0] ?? null
      const lines = batch ? await ctx.db.select('account.OpeningLine', { batchId: args.id }) : []
      return { batch, lines: lines.sort((a, b) => Number(a.sequence) - Number(b.sequence)) }
    },
  }),
  prepareOpeningBatch: defineFn({
    input: {
      id: 'id',
      accountingDate: 'date',
      journalId: 'id',
      sourceChecksum: 'text',
      controlDebit: 'decimal',
      controlCredit: 'decimal',
      lines: 'json',
      dryRun: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', moveId: 'id?', preview: 'json?', errors: 'json?' },
    effects: [
      'read:company.Company',
      'read:partner.Partner',
      'read:account.Account',
      'read:account.Journal',
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.OpeningBatch',
      'read:account.OpeningLine',
      'write:account.Move',
      'write:account.MoveLine',
      'write:account.OpeningBatch',
      'write:account.OpeningLine',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const { currency, scale } = await ledgerOf(ctx)
      if (!/^[a-f0-9]{64}$/u.test(String(args.sourceChecksum)))
        return failure(
          issue('sourceChecksum', 'openingChecksumInvalid', 'source checksum must be SHA-256 hex'),
        )
      const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
      if (!journal || journal.active === false)
        return failure(issue('journalId', 'journalMissing', 'opening journal does not exist or is inactive'))
      if (journal.type !== 'general')
        return failure(issue('journalId', 'openingJournalType', 'opening balances require a general journal'))
      const parsed = parseLines(args.lines, scale)
      if ('errors' in parsed) return { ok: false, errors: parsed.errors }
      let controlDebit: bigint
      let controlCredit: bigint
      try {
        controlDebit = moneyMinor(args.controlDebit, scale)
        controlCredit = moneyMinor(args.controlCredit, scale)
      } catch {
        return failure(
          issue('controlDebit', 'moneyExactString', 'control totals must be exact decimal strings'),
        )
      }
      if (parsed.debit !== parsed.credit || controlDebit !== parsed.debit || controlCredit !== parsed.credit)
        return failure(
          issue('lines', 'openingControlMismatch', 'opening lines and control totals must balance exactly', {
            debit: minorText(parsed.debit, scale),
            credit: minorText(parsed.credit, scale),
            controlDebit: minorText(controlDebit, scale),
            controlCredit: minorText(controlCredit, scale),
          }),
        )
      const accounts = new Map(
        (await ctx.db.select('account.Account')).map((account) => [String(account.id), account]),
      )
      for (const [at, line] of parsed.lines.entries()) {
        const account = accounts.get(line.accountId)
        if (!account || account.active === false)
          return failure(
            issue(`lines.${at}.accountId`, 'accountMissing', 'opening account is missing or inactive'),
          )
        if (account.reconcile === true && !line.partnerId)
          return failure(
            issue(
              `lines.${at}.partnerId`,
              'openingPartnerRequired',
              'reconcilable opening lines require a partner',
            ),
          )
        if (line.partnerId && !(await ctx.db.select('partner.Partner', { id: line.partnerId }))[0])
          return failure(issue(`lines.${at}.partnerId`, 'partnerMissing', 'opening partner does not exist'))
      }
      const content = {
        accountingDate: String(args.accountingDate),
        journalId: String(args.journalId),
        currency,
        controlDebit: minorText(controlDebit, scale),
        controlCredit: minorText(controlCredit, scale),
        lines: parsed.lines,
      }
      const contentChecksum = digest(content)
      const moveId = `opening:${String(args.id)}`
      const preview = {
        ...content,
        sourceChecksum: String(args.sourceChecksum),
        contentChecksum,
        lineCount: parsed.lines.length,
        moveId,
      }
      if (args.dryRun === true) return { ok: true, id: args.id, moveId, preview }

      const existing = (await ctx.db.select('account.OpeningBatch', { id: args.id }))[0]
      if (existing) {
        if (
          String(existing.contentChecksum) === contentChecksum &&
          String(existing.sourceChecksum) === String(args.sourceChecksum)
        )
          return { ok: true, id: existing.id, moveId: existing.moveId, preview }
        return failure(issue('id', 'openingBatchIdReused', 'this batch id belongs to different opening data'))
      }
      try {
        await ctx.tx(async (tx) => {
          await tx.db.insert('account.OpeningBatch', {
            id: args.id,
            state: 'validated',
            accountingDate: args.accountingDate,
            journalId: args.journalId,
            currency,
            sourceChecksum: args.sourceChecksum,
            contentChecksum,
            controlDebit: minorText(controlDebit, scale),
            controlCredit: minorText(controlCredit, scale),
            lineCount: parsed.lines.length,
            moveId,
            createdAt: now(),
            createdBy: tx.actor ?? null,
            postedAt: null,
            revision: 0,
          })
          const moveLines: Row[] = []
          for (const [at, line] of parsed.lines.entries()) {
            const account = accounts.get(line.accountId)!
            const debit = moneyMinor(line.debit, scale)
            const credit = moneyMinor(line.credit, scale)
            const magnitude = debit > 0n ? debit : credit
            const lineId = `${moveId}:${line.sourceKey}`
            await tx.db.insert('account.OpeningLine', {
              id: `${String(args.id)}:${line.sourceKey}`,
              batchId: args.id,
              sourceKey: line.sourceKey,
              accountId: line.accountId,
              partnerId: line.partnerId,
              description: line.description,
              debit: line.debit,
              credit: line.credit,
              dateMaturity: line.dateMaturity,
              sequence: (at + 1) * 10,
            })
            moveLines.push({
              id: lineId,
              moveId,
              name: line.description,
              accountId: line.accountId,
              partnerId: line.partnerId,
              productId: null,
              productUomId: null,
              quantity: '1',
              priceUnit: minorText(magnitude, scale),
              discount: '0',
              taxId: null,
              debit: line.debit,
              credit: line.credit,
              balance: minorText(debit - credit, scale),
              dateMaturity: line.dateMaturity ? `${line.dateMaturity}T00:00:00.000Z` : null,
              displayType: null,
              reconciled: false,
              amountResidual: minorText(account.reconcile === true ? magnitude : 0n, scale),
              sequence: (at + 1) * 10,
            })
          }
          await insertDraftMove(tx, {
            move: {
              id: moveId,
              name: moveId,
              ref: `opening:${String(args.id)}`,
              date: `${String(args.accountingDate)}T00:00:00.000Z`,
              accountingDate: args.accountingDate,
              documentDate: args.accountingDate,
              moveType: 'entry',
              state: 'draft',
              journalId: args.journalId,
              partnerId: null,
              invoiceDate: null,
              invoiceDateDue: null,
              paymentTermId: null,
              paymentState: 'paid',
              currency,
              amountUntaxed: minorText(controlDebit, scale),
              amountTax: minorText(0n, scale),
              amountTotal: minorText(controlDebit, scale),
              reversalOfId: null,
              reversedById: null,
              reversalStatus: null,
            },
            lines: moveLines,
          })
        })
        return { ok: true, id: args.id, moveId, preview }
      } catch (error) {
        return failure(
          issue('id', 'openingBatchConflict', error instanceof Error ? error.message : String(error)),
        )
      }
    },
  }),
  postOpeningBatch: defineFn({
    input: { id: 'id', expectedRevision: 'int?' },
    output: { ok: 'bool', id: 'id?', moveId: 'id?', errors: 'json?' },
    effects: [
      'read:company.Company',
      'read:account.OpeningBatch',
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.Journal',
      'read:account.Account',
      'read:account.PeriodPolicy',
      'write:account.OpeningBatch',
      'write:account.Move',
      'write:account.Journal',
      'write:account.PeriodPolicy',
      'write:account.AuditEvent',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const batch = (await ctx.db.select('account.OpeningBatch', { id: args.id }))[0]
      if (!batch) return failure(issue('id', 'openingBatchMissing', 'opening batch does not exist'))
      if (batch.state === 'posted') return { ok: true, id: batch.id, moveId: batch.moveId }
      if (batch.state !== 'validated')
        return failure(issue('state', 'openingBatchState', 'only a validated opening batch can be posted'))
      if (args.expectedRevision != null && Number(args.expectedRevision) !== Number(batch.revision))
        return failure(
          issue('expectedRevision', 'openingConcurrent', 'opening batch changed; review and retry'),
        )
      const posted = await postMoveById(ctx, batch.moveId)
      if (posted.ok !== true) return posted
      const changed = await ctx.db.compareAndSet(
        'account.OpeningBatch',
        { id: batch.id },
        { revision: batch.revision },
        { state: 'posted', postedAt: now(), revision: Number(batch.revision) + 1 },
      )
      if (!('dryRun' in changed) && !changed.matched) {
        const settled = (await ctx.db.select('account.OpeningBatch', { id: batch.id }))[0]
        if (settled?.state !== 'posted')
          return failure(
            issue('expectedRevision', 'openingConcurrent', 'opening batch changed; review and retry'),
          )
      }
      return { ok: true, id: batch.id, moveId: batch.moveId }
    },
  }),
}
