import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Translator } from '@ketvietlab/ketjs'
import { each, html, renderToString, signal } from '@ketvietlab/ketjs-view'
import { createFlowMapView } from '../packages/ketsuite/src/ui/client/flow-map-view.mjs'
import { mapScreen } from '../packages/ketsuite/src/modules/flow_backend/screens/map.tsx'

const messages: Record<string, string> = {
  'backend.brand': 'Administration',
  'flow_backend.epics.backToProject': 'Back to project epics',
  'flow_backend.epics.document': 'Epic brief',
}

const translate = ((key: string) => messages[key] ?? key) as Translator
translate.locale = 'en'
translate.has = (key) => key in messages
translate.resolves = translate.has

test('flow epic map: specialized workspace preserves island, identity, return actions and extension slot', () => {
  const map = html`<ket-island data-island="flow.map"><section data-ui="flow-map"></section></ket-island>`
  const rendered = renderToString(
    mapScreen(
      translate,
      { extras: { 'topbar.end': <span data-test="flow-extension">Extension</span> } },
      {
        projectName: 'Internal platform',
        epicTitle: 'First release',
        epicHref: '/admin/flow/epics/release%2Fone?lang=en',
        epicsHref: '/admin/flow/projects/platform%2Fcore/epics?lang=en',
        map,
      },
    ),
  )
  const textContent = rendered.replace(/<!--k\[?-->/g, '')

  assert.match(rendered, /data-ui="board-page"[^>]*data-variant="operational"/)
  assert.doesNotMatch(rendered, /data-ui="list-page"|data-ui="form-page"|data-ui="modal-layer"/)
  assert.match(textContent, /data-ui="board-page-title">First release/)
  assert.match(textContent, /Internal platform/)
  assert.match(rendered, /data-island="flow.map"/)
  assert.match(rendered, /href="\/admin\/flow\/epics\/release%2Fone\?lang=en"/)
  assert.match(rendered, /href="\/admin\/flow\/projects\/platform%2Fcore\/epics\?lang=en"/)
  assert.match(rendered, /data-test="flow-extension"/)
})

test('flow map island: legacy blocking cycles remain finite and use server-owned localized node hrefs', () => {
  const view = createFlowMapView(
    { each, html, signal },
    {
      lang: 'en',
      data: JSON.stringify({
        epicTitle: 'Legacy cycle',
        nodes: [
          {
            id: 'issue/a',
            title: 'Issue A',
            href: '/admin/flow/issues/issue%2Fa?lang=en',
            done: false,
          },
          {
            id: 'issue-b',
            title: 'Issue B',
            href: '/admin/flow/issues/issue-b?lang=en',
            done: false,
          },
        ],
        edges: [
          { source: 'issue/a', target: 'issue-b' },
          { source: 'issue-b', target: 'issue/a' },
        ],
      }),
    },
  )
  const rendered = renderToString(view())

  assert.equal(rendered.match(/data-ui="flow-map-node"/g)?.length, 2)
  assert.equal(rendered.match(/data-ui="flow-map-edge"/g)?.length, 2)
  assert.match(rendered, /href="\/admin\/flow\/issues\/issue%2Fa\?lang=en"/)
  assert.match(rendered, /href="\/admin\/flow\/issues\/issue-b\?lang=en"/)
  assert.match(rendered, /Issue A/)
  assert.match(rendered, /Issue B/)
})
