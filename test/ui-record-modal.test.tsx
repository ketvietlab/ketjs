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

test('record modal: a record with several tabs keeps one height while tabs switch, and a definition may cap it', () => {
  // The record layer asks for a fixed dialog only when there is more than one tab to switch between.
  const recordLayer = runtime.slice(runtime.indexOf('id: `record-modal-${definition.kind'))
  const call = recordLayer.slice(0, recordLayer.indexOf('body: recordBody()'))
  assert.match(
    call,
    /height:\s*\(definition\.tabs\?\.length \?\? 0\) \+ \(definition\.extensionTabs \? 1 : 0\) > 1 \? 'fixed' : 'content'/u,
  )
  assert.match(call, /fixedHeight: definition\.fixedHeight/u)
  // A dialog layer opened from the record keeps sizing to its content.
  const dialogLayer = runtime.slice(
    runtime.indexOf('const dialogLayer = '),
    runtime.indexOf('return {', runtime.indexOf('const dialogLayer = ')),
  )
  assert.doesNotMatch(dialogLayer, /height:/u)
})

test('record modal: a definition may put a footer of actions outside the scrolling body', () => {
  const recordLayer = runtime.slice(runtime.indexOf('id: `record-modal-${definition.kind'))
  const call = recordLayer.slice(0, recordLayer.indexOf('body: recordBody()'))
  assert.match(call, /actions: context \? definition\.actions\?\.\(context\) : undefined/u)
  // A dialog layer never gets one — it already carries its own in-body submit button.
  const dialogLayer = runtime.slice(
    runtime.indexOf('const dialogLayer = '),
    runtime.indexOf('return {', runtime.indexOf('const dialogLayer = ')),
  )
  assert.doesNotMatch(dialogLayer, /actions:/u)
})

test('record modal: going back over a client-owned entry does not refetch the page', () => {
  const popstate = bootstrap.slice(bootstrap.indexOf("window.addEventListener('popstate'"))
  const dispatchAt = popstate.indexOf("new CustomEvent('ket:popstate', { cancelable: true")
  const navigateAt = popstate.indexOf("void navigate(location.href, 'pop'")
  assert.ok(dispatchAt > 0 && navigateAt > dispatchAt, 'the owner is asked before the page is re-fetched')
  assert.match(popstate.slice(dispatchAt, navigateAt), /if \(!document\.dispatchEvent\(owned\)\) return/u)
  assert.match(runtime, /'ket:popstate'[\s\S]*?event\.preventDefault\(\)/u)
})

test("record modal: opening a record saves the list page's scroll position before pushing, so closing restores it", () => {
  // Mirrors `saveScroll` in packages/ketjs/src/server/http.ts: without this, going back
  // out of the modal restores no scroll (the entry never carried one) and the page jumps
  // to the top, since the shell's own `popstate` handler falls back to `__ketScroll ?? [0, 0]`.
  const show = runtime.slice(runtime.indexOf('const show = ('), runtime.indexOf('const hide = ('))
  const pushBranch = show.slice(show.indexOf("if (how === 'push') {"))
  const scrollSaveAt = pushBranch.indexOf('__ketScroll: [window.scrollX, window.scrollY]')
  const pushStateAt = pushBranch.indexOf('history.pushState(')
  assert.ok(
    scrollSaveAt > 0 && pushStateAt > scrollSaveAt,
    'scroll is snapshotted before the new entry is pushed',
  )
})

