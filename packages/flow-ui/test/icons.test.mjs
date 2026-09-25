import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { icons, LUCIDE_VERSION } from '../src/icons.mjs'
import { FlowIcon } from '../src/index.mjs'

test('icons are vendored Lucide glyphs with the ISC notice, drawn at Lucide stroke width like the design system', async () => {
  assert.match(LUCIDE_VERSION, /^\d+\.\d+\.\d+$/)
  assert.match(
    await readFile(new URL('../LUCIDE-LICENSE', import.meta.url), 'utf8'),
    /ISC License[\s\S]*Lucide Icons and Contributors/,
  )
  // Path-only glyphs are copied verbatim from lucide-static.
  assert.equal(icons.check, 'M20 6 9 17l-5-5')
  assert.equal(icons.plus, 'M5 12h14M12 5v14')
  assert.equal(icons.board, 'M5 3v14M12 3v8M19 3v18')
  // A leading relative moveto is made absolute while its follow-up pairs stay relative.
  assert.ok(icons.search.startsWith('M21 21l-4.34-4.34'))
  assert.equal(icons.chevron, 'M9 18l 6-6-6-6')
  // Circles and rounded rects become equivalent arcs.
  assert.ok(icons.clock.startsWith('M2 12a10 10 0 1 0 20 0a10 10 0 1 0 -20 0'))
  assert.ok(
    icons.image.startsWith('M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2Z'),
  )
  for (const [name, d] of Object.entries(icons)) assert.match(d, /^M/, name)
  const svg = renderToStaticString(FlowIcon('settings'))
  assert.match(svg, /stroke-width="2"/)
  assert.match(svg, /fill="none"/)
  assert.match(svg, /aria-hidden="true"/)
})
