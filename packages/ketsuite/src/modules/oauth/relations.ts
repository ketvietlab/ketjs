import type { RelationDef } from 'ketjs'

export const relations: Record<string, Record<string, RelationDef>> = {
  'oauth.Provider': {
    identities: { hasMany: 'oauth.ExternalIdentity', by: 'providerId' },
    transactions: { hasMany: 'oauth.Transaction', by: 'providerId' },
  },
  'oauth.ExternalIdentity': {
    provider: { belongsTo: 'oauth.Provider', by: 'providerId' },
    user: { belongsTo: 'user.User', by: 'userId' },
  },
  'oauth.Transaction': {
    provider: { belongsTo: 'oauth.Provider', by: 'providerId' },
    linkUser: { belongsTo: 'user.User', by: 'linkUserId' },
  },
  'user.User': {
    externalIdentities: { hasMany: 'oauth.ExternalIdentity', by: 'userId' },
  },
}