test('record modal: the runtime owns focus, escape, inertness, drafts and collection refresh', () => {
  assert.match(runtime, /event\.key === 'Escape'/u)
  assert.match(runtime, /const inertOutside = /u)
  assert.match(runtime, /restore|returnFocus/u)
  // The layer is snapshotted before the guard goes up, so what was typed survives
  // the render that disables the form.
  assert.match(runtime, /keepDrafts\(currentLayer, scope\)[\s\S]*?setRunning\(true\)/u)
  assert.match(runtime, /kept\.checks\[key\] = control\.checked/u)
  assert.match(runtime, /if \(!mayDiscard\(topLayer\(\)\)\) return/u)
  assert.match(runtime, /record\.inert = currentLayers\.length > 1/u)
  assert.match(runtime, /dialogReturnFocus/u)
  assert.match(runtime, /keepAllDrafts\(\)[\s\S]*?viewState\.set/u)
  assert.match(runtime, /'idempotency-key'/u)
  assert.match(runtime, /new CustomEvent\('ket:records-changed'/u)
  // A view never fetches: only the runtime calls the function endpoint and `/files`.
  assert.equal((runtime.match(/fetch\(/gu) ?? []).length, 2)
  assert.match(runtime, /fetch\('\/files'/u, 'uploads go through storage, never a module route')
  assert.match(runtime, /'ket:islands-attach'/u)
  assert.match(bootstrap, /addEventListener\('ket:islands-attach'[\s\S]*?islands\.mount\(root\)/u)
})

test('record modal: tabs another module adds follow the declared ones through the same filter', () => {
  const visible = runtime.slice(
    runtime.indexOf('const visibleTabs = '),
    runtime.indexOf('const contextFor = '),
  )
  assert.match(
    visible,
    /\[\.\.\.\(definition\.tabs \?\? \[\]\), \.\.\.\(definition\.extensionTabs\?\.\(context\) \?\? \[\]\)\]/u,
  )
  assert.match(visible, /tab\.visible\?\.\(context\) \?\? true/u)
})

test('record modal: tab layout is owned by the runtime instead of module views', () => {
  assert.match(runtime, /return TabbedView\(\{/u)
  assert.match(runtime, /body = active \? active\.view\(context\)/u)
  assert.match(runtime, /keepDrafts\(recordLayer\(\), 'record'\)/u)
  assert.match(runtime, /\[data-ui="tab"\]\[data-active="true"\]/u)
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
    getAttribute: (name: string) => (name === 'data-row-href' ? (chain[index]?.href ?? null) : null),
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

test('record modal: a command that leaves the modal open says it worked', () => {
  // A save is answered before the button could say anything and often changes
  // nothing the reader can see, so the form says so in the slot a refusal uses.
  const notice = runtime.slice(runtime.indexOf('const formIssues = '))
  assert.match(
    notice.slice(0, notice.indexOf('return Notice({', notice.indexOf('if (!all.length)'))),
    /saved\(\)[\s\S]*?tone: 'positive'/u,
    'the positive notice stands where the danger notice would',
  )
  // One that closes says it by closing.
  assert.match(runtime, /if \(after !== 'close'\) saved\.set\(true\)/u)
  // It is never stale: a new submit, another record and closing all clear it.
  assert.match(runtime, /showBusy\.set\(value\)\s*\n\s*if \(value\) saved\.set\(false\)/u)
  const show = runtime.slice(runtime.indexOf('const show = '))
  assert.match(show.slice(0, show.indexOf('open.set({ id, tab: nextTab })')), /saved\.set\(false\)/u)
  const hide = runtime.slice(runtime.indexOf('const hide = '))
  assert.match(hide.slice(0, hide.indexOf('releaseInert?.()')), /saved\.set\(false\)/u)
})

test('record modal: a multi-step command stops at the first failing call and skips a step whose `when` says no', () => {
  // A "save" spanning functions in different modules — none may call another —
  // still reads as one action: one busy state, one notice, stopping on the first
  // call that fails rather than papering over it with a later step's success.
  assert.match(runtime, /command\.also \?\? \[\]/u)
  assert.match(runtime, /if \(step\.when && !step\.when\(context\)\) continue/u)
  assert.match(runtime, /if \(!result\.ok\) break/u)
})

test('record modal: a command may ask before it runs, and a decline leaves the record untouched', () => {
  const runAt = runtime.indexOf('const run = async')
  const run = runtime.slice(runAt, runtime.indexOf('setRunning(true)', runAt))
  assert.match(run, /if \(command\.confirm\)/u)
  assert.match(run, /if \(message && !globalThis\.confirm\(message\)\) return/u)
})

test('record modal: a record wears its state beside the title, inside the head', () => {
  const html = renderToString(
    ModalSheet({
      id: 'sheet',
      mode: 'client',
      title: 'Qualified',
      status: 'Đang dùng',
      closeLabel: 'Đóng',
      body: 'nội dung',
    }),
  )
  const head = html.slice(html.indexOf('data-ui="modal-head"'), html.indexOf('data-ui="modal-body"'))
  // In the head, so it stays put while the body scrolls, and on the title's own
  // row rather than above the form where it reads as part of the record.
  assert.match(head, /data-ui="modal-title-row"[\s\S]*?Qualified[\s\S]*?Đang dùng/u)
  assert.doesNotMatch(html.slice(html.indexOf('data-ui="modal-body"')), /Đang dùng/u)
  // A record with no state to report leaves the row to the title.
  const plain = renderToString(
    ModalSheet({ id: 'sheet', mode: 'client', title: 'Qualified', closeLabel: 'Đóng', body: '' }),
  )
  assert.match(plain, /data-ui="modal-title-row"/u)
})

test('record modal: unsaved fields on another tab survive remounts and reverting clears the guard', async () => {
  const { recordDraftHasChanges } = await import('../packages/ketsuite/src/ui/client/record-modal.tsx')
  const record = {
    values: { name: 'Edited', body: '' },
    initialValues: { name: 'Saved', body: '' },
    checks: { 'tags\u0000one': false },
    initialChecks: { 'tags\u0000one': true },
  }
  assert.equal(recordDraftHasChanges(record), true)
  // Capturing an untouched dialog must not clear the underlying record's guard.
  const dialog = { values: { reason: '' }, initialValues: { reason: '' }, checks: {}, initialChecks: {} }
  assert.equal(recordDraftHasChanges(dialog), false)
  assert.equal(recordDraftHasChanges(record), true)
  record.values.name = 'Saved'
  assert.equal(recordDraftHasChanges(record), true, 'unchecked options are also unsaved edits')
  record.checks['tags\u0000one'] = true
  assert.equal(recordDraftHasChanges(record), false)
})
