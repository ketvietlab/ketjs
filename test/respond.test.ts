import { test } from 'node:test'
import assert from 'node:assert/strict'
import { page, fragment, json, text, raw, document, bootApp, defineApp, defineModule } from 'ketjs'
import { html } from 'ketjs-view'

/**
 * A route's body used to be a `string`, so a value that had been through the
 * escaper and a value someone concatenated by hand were the same type. Nothing
 * could tell them apart — not the compiler, not a reviewer skimming a diff — and
 * the document shell was built by concatenation for exactly that reason.
 *
 * RouteResult is branded now. The type-level proof is in tools/type-proof.ts: an
 * object literal is not assignable. These tests cover what happens at runtime.
 */

test('respond: a document is markup, so a hole cannot become markup', () => {
  const r = page({ body: document({ lang: 'en', title: 'Home', body: html`<p>${'<script>alert(1)</script>'}</p>` }) })
  assert.match(r.body, /^<!doctype html><html lang="en">/)
  assert.ok(r.body.includes('&lt;script&gt;'), 'the hole was escaped')
  assert.ok(!r.body.includes('<script>alert'), 'and nothing got through')
})

test('respond: the lang attribute is a hole like any other', () => {
  const r = page({ body: document({ lang: 'vi"><script>x</script>', body: html`<p>hi</p>` }) })
  assert.ok(!r.body.includes('<script>x'), 'an attribute hole is escaped, so it cannot close its own quote')
})

test('respond: a title is optional, and absent means absent rather than empty', () => {
  const r = page({ body: document({ lang: 'en', body: html`<p>x</p>` }) })
  assert.ok(!r.body.includes('<title>'))
})

test('respond: head content is markup too', () => {
  const r = page({ body: document({ lang: 'en', head: html`<link rel="stylesheet" href="/a.css">`, body: html`<p>x</p>` }) })
  assert.match(r.body, /<link rel="stylesheet" href="\/a\.css">/)
})

test('respond: a fragment carries no doctype, so it can be swapped into a page', () => {
  assert.equal(fragment(html`<li>a</li>`).body, '<li>a</li>')
})

test('respond: every constructor names its own content type', () => {
  assert.equal(json({ a: 1 }).type, 'application/json')
  assert.equal(text('hello').type, 'text/plain')
  assert.equal(fragment(html`<p>x</p>`).type, 'text/html')
  assert.equal(page({ body: document({ lang: 'en', body: html`<p>x</p>` }) }).type, 'text/html')
})

test('respond: status is carried when given and absent when not', () => {
  assert.equal(json({}, { status: 404 }).status, 404)
  assert.equal('status' in json({}), false, 'an absent status must not become an explicit undefined')
})

test('respond: raw is the one way past the escaper, and it is one word to grep for', () => {
  assert.equal(raw('<p>trusted</p>').body, '<p>trusted</p>')
  assert.equal(raw('x', { type: 'application/xml' }).type, 'application/xml')
})

// ── the locale, which reaches the first attribute on every page ──────────────

const notes = defineModule({ name: 'notes', app: true, messages: { en: { hi: 'Hi' } } })

const app = defineApp({
  name: 'localeapp', modules: [notes], headless: true,
  serve: { bootstrap: ['notes'], defaults: { defaultLocale: 'vi', fallbackLocale: 'vi' } },
})

test('locale: only a locale the deployment ships a catalogue for is ever used', async () => {
  const b = await bootApp(app, { env: { KET_SQLITE: ':memory:' }, port: 0 })
  const at = `http://127.0.0.1:${b.port}/_ket/health`
  // Node's own fetch sends `Accept-Language: *` by default. That reached Intl and
  // threw, so any client that did not set the header got a 500 — found by probing,
  // not by any test, because curl does not send it.
  assert.equal((await fetch(at)).status, 200)
  assert.equal((await fetch(at, { headers: { 'accept-language': '*' } })).status, 200)
  assert.equal((await fetch(at, { headers: { 'accept-language': 'zz-ZZ' } })).status, 200)
  await b.close()
})
