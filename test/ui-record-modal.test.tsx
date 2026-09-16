import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { ModalSheet } from '@ketvietlab/design-system'
import {
  RECORD_NEW_ID,
  RECORD_PARAM,
  defineRecordModalIsland,
  isRecordModalCreate,
  readRecordModalTarget,
  recordModalClosedHref,
  recordModalCreateHref,
  recordModalHost,
  recordModalHref,
} from '@ketvietlab/ketsuite/ui'

import {
  RECORD_MODAL_LABELS,
  delayedFlag,
  openerHref,
  resolveRecordModalLabel,
} from '../packages/ketsuite/src/ui/client/record-modal.tsx'

const runtime = readFileSync('packages/ketsuite/src/ui/client/record-modal.tsx', 'utf8')
const bootstrap = readFileSync('packages/ketjs/src/server/http.ts', 'utf8')

test('record modal: a link keeps the collection query and names kind, id and tab', () => {
  const href = recordModalHref(new URL('http://x/admin/crm/followups?bucket=overdue&q=an&cursor=50'), {
    kind: 'customer_care.followup',
    id: 'native:abc',
    tab: 'result',
  })
  assert.equal(
    href,
    '/admin/crm/followups?bucket=overdue&q=an&cursor=50&record=customer_care.followup%3Anative%3Aabc&tab=result',
  )
  const back = readRecordModalTarget(`http://x${href}`)
  assert.deepEqual(back, { kind: 'customer_care.followup', id: 'native:abc', tab: 'result' })
  assert.equal(recordModalClosedHref(`http://x${href}`), '/admin/crm/followups?bucket=overdue&q=an&cursor=50')
})

test('record modal: a create action opens the same modal with the reserved new id', () => {
  // A collection's own tabs use `section`: `record` and `tab` belong to the record modal.
  const href = recordModalCreateHref(new URL('http://x/admin/crm/configuration?section=stages&status=all'), {
    kind: 'crm.stage',
  })
  assert.equal(href, '/admin/crm/configuration?section=stages&status=all&record=crm.stage%3Anew')
  const target = readRecordModalTarget(`http://x${href}`)
  assert.deepEqual(target, { kind: 'crm.stage', id: RECORD_NEW_ID, tab: null })
  assert.equal(isRecordModalCreate(target), true)
  assert.equal(isRecordModalCreate({ id: 'stage-1' }), false)
  // The runtime reads a create without an id, tells views it is creating, and a
  // create command switches the modal to the record it made instead of closing.
  assert.match(runtime, /creating: current\.id === RECORD_NEW_ID/u)
  assert.match(runtime, /creating\s*\?\s*\{\}\s*:\s*\{ id \}/u)
  assert.match(runtime, /if \(createdId\) show\(createdId, command\.openTab \?\? null, 'replace'\)/u)
})

test('record modal: a reopened record renders from the island cache and revalidates', () => {
  // Cached contexts show at once and are read again quietly behind them.
  assert.match(runtime, /const cached = definition\.cache === false \? undefined : cache\.get\(id\)/u)
  assert.match(runtime, /envelope\.set\(cached\)[\s\S]*?quiet = true/u)
  // Bounded, and dropped by a successful command or a change announced for the kind.
  assert.match(runtime, /while \(cache\.size > RECORD_MODAL_CACHE_SIZE\)/u)
  assert.match(runtime, /cache\.delete\(current\.id\)/u)
  assert.match(runtime, /'ket:records-changed',\s*\(event\) =>[\s\S]*?cache\.delete\(String\(id\)\)/u)
})

test('record modal: a malformed record parameter opens nothing', () => {
  for (const raw of ['', 'followup', ':id', 'customer_care.followup:', 'Not A Kind:1', 'a:b'])
    assert.equal(readRecordModalTarget(`http://x/list?${RECORD_PARAM}=${encodeURIComponent(raw)}`), null, raw)
  assert.throws(() => recordModalHref('/x', { kind: 'bad kind', id: '1' }))
})

test('record modal: the server renders only a closed host with no record data', () => {
  const island = defineRecordModalIsland({
    kind: 'customer_care.followup',
    client: 'followup.mjs',
    export: 'followup',
  })
  assert.deepEqual(island.props, {})
  const html = renderToString(recordModalHost('customer_care.followup'))
  assert.match(html, /data-ui="record-modal-host"/u)
  assert.match(html, /data-record-kind="customer_care\.followup"/u)
  assert.match(html, /hidden/u)
  assert.doesNotMatch(html, /role="dialog"/u)
})

