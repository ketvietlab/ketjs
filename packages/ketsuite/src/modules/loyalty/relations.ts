import type { RelationDef } from '@ketvietlab/ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'loyalty.Program': {
    rules: { hasMany: 'loyalty.Rule', by: 'programId' },
    rewards: { hasMany: 'loyalty.Reward', by: 'programId' },
    wallets: { hasMany: 'loyalty.Wallet', by: 'programId' },
  },
  'loyalty.Rule': { program: { belongsTo: 'loyalty.Program', by: 'programId' } },
  'loyalty.Reward': { program: { belongsTo: 'loyalty.Program', by: 'programId' } },
  'loyalty.Wallet': {
    program: { belongsTo: 'loyalty.Program', by: 'programId' },
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
    ledger: { hasMany: 'loyalty.LedgerEntry', by: 'walletId' },
  },
  'loyalty.Membership': {
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
    tier: { belongsTo: 'loyalty.Tier', by: 'tierId' },
  },
}
