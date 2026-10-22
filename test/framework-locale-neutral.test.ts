import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildMenu, compose, defineModule, defineTheme } from '@ketvietlab/ketjs'

/**
 * The framework is written in English and used in any language. It required a
 * Vietnamese label on every permission bundle, gave every module without a
 * category the Vietnamese "Khác", and folded menu search case in Vietnamese
 * whatever the viewer's locale.
 */
const handler = () => ({ ok: true })
const module = (labels: Record<string, string>) =>
  defineModule({
    name: 'sales',
    functions: { list: { handler } },
    permissions: {
      posture: 'permission-bearing',
      owner: 'sales',
      bundles: { 'sales.view': { labels: labels as { en: string } } },
      functions: { 'sales.list': { risk: 'read', bundles: ['sales.view'], owner: 'sales' } },
      exemptions: {},
    },
  })
const roleTemplates = (labels: Record<string, string>) => ({
  'shop.clerk': { version: 1, labels: labels as { en: string }, bundles: ['sales.view'] },
})
const refused = (run: () => unknown): boolean => {
  try {
    run()
    return false
  } catch (error) {
    return Boolean(
      (error as { items?: Array<{ code: string }> }).items?.some(
        (item) => item.code === 'E_PERMISSION_CATALOG_INVALID',
      ),
    )
  }
}

test('framework locale: a permission label needs English, and any other locale is optional', () => {
  const english = { en: 'View sales' }
  assert.equal(
    refused(() => compose([module(english)], { roleTemplates: roleTemplates(english) })),
    false,
  )
  assert.equal(
    refused(() =>
      compose([module({ en: 'View sales', da: 'Se salg' })], { roleTemplates: roleTemplates(english) }),
    ),
    false,
  )
  assert.equal(
    refused(() => compose([module({ vi: 'Xem bán hàng' } as never)])),
    true,
    'English is the fallback',
  )
  assert.equal(
    refused(() => compose([module({ en: 'View sales', vi: ' ' })])),
    true,
    'a given label says something',
  )
  assert.equal(
    refused(() => compose([module(english)], { roleTemplates: roleTemplates({ en: '' }) })),
    true,
  )
})

test('framework locale: default categories are English', () => {
  assert.equal(defineModule({ name: 'plain' }).category, 'Other')
  assert.equal(defineTheme({ name: 'paper' }).category, 'Theme')
  assert.equal(defineModule({ name: 'own', category: 'Vận hành' }).category, 'Vận hành')
})

test('framework locale: menu search folds case in the viewer locale', () => {
  const manifest = compose(
    [
      defineModule({
        name: 'nav',
        menus: { root: { label: 'Root' }, invoices: { label: 'INVOICES', parent: 'root', path: '/i' } },
      }),
    ],
    { headless: true },
  )
  const labels = (q: string, locale?: string) =>
    buildMenu(manifest, { q, ...(locale ? { locale } : {}) })
      .flatMap((node) => [node, ...node.children])
      .map((node) => node.label)
  assert.ok(labels('invoices', 'en').includes('INVOICES'))
  // Turkish folds a dotted capital İ and a dotless ı; English does not.
  assert.ok(!labels('ınvoıces', 'en').includes('INVOICES'))
  assert.ok(labels('ınvoıces', 'tr').includes('INVOICES'), 'the viewer locale decides')
})
