import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { renderToString } from '@ketvietlab/ketjs-view'
import { Button, IconButton, LinkButton } from '../packages/design-system/src/primitives/actions/index.tsx'
import { TextField } from '../packages/design-system/src/forms/scalar-fields/index.tsx'
test('large actions preserve native semantics and size hook', () => {
  for (const view of [
    <Button label="Continue" type="submit" size="large" />,
    <LinkButton label="Back" href="/login" size="large" />,
    <IconButton label="Search" icon="search" size="large" />,
  ])
    assert.match(renderToString(view), /data-size="large"/)
  assert.match(renderToString(<Button label="Continue" type="submit" size="large" />), /type="submit"/)
  assert.ok(renderToString(<LinkButton label="Back" href="/login" size="large" />).includes('href="/login"'))
})
test('large native and compound fields preserve label and help association', () => {
  for (const suffix of [undefined, '@example.com']) {
    const html = renderToString(
      <TextField
        id="account"
        name="account"
        label="Account"
        size="large"
        suffix={suffix}
        help="Company account"
      />,
    )
    assert.match(html, /data-size="large"/)
    assert.match(html, /for="account"/)
    assert.match(html, /aria-describedby="account-help"/)
  }
  assert.doesNotMatch(
    renderToString(<TextField id="default" name="default" label="Default" />),
    /data-size="large"/,
  )
})
test('large contract is opt-in and switches at the existing mobile boundary', () => {
  const css = readFileSync('packages/design-system/src/foundations/control-sizes.css', 'utf8')
  assert.match(css, /--kv-control-height-large: 2.25rem/)
  assert.match(css, /max-width: 47.9375rem/)
  assert.match(css, /--kv-control-height-large: 2.75rem/)
  assert.match(css, /\[data-ui="field"\]\[data-size="large"\]/)
  assert.match(css, /\[data-ui="action"\]\[data-size="large"\]/)
  assert.doesNotMatch(css, /--kv-control-height-md:/)
})
