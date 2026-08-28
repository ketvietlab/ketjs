import { createHash } from 'node:crypto'
import { defineFn, isDateText } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { functions, insertDraftMove, ledgerOf, postMoveById } from './functions.ts'
import { canonicalDecimalText, compareDecimals, minorText, moneyMinor } from './money.ts'

const OPEN_TYPES = ['out_invoice', 'out_refund', 'in_invoice', 'in_refund'] as const
const now = (): string => new Date().toISOString()
const digest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const issue = (field: string, code: string, message: string, params?: Record<string, unknown>) => ({
  field,
  code: `account.error.${code}`,
  message,
  params,
})
const failure = (...errors: ReturnType<typeof issue>[]) => ({ ok: false as const, errors })

type Item = {
  sourceKey: string
  moveType: (typeof OPEN_TYPES)[number]
  partnerId: string
  journalId: string
  counterpartAccountId: string
  offsetAccountId: string
  documentDate: string
  dueDate: string
  originalAmount: string
  residualAmount: string
}

const parseItems = (value: unknown): Item[] | null => {
  if (!Array.isArray(value) || !value.length) return null
  const seen = new Set<string>()
  const items: Item[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const row = raw as Row
    const sourceKey = String(row.sourceKey ?? '').trim()
    const moveType = String(row.moveType) as Item['moveType']
    if (!sourceKey || seen.has(sourceKey) || !OPEN_TYPES.includes(moveType)) return null
    seen.add(sourceKey)
    if (!isDateText(row.documentDate) || !isDateText(row.dueDate)) return null
    let originalAmount: string
    let residualAmount: string
    try {
      originalAmount = canonicalDecimalText(row.originalAmount)
      residualAmount = canonicalDecimalText(row.residualAmount)
      if (
        compareDecimals(originalAmount, '0') <= 0 ||
        compareDecimals(residualAmount, '0') < 0 ||
        compareDecimals(residualAmount, originalAmount) > 0
      )
        return null
    } catch {
      return null
    }
    const item = {
      sourceKey,
      moveType,
      partnerId: String(row.partnerId ?? ''),
      journalId: String(row.journalId ?? ''),
      counterpartAccountId: String(row.counterpartAccountId ?? ''),
      offsetAccountId: String(row.offsetAccountId ?? ''),
      documentDate: String(row.documentDate),
      dueDate: String(row.dueDate),
      originalAmount,
      residualAmount,
    }
    if (!item.partnerId || !item.journalId || !item.counterpartAccountId || !item.offsetAccountId) return null
    items.push(item)
  }
  return items.sort((a, b) => a.sourceKey.localeCompare(b.sourceKey))
}

const sideOf = (
  moveType: Item['moveType'],
): { baseDebit: boolean; kind: 'receivable' | 'payable'; sign: 1n | -1n } => {
  if (moveType === 'out_invoice') return { baseDebit: false, kind: 'receivable', sign: 1n }
  if (moveType === 'out_refund') return { baseDebit: true, kind: 'receivable', sign: -1n }
  if (moveType === 'in_invoice') return { baseDebit: true, kind: 'payable', sign: 1n }
  return { baseDebit: false, kind: 'payable', sign: -1n }
}

