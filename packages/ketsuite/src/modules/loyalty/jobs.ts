import { defineFn, defineJob } from 'ketjs'
import type { FnSpec, JobContext, JobSpec } from 'ketjs'
import { n, now } from './engine.ts'
import { postDelta, release } from './ledger.ts'
import { refreshMembershipRow } from './membership-functions.ts'

export const jobs: Record<string, JobSpec> = {
  expireWallets: defineJob({
    queue: 'maintenance',
    input: { at: 'datetime?' },
    effects: [
      'read:loyalty.Wallet',
      'write:loyalty.Wallet',
      'read:loyalty.LedgerEntry',
      'write:loyalty.LedgerEntry',
      'read:loyalty.Reservation',
      'write:loyalty.Reservation',
    ],
    idempotent: true,
    handler: async (ctx: JobContext, args) => {
      const at = new Date(String(args.at ?? now())).getTime()
      for (const wallet of await ctx.db.select('loyalty.Wallet', { active: true })) {
        if (ctx.signal.aborted) throw ctx.signal.reason
        if (!wallet.expiresAt || new Date(String(wallet.expiresAt)).getTime() > at) continue
        await ctx.tx(async (tx) => {
          for (const reservation of await tx.db.select('loyalty.Reservation', {
            walletId: wallet.id,
            state: 'reserved',
          }))
            await release(tx, reservation)
          const current = (await tx.db.select('loyalty.Wallet', { id: wallet.id }))[0]!
          if (n(current.balance))
            await postDelta(tx, {
              id: `${String(wallet.id)}:expire`,
              walletId: String(wallet.id),
              operation: 'expire',
              amount: Math.abs(n(current.balance)),
              balanceDelta: -n(current.balance),
              sourceType: 'wallet',
              sourceId: String(wallet.id),
              sourceOperation: 'expire',
              sourceKey: `wallet:${String(wallet.id)}:expire`,
              descriptionCode: 'loyalty.ledger.description.expire',
              allowNegative: true,
            })
          await tx.db.update('loyalty.Wallet', { id: wallet.id }, { active: false })
        })
      }
    },
  }),

  refreshMembership: defineJob({
    queue: 'maintenance',
    input: { partnerId: 'id?', at: 'datetime?' },
    effects: [
      'read:partner.Partner',
      'read:loyalty.MembershipConfig',
      'read:loyalty.SpendEntry',
      'read:loyalty.Tier',
      'read:loyalty.Wallet',
      'read:loyalty.Membership',
      'write:loyalty.Membership',
    ],
    idempotent: true,
    handler: async (ctx: JobContext, args) => {
      const ids = args.partnerId
        ? [String(args.partnerId)]
        : [...new Set((await ctx.db.select('partner.Partner')).map((partner) => String(partner.id)))]
      for (const id of ids) {
        if (ctx.signal.aborted) throw ctx.signal.reason
        await refreshMembershipRow(ctx, id, args.at ? String(args.at) : now())
      }
    },
  }),
}

export const maintenanceFunctions: Record<string, FnSpec> = {
  'maintenance.expire': defineFn({
    input: { at: 'datetime?', idempotencyKey: 'text' },
    output: { ok: 'bool', jobId: 'id?', duplicate: 'bool?' },
    effects: ['enqueue:loyalty.expireWallets'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const queued = await ctx.jobs.enqueue(
        'loyalty.expireWallets',
        { ...(args.at ? { at: args.at } : {}) },
        { uniqueKey: `loyalty-expire:${String(args.idempotencyKey)}` },
      )
      return { ok: true, jobId: queued.id, duplicate: queued.existing }
    },
  }),

  'membership.refreshAsync': defineFn({
    input: { partnerId: 'id?', at: 'datetime?', idempotencyKey: 'text' },
    output: { ok: 'bool', jobId: 'id?', duplicate: 'bool?' },
    effects: ['enqueue:loyalty.refreshMembership'],
    idempotent: true,
    agent: true,
    handler: async (ctx, args) => {
      const queued = await ctx.jobs.enqueue(
        'loyalty.refreshMembership',
        {
          ...(args.partnerId ? { partnerId: args.partnerId } : {}),
          ...(args.at ? { at: args.at } : {}),
        },
        { uniqueKey: `loyalty-membership:${String(args.partnerId ?? 'all')}:${String(args.idempotencyKey)}` },
      )
      return { ok: true, jobId: queued.id, duplicate: queued.existing }
    },
  }),
}
