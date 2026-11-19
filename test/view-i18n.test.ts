import assert from 'node:assert/strict'
import { test } from 'node:test'
import { build } from 'esbuild'
import { formatMissing, missingMessages, PSEUDO_LOCALE, translator } from '@ketvietlab/ketjs-view/i18n'
import type { Catalog, Message, Messages, Translator } from '@ketvietlab/ketjs-view/i18n'

const english: Catalog = {
  'site.welcome': 'Hello, {name}!',
  'site.items': { one: '{count} item', other: '{count} items' },
}
const vietnameseItems: Message = { other: '{count} mục' }
const messages: Messages = {
  en: english,
  vi: { 'site.items': vietnameseItems },
  es: { 'site.items': { one: '{count} artículo', other: '{count} artículos' } },
  zh: { 'site.items': { other: '{count} 项' } },
}

test('the public view entry selects Intl plural forms in English, Vietnamese, Spanish and Chinese', () => {
  for (const [locale, one, many] of [
    ['en', '1 item', '2 items'],
    ['vi', '1 mục', '2 mục'],
    ['es', '1 artículo', '2 artículos'],
    ['zh', '1 项', '2 项'],
  ]) {
    const t: Translator = translator(messages, locale)
    assert.equal(t.locale, locale)
    assert.equal(t('site.items', { count: 1 }), one)
    assert.equal(t('site.items', { count: 2 }), many)
  }
})

test('catalog fallback, interpolation and gap reporting work without a manifest', () => {
  const calls: [string, string][] = []
  const t = translator(messages, 'vi', {
    fallback: 'en',
    onMissing: (key, locale) => calls.push([key, locale]),
  })
  assert.equal(t('site.welcome', { name: 'Duy' }), 'Hello, Duy!')
  assert.equal(t('site.welcome'), 'Hello, {name}!')
  assert.equal(t('site.unknown'), 'site.unknown')
  assert.equal(t.has('site.welcome'), false)
  assert.equal(t.resolves('site.welcome'), true)
  assert.deepEqual(calls, [
    ['site.welcome', 'vi'],
    ['site.welcome', 'vi'],
    ['site.unknown', 'vi'],
  ])
  assert.equal(translator(messages, 'vi')('site.welcome'), 'site.welcome')
  assert.equal(translator(messages, 'en')('site.items', { count: 0 }), '0 items')

  const gaps = missingMessages(messages, ['en', 'vi', 'fr'])
  assert.deepEqual(gaps, { vi: ['site.welcome'], fr: ['site.items', 'site.welcome'] })
  assert.equal(
    formatMissing(gaps),
    'vi: 1 missing\n  site.welcome\nfr: 2 missing\n  site.items\n  site.welcome',
  )
})

test('qps works from a chosen catalogue and expands the translated output', () => {
  const t = translator(messages, PSEUDO_LOCALE, { fallback: 'en' })
  assert.equal(PSEUDO_LOCALE, 'qps')
  assert.equal(t.has('site.items'), false)
  assert.equal(t.resolves('site.items'), true)
  assert.equal(t('site.items', { count: 1 }), '⟦1 iiteem⟧')
  assert.equal(t('site.items', { count: 2 }), '⟦2 iiteems⟧')
})

test('the view i18n subpath bundles for browsers with no runtime dependency', async () => {
  const bundled = await build({
    stdin: {
      contents:
        "export { translator, missingMessages, formatMissing, PSEUDO_LOCALE } from '@ketvietlab/ketjs-view/i18n'",
      resolveDir: process.cwd(),
    },
    bundle: true,
    platform: 'browser',
    tsconfigRaw: { compilerOptions: {} },
    format: 'esm',
    metafile: true,
    write: false,
  })
  const inputs = Object.keys(bundled.metafile!.inputs)
  assert.equal(inputs.length, 2)
  assert.ok(
    inputs.some((input) => input.endsWith('/ketjs-view/dist/i18n.js')),
    inputs.join('\n'),
  )
  for (const output of Object.values(bundled.metafile!.outputs)) assert.deepEqual(output.imports, [])
})
