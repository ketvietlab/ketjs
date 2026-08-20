import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { test } from 'node:test'
import {
  clearOidcCachesForTest,
  discoverOidc,
  exchangeOidcCode,
  oidcAuthorizationUrl,
  OauthProtocolError,
  pkceChallenge,
  verifyOidcIdToken,
} from '../packages/ketsuite/src/modules/oauth/protocol.ts'

const issuer = 'https://identity.example.test'
const discovery = {
  issuer,
  authorizationEndpoint: `${issuer}/oauth/v2/authorize`,
  tokenEndpoint: `${issuer}/oauth/v2/token`,
  jwksUri: `${issuer}/oauth/v2/keys`,
}

const pair = generateKeyPairSync('rsa', { modulusLength: 2048 })
const jwk = { ...pair.publicKey.export({ format: 'jwk' }), kid: 'key-1', use: 'sig', alg: 'RS256' }

const signedJwt = (
  headerValues: Record<string, unknown>,
  claims: Record<string, unknown>,
  key = pair.privateKey,
): string => {
  const header = Buffer.from(JSON.stringify(headerValues)).toString('base64url')
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key).toString('base64url')
  return `${header}.${payload}.${signature}`
}
const jwt = (claims: Record<string, unknown>, key = pair.privateKey): string =>
  signedJwt({ alg: 'RS256', kid: 'key-1', typ: 'JWT' }, claims, key)

const fakeFetch = (token: string, keys: Array<Record<string, unknown>> = [jwk]): typeof fetch =>
  (async (input: URL | RequestInfo, init?: RequestInit) => {
    assert.equal(init?.redirect, 'error')
    const url = String(input)
    if (url.endsWith('/.well-known/openid-configuration'))
      return new Response(
        JSON.stringify({
          issuer,
          authorization_endpoint: discovery.authorizationEndpoint,
          token_endpoint: discovery.tokenEndpoint,
          jwks_uri: discovery.jwksUri,
        }),
        { headers: { 'content-type': 'application/json' } },
      )
    if (url === discovery.jwksUri)
      return new Response(JSON.stringify({ keys }), {
        headers: { 'content-type': 'application/json', 'cache-control': 'max-age=300' },
      })
    if (url === discovery.tokenEndpoint) {
      assert.equal(init?.method, 'POST')
      return new Response(JSON.stringify({ token_type: 'Bearer', id_token: token }), {
        headers: { 'content-type': 'application/json' },
      })
    }
    return new Response('not found', { status: 404 })
  }) as typeof fetch

test('oauth protocol: discovery, exact redirect and PKCE are provider-neutral', async () => {
  const found = await discoverOidc(issuer, fakeFetch('unused'))
  assert.deepEqual(found, discovery)
  const url = new URL(
    oidcAuthorizationUrl(found, {
      clientId: 'ket-client',
      redirectUri: 'https://suite.example.test/auth/oauth/demo/callback',
      scope: 'openid profile email',
      state: 'state-value',
      nonce: 'nonce-value',
      codeVerifier: 'verifier-value',
    }),
  )
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
  assert.equal(url.searchParams.get('code_challenge'), pkceChallenge('verifier-value'))
  assert.equal(url.searchParams.get('redirect_uri'), 'https://suite.example.test/auth/oauth/demo/callback')
})

test('oauth protocol: ID token verifies issuer, audience, nonce, time and signature', async () => {
  clearOidcCachesForTest()
  const now = Date.now()
  const token = jwt({
    iss: issuer,
    sub: 'external-42',
    aud: 'ket-client',
    nonce: 'nonce-value',
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 300,
    email: 'operator@example.test',
    email_verified: true,
    name: 'Operator',
  })
  const exchanged = await exchangeOidcCode(
    discovery,
    {
      issuer,
      clientId: 'ket-client',
      clientAuthMethod: 'none',
      allowedAlgorithms: ['RS256'],
    },
    {
      code: 'authorization-code',
      redirectUri: 'https://suite.example.test/auth/oauth/demo/callback',
      codeVerifier: 'verifier-value',
    },
    fakeFetch(token),
  )
  const claims = await verifyOidcIdToken(
    exchanged.idToken,
    discovery,
    { clientId: 'ket-client', allowedAlgorithms: ['RS256'] },
    { nonce: 'nonce-value', now },
    fakeFetch(token),
  )
  assert.equal(claims.subject, 'external-42')
  assert.equal(claims.emailVerified, true)
})

