import assert from 'node:assert/strict'
import type { IncomingMessage } from 'node:http'
import { test } from 'node:test'
import { createClientAddressResolver, isSameOriginRequest } from '@ketvietlab/ketjs'

const request = (peer: string, headers: IncomingMessage['headers'] = {}) =>
  ({ headers, socket: { remoteAddress: peer } }) as IncomingMessage

test('request origin: TLS termination preserves host and port checks', () => {
  const url = new URL('http://app.example.com/auth/login')
  assert.equal(isSameOriginRequest(url, request('127.0.0.1', { origin: 'https://app.example.com' })), true)
  for (const origin of [
    'https://other.example.com',
    'https://app.example.com:8443',
    'null',
    'ftp://app.example.com',
  ]) {
    assert.equal(isSameOriginRequest(url, request('127.0.0.1', { origin })), false)
  }
})

test('request origin: cookie bindings require evidence while native login may allow non-browser clients', () => {
  const url = new URL('http://app.example.com')
  assert.equal(isSameOriginRequest(url, request('127.0.0.1')), false)
  assert.equal(isSameOriginRequest(url, request('127.0.0.1'), { allowMissingOrigin: true }), true)
  assert.equal(isSameOriginRequest(url, request('127.0.0.1', { 'sec-fetch-site': 'same-origin' })), true)
  for (const site of ['cross-site', 'same-site', 'none']) {
    assert.equal(
      isSameOriginRequest(url, request('127.0.0.1', { 'sec-fetch-site': site }), {
        allowMissingOrigin: true,
      }),
      false,
    )
  }
})

test('client address: forwarding headers are ignored unless the socket peer is explicitly trusted', () => {
  const resolve = createClientAddressResolver()
  assert.equal(resolve(request('::ffff:192.0.2.7', { 'x-forwarded-for': '198.51.100.2' })), '192.0.2.7')
  const trusted = createClientAddressResolver({ trustedProxies: ['127.0.0.1'] })
  assert.equal(trusted(request('192.0.2.7', { 'x-forwarded-for': '198.51.100.2' })), '192.0.2.7')
  assert.equal(trusted(request('::ffff:127.0.0.1', { 'x-forwarded-for': '198.51.100.2' })), '198.51.100.2')
})

test('client address: proxy chains stop at the nearest untrusted hop and canonical IPv6 addresses match', () => {
  const resolve = createClientAddressResolver({ trustedProxies: ['127.0.0.1', '192.0.2.5', '::1'] })
  assert.equal(
    resolve(request('127.0.0.1', { 'x-forwarded-for': '203.0.113.9, 198.51.100.2, 192.0.2.5' })),
    '198.51.100.2',
  )
  assert.equal(resolve(request('0:0:0:0:0:0:0:1', { 'x-forwarded-for': '198.51.100.2' })), '198.51.100.2')
  assert.equal(resolve(request('127.0.0.1', { 'x-forwarded-for': '192.0.2.5' })), '192.0.2.5')
})

test('client address: malformed or oversized forwarding chains fall back to the socket and invalid trust config fails', () => {
  const resolve = createClientAddressResolver({ trustedProxies: ['127.0.0.1'] })
  for (const forwarded of [
    '',
    'unknown',
    '198.51.100.2,',
    '198.51.100.2:99',
    'x'.repeat(2049),
    Array(33).fill('198.51.100.2').join(','),
  ]) {
    assert.equal(resolve(request('127.0.0.1', { 'x-forwarded-for': forwarded })), '127.0.0.1')
  }
  for (const proxy of ['*', '127.0.0.0/8', 'localhost', '']) {
    assert.throws(() => createClientAddressResolver({ trustedProxies: [proxy] }), RangeError)
  }
})
