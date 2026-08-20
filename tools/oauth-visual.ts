// Repeatable local data for browser review of OAuth providers and external identities.
// The target must be an explicit, new SQLite file; this tool never replaces data.

import { existsSync } from 'node:fs'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from 'ketjs'
import type { Adapter } from 'ketjs'
import { ketsuite } from '../apps/ketsuite/app.ts'

const path = process.env.KET_VISUAL_SQLITE
if (!path) throw new Error('set KET_VISUAL_SQLITE to a new SQLite file')
if (existsSync(path)) throw new Error(`refusing to replace existing visual database: ${path}`)

const modules = [...ketsuite.modules, ...(ketsuite.theme ? [ketsuite.theme] : [])]
const manifest = compose(modules)
const adapter = sqliteAdapter(path)
await adapter.open()
await migrateOne(adapter, manifest)
registerFunctions(modules)

const scope = {
  company: 'default',
  companies: ['default'],
  branch: 'root:default',
  branches: ['root:default'],
}
const call = async (name: string, args: Record<string, unknown>, actor?: string) => {
  const result = await callFn(name, args, { adapter, manifest, scope, actor })
  const value = result.value as { ok?: boolean; errors?: unknown }
  if (value?.ok === false) throw new Error(`${name}: ${JSON.stringify(value.errors)}`)
  return result.value
}

try {
  await call('partner.savePartner', {
    id: 'default:partner',
    kind: 'company',
    name: 'Công ty Cổ phần Kết Việt',
    ref: 'KET',
  })
  await call('company.saveCompany', {
    id: 'default',
    code: 'KET',
    partnerId: 'default:partner',
    currency: 'VND',
  })

  for (const account of [
    {
      id: 'visual-admin',
      login: 'admin',
      name: 'Nguyễn Quản Trị',
      email: 'admin@ketviet.example',
      superuser: true,
    },
    {
      id: 'sales-manager',
      login: 'sales.manager',
      name: 'Lê Thu Hà',
      email: 'thuha@ketviet.example',
      superuser: false,
    },
    {
      id: 'warehouse-user',
      login: 'warehouse.user',
      name: 'Phạm Quang Huy',
      email: 'quanghuy@ketviet.example',
      superuser: false,
    },
  ]) {
    await call('user.createUser', {
      ...account,
      password: 'oauth-demo',
      accessKind: 'internal',
      defaultCompanyId: 'default',
      defaultBranchId: 'root:default',
    })
    await call(
      'user.grantCompany',
      { id: `${account.id}:default`, userId: account.id, companyId: 'default' },
      'visual-admin',
    )
  }

  for (const provider of [
    {
      id: 'provider-ketviet',
      code: 'ketviet',
      name: 'Kết Việt Identity',
      issuer: 'https://identity.ketviet.example',
      clientId: 'ketsuite-production',
      clientAuthMethod: 'client_secret_basic',
      clientSecretEnv: 'KET_OAUTH_KETVIET_SECRET',
      scopes: 'openid profile email',
      redirectUri: 'http://127.0.0.1:3199/auth/oauth/ketviet/callback',
      allowedAlgorithms: 'RS256 PS256',
      allowLinking: true,
      autoProvision: true,
      requireVerifiedEmail: true,
      defaultCompanyId: 'default',
      sequence: 10,
      active: true,
    },
    {
      id: 'provider-partner',
      code: 'partner',
      name: 'Partner Keycloak',
      issuer: 'https://sso.partner.example',
      clientId: 'ketsuite-partner',
      clientAuthMethod: 'none',
      scopes: 'openid profile email',
      redirectUri: 'http://127.0.0.1:3199/auth/oauth/partner/callback',
      allowedAlgorithms: 'RS256',
      allowLinking: true,
      autoProvision: false,
      requireVerifiedEmail: true,
      sequence: 20,
      active: true,
    },
    {
      id: 'provider-legacy',
      code: 'legacy',
      name: 'Legacy SSO',
      issuer: 'https://legacy.identity.example',
      clientId: 'legacy-client',
      clientAuthMethod: 'none',
      scopes: 'openid email',
      redirectUri: 'http://127.0.0.1:3199/auth/oauth/legacy/callback',
      allowedAlgorithms: 'RS256',
      allowLinking: false,
      autoProvision: false,
      requireVerifiedEmail: true,
      sequence: 90,
      active: false,
    },
  ])
    await call('oauth.saveProvider', { protocol: 'oidc', ...provider }, 'visual-admin')

  for (const identity of [
    {
      id: 'identity-admin',
      providerId: 'provider-ketviet',
      userId: 'visual-admin',
      subject: '00u-admin-9842',
      email: 'admin@ketviet.example',
      displayName: 'Nguyễn Quản Trị',
      preferredUsername: 'admin',
    },
    {
      id: 'identity-sales',
      providerId: 'provider-ketviet',
      userId: 'sales-manager',
      subject: '00u-sales-7215',
      email: 'thuha@ketviet.example',
      displayName: 'Lê Thu Hà',
      preferredUsername: 'sales.manager',
    },
    {
      id: 'identity-warehouse',
      providerId: 'provider-partner',
      userId: 'warehouse-user',
      subject: '9f8c04d1-warehouse',
      email: 'quanghuy@ketviet.example',
      displayName: 'Phạm Quang Huy',
      preferredUsername: 'warehouse.user',
    },
  ])
    await call('oauth.linkIdentity', identity, 'visual-admin')

  console.log(`OAuth visual database ready: ${path}`)
  console.log('sign in with admin / oauth-demo')
} finally {
  await (adapter as Adapter).close()
}
