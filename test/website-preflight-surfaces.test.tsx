import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
import {
  type DanglingLink,
  menusScreen,
  type PreflightResult,
  preflightScreen,
} from '../packages/ketsuite/src/modules/website_backend/screens/index.tsx'

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const menus = (dangling: DanglingLink[] = []) =>
  renderToString(menusScreen(translate, [], [], 'site1', {}, '', dangling))

const preflight = (over: Partial<PreflightResult> = {}) =>
  renderToString(preflightScreen(translate, { ok: true, checked: 3, unrenderable: [], ...over }, 'site1', {}))

test('menus: a link that leads nowhere is named on the screen where links are edited', () => {
  const html = menus([{ id: 'm1', label: 'Bang gia', href: '/bang-gia' }])
  assert.match(html, /menus\.dangling/u)
  assert.match(html, /Bang gia/u)
  assert.match(html, /\/bang-gia/u)
})

test('menus: a menu whose links all resolve says nothing at all', () => {
  assert.equal(menus().includes('menus.dangling'), false)
})

test('preflight: a clean site says so, with how many pages were looked at', () => {
  const html = preflight()
  assert.match(html, /preflight\.clean/u)
  assert.match(html, /3/u)
})

test('preflight: a broken page is named with the reason', () => {
  const html = preflight({
    ok: false,
    unrenderable: [
      { entryId: 'p1', path: '/gioi-thieu', errors: [{ message: 'no composed module provides this' }] },
    ],
  })
  assert.match(html, /preflight\.broken/u)
  assert.match(html, /\/gioi-thieu/u)
  assert.match(html, /no composed module provides this/u)
})

test('preflight: a scan that stopped early says so before anything else', () => {
  // A partial scan is never ok, and the reader has to know why before reading
  // a count that does not cover the site.
  const html = preflight({ ok: false, capped: true, checked: 1000 })
  assert.match(html, /preflight\.capped/u)
  assert.ok(
    html.indexOf('preflight.capped') < html.indexOf('preflight.checked'),
    'the warning comes before the number it qualifies',
  )
})
