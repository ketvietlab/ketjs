import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compose, defineModule, defineTheme } from '@ketvietlab/ketjs'

/**
 * Two modules that know nothing of each other setting one token: the value the
 * page used was decided by the dependency sort's tie-break on module names.
 */
const warnings = (modules: Parameters<typeof compose>[0]) =>
  (compose(modules, { headless: true }).diagnostics ?? []).map((warning) => warning.code)

test('tokens: unrelated modules giving one token different values are reported', () => {
  const crm = defineModule({ name: 'crm', tokens: { accent: '#0a0' } })
  const sales = defineModule({ name: 'sales', tokens: { accent: '#a00' } })
  assert.deepEqual(warnings([crm, sales]), ['E_TOKEN_CONFLICT'])
})

test('tokens: layering along depends, equal values and themes are not conflicts', () => {
  const base = defineModule({ name: 'base', tokens: { accent: '#0a0', gap: '8px' } })
  const brand = defineModule({ name: 'brand', depends: ['base'], tokens: { accent: '#a00' } })
  const same = defineModule({ name: 'same', tokens: { gap: '8px' } })
  const paper = defineTheme({ name: 'paper', tokens: { accent: '#00a' } })
  const ink = defineTheme({ name: 'ink', tokens: { accent: '#000' } })
  assert.deepEqual(warnings([base, brand, same, paper, ink]), [])
})
