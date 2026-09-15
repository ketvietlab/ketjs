import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { ModalSheet } from '@ketvietlab/design-system'
import {
  RECORD_PARAM,
  defineRecordModalIsland,
  readRecordModalTarget,
  recordModalClosedHref,
  recordModalHost,
  recordModalHref,
} from '@ketvietlab/ketsuite/ui'

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