test('oauth protocol: confidential client secrets stay inside the selected token auth method', async () => {
  const calls: Array<{ headers: Headers; form: URLSearchParams }> = []
  const tokenFetch = (async (_input: URL | RequestInfo, init?: RequestInit) => {
    calls.push({
      headers: new Headers(init?.headers),
      form: new URLSearchParams(String(init?.body ?? '')),
    })
    return new Response(JSON.stringify({ token_type: 'Bearer', id_token: 'signed-token' }))
  }) as typeof fetch
  await exchangeOidcCode(
    discovery,
    {
      issuer,
      clientId: 'client id',
      clientAuthMethod: 'client_secret_basic',
      clientSecret: 's:e cret',
      allowedAlgorithms: ['RS256'],
    },
    { code: 'code', redirectUri: 'https://suite.example.test/callback', codeVerifier: 'verifier' },
    tokenFetch,
  )
  assert.equal(
    calls[0]?.headers.get('authorization'),
    `Basic ${Buffer.from('client+id:s%3Ae+cret').toString('base64')}`,
  )
  assert.equal(calls[0]?.form.has('client_secret'), false)

  await exchangeOidcCode(
    discovery,
    {
      issuer,
      clientId: 'ket-client',
      clientAuthMethod: 'client_secret_post',
      clientSecret: 'post-secret',
      allowedAlgorithms: ['RS256'],
    },
    { code: 'code', redirectUri: 'https://suite.example.test/callback', codeVerifier: 'verifier' },
    tokenFetch,
  )
  assert.equal(calls[1]?.headers.has('authorization'), false)
  assert.equal(calls[1]?.form.get('client_id'), 'ket-client')
  assert.equal(calls[1]?.form.get('client_secret'), 'post-secret')

  await assert.rejects(
    () =>
      exchangeOidcCode(
        discovery,
        {
          issuer,
          clientId: 'ket-client',
          clientAuthMethod: 'client_secret_post',
          allowedAlgorithms: ['RS256'],
        },
        { code: 'code', redirectUri: 'https://suite.example.test/callback', codeVerifier: 'verifier' },
        tokenFetch,
      ),
    (error) => error instanceof OauthProtocolError && error.code === 'oauth.error.secretMissing',
  )
})

test('oauth protocol: rejects nonce, issuer, algorithm and insecure remote endpoints', async () => {
  clearOidcCachesForTest()
  const now = Date.now()
  const valid = {
    iss: issuer,
    sub: 'external-42',
    aud: 'ket-client',
    nonce: 'nonce-value',
    iat: Math.floor(now / 1000),
    exp: Math.floor(now / 1000) + 300,
  }
  await assert.rejects(
    () =>
      verifyOidcIdToken(
        jwt(valid),
        discovery,
        { clientId: 'ket-client', allowedAlgorithms: ['RS256'] },
        { nonce: 'other', now },
        fakeFetch('unused'),
      ),
    (error) => error instanceof OauthProtocolError && error.code === 'oauth.error.nonceMismatch',
  )
  await assert.rejects(
    () =>
      verifyOidcIdToken(
        jwt({ ...valid, iss: 'https://other-issuer.example.test' }),
        discovery,
        { clientId: 'ket-client', allowedAlgorithms: ['RS256'] },
        { nonce: 'nonce-value', now },
        fakeFetch('unused'),
      ),
    (error) => error instanceof OauthProtocolError && error.code === 'oauth.error.issuerMismatch',
  )
  await assert.rejects(
    () =>
      verifyOidcIdToken(
        signedJwt({ alg: 'HS256', kid: 'key-1' }, valid),
        discovery,
        { clientId: 'ket-client', allowedAlgorithms: ['RS256'] },
        { nonce: 'nonce-value', now },
        fakeFetch('unused'),
      ),
    (error) => error instanceof OauthProtocolError && error.code === 'oauth.error.algorithmRejected',
  )
  await assert.rejects(
    () =>
      verifyOidcIdToken(
        signedJwt({ alg: 'RS256', kid: 'key-1', crit: 'not-an-array' }, valid),
        discovery,
        { clientId: 'ket-client', allowedAlgorithms: ['RS256'] },
        { nonce: 'nonce-value', now },
        fakeFetch('unused'),
      ),
    (error) => error instanceof OauthProtocolError && error.code === 'oauth.error.idTokenInvalid',
  )
  clearOidcCachesForTest()
  await assert.rejects(
    () =>
      verifyOidcIdToken(
        jwt(valid),
        discovery,
        { clientId: 'ket-client', allowedAlgorithms: ['RS256'] },
        { nonce: 'nonce-value', now },
        fakeFetch('unused', [{ ...jwk, key_ops: ['sign'] }]),
      ),
    (error) => error instanceof OauthProtocolError && error.code === 'oauth.error.jwksInvalid',
  )
  clearOidcCachesForTest()
  await assert.rejects(
    () =>
      verifyOidcIdToken(
        jwt({ ...valid, sub: 'x'.repeat(256) }),
        discovery,
        { clientId: 'ket-client', allowedAlgorithms: ['RS256'] },
        { nonce: 'nonce-value', now },
        fakeFetch('unused'),
      ),
    (error) => error instanceof OauthProtocolError && error.code === 'oauth.error.subjectInvalid',
  )
  await assert.rejects(
    () => discoverOidc('http://identity.example.test', fakeFetch('unused')),
    (error) => error instanceof OauthProtocolError && error.code === 'oauth.error.endpointInsecure',
  )
  await assert.rejects(
    () => discoverOidc(issuer, (async () => new Response('x'.repeat(1024 * 1024 + 1))) as typeof fetch),
    (error) => error instanceof OauthProtocolError && error.code === 'oauth.error.discoveryInvalid',
  )
})