test('record modal: client sheets carry no route-modal marker and close with buttons', () => {
  const html = renderToString(
    ModalSheet({ id: 'client-sheet', mode: 'client', title: 'Hồ sơ', closeLabel: 'Đóng', body: 'nội dung' }),
  )
  assert.match(html, /data-client-modal="true"/u)
  assert.doesNotMatch(html, /data-route-modal/u)
  assert.match(html, /<button data-ui="modal-close" type="button"/u)
  assert.match(html, /<button data-ui="modal-backdrop" type="button"/u)
  assert.doesNotMatch(html, /href=/u)

  const route = renderToString(
    ModalSheet({
      id: 'route-sheet',
      title: 'Hồ sơ',
      closeHref: '/list',
      closeLabel: 'Đóng',
      body: 'nội dung',
    }),
  )
  assert.match(route, /data-route-modal="true"/u)
  assert.match(route, /<a data-ui="modal-close" href="\/list"/u)
})

test('record modal: a record with several tabs keeps one height while tabs switch', () => {
  // The record layer asks for a fixed dialog only when there is more than one tab to switch between.
  const recordLayer = runtime.slice(runtime.indexOf('id: `record-modal-${definition.kind'))
  const call = recordLayer.slice(0, recordLayer.indexOf('body: recordBody()'))
  assert.match(call, /height: \(definition\.tabs\?\.length \?\? 0\) > 1 \? 'fixed' : 'content'/u)
  // A dialog layer opened from the record keeps sizing to its content.
  const dialogLayer = runtime.slice(
    runtime.indexOf('const dialogLayer = '),
    runtime.indexOf('return {', runtime.indexOf('const dialogLayer = ')),
  )
  assert.doesNotMatch(dialogLayer, /height:/u)
})

test('record modal: going back over a client-owned entry does not refetch the page', () => {
  const popstate = bootstrap.slice(bootstrap.indexOf("window.addEventListener('popstate'"))
  const dispatchAt = popstate.indexOf("new CustomEvent('ket:popstate', { cancelable: true")
  const navigateAt = popstate.indexOf("void navigate(location.href, 'pop'")
  assert.ok(dispatchAt > 0 && navigateAt > dispatchAt, 'the owner is asked before the page is re-fetched')
  assert.match(popstate.slice(dispatchAt, navigateAt), /if \(!document\.dispatchEvent\(owned\)\) return/u)
  assert.match(runtime, /'ket:popstate'[\s\S]*?event\.preventDefault\(\)/u)
})

