import type { Ctx, Row } from '@ketvietlab/ketjs'
import { DEFAULT_ACCOUNTING_TIMEZONE } from './date.ts'
import { MONEY_POLICY_VERSION } from './money.ts'

export const ACCOUNT_CORE_STANDARD = 'custom'
export const ACCOUNT_CORE_CHECKSUM = 'account-core-v1'

export const ACCOUNT_SETUP_EFFECTS = [
  'read:company.Company',
  'read:account.Setup',
  'write:company.Company',
  'write:account.Setup',
] as const

const setupId = (company: string): string => `account-setup:${company}`
const COMPANY_CHANGED_DURING_SETUP = 'account.error.companyConcurrent'
const COMPANY_LOCK_ATTEMPTS = 4

/** Initialize jurisdiction-neutral ledger invariants, never a national chart. */
async function initializeCompanyAccountingOnce(ctx: Ctx): Promise<Row> {
  const companyId = String(ctx.scope.company ?? '')
  if (!companyId) throw new Error('account.error.companyRequired')
  return ctx.tx(async (tx) => {
    const company = (await tx.db.select('company.Company', { id: companyId }))[0]
    if (!company) throw new Error('account.error.companyMissing')
    const timezone = String(company.accountingTimezone ?? DEFAULT_ACCOUNTING_TIMEZONE)
    if (company.currencyLocked !== true || !company.accountingTimezone) {
      const version = Number(company.version ?? 0)
      const changed = await tx.db.compareAndSet(
        'company.Company',
        { id: company.id },
        { version: company.version ?? null },
        { currencyLocked: true, accountingTimezone: timezone, version: version + 1 },
      )
      if (!('dryRun' in changed) && !changed.matched) throw new Error(COMPANY_CHANGED_DURING_SETUP)
    }
    const current = (await tx.db.select('account.Setup'))[0]
    if (!current) {
      const row = {
        id: setupId(companyId),
        countryCode: 'XX',
        standard: ACCOUNT_CORE_STANDARD,
        legalBasis: 'custom',
        sourceChecksum: ACCOUNT_CORE_CHECKSUM,
        accountingTimezone: timezone,
        moneyPolicyVersion: MONEY_POLICY_VERSION,
        installedAt: new Date().toISOString(),
      }
      await tx.db.insert('account.Setup', row)
      return row
    }
    if (current.accountingTimezone !== timezone || current.moneyPolicyVersion !== MONEY_POLICY_VERSION)
      await tx.db.update(
        'account.Setup',
        { id: current.id },
        { accountingTimezone: timezone, moneyPolicyVersion: MONEY_POLICY_VERSION },
      )
    return { ...current, accountingTimezone: timezone, moneyPolicyVersion: MONEY_POLICY_VERSION }
  })
}

export async function ensureCompanyAccounting(ctx: Ctx): Promise<Row> {
  let lastConflict: Error | null = null
  for (let attempt = 0; attempt < COMPANY_LOCK_ATTEMPTS; attempt += 1) {
    try {
      return await initializeCompanyAccountingOnce(ctx)
    } catch (error) {
      if (!(error instanceof Error) || error.message !== COMPANY_CHANGED_DURING_SETUP) throw error
      lastConflict = error
    }
  }
  throw lastConflict ?? new Error(COMPANY_CHANGED_DURING_SETUP)
}
