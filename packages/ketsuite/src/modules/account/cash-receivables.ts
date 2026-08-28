import { createHash } from 'node:crypto'
import { defineFn } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec, Row } from '@ketvietlab/ketjs'
import { accountingDateText } from './date.ts'
import { functions as coreFunctions, ledgerOf } from './functions.ts'
import { canonicalDecimalText, minorText, moneyMinor } from './money.ts'

const now = (): string => new Date().toISOString()
const failure = (field: string, code: string, message: string) => ({
  ok: false as const,
  errors: [{ field, code: `account.error.${code}`, message }],
})
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, held]) => `${JSON.stringify(key)}:${stable(held)}`)
      .join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
const checksum = (value: unknown): string => createHash('sha256').update(stable(value)).digest('hex')
const asRows = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? (value.filter((row) => row && typeof row === 'object') as Record<string, unknown>[])
    : []
const dayDistance = (from: string, to: string): number =>
  Math.floor((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000)

type Normalized = {
  externalId: string | null
  bookingDate: string
  valueDate: string | null
  amount: string
  direction: 'inbound' | 'outbound'
  reference: string | null
  counterparty: string | null
  partnerId: string | null
  providerState: 'pending' | 'posted' | 'reversed'
  balance: string | null
}

const normalizeRows = async (
  ctx: Ctx,
  profile: Row,
  rows: unknown,
): Promise<{ normalized: Normalized[]; errors: Row[] }> => {
  const { scale, timezone } = await ledgerOf(ctx)
  const mapping = (profile.mapping ?? {}) as Record<string, unknown>
  const key = (name: string): string => String(mapping[name] ?? name)
  const normalized: Normalized[] = []
  const errors: Row[] = []
  for (const [index, raw] of asRows(rows).entries()) {
    try {
      const rawAmount = canonicalDecimalText(String(raw[key('amount')] ?? ''))
      const signed = moneyMinor(rawAmount, scale)
      const explicit = String(raw[key('direction')] ?? '').toLowerCase()
      const direction =
        explicit === 'outbound' || explicit === 'debit' || signed < 0n ? 'outbound' : 'inbound'
      const amount = minorText(signed < 0n ? -signed : signed, scale)
      if (moneyMinor(amount, scale) === 0n) throw new Error('amount must be non-zero')
      const bookingDate = accountingDateText(raw[key('bookingDate')], timezone)
      const providerState = String(raw[key('providerState')] ?? 'posted').toLowerCase()
      if (!['pending', 'posted', 'reversed'].includes(providerState))
        throw new Error('invalid provider state')
      normalized.push({
        externalId: raw[key('externalId')] == null ? null : String(raw[key('externalId')]),
        bookingDate,
        valueDate: raw[key('valueDate')] == null ? null : accountingDateText(raw[key('valueDate')], timezone),
        amount,
        direction,
        reference: raw[key('reference')] == null ? null : String(raw[key('reference')]).trim() || null,
        counterparty:
          raw[key('counterparty')] == null ? null : String(raw[key('counterparty')]).trim() || null,
        partnerId: raw[key('partnerId')] == null ? null : String(raw[key('partnerId')]),
        providerState: providerState as Normalized['providerState'],
        balance:
          raw[key('balance')] == null
            ? null
            : minorText(moneyMinor(String(raw[key('balance')]), scale), scale),
      })
    } catch (error) {
      errors.push({ row: index + 1, message: (error as Error).message })
    }
  }
  return { normalized, errors }
}

const preview = async (ctx: Ctx, args: Record<string, unknown>) => {
  const profile = (await ctx.db.select('account.BankImportProfile', { id: args.profileId }))[0]
  if (!profile) return failure('profileId', 'bankProfileMissing', 'bank import profile does not exist')
  const { scale } = await ledgerOf(ctx)
  const { normalized, errors } = await normalizeRows(ctx, profile, args.rows)
  let movement = 0n
  for (const row of normalized) {
    const amount = moneyMinor(row.amount, scale)
    movement += row.direction === 'inbound' ? amount : -amount
  }
  let opening: bigint
  let closing: bigint
  try {
    opening = moneyMinor(args.openingBalance ?? '0', scale)
    closing = moneyMinor(args.closingBalance ?? minorText(opening + movement, scale), scale)
  } catch {
    return failure('openingBalance', 'moneyExactString', 'balances must be exact decimal strings')
  }
  const difference = opening + movement - closing
  const blocked = difference !== 0n && profile.balancePolicy === 'block'
  return {
    ok: errors.length === 0 && !blocked,
    normalized,
    errors,
    openingBalance: minorText(opening, scale),
    movement: minorText(movement, scale),
    closingBalance: minorText(closing, scale),
    difference: minorText(difference, scale),
    warning: difference === 0n ? null : 'opening + movement does not equal closing balance',
    blocked,
  }
}

async function activeOpenLines(ctx: Ctx): Promise<Array<Row & { move: Row }>> {
  const { scale } = await ledgerOf(ctx)
  const posted = new Map(
    (await ctx.db.select('account.Move', { state: 'posted' })).map((move) => [String(move.id), move]),
  )
  return (await ctx.db.select('account.MoveLine'))
    .filter(
      (line) =>
        posted.has(String(line.moveId)) &&
        line.reconciled !== true &&
        moneyMinor(line.amountResidual, scale) > 0n,
    )
    .map((line) => ({ ...line, move: posted.get(String(line.moveId))! }))
}

const callCore = async (name: keyof typeof coreFunctions, ctx: Ctx, args: Record<string, unknown>) => {
  const fn = coreFunctions[name]
  if (!fn) throw new Error(`account.${String(name)} is unavailable`)
  return fn.handler(ctx, args) as Promise<Record<string, unknown>>
}

export const cashReceivableFunctions: Record<string, FnSpec> = {
  listBankAccounts: defineFn({
    input: { active: 'bool?' },
    effects: ['read:account.BankAccount'],
    agent: true,
    handler: async (ctx, args) =>
      (await ctx.db.select('account.BankAccount'))
        .filter((row) => args.active == null || row.active === args.active)
        .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  }),
  listBankImportProfiles: defineFn({
    input: {},
    effects: ['read:account.BankImportProfile'],
    agent: true,
    handler: async (ctx) =>
      (await ctx.db.select('account.BankImportProfile')).sort((a, b) =>
        String(a.name).localeCompare(String(b.name)),
      ),
  }),
  listBankTransactions: defineFn({
    input: { bankAccountId: 'id?', reconcileState: 'text?', providerState: 'text?' },
    effects: ['read:account.BankTransaction'],
    agent: true,
    handler: async (ctx, args) =>
      (await ctx.db.select('account.BankTransaction'))
        .filter(
          (row) =>
            (!args.bankAccountId || row.bankAccountId === args.bankAccountId) &&
            (!args.reconcileState || row.reconcileState === args.reconcileState) &&
            (!args.providerState || row.providerState === args.providerState),
        )
        .sort(
          (a, b) =>
            String(b.bookingDate).localeCompare(String(a.bookingDate)) ||
            String(a.id).localeCompare(String(b.id)),
        ),
  }),
  listBankReconciliations: defineFn({
    input: { transactionId: 'id?' },
    effects: ['read:account.BankReconciliation'],
    agent: true,
    handler: async (ctx, args) =>
      (await ctx.db.select('account.BankReconciliation'))
        .filter((row) => !args.transactionId || row.transactionId === args.transactionId)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
  }),
  listCashCounts: defineFn({
    input: { bankAccountId: 'id?' },
    effects: ['read:account.CashCount'],
    agent: true,
    handler: async (ctx, args) =>
      (await ctx.db.select('account.CashCount'))
        .filter((row) => !args.bankAccountId || row.bankAccountId === args.bankAccountId)
        .sort((a, b) => String(b.countedAt).localeCompare(String(a.countedAt))),
  }),
  listFollowUpCases: defineFn({
    input: { state: 'text?' },
    effects: ['read:account.FollowUpCase'],
    agent: true,
    handler: async (ctx, args) =>
      (await ctx.db.select('account.FollowUpCase'))
        .filter((row) => !args.state || row.state === args.state)
        .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))),
  }),
  listFollowUpMessages: defineFn({
    input: { state: 'text?' },
    effects: ['read:account.FollowUpMessage'],
    agent: true,
    handler: async (ctx, args) =>
      (await ctx.db.select('account.FollowUpMessage'))
        .filter((row) => !args.state || row.state === args.state)
        .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt))),
  }),
  saveBankAccount: defineFn({
    input: {
      id: 'id',
      name: 'text',
      journalId: 'id',
      liquidityAccountId: 'id',
      clearingAccountId: 'id',
      suspenseAccountId: 'id',
      currency: 'text',
      externalKey: 'text?',
      accessPolicy: 'text?',
      active: 'bool?',
    },
    effects: [
      'read:account.Journal',
      'read:account.Account',
      'read:company.Company',
      'read:account.BankAccount',
      'write:account.BankAccount',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const { currency } = await ledgerOf(ctx)
      const journal = (await ctx.db.select('account.Journal', { id: args.journalId }))[0]
      if (!journal || !['bank', 'cash'].includes(String(journal.type)))
        return failure('journalId', 'bankJournalInvalid', 'bank account requires a bank or cash journal')
      if (String(args.currency).toUpperCase() !== currency)
        return failure(
          'currency',
          'bankCurrencyMismatch',
          'bank account currency must match the company ledger',
        )
      const accounts = new Map((await ctx.db.select('account.Account')).map((row) => [String(row.id), row]))
      const liquidity = accounts.get(String(args.liquidityAccountId))
      if (liquidity?.accountType !== 'asset_cash')
        return failure('liquidityAccountId', 'bankLiquidityInvalid', 'liquidity account must be cash or bank')
      if (!accounts.has(String(args.clearingAccountId)) || !accounts.has(String(args.suspenseAccountId)))
        return failure(
          'clearingAccountId',
          'bankControlAccountMissing',
          'clearing and suspense accounts must exist',
        )
      const values = {
        ...args,
        currency,
        externalKey: args.externalKey ?? null,
        accessPolicy: args.accessPolicy ?? null,
        active: args.active ?? true,
      }
      const existing = (await ctx.db.select('account.BankAccount', { id: args.id }))[0]
      if (existing) {
        await ctx.db.update('account.BankAccount', { id: args.id }, values)
        return { ok: true, id: args.id, existing: true }
      }
      await ctx.db.insert('account.BankAccount', values)
      return { ok: true, id: args.id, existing: false }
    },
  }),
  saveBankImportProfile: defineFn({
    input: {
      id: 'id',
      name: 'text',
      format: 'text',
      provider: 'text?',
      mapping: 'json',
      balancePolicy: 'text?',
      version: 'int?',
      active: 'bool?',
    },
    effects: ['read:account.BankImportProfile', 'write:account.BankImportProfile'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      if (!['csv', 'xlsx', 'api'].includes(String(args.format)))
        return failure('format', 'bankFormatInvalid', 'format must be csv, xlsx, or api')
      const balancePolicy = String(args.balancePolicy ?? 'block')
      if (!['block', 'warn'].includes(balancePolicy))
        return failure('balancePolicy', 'bankBalancePolicyInvalid', 'balance policy must block or warn')
      const values = {
        ...args,
        provider: args.provider ?? null,
        balancePolicy,
        version: args.version ?? 1,
        active: args.active ?? true,
      }
      const existing = (await ctx.db.select('account.BankImportProfile', { id: args.id }))[0]
      if (existing) await ctx.db.update('account.BankImportProfile', { id: args.id }, values)
      else await ctx.db.insert('account.BankImportProfile', values)
      return { ok: true, id: args.id, existing: Boolean(existing) }
    },
  }),
  previewBankStatement: defineFn({
    input: { profileId: 'id', rows: 'json', openingBalance: 'decimal?', closingBalance: 'decimal?' },
    effects: ['read:account.BankImportProfile', 'read:company.Company'],
    agent: true,
    handler: preview,
  }),
  importBankStatement: defineFn({
    input: {
      id: 'id',
      bankAccountId: 'id',
      profileId: 'id',
      rows: 'json',
      openingBalance: 'decimal?',
      closingBalance: 'decimal?',
      sourceChecksum: 'text?',
      actorId: 'text?',
    },
    effects: [
      'read:account.BankAccount',
      'read:account.BankImportProfile',
      'read:account.BankStatementBatch',
      'read:account.BankTransaction',
      'read:account.BankTransactionVersion',
      'read:company.Company',
      'write:account.BankStatementBatch',
      'write:account.BankTransaction',
      'write:account.BankTransactionVersion',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const bank = (await ctx.db.select('account.BankAccount', { id: args.bankAccountId }))[0]
      if (!bank) return failure('bankAccountId', 'bankAccountMissing', 'bank account does not exist')
      const result = (await preview(ctx, args)) as Record<string, unknown>
      if (result.blocked || (result.errors as unknown[]).length) return result
      const sourceChecksum = String(args.sourceChecksum ?? checksum(args.rows))
      const heldBatch = (await ctx.db.select('account.BankStatementBatch', { sourceChecksum }))[0]
      if (heldBatch) return { ok: true, id: heldBatch.id, duplicate: true, imported: 0, updated: 0 }
      const normalized = result.normalized as Normalized[]
      const batch = {
        id: args.id,
        bankAccountId: args.bankAccountId,
        profileId: args.profileId,
        sourceChecksum,
        openingBalance: result.openingBalance,
        movement: result.movement,
        closingBalance: result.closingBalance,
        state: result.warning ? 'warning' : 'validated',
        warning: result.warning,
        transactionCount: normalized.length,
        importedAt: now(),
        importedBy: args.actorId ?? null,
      }
      const inserted = await ctx.db.insertIfAbsent('account.BankStatementBatch', batch)
      if (!('dryRun' in inserted) && !inserted.inserted) {
        const existing = (await ctx.db.select('account.BankStatementBatch', { sourceChecksum }))[0]
        return { ok: true, id: existing?.id ?? args.id, duplicate: true, imported: 0, updated: 0 }
      }
      let imported = 0
      let updated = 0
      for (const [index, row] of normalized.entries()) {
        const semantic = checksum({ bankAccountId: args.bankAccountId, ...row })
        const raw = asRows(args.rows)[index] ?? {}
        const versionFingerprint = checksum({ row, raw })
        const byExternal = row.externalId
          ? (
              await ctx.db.select('account.BankTransaction', {
                bankAccountId: args.bankAccountId,
                externalId: row.externalId,
              })
            )[0]
          : null
        const existing =
          byExternal ?? (await ctx.db.select('account.BankTransaction', { fingerprint: semantic }))[0]
        const id = existing?.id ?? `${String(args.id)}:${index + 1}`
        if (!existing) {
          await ctx.db.insert('account.BankTransaction', {
            id,
            batchId: args.id,
            bankAccountId: args.bankAccountId,
            ...row,
            fingerprint: semantic,
            reconcileState: 'unmatched',
            moveId: null,
            revision: 0,
            updatedAt: now(),
          })
          imported += 1
        } else {
          await ctx.db.update(
            'account.BankTransaction',
            { id },
            {
              batchId: args.id,
              bookingDate: row.bookingDate,
              valueDate: row.valueDate,
              amount: row.amount,
              direction: row.direction,
              reference: row.reference,
              counterparty: row.counterparty,
              partnerId: row.partnerId,
              providerState: row.providerState,
              revision: Number(existing.revision ?? 0) + 1,
              updatedAt: now(),
            },
          )
          updated += 1
        }
        const versionId = `${String(id)}:${versionFingerprint}`
        await ctx.db.insertIfAbsent('account.BankTransactionVersion', {
          id: versionId,
          transactionId: id,
          fingerprint: versionFingerprint,
          providerState: row.providerState,
          normalized: row,
          raw,
          receivedAt: now(),
        })
      }
      return { ok: true, id: args.id, duplicate: false, imported, updated, warning: result.warning }
    },
  }),
  saveMatchRule: defineFn({
    input: {
      id: 'id',
      name: 'text',
      version: 'int?',
      weights: 'json?',
      minimumScore: 'int?',
      autoApproveScore: 'int?',
      active: 'bool?',
    },
    effects: ['read:account.MatchRule', 'write:account.MatchRule'],
    idempotent: true,
    handler: async (ctx, args) => {
      const values = {
        ...args,
        version: args.version ?? 1,
        weights: args.weights ?? { amount: 60, reference: 20, partner: 10, date: 10 },
        minimumScore: args.minimumScore ?? 60,
        autoApproveScore: args.autoApproveScore ?? null,
        active: args.active ?? true,
      }
      const existing = (await ctx.db.select('account.MatchRule', { id: args.id }))[0]
      if (existing) await ctx.db.update('account.MatchRule', { id: args.id }, values)
      else await ctx.db.insert('account.MatchRule', values)
      return { ok: true, id: args.id }
    },
  }),
  suggestBankMatches: defineFn({
    input: { transactionId: 'id', ruleId: 'id' },
    effects: [
      'read:account.BankTransaction',
      'read:account.MatchRule',
      'read:account.Move',
      'read:account.MoveLine',
      'read:company.Company',
      'read:account.MatchSuggestion',
      'write:account.MatchSuggestion',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const tx = (await ctx.db.select('account.BankTransaction', { id: args.transactionId }))[0]
      const rule = (await ctx.db.select('account.MatchRule', { id: args.ruleId }))[0]
      if (!tx) return failure('transactionId', 'bankTransactionMissing', 'bank transaction does not exist')
      if (rule?.active !== true)
        return failure('ruleId', 'matchRuleMissing', 'active matching rule does not exist')
      const { scale } = await ledgerOf(ctx)
      const weights = rule.weights as Record<string, number>
      const candidates: Array<Row & { score: number; reasons: string[] }> = []
      for (const line of await activeOpenLines(ctx)) {
        const positive = moneyMinor(line.balance, scale) > 0n
        if ((tx.direction === 'inbound') !== positive) continue
        let score = 0
        const reasons: string[] = []
        if (moneyMinor(line.amountResidual, scale) === moneyMinor(tx.amount, scale)) {
          score += Number(weights.amount ?? 60)
          reasons.push('exact_amount')
        }
        const reference = String(tx.reference ?? '')
          .trim()
          .toLowerCase()
        if (
          reference &&
          [line.move.name, line.move.ref].some((held) =>
            String(held ?? '')
              .toLowerCase()
              .includes(reference),
          )
        ) {
          score += Number(weights.reference ?? 20)
          reasons.push('reference')
        }
        if (tx.partnerId && tx.partnerId === line.partnerId) {
          score += Number(weights.partner ?? 10)
          reasons.push('partner')
        }
        if (Math.abs(dayDistance(String(line.move.accountingDate), String(tx.bookingDate))) <= 3) {
          score += Number(weights.date ?? 10)
          reasons.push('date_window')
        }
        if (score >= Number(rule.minimumScore)) candidates.push({ ...line, score, reasons })
      }
      candidates.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)))
      const ambiguous = candidates.length > 1 && candidates[0]!.score - candidates[1]!.score <= 5
      const rows: Row[] = []
      for (const candidate of candidates.slice(0, 20)) {
        const id = `${String(tx.id)}:${String(candidate.id)}:${String(rule.id)}:${String(rule.version)}`
        const row = {
          id,
          transactionId: tx.id,
          moveLineId: candidate.id,
          ruleId: rule.id,
          ruleVersion: rule.version,
          score: candidate.score,
          reasons: candidate.reasons,
          ambiguous,
          state: 'suggested',
          createdAt: now(),
        }
        await ctx.db.insertIfAbsent('account.MatchSuggestion', row)
        rows.push(row)
      }
      return { ok: true, candidates: rows, ambiguous }
    },
  }),
  postBankReconciliation: defineFn({
    input: {
      id: 'id',
      transactionId: 'id',
      allocations: 'json',
      accountingDate: 'date?',
      writeOffAccountId: 'id?',
      writeOffAmount: 'decimal?',
      actorId: 'text?',
      reason: 'text?',
      ruleId: 'id?',
      ruleVersion: 'int?',
    },
    effects: [
      'read:account.BankTransaction',
      'read:account.BankAccount',
      'read:account.BankReconciliation',
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.Account',
      'read:account.Journal',
      'read:account.PartialReconcile',
      'read:account.PeriodPolicy',
      'read:company.Company',
      'write:account.BankReconciliation',
      'write:account.BankTransaction',
      'write:account.Move',
      'write:account.MoveLine',
      'write:account.Journal',
      'write:account.PartialReconcile',
      'write:account.PeriodPolicy',
      'write:account.AuditEvent',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const held = (await ctx.db.select('account.BankReconciliation', { id: args.id }))[0]
      if (held?.state === 'posted') return { ok: true, id: held.id, moveId: held.moveId, duplicate: true }
      const tx = (await ctx.db.select('account.BankTransaction', { id: args.transactionId }))[0]
      if (tx?.providerState !== 'posted')
        return failure(
          'transactionId',
          'bankTransactionNotPosted',
          'only a posted bank transaction can be reconciled',
        )
      const bank = (await ctx.db.select('account.BankAccount', { id: tx.bankAccountId }))[0]
      if (!bank) return failure('transactionId', 'bankAccountMissing', 'bank account does not exist')
      const { scale } = await ledgerOf(ctx)
      const allocations = asRows(args.allocations)
      if (!allocations.length)
        return failure('allocations', 'reconcileAllocationsRequired', 'at least one allocation is required')
      let allocated = 0n
      const openById = new Map((await activeOpenLines(ctx)).map((line) => [String(line.id), line]))
      const prepared: Array<{ line: Row; amount: bigint }> = []
      const allocatedLineIds = new Set<string>()
      for (const allocation of allocations) {
        const moveLineId = String(allocation.moveLineId)
        if (allocatedLineIds.has(moveLineId))
          return failure(
            'allocations',
            'reconcileAllocationDuplicate',
            'an open item can only appear once in a reconciliation',
          )
        allocatedLineIds.add(moveLineId)
        const line = openById.get(moveLineId)
        if (!line) return failure('allocations', 'openItemMissing', 'an allocated open item does not exist')
        const amount = moneyMinor(String(allocation.amount ?? '0'), scale)
        if (amount <= 0n || amount > moneyMinor(line.amountResidual, scale))
          return failure('allocations', 'reconcileAmountExceeds', 'allocation exceeds the open residual')
        const debitOpen = moneyMinor(line.balance, scale) > 0n
        if ((tx.direction === 'inbound') !== debitOpen)
          return failure(
            'allocations',
            'reconcileSides',
            'allocation direction does not match the bank transaction',
          )
        allocated += amount
        prepared.push({ line, amount })
      }
      const bankAmount = moneyMinor(tx.amount, scale)
      const imbalance = tx.direction === 'inbound' ? bankAmount - allocated : allocated - bankAmount
      const writeOff = imbalance < 0n ? -imbalance : imbalance
      if (writeOff > 0n) {
        if (!args.writeOffAccountId)
          return failure(
            'writeOffAccountId',
            'writeOffAccountRequired',
            'an imbalanced reconciliation requires a write-off account',
          )
        if (moneyMinor(args.writeOffAmount ?? '0', scale) !== writeOff)
          return failure(
            'writeOffAmount',
            'writeOffAmountMismatch',
            'write-off amount does not match the reconciliation difference',
          )
      }
      const accountingDate = accountingDateText(
        args.accountingDate ?? tx.bookingDate,
        (await ledgerOf(ctx)).timezone,
      )
      const moveId = `${String(args.id)}:move`
      if (!held)
        await ctx.db.insert('account.BankReconciliation', {
          id: args.id,
          transactionId: tx.id,
          state: 'approved',
          accountingDate,
          allocations,
          writeOffAccountId: args.writeOffAccountId ?? null,
          writeOffAmount: minorText(writeOff, scale),
          moveId,
          actorId: args.actorId ?? null,
          reason: args.reason ?? null,
          before: prepared.map(({ line }) => ({ moveLineId: line.id, residual: line.amountResidual })),
          after: null,
          ruleId: args.ruleId ?? null,
          ruleVersion: args.ruleVersion ?? null,
          createdAt: now(),
          reversedAt: null,
          reversedBy: null,
          reversalReason: null,
        })
      let result = await callCore('createMove', ctx, {
        id: moveId,
        journalId: bank.journalId,
        moveType: 'entry',
        accountingDate,
        documentDate: accountingDate,
        ref: tx.reference ?? tx.externalId ?? tx.id,
      })
      if (result.ok !== true) return result
      result = await callCore('addMoveLine', ctx, {
        id: `${moveId}:liquidity`,
        moveId,
        name: tx.counterparty ?? tx.reference ?? 'Bank transaction',
        accountId: bank.liquidityAccountId,
        ...(tx.direction === 'inbound' ? { debit: tx.amount } : { credit: tx.amount }),
        sequence: 10,
      })
      if (result.ok !== true) return result
      for (const [index, item] of prepared.entries()) {
        result = await callCore('addMoveLine', ctx, {
          id: `${moveId}:allocation:${index + 1}`,
          moveId,
          name: tx.reference ?? 'Bank reconciliation',
          accountId: item.line.accountId,
          partnerId: item.line.partnerId,
          ...(tx.direction === 'inbound'
            ? { credit: minorText(item.amount, scale) }
            : { debit: minorText(item.amount, scale) }),
          sequence: 20 + index,
        })
        if (result.ok !== true) return result
      }
      if (writeOff > 0n) {
        const writeOffBalance = -imbalance
        result = await callCore('addMoveLine', ctx, {
          id: `${moveId}:writeoff`,
          moveId,
          name: 'Reconciliation difference',
          accountId: args.writeOffAccountId,
          ...(writeOffBalance > 0n
            ? { debit: minorText(writeOffBalance, scale) }
            : { credit: minorText(-writeOffBalance, scale) }),
          sequence: 90,
        })
        if (result.ok !== true) return result
      }
      result = await callCore('postMove', ctx, { id: moveId })
      if (result.ok !== true) return result
      for (const [index, item] of prepared.entries()) {
        const counterpartId = `${moveId}:allocation:${index + 1}`
        result = await callCore('reconcile', ctx, {
          id: `${String(args.id)}:partial:${index + 1}`,
          debitMoveId: tx.direction === 'inbound' ? item.line.id : counterpartId,
          creditMoveId: tx.direction === 'inbound' ? counterpartId : item.line.id,
          amount: minorText(item.amount, scale),
          actorId: args.actorId,
          reason: args.reason,
        })
        if (result.ok !== true) return result
      }
      const after = prepared.map(({ line }) => ({
        moveLineId: line.id,
        residual: ctx.db.select('account.MoveLine', { id: line.id }) as Promise<Row[]>,
      }))
      const resolvedAfter = await Promise.all(
        after.map(async (item) => ({
          moveLineId: item.moveLineId,
          residual: (await item.residual)[0]?.amountResidual,
        })),
      )
      await ctx.db.update(
        'account.BankReconciliation',
        { id: args.id },
        { state: 'posted', after: resolvedAfter },
      )
      await ctx.db.update(
        'account.BankTransaction',
        { id: tx.id },
        { reconcileState: 'reconciled', moveId, revision: Number(tx.revision ?? 0) + 1, updatedAt: now() },
      )
      return { ok: true, id: args.id, moveId, duplicate: false }
    },
  }),
  undoBankReconciliation: defineFn({
    input: { id: 'id', reversalId: 'id', accountingDate: 'date?', actorId: 'text?', reason: 'text' },
    effects: [
      'read:account.BankReconciliation',
      'read:account.BankTransaction',
      'read:account.PartialReconcile',
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.Account',
      'read:account.Journal',
      'read:account.Payment',
      'read:account.PeriodPolicy',
      'read:company.Company',
      'write:account.BankReconciliation',
      'write:account.BankTransaction',
      'write:account.PartialReconcile',
      'write:account.Move',
      'write:account.MoveLine',
      'write:account.Journal',
      'write:account.Payment',
      'write:account.PeriodPolicy',
      'write:account.AuditEvent',
    ],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const reconciliation = (await ctx.db.select('account.BankReconciliation', { id: args.id }))[0]
      if (!reconciliation)
        return failure('id', 'bankReconciliationMissing', 'bank reconciliation does not exist')
      if (reconciliation.state === 'reversed') return { ok: true, id: args.id, duplicate: true }
      if (reconciliation.state !== 'posted')
        return failure('id', 'bankReconciliationNotPosted', 'only a posted reconciliation can be undone')
      const tx = (await ctx.db.select('account.BankTransaction', { id: reconciliation.transactionId }))[0]
      const { scale } = await ledgerOf(ctx)
      const allocations = asRows(reconciliation.allocations)
      for (const [index] of allocations.entries()) {
        const partial = (
          await ctx.db.select('account.PartialReconcile', { id: `${String(args.id)}:partial:${index + 1}` })
        )[0]
        if (!partial || partial.state === 'reversed') continue
        const amount = moneyMinor(partial.amount, scale)
        for (const lineId of [partial.debitMoveId, partial.creditMoveId]) {
          const line = (await ctx.db.select('account.MoveLine', { id: lineId }))[0]
          if (!line) continue
          const residual = moneyMinor(line.amountResidual, scale) + amount
          await ctx.db.update(
            'account.MoveLine',
            { id: line.id },
            { amountResidual: minorText(residual, scale), reconciled: false },
          )
        }
        await ctx.db.update(
          'account.PartialReconcile',
          { id: partial.id },
          {
            state: 'reversed',
            reversedAt: now(),
            reversedBy: args.actorId ?? null,
            reversalReason: args.reason,
          },
        )
      }
      const reversed = await callCore('reverseMove', ctx, {
        id: reconciliation.moveId,
        reversalId: args.reversalId,
        ...(args.accountingDate ? { accountingDate: args.accountingDate } : {}),
        reason: args.reason,
      })
      if (reversed.ok !== true) return reversed
      await ctx.db.update(
        'account.BankReconciliation',
        { id: args.id },
        {
          state: 'reversed',
          reversedAt: now(),
          reversedBy: args.actorId ?? null,
          reversalReason: args.reason,
        },
      )
      if (tx)
        await ctx.db.update(
          'account.BankTransaction',
          { id: tx.id },
          {
            reconcileState: 'unmatched',
            moveId: null,
            revision: Number(tx.revision ?? 0) + 1,
            updatedAt: now(),
          },
        )
      return { ok: true, id: args.id, reversalId: args.reversalId, duplicate: false }
    },
  }),
  receivableAging: defineFn({
    input: { cutoff: 'date', basis: 'text?', partnerId: 'id?', accountType: 'text?', buckets: 'json?' },
    effects: ['read:account.Move', 'read:account.MoveLine', 'read:account.Account', 'read:company.Company'],
    agent: true,
    handler: async (ctx, args) => {
      const basis = String(args.basis ?? 'due')
      if (!['due', 'invoice'].includes(basis))
        return failure('basis', 'agingBasisInvalid', 'aging basis must be due or invoice')
      const limits = (Array.isArray(args.buckets) ? args.buckets : [0, 30, 60, 90])
        .map(Number)
        .filter(Number.isFinite)
        .sort((a, b) => a - b)
      const accountTypes =
        String(args.accountType ?? 'receivable') === 'payable' ? ['liability_payable'] : ['asset_receivable']
      const accountById = new Map(
        (await ctx.db.select('account.Account')).map((row) => [String(row.id), row]),
      )
      const rows: Row[] = []
      for (const line of await activeOpenLines(ctx)) {
        if (!accountTypes.includes(String(accountById.get(String(line.accountId))?.accountType))) continue
        if (args.partnerId && line.partnerId !== args.partnerId) continue
        const sourceDate =
          basis === 'due'
            ? String(line.dateMaturity ?? line.move.invoiceDateDue ?? line.move.accountingDate)
            : String(line.move.documentDate ?? line.move.accountingDate)
        const date = sourceDate.slice(0, 10)
        if (String(line.move.accountingDate) > String(args.cutoff)) continue
        const days = dayDistance(date, String(args.cutoff))
        const bucket = days < limits[0]! ? 'not_due' : `${limits.filter((limit) => days >= limit).at(-1)}+`
        const sign = moneyMinor(line.balance, (await ledgerOf(ctx)).scale) < 0n ? '-' : ''
        rows.push({
          moveLineId: line.id,
          moveId: line.moveId,
          partnerId: line.partnerId,
          accountId: line.accountId,
          documentDate: line.move.documentDate,
          dueDate: line.dateMaturity ?? line.move.invoiceDateDue,
          cutoff: args.cutoff,
          currency: line.move.currency,
          daysOverdue: days,
          bucket,
          amount: `${sign}${String(line.amountResidual)}`,
        })
      }
      const totals: Record<string, string> = {}
      const { scale } = await ledgerOf(ctx)
      for (const row of rows)
        totals[String(row.bucket)] = minorText(
          moneyMinor(totals[String(row.bucket)] ?? '0', scale) + moneyMinor(row.amount, scale),
          scale,
        )
      return { cutoff: args.cutoff, basis, buckets: limits, rows, totals }
    },
  }),
  createCashDocument: defineFn({
    input: {
      id: 'id',
      paymentId: 'id?',
      moveId: 'id?',
      kind: 'text',
      number: 'text',
      templateKey: 'text',
      templateVersion: 'text',
      actorId: 'text?',
    },
    effects: [
      'read:account.Payment',
      'read:account.Move',
      'read:account.MoveLine',
      'read:account.CashDocument',
      'read:company.Company',
      'write:account.CashDocument',
    ],
    idempotent: true,
    handler: async (ctx, args) => {
      if (!['receipt', 'payment', 'cash_transfer'].includes(String(args.kind)))
        return failure('kind', 'cashDocumentKindInvalid', 'unsupported cash document kind')
      const payment = args.paymentId
        ? (await ctx.db.select('account.Payment', { id: args.paymentId }))[0]
        : null
      const moveId = args.moveId ?? payment?.moveId
      const move = moveId ? (await ctx.db.select('account.Move', { id: moveId }))[0] : null
      if (move?.state !== 'posted')
        return failure('moveId', 'cashDocumentMoveInvalid', 'cash document requires a posted move')
      const snapshot = { payment, move, lines: await ctx.db.select('account.MoveLine', { moveId }) }
      const controlTotal = payment?.amount ?? move.amountTotal
      const row = {
        id: args.id,
        paymentId: args.paymentId ?? null,
        moveId,
        kind: args.kind,
        number: args.number,
        templateKey: args.templateKey,
        templateVersion: args.templateVersion,
        snapshot,
        controlTotal,
        createdAt: now(),
        createdBy: args.actorId ?? null,
      }
      const inserted = await ctx.db.insertIfAbsent('account.CashDocument', row)
      if (!('dryRun' in inserted) && !inserted.inserted) return { ok: true, id: args.id, duplicate: true }
      return { ok: true, id: args.id, duplicate: false, snapshot, controlTotal }
    },
  }),
  createCashCount: defineFn({
    input: {
      id: 'id',
      bankAccountId: 'id',
      countedAt: 'datetime',
      countedBy: 'text',
      actualBalance: 'decimal',
    },
    effects: [
      'read:account.BankAccount',
      'read:account.Move',
      'read:account.MoveLine',
      'read:company.Company',
      'read:account.CashCount',
      'write:account.CashCount',
    ],
    idempotent: true,
    handler: async (ctx, args) => {
      const bank = (await ctx.db.select('account.BankAccount', { id: args.bankAccountId }))[0]
      if (!bank) return failure('bankAccountId', 'bankAccountMissing', 'cash book does not exist')
      const { scale, timezone } = await ledgerOf(ctx)
      const accountingDate = accountingDateText(args.countedAt, timezone)
      const posted = new Set(
        (await ctx.db.select('account.Move', { state: 'posted' }))
          .filter((move) => String(move.accountingDate) <= accountingDate)
          .map((move) => String(move.id)),
      )
      let book = 0n
      for (const line of await ctx.db.select('account.MoveLine', { accountId: bank.liquidityAccountId }))
        if (posted.has(String(line.moveId))) book += moneyMinor(line.balance, scale)
      const actual = moneyMinor(args.actualBalance, scale)
      const difference = actual - book
      const row = {
        id: args.id,
        bankAccountId: args.bankAccountId,
        countedAt: args.countedAt,
        accountingDate,
        countedBy: args.countedBy,
        bookBalance: minorText(book, scale),
        actualBalance: minorText(actual, scale),
        difference: minorText(difference, scale),
        state: difference === 0n ? 'balanced' : 'difference',
        differenceAccountId: null,
        moveId: null,
        approvedBy: null,
        approvedAt: null,
      }
      const inserted = await ctx.db.insertIfAbsent('account.CashCount', row)
      return { ok: true, duplicate: !('dryRun' in inserted) && !inserted.inserted, ...row }
    },
  }),
  approveCashCountDifference: defineFn({
    input: { id: 'id', moveId: 'id', differenceAccountId: 'id', approvedBy: 'text' },
    effects: [
      'read:account.CashCount',
      'read:account.BankAccount',
      'read:account.Account',
      'read:account.Journal',
      'read:account.Move',
      'read:account.MoveLine',
      'read:company.Company',
      'write:account.CashCount',
      'write:account.Move',
      'write:account.MoveLine',
    ],
    idempotent: true,
    handler: async (ctx, args) => {
      const count = (await ctx.db.select('account.CashCount', { id: args.id }))[0]
      if (!count) return failure('id', 'cashCountMissing', 'cash count does not exist')
      if (count.moveId) return { ok: true, id: args.id, moveId: count.moveId, duplicate: true }
      const bank = (await ctx.db.select('account.BankAccount', { id: count.bankAccountId }))[0]
      const { scale } = await ledgerOf(ctx)
      const difference = moneyMinor(count.difference, scale)
      if (difference === 0n)
        return failure('id', 'cashCountBalanced', 'a balanced count needs no difference entry')
      let result = await callCore('createMove', ctx, {
        id: args.moveId,
        journalId: bank?.journalId,
        moveType: 'entry',
        accountingDate: count.accountingDate,
        documentDate: count.accountingDate,
        ref: `cash-count:${String(count.id)}`,
      })
      if (result.ok !== true) return result
      result = await callCore('addMoveLine', ctx, {
        id: `${String(args.moveId)}:cash`,
        moveId: args.moveId,
        name: 'Cash count difference',
        accountId: bank?.liquidityAccountId,
        ...(difference > 0n
          ? { debit: minorText(difference, scale) }
          : { credit: minorText(-difference, scale) }),
      })
      if (result.ok !== true) return result
      result = await callCore('addMoveLine', ctx, {
        id: `${String(args.moveId)}:difference`,
        moveId: args.moveId,
        name: 'Cash count difference',
        accountId: args.differenceAccountId,
        ...(difference > 0n
          ? { credit: minorText(difference, scale) }
          : { debit: minorText(-difference, scale) }),
      })
      if (result.ok !== true) return result
      await ctx.db.update(
        'account.CashCount',
        { id: args.id },
        {
          state: 'approved',
          differenceAccountId: args.differenceAccountId,
          moveId: args.moveId,
          approvedBy: args.approvedBy,
          approvedAt: now(),
        },
      )
      return { ok: true, id: args.id, moveId: args.moveId, state: 'approved', posted: false }
    },
  }),
  saveFollowUpPolicy: defineFn({
    input: {
      id: 'id',
      name: 'text',
      levels: 'json',
      quietHours: 'json?',
      rateLimit: 'int?',
      active: 'bool?',
    },
    effects: ['read:account.FollowUpPolicy', 'write:account.FollowUpPolicy'],
    idempotent: true,
    handler: async (ctx, args) => {
      const values = {
        ...args,
        quietHours: args.quietHours ?? null,
        rateLimit: args.rateLimit ?? 1,
        active: args.active ?? true,
      }
      const existing = (await ctx.db.select('account.FollowUpPolicy', { id: args.id }))[0]
      if (existing) await ctx.db.update('account.FollowUpPolicy', { id: args.id }, values)
      else await ctx.db.insert('account.FollowUpPolicy', values)
      return { ok: true, id: args.id }
    },
  }),
  saveFollowUpCase: defineFn({
    input: {
      id: 'id',
      partnerId: 'id',
      ownerId: 'text?',
      state: 'text?',
      promiseDate: 'date?',
      promiseAmount: 'decimal?',
      disputeReason: 'text?',
      nextActionAt: 'datetime?',
      snapshot: 'json',
    },
    effects: ['read:partner.Partner', 'read:account.FollowUpCase', 'write:account.FollowUpCase'],
    idempotent: true,
    handler: async (ctx, args) => {
      if (!(await ctx.db.select('partner.Partner', { id: args.partnerId }))[0])
        return failure('partnerId', 'partnerMissing', 'partner does not exist')
      const values = {
        ...args,
        ownerId: args.ownerId ?? null,
        state: args.state ?? 'open',
        promiseDate: args.promiseDate ?? null,
        promiseAmount: args.promiseAmount ?? null,
        disputeReason: args.disputeReason ?? null,
        nextActionAt: args.nextActionAt ?? null,
        updatedAt: now(),
      }
      const existing = (await ctx.db.select('account.FollowUpCase', { id: args.id }))[0]
      if (existing) await ctx.db.update('account.FollowUpCase', { id: args.id }, values)
      else await ctx.db.insert('account.FollowUpCase', values)
      return { ok: true, id: args.id }
    },
  }),
  queueFollowUpMessage: defineFn({
    input: {
      id: 'id',
      caseId: 'id',
      channel: 'text',
      templateKey: 'text',
      templateVersion: 'text',
      idempotencyKey: 'text',
      consent: 'bool',
      scheduledAt: 'datetime',
    },
    effects: ['read:account.FollowUpCase', 'read:account.FollowUpMessage', 'write:account.FollowUpMessage'],
    idempotent: true,
    handler: async (ctx, args) => {
      if (args.consent !== true)
        return failure('consent', 'followUpConsentRequired', 'follow-up delivery requires consent')
      const held = (
        await ctx.db.select('account.FollowUpMessage', { idempotencyKey: args.idempotencyKey })
      )[0]
      if (held) return { ok: true, id: held.id, duplicate: true }
      const followUp = (await ctx.db.select('account.FollowUpCase', { id: args.caseId }))[0]
      if (!followUp) return failure('caseId', 'followUpCaseMissing', 'follow-up case does not exist')
      const row = {
        id: args.id,
        caseId: args.caseId,
        channel: args.channel,
        templateKey: args.templateKey,
        templateVersion: args.templateVersion,
        idempotencyKey: args.idempotencyKey,
        consent: true,
        snapshot: followUp.snapshot,
        state: 'queued',
        scheduledAt: args.scheduledAt,
        sentAt: null,
        providerMessageId: null,
        lastError: null,
      }
      const inserted = await ctx.db.insertIfAbsent('account.FollowUpMessage', row)
      return { ok: true, id: args.id, duplicate: !('dryRun' in inserted) && !inserted.inserted }
    },
  }),
  recordFollowUpDelivery: defineFn({
    input: { id: 'id', state: 'text', providerMessageId: 'text?', error: 'text?' },
    effects: ['read:account.FollowUpMessage', 'write:account.FollowUpMessage'],
    idempotent: true,
    handler: async (ctx, args) => {
      const message = (await ctx.db.select('account.FollowUpMessage', { id: args.id }))[0]
      if (!message) return failure('id', 'followUpMessageMissing', 'follow-up message does not exist')
      if (message.state === 'sent') return { ok: true, id: args.id, duplicate: true }
      if (!['sent', 'failed', 'cancelled'].includes(String(args.state)))
        return failure('state', 'followUpStateInvalid', 'unsupported delivery state')
      await ctx.db.update(
        'account.FollowUpMessage',
        { id: args.id },
        {
          state: args.state,
          providerMessageId: args.providerMessageId ?? null,
          sentAt: args.state === 'sent' ? now() : null,
          lastError: args.error ?? null,
        },
      )
      return { ok: true, id: args.id, duplicate: false }
    },
  }),
}