test('record modal: the runtime owns focus, escape, inertness, drafts and collection refresh', () => {
  assert.match(runtime, /event\.key === 'Escape'/u)
  assert.match(runtime, /const inertOutside = /u)
  assert.match(runtime, /restore|returnFocus/u)
  assert.match(
    runtime,
    /drafts\.set\(\{ \.\.\.drafts\(\), \.\.\.kept \}\)/u,
    'a refused submit keeps what was typed',
  )
  assert.match(runtime, /'idempotency-key'/u)
  assert.match(runtime, /new CustomEvent\('ket:records-changed'/u)
  // A view never fetches: only the runtime calls the function endpoint and `/files`.
  assert.equal((runtime.match(/fetch\(/gu) ?? []).length, 2)
  assert.match(runtime, /fetch\('\/files'/u, 'uploads go through storage, never a module route')
  assert.match(runtime, /'ket:islands-attach'/u)
  assert.match(bootstrap, /addEventListener\('ket:islands-attach'[\s\S]*?islands\.mount\(root\)/u)
})

test('record modal: the loading state never shows a label key', () => {
  const docs = readFileSync('docs/src/content/docs/ketsuite/record-modal.md', 'utf8')
  const documented = [
    ...new Set([...docs.matchAll(/`(recordModal\.[a-zA-Z]+)`/gu)].map((m) => m[1] as string)),
  ]
  assert.ok(documented.length >= 9, 'the runtime label table is documented')
  for (const key of documented) assert.ok(RECORD_MODAL_LABELS[key], `a default exists for ${key}`)
  // Before any context loads there are no messages: the module's labels, then the defaults.
  assert.equal(resolveRecordModalLabel('recordModal.loading', {}), 'Loading…')
  assert.equal(
    resolveRecordModalLabel('recordModal.loading', { labels: { 'recordModal.loading': 'Đang tải…' } }),
    'Đang tải…',
  )
  // Opening the next record keeps the previous record's words while it loads.
  assert.equal(
    resolveRecordModalLabel('recordModal.close', {
      messages: null,
      previous: { 'recordModal.close': 'Đóng' },
      labels: { 'recordModal.close': 'Close (module)' },
    }),
    'Đóng',
  )
  for (const key of documented)
    assert.doesNotMatch(resolveRecordModalLabel(key, {}), /^recordModal\./u, `${key} resolves to words`)
})

test('record modal: a created record is in the address bar before the collection refreshes', () => {
  // The shell answers `ket:records-changed` by re-fetching `location.href`; announcing
  // before the `:new` entry is replaced would reload the create form.
  const openBranch = runtime.slice(runtime.indexOf("if (after === 'open') {"))
  const showAt = openBranch.indexOf("show(createdId, command.openTab ?? null, 'replace')")
  const announceAt = openBranch.indexOf('announce()')
  assert.ok(
    showAt > 0 && announceAt > showAt,
    'the URL names the created record before the change is announced',
  )
})

/**
 * A stand-in for the element a click landed on. `closest` answers from a chain
 * of ancestors, each described by the selectors it matches, which is all the
 * opener resolver asks of the DOM.
 */
const clickedOn = (
  chain: ReadonlyArray<{ matches: readonly string[]; href?: string; target?: string }>,
): Element => {
  const node = (index: number): Record<string, unknown> => ({
    closest: (selector: string) => {
      for (let at = index; at < chain.length; at += 1)
        if (chain[at]?.matches.some((one) => selector.split(', ').includes(one)))
          return { ...node(at), ...chain[at] }
      return null
    },
    getAttribute: (name: string) =>
      name === 'data-row-href' ? (chain[index]?.href ?? null) : null,
  })
  return node(0) as unknown as Element
}

const ROW = { matches: ['[data-row-href]'], href: '/list?record=crm.stage%3Aqualified' }

test('record modal: a click opens from the link it landed on, or the row it landed in', () => {
  // A row carries its destination on the row (`rowLink: false`), so the modal
  // has to read the row: the shell would navigate it and leave the modal shut.
  assert.equal(openerHref(clickedOn([{ matches: ['td'] }, ROW])), ROW.href)
  assert.equal(openerHref(clickedOn([ROW])), ROW.href)

  // A link inside a row wins over the row: it names its own destination.
  const link = { matches: ['a', 'a[href]'], href: '/list?record=crm.stage%3Awon' }
  assert.equal(openerHref(clickedOn([link, ROW])), link.href)
  // …unless it opens elsewhere, which is not this modal's business.
  assert.equal(openerHref(clickedOn([{ ...link, target: '_blank' }, ROW])), null)

  // A control inside the row does its own thing; the row is not a second target.
  for (const control of ['button', 'input', 'select', 'textarea', 'label', 'summary', 'details'])
    assert.equal(
      openerHref(clickedOn([{ matches: [control] }, ROW])),
      null,
      `${control} inside a row keeps the row shut`,
    )
  assert.equal(openerHref(clickedOn([{ matches: ['[data-ui="select-cell"]'] }, ROW])), null)

  // Nothing to open.
  assert.equal(openerHref(clickedOn([{ matches: ['td'] }])), null)
  assert.equal(openerHref(null), null)
})

test('record modal: a save the server answers at once never flashes its spinner', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const seen: boolean[] = []
  const busy = delayedFlag((value) => seen.push(value), 400)

  // A command that answers inside the window says nothing at all.
  busy.set(true)
  t.mock.timers.tick(399)
  busy.set(false)
  t.mock.timers.tick(5000)
  assert.deepEqual(seen, [false], 'the button never went through its loading state')

  // One that outlasts the window reports, and stops reporting when it ends.
  seen.length = 0
  busy.set(true)
  t.mock.timers.tick(400)
  assert.deepEqual(seen, [true])
  busy.set(false)
  assert.deepEqual(seen, [true, false])

  // An island torn down mid-command leaves no timer to fire into a dead view.
  seen.length = 0
  busy.set(true)
  busy.stop()
  t.mock.timers.tick(5000)
  assert.deepEqual(seen, [])
})
