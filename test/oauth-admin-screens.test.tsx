import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  identitiesScreen,
  identityFormScreen,
  linkProviderScreen,
  providerFormScreen,
  providersScreen,
} from '../packages/ketsuite/src/modules/oauth_backend/screens/index.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const provider = {
  id: 'provider/a',
  code: 'company',
  name: 'Company SSO',
  protocol: 'oidc',
  issuer: 'https://identity.example.com',
  clientId: 'ket',
  clientAuthMethod: 'none',
  scopes: 'openid profile email',
  redirectUri: 'https://ket.example.com/auth/oauth/company/callback',
  allowedAlgorithms: 'RS256',
  allowLinking: true,
  autoProvision: false,
  requireVerifiedEmail: true,
  sequence: 10,
  active: true,
}

test('OAuth collections use ListPage and forms use FormPage', () => {
  const providers = renderToString(providersScreen(translate, [provider], {}, '?lang=en'))
  const providerForm = renderToString(
    providerFormScreen(translate, provider, { companies: [], roles: [] }, {}, '?lang=en'),
  )
  const identities = renderToString(identitiesScreen(translate, [], {}, '?lang=en'))
  const identityForm = renderToString(
    identityFormScreen(translate, {}, { providers: [], users: [] }, {}, '?lang=en'),
  )
  const chooser = renderToString(
    linkProviderScreen(
      translate,
      [{ id: provider.id, code: provider.code, name: provider.name, sequence: 10 }],
      [],
      {},
      '?lang=en',
    ),
  )

  assert.match(providers, /data-ui="list-page"/)
  assert.match(providers, /href="\/admin\/oauth\/providers\/provider\/a\?lang=en"/)
  assert.match(providerForm, /data-ui="form-page"/)
  assert.match(providerForm, /action="\/admin\/oauth\/providers\/provider\/a\?lang=en"/)
  assert.match(identities, /data-ui="list-page"/)
  assert.match(identityForm, /data-ui="form-page"/)
  assert.match(chooser, /data-ui="form-page"/)
  assert.match(chooser, /\/auth\/oauth\/company\/start\?mode=link&amp;next=%2Fadmin%2Fprofile&amp;lang=en/)
})