export const openItemFunctions: Record<string, FnSpec> = {
  listOpenItemBatches: defineFn({
    input: { state: 'text?' },
    effects: ['read:account.OpenItemBatch'],
    agent: true,
    handler: async (ctx, args) => {
      const rows = args.state
        ? await ctx.db.select('account.OpenItemBatch', { state: args.state })
        : await ctx.db.select('account.OpenItemBatch')
      return rows.sort((a, b) => String(b.accountingDate).localeCompare(String(a.accountingDate)))
    },
  }),
  getOpenItemBatch: defineFn({
    input: { id: 'id' },
    output: { batch: 'json?', items: 'json' },
    effects: ['read:account.OpenItemBatch', 'read:account.OpenItemSource'],
    agent: true,
    handler: async (ctx, args) => {
      const batch = (await ctx.db.select('account.OpenItemBatch', { id: args.id }))[0] ?? null
      const items = batch ? await ctx.db.select('account.OpenItemSource', { batchId: args.id }) : []
      return { batch, items: items.sort((a, b) => Number(a.sequence) - Number(b.sequence)) }
    },
  }),
  importOpenItems: defineFn({
    input: {
      id: 'id',
      accountingDate: 'date',
      sourceChecksum: 'text',
      controlReceivable: 'decimal',
      controlPayable: 'decimal',
      items: 'json',
      dryRun: 'bool?',
    },
    output: { ok: 'bool', id: 'id?', preview: 'json?', errors: 'json?' },
    effects: [
      'read:company.Company',
      'read:partner.Partner',
      'read:account.Account',
      'read:account.Journal',
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.PartialReconcile',
      'read:account.PeriodPolicy',
      'read:account.OpenItemBatch',
      'read:account.OpenItemSource',
      'write:account.Journal',
      'write:account.Move',
      'write:account.MoveLine',
      'write:account.PartialReconcile',
      'write:account.PeriodPolicy',
      'write:account.AuditEvent',
      'write:account.OpenItemBatch',
      'write:account.OpenItemSource',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!/^[a-f0-9]{64}$/u.test(String(args.sourceChecksum)))
        return failure(
          issue('sourceChecksum', 'openingChecksumInvalid', 'source checksum must be SHA-256 hex'),
        )
      const items = parseItems(args.items)
      if (!items) return failure(issue('items', 'openItemInputInvalid', 'open-item source rows are invalid'))
      const { currency, scale } = await ledgerOf(ctx)
      let receivable = 0n
      let payable = 0n
      for (const item of items) {
        const side = sideOf(item.moveType)
        const residual = moneyMinor(item.residualAmount, scale) * side.sign
        if (side.kind === 'receivable') receivable += residual
        else payable += residual
      }
      let controlReceivable: bigint
      let controlPayable: bigint
      try {
        controlReceivable = moneyMinor(args.controlReceivable, scale)
        controlPayable = moneyMinor(args.controlPayable, scale)
      } catch {
        return failure(
          issue('controlReceivable', 'moneyExactString', 'control totals must be exact decimals'),
        )
      }
      if (controlReceivable !== receivable || controlPayable !== payable)
        return failure(
          issue('items', 'openItemControlMismatch', 'open-item controls do not match signed residuals', {
            receivable: minorText(receivable, scale),
            payable: minorText(payable, scale),
          }),
        )
      const accounts = new Map(
        (await ctx.db.select('account.Account')).map((account) => [String(account.id), account]),
      )
      const journals = new Map(
        (await ctx.db.select('account.Journal')).map((journal) => [String(journal.id), journal]),
      )
      for (const [at, item] of items.entries()) {
        if (!(await ctx.db.select('partner.Partner', { id: item.partnerId }))[0])
          return failure(issue(`items.${at}.partnerId`, 'partnerMissing', 'partner does not exist'))
        const side = sideOf(item.moveType)
        const counterpart = accounts.get(item.counterpartAccountId)
        const expectedType = side.kind === 'receivable' ? 'asset_receivable' : 'liability_payable'
        if (!counterpart || counterpart.accountType !== expectedType || counterpart.reconcile !== true)
          return failure(
            issue(
              `items.${at}.counterpartAccountId`,
              'openItemCounterpart',
              'counterpart account type is invalid',
            ),
          )
        if (!accounts.get(item.offsetAccountId))
          return failure(
            issue(`items.${at}.offsetAccountId`, 'accountMissing', 'offset account does not exist'),
          )
        const journal = journals.get(item.journalId)
        const expectedJournal = side.kind === 'receivable' ? 'sale' : 'purchase'
        if (!journal || journal.type !== expectedJournal)
          return failure(
            issue(`items.${at}.journalId`, 'openItemJournal', 'document journal type is invalid'),
          )
      }
      const content = {
        accountingDate: String(args.accountingDate),
        currency,
        controlReceivable: minorText(receivable, scale),
        controlPayable: minorText(payable, scale),
        items,
      }
      const contentChecksum = digest(content)
      const preview = {
        ...content,
        sourceChecksum: args.sourceChecksum,
        contentChecksum,
        itemCount: items.length,
      }
      if (args.dryRun === true) return { ok: true, id: args.id, preview }

      const existing = (await ctx.db.select('account.OpenItemBatch', { id: args.id }))[0]
      if (existing && String(existing.contentChecksum) !== contentChecksum)
        return failure(issue('id', 'openItemBatchIdReused', 'batch id belongs to different open items'))
      if (!existing)
        await ctx.db.insert('account.OpenItemBatch', {
          id: args.id,
          state: 'importing',
          accountingDate: args.accountingDate,
          sourceChecksum: args.sourceChecksum,
          contentChecksum,
          controlReceivable: minorText(receivable, scale),
          controlPayable: minorText(payable, scale),
          itemCount: items.length,
          createdAt: now(),
          createdBy: ctx.actor ?? null,
          completedAt: null,
          revision: 0,
        })
      for (const [at, item] of items.entries()) {
        const side = sideOf(item.moveType)
        const original = moneyMinor(item.originalAmount, scale)
        const residual = moneyMinor(item.residualAmount, scale)
        const paid = original - residual
        const moveId = `open-item:${String(args.id)}:${item.sourceKey}`
        const counterpartLineId = `${moveId}:counterpart`
        const baseLineId = `${moveId}:base`
        const baseDebit = side.baseDebit
        const mapped = (
          await ctx.db.select('account.OpenItemSource', { batchId: args.id, sourceKey: item.sourceKey })
        )[0]
        if (mapped?.state === 'imported') {
          const line = (await ctx.db.select('account.MoveLine', { id: counterpartLineId }))[0]
          if (!line || moneyMinor(line.amountResidual, scale) !== residual)
            return failure(
              issue(
                `items.${at}`,
                'openItemConflict',
                'stored open-item residual differs from its source map',
              ),
            )
          continue
        }
        try {
          await ctx.tx((tx) =>
            insertDraftMove(tx, {
              move: {
                id: moveId,
                name: moveId,
                ref: item.sourceKey,
                date: `${String(args.accountingDate)}T00:00:00.000Z`,
                accountingDate: args.accountingDate,
                documentDate: item.documentDate,
                moveType: item.moveType,
                state: 'draft',
                journalId: item.journalId,
                partnerId: item.partnerId,
                invoiceDate: `${item.documentDate}T00:00:00.000Z`,
                invoiceDateDue: `${item.dueDate}T00:00:00.000Z`,
                paymentTermId: null,
                paymentState: 'not_paid',
                currency,
                amountUntaxed: minorText(original, scale),
                amountTax: minorText(0n, scale),
                amountTotal: minorText(original, scale),
                reversalOfId: null,
                reversedById: null,
                reversalStatus: null,
              },
              lines: [
                {
                  id: baseLineId,
                  moveId,
                  name: item.sourceKey,
                  accountId: item.offsetAccountId,
                  partnerId: item.partnerId,
                  quantity: '1',
                  priceUnit: minorText(original, scale),
                  discount: '0',
                  debit: minorText(baseDebit ? original : 0n, scale),
                  credit: minorText(baseDebit ? 0n : original, scale),
                  balance: minorText(baseDebit ? original : -original, scale),
                  reconciled: false,
                  amountResidual: minorText(0n, scale),
                  sequence: 10,
                },
                {
                  id: counterpartLineId,
                  moveId,
                  name: item.sourceKey,
                  accountId: item.counterpartAccountId,
                  partnerId: item.partnerId,
                  quantity: '1',
                  priceUnit: minorText(original, scale),
                  discount: '0',
                  debit: minorText(baseDebit ? 0n : original, scale),
                  credit: minorText(baseDebit ? original : 0n, scale),
                  balance: minorText(baseDebit ? -original : original, scale),
                  dateMaturity: `${item.dueDate}T00:00:00.000Z`,
                  reconciled: false,
                  amountResidual: minorText(original, scale),
                  sequence: 20,
                },
              ],
            }),
          )
        } catch (error) {
          return failure(
            issue(`items.${at}`, 'openItemConflict', error instanceof Error ? error.message : String(error)),
          )
        }
        const posted = await postMoveById(ctx, moveId)
        if (posted.ok !== true) return posted
        let settlementMoveId: string | null = null
        if (paid > 0n) {
          settlementMoveId = `${moveId}:settlement`
          const settlementCounterpartId = `${settlementMoveId}:counterpart`
          const originalCounterpartDebit = !baseDebit
          await ctx.tx((tx) =>
            insertDraftMove(tx, {
              move: {
                id: settlementMoveId,
                name: settlementMoveId,
                ref: `${item.sourceKey}:settled-before-migration`,
                date: `${String(args.accountingDate)}T00:00:00.000Z`,
                accountingDate: args.accountingDate,
                documentDate: args.accountingDate,
                moveType: 'entry',
                state: 'draft',
                journalId: item.journalId,
                partnerId: item.partnerId,
                invoiceDate: null,
                invoiceDateDue: null,
                paymentTermId: null,
                paymentState: 'paid',
                currency,
                amountUntaxed: minorText(paid, scale),
                amountTax: minorText(0n, scale),
                amountTotal: minorText(paid, scale),
              },
              lines: [
                {
                  id: settlementCounterpartId,
                  moveId: settlementMoveId,
                  name: item.sourceKey,
                  accountId: item.counterpartAccountId,
                  partnerId: item.partnerId,
                  quantity: '1',
                  priceUnit: minorText(paid, scale),
                  discount: '0',
                  debit: minorText(originalCounterpartDebit ? 0n : paid, scale),
                  credit: minorText(originalCounterpartDebit ? paid : 0n, scale),
                  balance: minorText(originalCounterpartDebit ? -paid : paid, scale),
                  reconciled: false,
                  amountResidual: minorText(paid, scale),
                  sequence: 10,
                },
                {
                  id: `${settlementMoveId}:offset`,
                  moveId: settlementMoveId,
                  name: item.sourceKey,
                  accountId: item.offsetAccountId,
                  partnerId: item.partnerId,
                  quantity: '1',
                  priceUnit: minorText(paid, scale),
                  discount: '0',
                  debit: minorText(originalCounterpartDebit ? paid : 0n, scale),
                  credit: minorText(originalCounterpartDebit ? 0n : paid, scale),
                  balance: minorText(originalCounterpartDebit ? paid : -paid, scale),
                  reconciled: false,
                  amountResidual: minorText(0n, scale),
                  sequence: 20,
                },
              ],
            }),
          )
          const settlementPosted = await postMoveById(ctx, settlementMoveId)
          if (settlementPosted.ok !== true) return settlementPosted
          const reconciled = (await functions.reconcile!.handler(ctx, {
            id: `${moveId}:opening-reconcile`,
            debitMoveId: originalCounterpartDebit ? counterpartLineId : settlementCounterpartId,
            creditMoveId: originalCounterpartDebit ? settlementCounterpartId : counterpartLineId,
            amount: minorText(paid, scale),
            date: `${String(args.accountingDate)}T00:00:00.000Z`,
          })) as Row
          if (reconciled.ok !== true) return reconciled
        }
        const held = (
          await ctx.db.select('account.OpenItemSource', { batchId: args.id, sourceKey: item.sourceKey })
        )[0]
        if (!held)
          await ctx.db.insert('account.OpenItemSource', {
            id: `${String(args.id)}:${item.sourceKey}`,
            batchId: args.id,
            ...item,
            moveId,
            settlementMoveId,
            state: 'imported',
            sequence: (at + 1) * 10,
          })
      }
      const current = (await ctx.db.select('account.OpenItemBatch', { id: args.id }))[0]!
      if (current.state !== 'completed')
        await ctx.db.update(
          'account.OpenItemBatch',
          { id: args.id },
          {
            state: 'completed',
            completedAt: now(),
            revision: Number(current.revision) + 1,
          },
        )
      return { ok: true, id: args.id, preview }
    },
  }),
}
