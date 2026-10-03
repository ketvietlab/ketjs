import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderToString } from '@ketvietlab/ketjs-view'
import { ContextButton } from '../packages/design-system/src/interactions/context-button/index.tsx'
import { Combobox } from '../packages/design-system/src/forms/combobox/index.tsx'

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

test('combobox leading content remains decorative while native value and description are preserved', () => {
  const html = renderToString(
    <Combobox
      id="labels"
      name="label"
      label="Label"
      query=""
      open
      openHref="#open"
      closeHref="#closed"
      options={[
        { value: 'vip', label: 'Priority', description: 'Existing customer', leading: <span>●</span> },
      ]}
    />,
  )
  assert.match(html, /data-ui="combobox-option-leading" aria-hidden="true"/u)
  assert.match(html, /#closed\?label=vip/u)
  assert.match(
    html.replace(/<!--.*?-->/gs, ''),
    /<strong>.*Priority<\/strong>.*<small>Existing customer<\/small>/u,
  )
  assert.match(html, /role="option" aria-selected="false"/u)
})
