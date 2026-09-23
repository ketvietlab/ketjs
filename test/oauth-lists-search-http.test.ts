// The search-filter bar over the sign-in provider lists.
//
// Providers and linked identities are complete collections the routes already
// hold, so what is worth proving over real HTTP is that the bar's URL narrows
// them, that an archived provider stays out of the way until asked for, and that
// a favourite survives a round trip.
import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

const PROVIDERS = '/admin/oauth/providers'

const provider = (id: string, code: string, name: string, issuer: string) => ({
  id,
  code,
  name,
  protocol: 'oidc',
  issuer,
  clientId: 'ket-client',
  clientAuthMethod: 'none',
  scopes: 'openid profile email',
  redirectUri: `https://ket.test/auth/oauth/${code}/callback`,
  allowedAlgorithms: 'RS256',
  allowLinking: true,
  autoProvision: true,
  requireVerifiedEmail: true,
  defaultCompanyId: 'acme',
  active: true,
})

const boot = async (t: TestContext) => {
  const app = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => app.close())
  const scope = { company: 'acme', branch: 'root:acme', branches: ['root:acme'] }
  const fixture = (name: string, input: Record<string, unknown>) =>
    app.fixture.call<Row>(name, input, { scope })
  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await app.client.login({ login: 'admin', password: 'correct horse' })
  await fixture('oauth.saveProvider', provider('one', 'okta', 'Okta Mẫu', 'https://okta.test'))
  await fixture('oauth.saveProvider', provider('two', 'entra', 'Entra Mẫu', 'https://entra.test'))
  return app
}

test('oauth providers HTTP: the bar narrows the list and keeps archived out of the way', async (t) => {
  const app = await boot(t)

  const all = await app.client.get(`${PROVIDERS}?lang=vi`)
  const allHtml = await all.text()
  assert.equal(all.status, 200)
  assert.match(allHtml, /data-island="backend\.search-filter"/)
  assert.match(allHtml, /Okta Mẫu/u)
  assert.match(allHtml, /Entra Mẫu/u)

  const searched = await (await app.client.get(`${PROVIDERS}?lang=vi&q=entra`)).text()
  assert.match(searched, /Entra Mẫu/u)
  assert.doesNotMatch(searched, /Okta Mẫu/u)

  await app.client.call('oauth.archiveProvider', { id: 'two', active: false })
  const active = await (await app.client.get(`${PROVIDERS}?lang=vi`)).text()
  assert.doesNotMatch(active, /Entra Mẫu/u)
  const archived = await (await app.client.get(`${PROVIDERS}?lang=vi&archived=1`)).text()
  assert.match(archived, /Entra Mẫu/u)
})

test('oauth identities HTTP: the list carries the bar and groups by provider', async (t) => {
  const app = await boot(t)
  const response = await app.client.get('/admin/oauth/identities?lang=vi&group=provider')
  const html = await response.text()
  assert.equal(response.status, 200)
  assert.match(html, /data-island="backend\.search-filter"/)
})

test('oauth lists HTTP: the bar applies and saves searches through the shared functions', async (t) => {
  const app = await boot(t)
  const returnTo = `${PROVIDERS}?lang=vi`

  const applied = await app.client.call<{ href: string }>('oauth_backend.applySearchFilter', {
    listKey: 'oauth.providers',
    returnTo,
    query: 'okta',
    facets: [{ id: 'preset:autoProvision', type: 'filter', label: 'Auto' }],
    groupBy: ['autoProvision'],
    customFilters: [],
  })
  const href = new URL(applied.value.href, 'http://ket.local')
  assert.equal(href.pathname, PROVIDERS)
  assert.equal(href.searchParams.get('q'), 'okta')
  assert.deepEqual(href.searchParams.getAll('preset'), ['autoProvision'])
  assert.deepEqual(href.searchParams.getAll('group'), ['autoProvision'])

  const favorite = await app.client.call<{ id: string }>('oauth_backend.saveSearchFavorite', {
    name: 'Nhà cung cấp tự tạo tài khoản',
    isDefault: true,
    state: {
      listKey: 'oauth.providers',
      returnTo,
      facets: [{ id: 'preset:autoProvision', type: 'filter', label: 'Auto' }],
      groupBy: [],
      customFilters: [],
    },
  })
  assert.match(await (await app.client.get(returnTo)).text(), /Nhà cung cấp tự tạo tài khoản/)
  await app.client.call('oauth_backend.deleteSearchFavorite', {
    listKey: 'oauth.providers',
    id: favorite.value.id,
  })
  assert.doesNotMatch(await (await app.client.get(returnTo)).text(), /Nhà cung cấp tự tạo tài khoản/)
})
