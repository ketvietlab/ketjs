import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { ContextButton } from '../packages/design-system/src/interactions/context-button/index.tsx'

test('context command preserves native selection, submission identity and two text roles', () => {
  const html = renderToString(
    <ContextButton
      label="Store <one>"
      description="Messaging account"
      count={5}
      pressed
      name="channel"
      value="store-1"
    />,
  )
  assert.match(html, /type="button"/u)
  assert.match(html, /name="channel" value="store-1"/u)
  assert.match(html, /aria-pressed="true"/u)
  assert.match(html, /Store &lt;one&gt;/u)
  assert.match(html, /data-weight="medium"/u)
  assert.match(html, /data-variant="bodySm"/u)
  assert.match(html, /data-ui="badge"/u)
  assert.doesNotMatch(html, /role="tab"|data-ui="surface"/u)
})

test('unavailable context is disabled and zero counts do not create empty badges', () => {
  const html = renderToString(<ContextButton label="Unavailable" disabled pressed={false} count={0} />)
  assert.match(html, /disabled/u)
  assert.match(html, /aria-pressed="false"/u)
  assert.doesNotMatch(html, /data-ui="badge"|context-button-leading|context-button-copy.*bodySm/u)
})
