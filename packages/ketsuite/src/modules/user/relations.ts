import type { RelationDef } from 'ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'user.User': {
    partner: { belongsTo: 'partner.Partner', by: 'partnerId' },
    memberships: { hasMany: 'user.Membership', by: 'userId' },
  },
  'user.Membership': {
    user: { belongsTo: 'user.User', by: 'userId' },
  },
}
