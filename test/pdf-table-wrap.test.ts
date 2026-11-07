import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { compileReportTemplate, interFontUrl, parseTrueType, renderPdf } from '@ketvietlab/ketjs/pdf'

const bytes = await Promise.all(
  ['regular', 'semibold', 'bold'].map((weight) =>
    readFile(interFontUrl(weight as 'regular' | 'semibold' | 'bold')),
  ),
)
const options = { font: bytes[0]!, semiboldFont: bytes[1]!, boldFont: bytes[2]! }
const fonts = bytes.map(parseTrueType)
const template =
  '<report paper="A5" margin="34"><table><thead><tr><th>Description</th><th>Quantity</th><th>Amount</th></tr></thead><tbody>{% for row in rows %}<tr><td>{{ row.name }}</td><td>{{ row.qty }}</td><td>{{ row.amount }}</td></tr>{% endfor %}</tbody></table></report>'
const render = (rows: { name: string; qty: string; amount: string }[]) => {
  const pdf = renderPdf(compileReportTemplate(template).render({ rows }), options)
  const source = Buffer.from(pdf).toString('latin1')
  const chars = new Set(
    Array.from('DescriptionQuantityAmount' + rows.map((row) => row.name + row.qty + row.amount).join('')),
  )
  const maps = fonts.map(
    (font) => new Map([...chars].map((char) => [font.glyphOf(char.codePointAt(0)!), char])),
  )
  const runs = [
    ...source.matchAll(/BT \/F([123]) ([\d.]+) Tf 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm <([0-9a-f]*)> Tj/giu),
  ].map((match) => {
    const font = fonts[Number(match[1]) - 1]!
    const glyphs = match[5]!.match(/.{4}/gu)?.map((value) => Number.parseInt(value, 16)) ?? []
    return {
      text: glyphs.map((glyph) => maps[Number(match[1]) - 1]!.get(glyph) ?? '?').join(''),
      page: source.slice(0, match.index).lastIndexOf('stream\n'),
      font: Number(match[1]),
      x: Number(match[3]),
      y: Number(match[4]),
      width:
        (glyphs.reduce((sum, glyph) => sum + font.widthOf(glyph), 0) * Number(match[2])) / font.unitsPerEm,
    }
  })
  return { source, runs, pages: [...source.matchAll(/\/Type \/Page\b/gu)].length }
}
const withinCells = (runs: ReturnType<typeof render>['runs']) => {
  const cellWidth = (419.53 - 68) / 3
  for (const run of runs.filter((run) => run.text)) {
    assert.ok(run.x >= 33.99 && run.x + run.width <= 385.54, JSON.stringify(run))
    const column = Math.floor((run.x - 34 + 0.01) / cellWidth)
    assert.ok(run.x + run.width <= 34 + (column + 1) * cellWidth + 0.01, JSON.stringify(run))
    assert.ok(run.y >= 34 && run.y <= 561.29, JSON.stringify(run))
  }
}

test('PDF cells wrap by embedded-font measurements and preserve Vietnamese descriptions', () => {
  const name = 'Kiểm tra thiết bị, bàn giao và hướng dẫn vận hành. '.repeat(4).trim()
  const result = render([{ name, qty: '2', amount: '125000' }])
  withinCells(result.runs)
  const description = result.runs
    .filter((run) => run.font === 1 && run.x < 100)
    .map((run) => run.text)
    .join(' ')
  assert.equal(description, name)
  assert.equal(result.runs.filter((run) => run.text === '125000').length, 1)
  assert.ok(result.runs.filter((run) => run.font === 1 && run.x < 100).length > 1)
})

test('PDF unbroken identifiers wrap without loss or escaping their column', () => {
  const name = 'SKU' + '0123456789'.repeat(20)
  const result = render([{ name, qty: '1', amount: '99' }])
  withinCells(result.runs)
  assert.equal(
    result.runs
      .filter((run) => run.font === 1 && run.x < 100)
      .map((run) => run.text)
      .join(''),
    name,
  )
})

test('PDF wrapped rows paginate, repeat column headings and do not duplicate amounts', () => {
  const rows = Array.from({ length: 15 }, (_, index) => ({
    name: `Service ${index} ` + 'Installation and training '.repeat(8),
    qty: '1',
    amount: String(90000 + index),
  }))
  const result = render(rows)
  withinCells(result.runs)
  assert.ok(result.pages >= 3)
  assert.equal(result.runs.filter((run) => run.text === 'Description').length, result.pages)
  for (const row of rows) assert.equal(result.runs.filter((run) => run.text === row.amount).length, 1)
})

test('PDF a row taller than a page continues with every word and one numeric fact', () => {
  const name = 'Long description '.repeat(600).trim()
  const result = render([{ name, qty: '7', amount: '88888' }])
  withinCells(result.runs)
  assert.ok(result.pages > 3)
  assert.equal(
    result.runs
      .filter((run) => run.font === 1 && run.x < 100)
      .map((run) => run.text)
      .join(' '),
    name,
  )
  assert.equal(result.runs.filter((run) => run.text === '88888').length, 1)
})

test('PDF rejects repeatable headers that leave no room for page content', () => {
  const doc = compileReportTemplate(
    '<report paper="A5"><table><thead><tr><th>{{ heading }}</th><th>Amount</th></tr></thead><tbody><tr><td>One</td><td>1</td></tr></tbody></table></report>',
  ).render({ heading: 'Long heading '.repeat(1000) })
  assert.throws(() => renderPdf(doc, options), /headers exceed page height/)
})

test('PDF keeps a wrapped row together when the row fits on a fresh page', () => {
  const markers = ['ALPHA', 'BRAVO', 'CHARLIE']
  const result = render(
    markers.map((marker, index) => ({
      name: (marker + ' ').repeat(80),
      qty: '1',
      amount: String(7000 + index),
    })),
  )
  withinCells(result.runs)
  for (const marker of markers) {
    const pages = new Set(result.runs.filter((run) => run.text.includes(marker)).map((run) => run.page))
    assert.equal(pages.size, 1, marker)
  }
})
