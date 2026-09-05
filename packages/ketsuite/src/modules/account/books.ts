import { defineFn } from '@ketvietlab/ketjs'
import type { FnSpec, Row } from '@ketvietlab/ketjs'
import { ledgerOf } from './functions.ts'
import { minorText, moneyMinor } from './money.ts'

export const ACCOUNT_BOOKS = [
  'general_journal',
  'general_ledger',
  'account_detail',
  'cash',
  'bank',
  'partner',
] as const

const issue = (field: string, code: string, message: string) => ({
  field,
  code: `account.error.${code}`,
  message,
})

export const bookFunctions: Record<string, FnSpec> = {
  accountingBook: defineFn({
    input: {
      book: 'text',
      dateFrom: 'date',
      dateTo: 'date',
      accountId: 'id?',
      journalId: 'id?',
      partnerId: 'id?',
    },
    output: {
      book: 'text?',
      currency: 'text?',
      dateFrom: 'date?',
      dateTo: 'date?',
      opening: 'decimal?',
      debit: 'decimal?',
      credit: 'decimal?',
      closing: 'decimal?',
      rows: 'json?',
      errors: 'json?',
    },
    effects: [
      'read:company.Company',
      'read:account.Account',
      'read:account.Journal',
      'read:account.Move',
      'read:account.MoveLine',
    ],
    agent: true,
    handler: async (ctx, args) => {
      const book = String(args.book)
      if (!ACCOUNT_BOOKS.includes(book as (typeof ACCOUNT_BOOKS)[number]))
        return { errors: [issue('book', 'accountBookUnsupported', 'unsupported accounting book')] }
      if (String(args.dateFrom) > String(args.dateTo))
        return { errors: [issue('dateTo', 'accountBookPeriod', 'book period end precedes its start')] }
      if (['general_ledger', 'account_detail'].includes(book) && !args.accountId)
        return { errors: [issue('accountId', 'accountBookAccountRequired', 'this book requires an account')] }
      if (book === 'partner' && !args.partnerId)
        return {
          errors: [issue('partnerId', 'accountBookPartnerRequired', 'partner book requires a partner')],
        }

      const { currency, scale } = await ledgerOf(ctx)
      const accounts = new Map(
        (await ctx.db.select('account.Account')).map((account) => [String(account.id), account]),
      )
      const journals = new Map(
        (await ctx.db.select('account.Journal')).map((journal) => [String(journal.id), journal]),
      )
      if (args.accountId && !accounts.has(String(args.accountId)))
        return { errors: [issue('accountId', 'accountMissing', 'account does not exist')] }
      if (args.journalId && !journals.has(String(args.journalId)))
        return { errors: [issue('journalId', 'journalMissing', 'journal does not exist')] }

      const moves = new Map(
        (await ctx.db.select('account.Move'))
          .filter((move) => move.state === 'posted')
          .map((move) => [String(move.id), move]),
      )
      const lines = await ctx.db.select('account.MoveLine')
      const accepted = (line: Row): boolean => {
        const move = moves.get(String(line.moveId))
        if (!move) return false
        const account = accounts.get(String(line.accountId))
        const journal = journals.get(String(move.journalId))
        if (!account || !journal) return false
        if (args.accountId && String(line.accountId) !== String(args.accountId)) return false
        if (args.journalId && String(move.journalId) !== String(args.journalId)) return false
        if (args.partnerId && String(line.partnerId ?? '') !== String(args.partnerId)) return false
        if (book === 'cash' && journal.type !== 'cash') return false
        if (book === 'bank' && journal.type !== 'bank') return false
        if (book === 'partner' && account.reconcile !== true) return false
        return true
      }
      let opening = 0n
      let debit = 0n
      let credit = 0n
      const rows: Row[] = []
      for (const line of lines) {
        if (!accepted(line)) continue
        const move = moves.get(String(line.moveId))!
        const date = String(move.accountingDate ?? move.date).slice(0, 10)
        const lineDebit = moneyMinor(line.debit, scale)
        const lineCredit = moneyMinor(line.credit, scale)
        if (date < String(args.dateFrom)) {
          opening += lineDebit - lineCredit
          continue
        }
        if (date > String(args.dateTo)) continue
        debit += lineDebit
        credit += lineCredit
        const account = accounts.get(String(line.accountId))!
        const journal = journals.get(String(move.journalId))!
        rows.push({
          id: line.id,
          moveId: move.id,
          moveName: move.name,
          accountingDate: date,
          documentDate: move.documentDate,
          reference: move.ref,
          journalId: journal.id,
          journalCode: journal.code,
          accountId: account.id,
          accountCode: account.code,
          accountName: account.name,
          partnerId: line.partnerId,
          description: line.name,
          debit: minorText(lineDebit, scale),
          credit: minorText(lineCredit, scale),
          balance: minorText(lineDebit - lineCredit, scale),
          residual: line.amountResidual,
        })
      }
      rows.sort(
        (a, b) =>
          String(a.accountingDate).localeCompare(String(b.accountingDate)) ||
          String(a.moveId).localeCompare(String(b.moveId)) ||
          String(a.id).localeCompare(String(b.id)),
      )
      return {
        book,
        currency,
        dateFrom: args.dateFrom,
        dateTo: args.dateTo,
        opening: minorText(opening, scale),
        debit: minorText(debit, scale),
        credit: minorText(credit, scale),
        closing: minorText(opening + debit - credit, scale),
        rows,
      }
    },
  }),
}
