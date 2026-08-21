import { defineFn, eq, from } from '@ketvietlab/ketjs'
import type { Ctx, FnSpec } from '@ketvietlab/ketjs'

const missing = (field: string, code: string) => ({ ok: false, errors: [{ field, code }] })

export const functions: Record<string, FnSpec> = {
  saveAccountingTerms: defineFn({
    input: {
      id: 'id',
      partnerId: 'id',
      paymentTermId: 'id?',
      receivableAccountId: 'id?',
      payableAccountId: 'id?',
    },
    output: { ok: 'bool', id: 'id?', errors: 'json?' },
    effects: [
      'read:partner.Partner',
      'read:partner.CompanyTerms',
      'write:partner.CompanyTerms',
      'read:account.PaymentTerm',
      'read:account.Account',
    ],
    idempotent: true,
    handler: async (ctx: Ctx, a) => {
      const P = ctx.table('partner.Partner')
      if (!(await ctx.db.one(from(P).where(eq(P.id, a.partnerId)))))
        return missing('partnerId', 'account_partner.error.partnerMissing')
      if (a.paymentTermId) {
        const T = ctx.table('account.PaymentTerm')
        if (!(await ctx.db.one(from(T).where(eq(T.id, a.paymentTermId)))))
          return missing('paymentTermId', 'account_partner.error.paymentTermMissing')
      }
      const A = ctx.table('account.Account')
      for (const [field, accountType] of [
        ['receivableAccountId', 'asset_receivable'],
        ['payableAccountId', 'liability_payable'],
      ] as const) {
        if (!a[field]) continue
        const account = await ctx.db.one(from(A).where(eq(A.id, a[field])))
        if (!account) return missing(field, 'account_partner.error.accountMissing')
        if (account.accountType !== accountType) return missing(field, 'account_partner.error.accountType')
      }

      return ctx.tx(async (tx) => {
        const T = tx.table('partner.CompanyTerms')
        const existing = await tx.db.one(from(T).where(eq(T.partnerId, a.partnerId)))
        const patch = {
          paymentTermId: a.paymentTermId ?? null,
          receivableAccountId: a.receivableAccountId ?? null,
          payableAccountId: a.payableAccountId ?? null,
        }
        if (existing) {
          await tx.db.update('partner.CompanyTerms', { id: existing.id }, patch)
          return { ok: true, id: existing.id }
        }
        const inserted = await tx.db.insertIfAbsent('partner.CompanyTerms', {
          id: a.id,
          partnerId: a.partnerId,
          ...patch,
        })
        if ('dryRun' in inserted || inserted.inserted) return { ok: true, id: a.id }
        const held = await tx.db.one(from(T).where(eq(T.partnerId, a.partnerId)))
        if (held) await tx.db.update('partner.CompanyTerms', { id: held.id }, patch)
        return { ok: true, id: held?.id ?? a.id }
      })
    },
  }),

  getAccountingTerms: defineFn({
    input: { partnerId: 'id' },
    output: {
      id: 'id',
      partnerId: 'id',
      paymentTermId: 'id?',
      receivableAccountId: 'id?',
      payableAccountId: 'id?',
    },
    effects: ['read:partner.CompanyTerms'],
    handler: async (ctx: Ctx, a) => {
      const T = ctx.table('partner.CompanyTerms')
      return ctx.db.one(from(T).where(eq(T.partnerId, a.partnerId)))
    },
  }),
}
