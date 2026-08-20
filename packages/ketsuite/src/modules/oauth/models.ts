import type { ModelDef } from 'ketjs'

/** Provider configuration is vendor-neutral. ZITADEL is one OIDC issuer, not a schema choice. */
export const models: Record<string, ModelDef> = {
  Provider: {
    scope: 'shared',
    fields: {
      id: 'id',
      code: 'text',
      name: 'text',
      protocol: 'text',
      issuer: 'text',
      clientId: 'text',
      clientAuthMethod: 'text',
      /** Name of an environment variable. The secret itself never enters a Ket row or function output. */
      clientSecretEnv: 'text?',
      scopes: 'text',
      redirectUri: 'text',
      allowedAlgorithms: 'text',
      allowLinking: 'bool',
      autoProvision: 'bool',
      requireVerifiedEmail: 'bool',
      defaultCompanyId: 'ref:company.Company?',
      defaultRoleId: 'ref:user.Role?',
      sequence: 'int',
      active: 'bool',
      createdAt: 'datetime',
      updatedAt: 'datetime',
    },
    indexes: {
      code: { fields: ['code'], unique: true },
      issuer_client: { fields: ['issuer', 'clientId'], unique: true },
    },
  },

  /** A verified issuer subject maps to a local User. Email is profile data, never the identity key. */
  ExternalIdentity: {
    scope: 'shared',
    fields: {
      id: 'id',
      providerId: 'ref:oauth.Provider',
      userId: 'ref:user.User',
      issuer: 'text',
      subject: 'text',
      email: 'text?',
      displayName: 'text?',
      preferredUsername: 'text?',
      lastLoginAt: 'datetime?',
      createdAt: 'datetime',
      updatedAt: 'datetime',
    },
    indexes: {
      provider_subject: { fields: ['providerId', 'issuer', 'subject'], unique: true },
    },
  },

  /**
   * Short-lived server-side state for Authorization Code + PKCE.
   *
   * State and nonce are digest-only. The verifier must be recoverable for the token
   * exchange, so it is stored for ten minutes and is never exposed over generic HTTP.
   */
  Transaction: {
    scope: 'shared',
    fields: {
      id: 'id',
      stateDigest: 'text',
      providerId: 'ref:oauth.Provider',
      mode: 'text',
      linkUserId: 'ref:user.User?',
      issuer: 'text',
      redirectUri: 'text',
      nonceDigest: 'text',
      codeVerifier: 'text',
      discovery: 'json',
      returnTo: 'text',
      providerUpdatedAt: 'datetime',
      expiresAt: 'datetime',
      consumedAt: 'datetime?',
      createdAt: 'datetime',
    },
    indexes: {
      state: { fields: ['stateDigest'], unique: true },
    },
  },
}
