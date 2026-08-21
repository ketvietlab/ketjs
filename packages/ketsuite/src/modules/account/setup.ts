import { eq, from } from 'ketjs'
import type { Ctx, Row } from 'ketjs'
import {
  TT99_ACCOUNT_CHECKSUM,
  TT99_ACCOUNTS,
  TT99_CODE,
  TT99_COUNTRY,
  TT99_LEGAL_BASIS,
  VIETNAM_TAXES,
} from './tt99.ts'

export const ACCOUNT_SETUP_EFFECTS = [
  'read:company.Company',
  'read:partner.Address',
  'read:account.Setup',
  'read:account.Account',
  'read:account.Tax',
  'read:account.Journal',
  'read:account.PaymentTerm',
  'read:account.PaymentTermLine',
  'write:account.Setup',
  'write:account.Account',
  'write:account.Tax',
  'write:account.Journal',
  'write:account.PaymentTerm',
  'write:account.PaymentTermLine',
] as const

const accountId = (company: string, code: string): string => `account:${company}:tt99:${code}`
const taxId = (company: string, key: string): string => `tax:${company}:vn:${key}`
const journalId = (company: string, key: string): string => `journal:${company}:${key}`
const termId = (company: string, key: string): string => `term:${company}:${key}`
const setupId = (company: string): string => `account-setup:${company}`

const countryFor = async (ctx: Ctx, company: Row): Promise<string | null> => {
  const addresses = await ctx.db.select('partner.Address', { partnerId: company.partnerId })
  const legal =
    addresses.find((row) => row.use === 'invoice') ?? addresses.find((row) => row.use === 'contact')
  if (legal?.countryCode) return String(legal.countryCode).trim().toUpperCase()
  // KetSuite currently ships only the Vietnam accounting data pack. VND is a
  // deterministic fallback for provisioned companies that do not yet have an address.
  return String(company.currency).toUpperCase() === 'VND' ? TT99_COUNTRY : null
}

const put = async (ctx: Ctx, model: string, values: Row): Promise<void> => {
  await ctx.db.insertIfAbsent(model, values)
}

const installing = new Map<string, Promise<void>>()

async function installCompanyAccounting(ctx: Ctx): Promise<Row> {
  const companyId = String(ctx.scope.company ?? '')
  if (!companyId) throw new Error('account.error.companyRequired')
  const S = ctx.table('account.Setup')
  const current = await ctx.db.one(from(S).where(eq(S.companyId, companyId)))
  if (current) return current

  const company = (await ctx.db.select('company.Company', { id: companyId }))[0]
  if (!company) throw new Error('account.error.companyMissing')
  const countryCode = await countryFor(ctx, company)
  if (countryCode !== TT99_COUNTRY) throw new Error('account.error.countryUnsupported')

  return ctx.tx(async (tx) => {
    const existingSetup = await tx.db.one(
      from(tx.table('account.Setup')).where(eq(tx.table('account.Setup').companyId, companyId)),
    )
    if (existingSetup) return existingSetup

    const existingAccounts = await tx.db.select('account.Account')
    const byCode = new Map(existingAccounts.map((row) => [String(row.code), row]))
    for (const account of TT99_ACCOUNTS) {
      if (byCode.has(account.code)) continue
      await put(tx, 'account.Account', {
        id: accountId(companyId, account.code),
        code: account.code,
        name: account.name,
        accountType: account.accountType,
        reconcile: account.reconcile,
        active: true,
      })
    }

    const accounts = await tx.db.select('account.Account')
    const ids = new Map(accounts.map((row) => [String(row.code), String(row.id)]))
    const required = (code: string): string => {
      const id = ids.get(code)
      if (!id) throw new Error(`account.error.defaultMissing:${code}`)
      return id
    }

    for (const tax of VIETNAM_TAXES)
      await put(tx, 'account.Tax', {
        id: taxId(companyId, tax.key),
        name: tax.name,
        description: tax.description,
        typeTaxUse: tax.use,
        taxScope: null,
        amountType: 'percent',
        amount: tax.amount,
        priceInclude: false,
        includeBaseAmount: tax.includeBaseAmount === true,
        accountId: tax.accountCode ? required(tax.accountCode) : null,
        sequence: 10,
        active: true,
      })

    for (const journal of [
      { key: 'sale', name: 'Bán hàng', code: 'SAL', type: 'sale' },
      { key: 'purchase', name: 'Mua hàng', code: 'PUR', type: 'purchase' },
      { key: 'bank', name: 'Ngân hàng', code: 'BNK', type: 'bank', account: '112' },
      { key: 'cash', name: 'Tiền mặt', code: 'CSH', type: 'cash', account: '111' },
      { key: 'general', name: 'Nghiệp vụ khác', code: 'MISC', type: 'general' },
    ])
      await put(tx, 'account.Journal', {
        id: journalId(companyId, journal.key),
        name: journal.name,
        code: journal.code,
        type: journal.type,
        defaultAccountId: journal.account ? required(journal.account) : null,
        sequenceNumber: 0,
        active: true,
      })

    const immediate = termId(companyId, 'immediate')
    const net30 = termId(companyId, 'net30')
    await put(tx, 'account.PaymentTerm', { id: immediate, name: 'Thanh toán ngay', note: null, active: true })
    await put(tx, 'account.PaymentTermLine', {
      id: `${immediate}:line`,
      paymentId: immediate,
      value: 'percent',
      valueAmount: '100',
      delayType: 'days_after',
      nbDays: 0,
      daysNextMonth: null,
      sequence: 10,
    })
    await put(tx, 'account.PaymentTerm', { id: net30, name: '30 ngày', note: null, active: true })
    await put(tx, 'account.PaymentTermLine', {
      id: `${net30}:line`,
      paymentId: net30,
      value: 'percent',
      valueAmount: '100',
      delayType: 'days_after',
      nbDays: 30,
      daysNextMonth: null,
      sequence: 10,
    })

    const installedAt = new Date().toISOString()
    await put(tx, 'account.Setup', {
      id: setupId(companyId),
      countryCode,
      standard: TT99_CODE,
      legalBasis: TT99_LEGAL_BASIS,
      sourceChecksum: TT99_ACCOUNT_CHECKSUM,
      installedAt,
    })
    return (await tx.db.select('account.Setup', { id: setupId(companyId) }))[0]!
  })
}

export async function ensureCompanyAccounting(ctx: Ctx): Promise<Row> {
  const companyId = String(ctx.scope.company ?? '')
  if (!companyId) throw new Error('account.error.companyRequired')
  const current = (await ctx.db.select('account.Setup'))[0]
  if (current) return current

  const active = installing.get(companyId)
  if (active) {
    await active
    const completed = (await ctx.db.select('account.Setup'))[0]
    if (completed) return completed
  }

  const task = installCompanyAccounting(ctx).then(() => undefined)
  installing.set(companyId, task)
  try {
    await task
  } finally {
    if (installing.get(companyId) === task) installing.delete(companyId)
  }
  const completed = (await ctx.db.select('account.Setup'))[0]
  if (!completed) throw new Error('account.error.setupIncomplete')
  return completed
}
