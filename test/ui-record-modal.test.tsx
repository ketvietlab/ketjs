import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { ModalSheet } from '@ketvietlab/design-system'
import {
  RECORD_NEW_ID,
  RECORD_PARAM,
  defineRecordModalIsland,
  defineRecordPageIsland,
  isRecordModalCreate,
  readRecordModalTarget,
  recordModalClosedHref,
  recordModalCreateHref,
  recordModalHost,
  recordModalHref,
  recordPageLoading,
  recordPageShell,
} from '@ketvietlab/ketsuite/ui'

import {
  RECORD_MODAL_LABELS,
  callRecordFunction,
  callRecordRoute,
  createRecordModal,
  createRecordPage,
  delayedFlag,
  openerHref,
  resolveRecordModalIssue,
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
  assert.match(call, /fixedHeight: definition\.fixedHeight \?\? 'auto'/u)
  assert.match(
    runtime,
    /tallestRecordHeight = Math\.max\(tallestRecordHeight, Math\.ceil\(sheet\.getBoundingClientRect\(\)\.height\)\)/u,
  )
  assert.match(runtime, /if \(!sameRecord\) \{\s*tallestRecordHeight = 0/u)
  assert.match(runtime, /window\.matchMedia\('\(max-width: 47\.9375rem\)'\)/u)
  assert.match(runtime, /root\.addEventListener\('load', fitRecordHeight/u)
  assert.match(runtime, /root\.addEventListener\('toggle', fitRecordHeight/u)
  assert.match(runtime, /document\.fonts\?\.ready\.then/u)
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
  // A nested dialog owns its own fixed actions, independent of the record footer.
  const dialogLayer = runtime.slice(
    runtime.indexOf('const dialogLayer = '),
    runtime.indexOf('return {', runtime.indexOf('const dialogLayer = ')),
  )
  assert.match(dialogLayer, /actions: spec.actions\?\.\(context\)/u)
  assert.match(dialogLayer, /description: spec.description\?\.\(context\)/u)
})

test('record modal: going back over a client-owned entry does not refetch the page', () => {
  const popstate = bootstrap.slice(bootstrap.indexOf("window.addEventListener('popstate'"))
  const dispatchAt = popstate.indexOf("new CustomEvent('ket:popstate', { cancelable: true")
  const navigateAt = popstate.indexOf("void navigate(location.href, 'pop'")
  assert.ok(dispatchAt > 0 && navigateAt > dispatchAt, 'the owner is asked before the page is re-fetched')
  assert.match(popstate.slice(dispatchAt, navigateAt), /if \(!document\.dispatchEvent\(owned\)\) return/u)
  assert.match(runtime, /'ket:popstate'[\s\S]*?event\.preventDefault\(\)/u)
})

test('record modal: cross-collection navigation opens its target without resetting an open draft', () => {
  const listener =
    /'ket:navigation-complete',\s*\(\) => \{([\s\S]*?)\n          \},\s*\{ signal: lifetime \}/u.exec(runtime)
  assert.ok(listener, 'the persistent island follows completed fragment navigation')
  const run = new Function(
    'readRecordModalTarget',
    'location',
    'definition',
    'open',
    'show',
    'hide',
    'page',
    listener[1]!,
  )
  const calls: unknown[][] = []
  const show = (...args: unknown[]) => calls.push(args)
  const target = { kind: 'product.template', id: 'one', tab: 'variants' }
  const invoke = (kind: string, current: unknown, record: typeof target | null = target) =>
    run(
      () => record,
      { href: '/destination' },
      { kind },
      () => current,
      show,
      () => calls.push(['closed']),
      null,
    )
  invoke('product.template', null)
  assert.deepEqual(calls, [['one', 'variants', 'none', undefined, undefined]])
  invoke('product.template', { id: 'one', tab: 'general' })
  invoke('partner.record', null)
  invoke('product.template', null, null)
  assert.equal(calls.length, 1, 'refreshes and unrelated navigation leave the current draft alone')
  invoke('product.template', { id: 'old', tab: 'general' })
  assert.deepEqual(calls.at(-1), ['one', 'variants', 'none', undefined, undefined])
  invoke('product.template', { id: 'one' }, null)
  assert.deepEqual(calls.at(-1), ['closed'])
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
  assert.equal((runtime.match(/fetch\(/gu) ?? []).length, 3)
  assert.match(runtime, /fetch\('\/files'/u, 'uploads go through storage, never a module route')
  assert.match(runtime, /'ket:islands-attach'/u)
  assert.match(bootstrap, /addEventListener\('ket:islands-attach'[\s\S]*?islands\.mount\(root\)/u)
})

test('record modal: a preview command changes nothing and leaves its answer on screen', () => {
  const branch = /if \(command\.preview\) \{([\s\S]*?)\n        \}/u.exec(runtime)
  assert.ok(branch, 'the submit path has a preview branch')
  const body = branch[1]!

  // It hands the answer to the view and stops. The selection needs no saving here:
  // every submit snapshots its layer before it runs, and a preview clears nothing.
  assert.match(body, /outcome\.set\(\{ command: name, value: result\.value \}\)/u)
  assert.match(body, /return/u)
  assert.doesNotMatch(body, /Drafts\.set|drafts\.set/u, 'a preview does not touch the drafts')
  // Nothing is dropped, re-read or announced: the record did not change.
  assert.doesNotMatch(body, /cache\.delete|announce\(\)|load\(/u)
  assert.ok(
    runtime.indexOf('if (command.preview)') < runtime.indexOf('cache.delete(current.id)'),
    'the preview returns before the runtime treats the submit as a change',
  )

  // A preview calls a read that is not declared idempotent, and the server refuses a
  // key on such a function: only a command that writes carries one.
  assert.match(runtime, /const intent = \(\) => \(command\.preview \? undefined : uuid\(\)\)/u)
  assert.doesNotMatch(runtime, /callRecordFunction\(fn, input, \{ idempotencyKey: uuid\(\) \}\)/u)

  // An answer is only ever read beside the selection it was computed from, so
  // everything that moves the layer clears it: another record, a closed modal, a
  // closed or newly opened dialog, another tab, a refusal, and a real write.
  for (const [what, near] of [
    ['another record', /outcome\.set\(null\)\n        dialog\.set/u],
    ['a closed modal', /outcome\.set\(null\)\n      status\.set\('idle'\)/u],
    ['a closed dialog', /outcome\.set\(null\)\n        afterRender\(/u],
    [
      'an opened dialog',
      /outcome\.set\(null\)\n                saved\.set\(false\)\n                dialog\.set\(\{ name: opener/u,
    ],
    ['another tab', /outcome\.set\(null\)\n              show\(/u],
    ['a refusal', /outcome\.set\(null\)\n          issues\.set\(/u],
  ] as const)
    assert.match(runtime, near, `${what} clears the answer`)
  // A write keeps its answer only when it stays in the layer, which is how a
  // credential the server says once reaches the reader.
  assert.match(
    runtime,
    /outcome\.set\(after_\(command\) === 'stay' \? \{ command: name, value: result\.value \} : null\)/u,
  )
  assert.match(runtime, /held\?\.command === command \? \(held\.value as T\) : null/u)
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

test('record modal: read failures replace the loading title and keep retry available', () => {
  assert.match(
    runtime,
    /title:\s*context\s*\? definition\.title\(context\)\s*: t\(status\(\) === 'error' \? 'recordModal.loadFailed' : 'recordModal.loading'\)/u,
  )
  const errorBody = runtime.slice(
    runtime.indexOf("if (status() === 'error')"),
    runtime.indexOf("if (status() !== 'ready'"),
  )
  assert.match(errorBody, /title: t\('recordModal.loadFailed'\)/u)
  assert.match(errorBody, /value: 'retry'/u)
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
  assert.match(runtime, /if \(after !== 'close' && after === declared\) saved\.set\(true\)/u)
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

test('record modal: route contexts preserve authorization failures and abort signals, reject external origins', async (t) => {
  const { readRecordContextRoute } = await import('../packages/ketsuite/src/ui/client/record-modal.tsx')
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location')
  Object.defineProperty(globalThis, 'location', {
    value: new URL('https://care.test/admin/crm/followups'),
    configurable: true,
  })
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'location', original)
    else Reflect.deleteProperty(globalThis, 'location')
  })
  const controller = new AbortController()
  const fetcher = t.mock.method(
    globalThis,
    'fetch',
    async (input: string | URL | Request, init?: RequestInit) => {
      assert.equal(input, 'https://care.test/_care/context?id=one')
      assert.equal(init?.credentials, 'same-origin')
      assert.equal(init?.signal, controller.signal)
      return new Response(JSON.stringify({ data: { id: 'one' } }), { status: 200 })
    },
  )
  assert.deepEqual(await readRecordContextRoute('/_care/context?id=one', controller.signal), {
    ok: true,
    value: { data: { id: 'one' } },
  })
  await assert.rejects(readRecordContextRoute('https://external.test/context'), /same-origin/)
  assert.equal(fetcher.mock.callCount(), 1)
  fetcher.mock.mockImplementation(async () => new Response(null, { status: 403 }))
  assert.deepEqual(await readRecordContextRoute('/private'), {
    ok: false,
    issues: [],
    message: null,
    status: 403,
  })
})

test('record modal: public forms associate fixed-footer submitters and retain command fields', async () => {
  const { RecordModalForm } = await import('../packages/ketsuite/src/ui/client/record-modal.tsx')
  const { Button } = await import('@ketvietlab/design-system')
  const html = await renderToString(
    ModalSheet({
      id: 'nested',
      title: 'Milestone',
      mode: 'client',
      closeLabel: 'Close',
      body: RecordModalForm({
        kind: 'care.program',
        id: 'milestone-form',
        hidden: { __command: 'saveMilestone', id: 'one' },
        fields: [{ id: 'title', name: 'title', label: 'Title', required: true }],
      }),
      actions: Button({ type: 'submit', form: 'milestone-form', label: 'Save' }),
    }),
  )
  assert.match(html, /id="milestone-form"/)
  assert.match(html, /name="__command" value="saveMilestone"/)
  assert.match(html, /form="milestone-form"/)
  assert.ok(html.indexOf('form="milestone-form"') > html.indexOf('</form>'))
})

test('record modal: action forms opt out of field container sizing in fixed footers', () => {
  const css = readFileSync('packages/design-system/src/patterns/record-form/styles.css', 'utf8')
  const actionRule = css.match(/\[data-ui="record-form"\]\[data-layout="actions"\]\s*\{([^}]+)\}/u)?.[1] ?? ''
  assert.match(actionRule, /container-type:\s*normal/u)
  assert.match(actionRule, /flex:\s*0 0 auto/u)
})

test('record modal: a server failure never shows the server text to the user', async (t) => {
  const answer = (status: number, body: unknown) => {
    t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify(body), { status }))
  }
  answer(500, { code: 'E_INTERNAL', message: '"x.fn" attempted write on x.Model but declares effects []' })
  const failed = await callRecordFunction('x.fn', {})
  assert.equal(failed.ok, false)
  assert.equal(failed.ok ? null : failed.message, null, 'the modal falls back to its own words')

  t.mock.restoreAll()
  answer(400, { code: 'E_EXPECTED', message: 'Số điện thoại đã có người dùng' })
  const refused = await callRecordFunction('x.fn', {})
  assert.equal(refused.ok ? null : refused.message, 'Số điện thoại đã có người dùng')
})

test('record modal: command routes reject external destinations and preserve refusal fields', async (t) => {
  let calls = 0
  t.mock.method(globalThis, 'fetch', async (path: unknown, init: RequestInit) => {
    calls++
    assert.equal(path, '/admin/identity/command')
    assert.equal(init.credentials, 'same-origin')
    assert.equal((init.headers as Record<string, string>)['idempotency-key'], 'intent')
    return Response.json({
      ok: true,
      value: { ok: false, errors: [{ field: 'email', code: 'unavailable' }] },
    })
  })
  for (const path of ['https://evil.test/x', '//evil.test/x', '/\\evil.test/x'])
    await assert.rejects(callRecordRoute(path, {}), /same-origin/)
  assert.equal(calls, 0)
  const result = await callRecordRoute('/admin/identity/command', {}, { idempotencyKey: 'intent' })
  assert.equal(result.ok, false)
  if (!result.ok) assert.equal(result.issues[0].field, 'email')
})

test('record modal: unknown refusal codes use a translated fallback without hiding known field guidance', () => {
  const labels = { 'recordModal.saveFailed': 'Không thể lưu thay đổi.' }
  assert.equal(
    resolveRecordModalLabel('E_PROVIDER_UNAVAILABLE', { labels }),
    labels['recordModal.saveFailed'],
  )
  assert.equal(
    resolveRecordModalLabel('E_ROLE_NOT_ASSIGNABLE', {
      labels,
      messages: { E_ROLE_NOT_ASSIGNABLE: 'Chọn lại vai trò.' },
    }),
    'Chọn lại vai trò.',
  )
})

test('record modal: a refusal code no source translates never reaches the reader', () => {
  const labels = {
    'recordModal.saveFailed': 'Không thể lưu thay đổi.',
    'users.emailTaken': 'Email đã có người dùng.',
  }
  for (const code of ['unknown', 'self_change_forbidden', 'E_PROVIDER_UNAVAILABLE'])
    assert.equal(resolveRecordModalIssue(code, { labels }), labels['recordModal.saveFailed'], code)
  assert.equal(resolveRecordModalIssue('users.emailTaken', { labels }), 'Email đã có người dùng.')
  assert.equal(
    resolveRecordModalIssue('unavailable', { messages: { unavailable: 'Email này không dùng được.' } }),
    'Email này không dùng được.',
  )
  assert.equal(resolveRecordModalIssue('unknown', {}), RECORD_MODAL_LABELS['recordModal.saveFailed'])
})

test('record modal: public dropzone forms submit selected files through the upload runtime', () => {
  const source = readFileSync('packages/ketsuite/src/ui/client/record-modal-form.tsx', 'utf8')
  assert.match(source, /dropzone\?: boolean/u)
  assert.match(source, /data-record-dropzone=\{props\.dropzone \? '' : null\}/u)
  assert.match(runtime, /control\.form\?\.hasAttribute\('data-record-dropzone'\)/u)
  assert.match(runtime, /control\.form\?\.requestSubmit\(\)/u)
})

test('record modal: a pending dialog deep link is cleared by normal navigation and close', () => {
  const href = recordModalHref('/admin/crm/tickets?owner=me', {
    kind: 'customer_care.ticket',
    id: 't1',
    tab: 'handle',
    dialog: 'move-progress',
  })
  assert.deepEqual(readRecordModalTarget(href), {
    kind: 'customer_care.ticket',
    id: 't1',
    tab: 'handle',
    dialog: 'move-progress',
  })
  assert.equal(recordModalClosedHref(href), '/admin/crm/tickets?owner=me')
  assert.doesNotMatch(recordModalHref(href, { kind: 'customer_care.ticket', id: 't2' }), /recordDialog/)
  assert.match(runtime, /definition\.dialogs\?\.\[pendingEntryDialog\]/u)
  assert.match(runtime, /pendingEntryDialog = null/u)
})

test('record modal: cancelling one inline editor preserves other drafts and their dirty guard', async () => {
  const { resetRecordDraftFields, recordDraftHasChanges } = await import(
    '../packages/ketsuite/src/ui/client/record-modal.tsx'
  )
  const record = {
    values: { milestone: 'discard', call: 'keep' },
    initialValues: { milestone: 'saved', call: '' },
    checks: { confirmed: true },
    initialChecks: { confirmed: false },
  }
  const cancelled = resetRecordDraftFields(record, ['milestone'])
  assert.equal(cancelled.values.milestone, undefined)
  assert.equal(cancelled.initialValues.milestone, undefined)
  assert.equal(cancelled.values.call, 'keep')
  assert.equal(cancelled.checks.confirmed, true)
  assert.equal(recordDraftHasChanges(cancelled), true)
  assert.equal(record.values.milestone, 'discard', 'draft snapshots stay immutable')
  assert.equal(recordDraftHasChanges(resetRecordDraftFields(cancelled, ['call', 'confirmed'])), false)
})

test('record modal: a section-composed form does not reserve an empty field grid', async () => {
  const { RecordModalForm } = await import('../packages/ketsuite/src/ui/client/record-modal-form.tsx')
  const html = renderToString(
    RecordModalForm({ kind: 'test', fields: [], command: 'save', body: <section>Grouped fields</section> }),
  )
  assert.doesNotMatch(html, /data-ui="form-grid"/)
  assert.match(html, /name="__command" value="save"/)
  assert.match(html.replace(/<!--.*?-->/g, ''), /<section>Grouped fields<\/section>/)
  const withFields = renderToString(
    RecordModalForm({ kind: 'test', fields: [{ id: 'name', name: 'name', label: 'Name' }] }),
  )
  assert.match(withFields, /data-ui="form-grid"/)
})

test('record modal: child view state is isolated and cleared with its draft lifecycle', () => {
  assert.match(runtime, /scope === 'dialog' \? dialogViewState\(\)\[key\] : undefined/u)
  assert.equal(
    (runtime.match(/const stateStore = dialog\(\) \? dialogViewState : viewState/gu) ?? []).length,
    2,
  )
  const resets = [...runtime.matchAll(/dialogDrafts\.set\(emptyDraftState\(\)\)/gu)]
  assert.ok(resets.length > 0)
  for (const reset of resets)
    assert.match(runtime.slice(reset.index, reset.index + 120), /dialogViewState\.set\(\{\}\)/u)
})

test('record page: the server renders the RecordPage loading state the client adopts', () => {
  const props = {
    id: 'tpl',
    title: 'Áo thun',
    loading: 'Đang tải…',
    back: '/admin/product/templates?lang=vi',
    width: 'wide',
  }
  const island = defineRecordPageIsland({ kind: 'product.template', client: 'p.mjs', export: 'templatePage' })
  assert.deepEqual(island.key, ['id'])
  const controller = island.view(props) as { view: () => ReturnType<typeof recordPageLoading> }
  const html = renderToString(controller.view())
  assert.equal(
    html,
    renderToString(recordPageLoading(props)),
    'server and first client render are the same markup',
  )
  assert.match(html, /data-ui="record-page"/u)
  assert.match(html, /Áo thun/u)
  assert.match(html, /Đang tải…/u)
  assert.throws(
    () => defineRecordPageIsland({ kind: 'Product', client: 'p.mjs', export: 'x' }),
    /invalid record kind/u,
  )
})

test('record page: the record runtime renders a page that leaves for its collection and owns no history', () => {
  // One controller serves both presentations; a page is not a layer.
  assert.match(runtime, /export const createRecordPage =/u)
  assert.match(runtime, /: page\s*\? `\[data-ui="record-page"\], \$\{MODAL_LAYER\}`\s*: MODAL_LAYER/u)
  assert.match(runtime, /if \(page\) return pageView\(page\)/u)
  // Closing a page (Close, a delete that closes) leaves through the shell's link handling.
  const hide = runtime.slice(runtime.indexOf('const hide = ('), runtime.indexOf('const close = ('))
  assert.match(hide, /if \(page && how !== 'none'\) \{\s*leave\(\)\s*return/u)
  // Nothing outside the page turns inert and focus is not forced into it.
  const show = runtime.slice(runtime.indexOf('const show = ('), runtime.indexOf('const hide = ('))
  assert.ok(show.indexOf('if (page) {') < show.indexOf('releaseInert = inertOutside(root)'))
  // Back and forward are the shell's on a page.
  assert.match(runtime, /'ket:popstate',\s*\(event\) => \{\s*\/\/[^\n]*\n\s*if \(page\) return/u)
  assert.match(runtime, /'ket:navigation-complete',\s*\(\) => \{\s*if \(page\) return/u)
  // A page re-reads its own context; the shell has no collection behind it to refresh.
  assert.match(runtime, /\.\.\.\(page \? \{ page: true \} : \{\}\)/u)
  const refresh = readFileSync('packages/ketsuite/src/ui/client/table-selection-view.tsx', 'utf8')
  assert.match(refresh, /detail\?\.page\) return/u)
})

// ── Record pages ──────────────────────────────────────────────────────────────

test('record page: the server writes the frame the browser adopts, titled and on its trail', () => {
  const props = {
    id: 'u-1',
    title: 'Minh Trang',
    loadingLabel: 'Đang tải…',
    trail: [
      { label: 'Hệ thống' },
      { label: 'Người dùng', href: '/admin/users?q=tr' },
      { label: 'Minh Trang' },
    ],
    trailLabel: 'Người dùng',
    envelope: { data: {}, messages: {} },
  }
  const html = renderToString(recordPageShell(props))
  assert.match(html, /^<div data-record-layer="page">(?:<!--k\[-->)*<section data-ui="record-page"/u)
  assert.match(html, /data-width="default"/u, 'an administrative profile is a bounded column')
  assert.match(
    html,
    /data-variant="operational"/u,
    'it sits in the operational shell like every other record screen',
  )
  assert.match(
    html,
    /data-variant="operational"/u,
    'it sits in the operational shell like every other record screen',
  )
  assert.match(html, /<nav data-ui="breadcrumbs"[^>]*aria-label="Người dùng"/u)
  assert.match(html, /href="\/admin\/users\?q=tr"/u, 'the way back keeps the collection as it was left')
  assert.match(html, /Minh Trang/u)
  assert.match(html, /Đang tải…/u)
  // The record data rides in the island props, never in the frame itself.
  assert.doesNotMatch(html, /messages/u)

  const island = defineRecordPageIsland({ kind: 'user.user', client: 'user-modal.mjs', export: 'userPage' })
  assert.deepEqual(Object.keys(island.props ?? {}), [
    'id',
    'title',
    'loadingLabel',
    'loading',
    'back',
    'tab',
    'width',
    'trail',
    'trailLabel',
    'envelope',
  ])
  assert.deepEqual(island.key, ['id'])
  const view = island.view(props)
  assert.equal(renderToString((typeof view === 'function' ? view : view.view)()), html)
  assert.throws(() => defineRecordPageIsland({ kind: 'Bad Kind', client: 'x.mjs', export: 'x' }), TypeError)
})

test('record page: the runtime keeps a page a page — no history, no fence, no close', () => {
  // Hydration adopts exactly the server frame before the record is drawn.
  assert.match(runtime, /if \(!adopted\(\)\) return recordPageShell\(pageProps!\)/u)
  assert.match(runtime, /if \(serverPage\) \{\s*adopted\.set\(true\)/u)
  // Links naming records, back/forward and the deep link stay with the modal hosts.
  const click = runtime.slice(runtime.indexOf('const inModal = element?.closest(layerSelector)'))
  assert.match(click.slice(0, click.indexOf('const href = openerHref(element)')), /if \(serverPage\) return/u)
  const mount = runtime.slice(runtime.indexOf('mount: ({ root: host, lifetime })'))
  assert.ok(
    mount.indexOf('if (serverPage) {') < mount.indexOf("'ket:popstate'"),
    'a page returns before it listens to history',
  )
  // The rest of the document is fenced off only while a dialog is over the page.
  const show = runtime.slice(runtime.indexOf('const show = ('), runtime.indexOf('const hide = ('))
  assert.ok(show.indexOf('if (page) {') < show.indexOf('releaseInert = inertOutside(root)'))
  assert.match(
    runtime,
    /if \(currentLayers\.length > 1\) \{\s*if \(root && !releaseInert\) releaseInert = inertOutside\(root\)/u,
  )
  // Closing a dialog leaves the address alone; the page itself never closes.
  assert.match(runtime, /if \(current && !serverPage\)\s*history\.replaceState/u)
  assert.match(runtime, /if \(serverPage\) return\s*if \(!mayDiscard\(recordLayer\(\)\)\) return/u)
  // What would close the modal closes the dialog and reads the record again in place.
  assert.match(runtime, /serverPage &&[\s\S]{0,200}declared === 'close'[\s\S]{0,200}\? \{ dialog: null \}/u)
})

test('record page: both client-read and route-context factories adopt their server frame', () => {
  const definition = {
    kind: 'test.record',
    title: () => 'Record',
    context: { fn: 'test.context' },
  }
  const clientProps = {
    id: 'new',
    title: 'Create',
    loading: 'Loading',
    back: '/admin/records',
    width: 'wide',
  }
  const client = createRecordPage(definition, { path: (id) => `/admin/records/${id}` })(clientProps)
  assert.equal(renderToString(client.view()), renderToString(recordPageLoading(clientProps)))
  const routeProps = {
    id: 'r-1',
    title: 'Record',
    loadingLabel: 'Loading',
    trail: [{ label: 'Records', href: '/admin/records' }],
    envelope: { data: { name: 'Record' }, messages: {} },
  }
  for (const factory of [
    createRecordPage(definition),
    createRecordModal(definition, { presentation: 'page' }),
  ]) {
    const page = factory(routeProps)
    assert.equal(renderToString(page.view()), renderToString(recordPageShell(routeProps)))
  }
})

test('record page: Back guards client-read drafts and returns; route-context profiles stay open', () => {
  const close = runtime.slice(runtime.indexOf('const close = ('), runtime.indexOf('const run = async'))
  const tail = close.slice(close.indexOf('// Route-context pages'), close.lastIndexOf('}'))
  const run = new Function('serverPage', 'mayDiscard', 'recordLayer', 'hide', tail)
  const calls: string[] = []
  const layer = {}
  const invoke = (serverPage: boolean, discard: boolean) =>
    run(
      serverPage,
      (current: unknown) => {
        assert.equal(current, layer)
        calls.push('guard')
        return discard
      },
      () => layer,
      (how: string) => calls.push(how),
    )
  invoke(false, true)
  assert.deepEqual(calls, ['guard', 'history'])
  calls.length = 0
  invoke(false, false)
  assert.deepEqual(calls, ['guard'], 'canceling discard keeps the client-read page')
  calls.length = 0
  invoke(true, true)
  assert.deepEqual(calls, [], 'a route-context profile has no close action')
  assert.match(runtime, /\(!serverPage \|\| inModal\.matches\('\[data-ui="modal-layer"\]'\)\)/u)
})
