import { test } from 'node:test'
import assert from 'node:assert/strict'
import { document, html, renderToString } from '@ketvietlab/ketjs'
import { LAYER_ORDER_CSS } from '@ketvietlab/ketjs/theme'

/**
 * The document shell writes the cascade layer order out as a literal, because a
 * string hole inside <style> is escaped text. This keeps the literal and the
 * exported order the same, and keeps it before any stylesheet the head adds.
 */
test('document: the shell declares the exported cascade layer order before the head', () => {
  const markup = renderToString(
    document({ lang: 'en', head: html`<link rel="stylesheet" href="/app.css">`, body: html`<main></main>` }),
  )
  const declared = markup.indexOf(`<style>${LAYER_ORDER_CSS}</style>`)
  assert.notEqual(declared, -1, markup)
  assert.ok(declared < markup.indexOf('<link rel="stylesheet"'))
})
