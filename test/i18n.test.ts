import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  compose,
  defineModule,
  defineTheme,
  createTheme,
  translator,
  missingMessages,
  formatMissing,
  PSEUDO_LOCALE,
} from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { appsScreen } from '@ketvietlab/ketsuite/backend'
import backend from '@ketvietlab/ketsuite/backend'

const shop = defineModule({
  name: 'shop',
  messages: {
    vi: { greeting: 'Xin chào {name}', cart: { one: '{count} món', other: '{count} món' } },
    en: {
      greeting: 'Hello {name}',
      cart: { one: '{count} item', other: '{count} items' },
      extra: 'Only in English',
    },
  },
})

test('i18n: keys are prefixed by module, so two modules may both own a name', () => {
  const other = defineModule({ name: 'blog', messages: { vi: { greeting: 'Chào bạn' } } })
  const m = compose([shop, other], { headless: true })
  assert.equal(m.messages!.vi!['shop.greeting'], 'Xin chào {name}')
  assert.equal(m.messages!.vi!['blog.greeting'], 'Chào bạn')
})

test('i18n: placeholders are filled, and a missing one stays visible', () => {
  const _ = translator(compose([shop], { headless: true }), 'vi')
  assert.equal(_('shop.greeting', { name: 'Duy' }), 'Xin chào Duy')
  assert.equal(_('shop.greeting'), 'Xin chào {name}', 'a blank is worse than a visible hole')
})

test('i18n: plural categories come from Intl, not from a hand-rolled rule', () => {
  const m = compose([shop], { headless: true })
  const en = translator(m, 'en'),
    vi = translator(m, 'vi')
  assert.equal(en('shop.cart', { count: 1 }), '1 item')
  assert.equal(en('shop.cart', { count: 5 }), '5 items')
  assert.equal(vi('shop.cart', { count: 1 }), '1 món', 'Vietnamese has one form and that is fine')
  assert.equal(vi('shop.cart', { count: 5 }), '5 món')
})

test('i18n: a missing key falls back, then shows itself — never blank', () => {
  const m = compose([shop], { headless: true })
  const missed: Array<[string, string]> = []
  const _ = translator(m, 'vi', { fallback: 'en', onMissing: (k, l) => missed.push([k, l]) })

  assert.equal(_('shop.extra'), 'Only in English', 'falls back to the other locale')
  assert.equal(_('shop.nowhere'), 'shop.nowhere', 'and finally to the key itself, which is findable')
  assert.deepEqual(missed, [
    ['shop.extra', 'vi'],
    ['shop.nowhere', 'vi'],
  ])
  assert.equal(_.has('shop.extra'), false)
  assert.equal(_.has('shop.greeting'), true)
})

test('i18n: gaps are reported rather than raised', () => {
  const m = compose([shop], { headless: true })
  const gaps = missingMessages(m)
  assert.deepEqual(gaps, { vi: ['shop.extra'] }, 'a build must not break because one string is untranslated')
  assert.match(formatMissing(gaps), /vi: 1 missing/)
  assert.equal(formatMissing({}), 'every locale has every key')
})

test('i18n: the pseudo-locale expands text so a layout can be tested before translation exists', () => {
  const _ = translator(compose([shop], { headless: true }), PSEUDO_LOCALE, { fallback: 'vi' })
  const out = _('shop.greeting', { name: 'Duy' })
  assert.match(out, /^⟦.*⟧$/, 'bracketed, so truncation is obvious')
  assert.ok(out.length > 'Xin chào Duy'.length, 'and longer, which is what breaks a layout')
})

test('i18n: a theme translates through the _ filter, because scope holds no functions', () => {
  const mod = defineModule({
    name: 'site',
    joints: {},
    messages: { vi: { welcome: 'Chào mừng' }, en: { welcome: 'Welcome' } },
  })
  const theme = defineTheme({
    name: 'th',
    depends: ['site'],
    templates: { home: `<h1>{{ 'site.welcome' | _ }}</h1>` },
  })
  const m = compose([mod, theme], { headless: true })

  for (const [locale, expected] of [
    ['vi', 'Chào mừng'],
    ['en', 'Welcome'],
  ] as const) {
    const rt = createTheme(m, [mod, theme], { translate: translator(m, locale) })
    assert.equal(rt.renderRegion('home', {}), `<h1>${expected}</h1>`)
  }
})

test('i18n: the backend UI has no hardcoded language left in it', () => {
  const m = compose([backend], { headless: true })
  const app = {
    name: 'w',
    title: 'W',
    summary: 's',
    category: 'C',
    state: 'installed' as const,
    depends: [],
    dependents: ['x'],
  }

  const vi = renderToString(appsScreen(translator(m, 'vi'), [app]))
  const en = renderToString(appsScreen(translator(m, 'en'), [app]))
  assert.match(vi, /Ứng dụng/)
  assert.match(vi, />Gỡ</)
  assert.match(en, /Apps/)
  assert.match(en, />Remove</)
  assert.ok(!en.includes('Ứng dụng'), 'no Vietnamese survives into the English render')
  assert.ok(!vi.includes('Remove'))
})

test('i18n: the backend catalogue is complete in both languages', () => {
  const m = compose([backend], { headless: true })
  assert.deepEqual(missingMessages(m), {}, formatMissing(missingMessages(m)))
})

test('i18n: has() and resolves() answer different questions', () => {
  const m = compose([shop], { headless: true })
  const vi = translator(m, 'vi', { fallback: 'en' })
  assert.equal(vi.has('shop.extra'), false, 'vi does not own this key')
  assert.equal(vi.resolves('shop.extra'), true, 'but it still produces a translation, via en')

  // The distinction is not academic: using has() to decide whether to translate
  // makes the pseudo-locale stop expanding, which is the one thing it is for.
  const pseudo = translator(m, PSEUDO_LOCALE, { fallback: 'vi' })
  assert.equal(pseudo.has('shop.greeting'), false)
  assert.equal(pseudo.resolves('shop.greeting'), true)
  assert.match(pseudo('shop.greeting', { name: 'D' }), /^⟦.*⟧$/)
})
