import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { timeframeFilter } from '@ketvietlab/ketsuite/ui'

const css = readFileSync('packages/ketsuite/src/modules/backend/design/controls.css', 'utf8')
/** The renderer interleaves hydration markers, so read the text, not the bytes. */
const textIn = (html: string, hook: string): string =>
  (html.match(new RegExp(`data-ui="${hook}"[^>]*>(?<body>.*?)</`, 'u'))?.groups?.body ?? '').replace(
    /<!--k\[?-*-->/gu,
    '',
  )

const render = () =>
  renderToString(
    timeframeFilter({
      id: 'insights-period',
      label: 'Kỳ báo cáo',
      options: [
        { id: 'today', label: 'Hôm nay', href: '/admin/crm/overview?period=today' },
        {
          id: 'last_30_days',
          label: '30 ngày qua',
          href: '/admin/crm/overview?period=last_30_days',
          active: true,
          detail: '2026-08-06 → 2026-09-05',
        },
        { id: 'last_month', label: 'Tháng trước', href: '/admin/crm/overview?period=last_month' },
      ],
      range: '2026-08-06 → 2026-09-05',
      asOf: '2026-09-05 09:42',
      asOfLabel: 'Cập nhật',
      note: 'Asia/Ho_Chi_Minh',
    }),
  )

test('timeframe filter: the choice, the range it resolves to and when it was computed read together', () => {
  const html = render()
  // The trigger says which period is in force without being opened.
  assert.equal(textIn(html, 'timeframe-value'), '30 ngày qua')
  // A period label alone does not say what a number covers, so the range and the
  // moment the figures were computed sit beside it.
  assert.equal(textIn(html, 'timeframe-range'), '2026-08-06 → 2026-09-05')
  assert.equal(textIn(html, 'timeframe-asof'), 'Cập nhật 2026-09-05 09:42')
  assert.equal(textIn(html, 'timeframe-note'), 'Asia/Ho_Chi_Minh')
})

test('timeframe filter: every option is a link, so the period survives a copied URL', () => {
  const html = render()
  const links = [...html.matchAll(/<a[^>]*data-ui="timeframe-option"[^>]*href="([^"]+)"/gu)].map(
    (match) => match[1],
  )
  assert.deepEqual(links, [
    '/admin/crm/overview?period=today',
    '/admin/crm/overview?period=last_30_days',
    '/admin/crm/overview?period=last_month',
  ])
  // No form, no script: the control works with JavaScript switched off.
  assert.doesNotMatch(html, /<form/u)
  assert.doesNotMatch(html, /<script/u)
})

test('timeframe filter: the active option is announced, not only coloured', () => {
  const html = render()
  const active = html.match(/<a[^>]*data-active="true"[^>]*>/u)?.[0] ?? ''
  assert.match(active, /aria-current="true"/u)
  assert.equal((html.match(/data-active="true"/gu) ?? []).length, 1, 'exactly one option is current')
  assert.match(html, /role="group" aria-label="Kỳ báo cáo"/u)
})

test('timeframe filter: it is a filter, and does not borrow the tab treatment', () => {
  const html = render()
  // Tabs mean sibling views. A screen that already has tabs would otherwise
  // carry two rows that look alike and mean different things.
  assert.doesNotMatch(html, /data-ui="tabs"/u)
  assert.doesNotMatch(html, /role="tablist"/u)
})

test('timeframe filter: every hook it renders has a stylesheet rule', () => {
  const hooks = [
    'timeframe',
    'timeframe-menu',
    'timeframe-trigger',
    'timeframe-label',
    'timeframe-value',
    'timeframe-content',
    'timeframe-option',
    'timeframe-option-detail',
    'timeframe-range',
    'timeframe-asof',
    'timeframe-note',
  ]
  const html = render()
  assert.deepEqual(
    hooks.filter((hook) => !html.includes(`data-ui="${hook}"`)),
    [],
    'every listed hook is actually rendered',
  )
  assert.deepEqual(
    hooks.filter((hook) => !css.includes(`[data-ui="${hook}"]`)),
    [],
    'every rendered hook is styled',
  )
})

test('timeframe filter: with nothing marked active the first option stands for the state', () => {
  const html = renderToString(
    timeframeFilter({
      id: 'plain',
      label: 'Period',
      options: [
        { id: 'today', label: 'Today', href: '?period=today' },
        { id: 'week', label: 'This week', href: '?period=week' },
      ],
    }),
  )
  assert.equal(textIn(html, 'timeframe-value'), 'Today')
  // Nothing to say about a range that was not given.
  assert.doesNotMatch(html, /data-ui="timeframe-range"/u)
  assert.doesNotMatch(html, /data-ui="timeframe-asof"/u)
})
