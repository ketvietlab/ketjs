import test from 'node:test'
import assert from 'node:assert/strict'
import { missingMessages, translator } from '@ketvietlab/ketjs'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import {
  FLOW_LANGUAGES,
  flowLocale,
  setFlowLocale,
  tr,
  flowMessageManifest,
  flowClientMessages,
  registerFlowMessages,
} from '@ketvietlab/flow-client/i18n.mjs'
import { createFlowWorkspace, routes } from '@ketvietlab/flow-client/workspace.mjs'
import { createOrganizationSession } from '../atlas/organization-store.mjs'
import { createFnClient } from '@ketvietlab/flow-client/api.mjs'

test('English default and complete KetJS catalogs in requested order', () => {
  assert.equal(flowLocale(), 'en')
  assert.deepEqual(
    FLOW_LANGUAGES.map((x) => x.value),
    ['en', 'ja', 'vi'],
  )
  assert.deepEqual(missingMessages(flowMessageManifest, ['en', 'ja', 'vi']), {})
  const messages = /** @type {Record<string, Record<string, string>>} */ (flowMessageManifest.messages)
  assert.ok(
    Object.keys(messages.en).length > Object.keys(flowClientMessages.en).length,
    'kit and core product catalogs are all registered',
  )
  for (const [key, english] of Object.entries(messages.en)) {
    const tokens = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((x) => x[1]).sort()
    for (const lang of ['ja', 'vi'])
      assert.deepEqual(tokens(messages[lang][key]), tokens(english), `${lang}:${key}`)
    assert.equal(tr(key), translator(flowMessageManifest, 'en')(key))
  }
  assert.throws(() => registerFlowMessages({ en: { 'ui.group.status': 'Twice' } }), /already registered/)
  setFlowLocale('invalid')
  assert.equal(flowLocale(), 'en')
})

test('all screens render in three languages and existing island switches without changing data', async () => {
  const oldWindow = globalThis.window,
    oldObserver = globalThis.MutationObserver
  globalThis.window = new EventTarget()
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  }
  try {
    for (const screen of Object.keys(routes)) {
      const fixture = createOrganizationSession('baseline', screen)
      const call = createFnClient({
        fetch: async (url, request) =>
          new Response(
            JSON.stringify(fixture.call(decodeURIComponent(url.split('/').pop()), JSON.parse(request.body))),
            { status: 200 },
          ),
      })
      const lifetime = new AbortController()
      const island = createFlowWorkspace({ screen }, { call })
      island.mount({
        root: Object.assign(new EventTarget(), {
          ownerDocument: new EventTarget(),
          querySelector: () => null,
          querySelectorAll: () => [],
        }),
        lifetime: lifetime.signal,
      })
      await new Promise((resolve) => setTimeout(resolve, 0))
      for (const lang of ['en', 'ja', 'vi']) {
        setFlowLocale(lang)
        const output = renderToStaticString(island.view())
        assert.doesNotMatch(output, /\[object Object\]|undefined|flow\.ui\.[a-z]/, `${screen}:${lang}`)
        if (screen === 'board') {
          assert.ok(output.includes(tr('flow.ui.group.status')), `${lang}: group option updates`)
          assert.ok(output.includes('KetSuite Core'), 'project name remains user data')
        }
      }
      lifetime.abort()
      island.dispose()
    }
  } finally {
    globalThis.window = oldWindow
    globalThis.MutationObserver = oldObserver
    setFlowLocale('en')
  }
})

test('core does not carry private feature catalogs', () => {
  for (const key of Object.keys(flowClientMessages.en))
    assert.doesNotMatch(key, /^(hours|performance|goals|integrations)\./)
})
