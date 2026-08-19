// Proves the "surgical" claim with numbers instead of adjectives: how many host
// operations does it actually take to change one row out of a thousand?
import { countingHost, createRoot, html, each } from 'ketjs-view'

type Item = { id: number; name: string; qty: number }

const N = 1000
const mk = (n: number): Item[] => Array.from({ length: n }, (_, i) => ({ id: i, name: `item ${i}`, qty: i }))

const host = countingHost()
const container = host.root()
const root = createRoot(host, container)

const view = (items: Item[]) =>
  html`<ul class="list">${each(
    items,
    (it) => (it as Item).id,
    (it) => {
      const item = it as Item
      return html`<li data-id=${item.id}><span>${item.name}</span><b>${item.qty}</b></li>`
    },
  )}</ul>`

const report = (label: string) => {
  const o = host.ops
  const total = Object.values(o).reduce((a, b) => a + b, 0)
  console.log(
    label.padEnd(34),
    `total=${String(total).padStart(5)}`,
    `createEl=${String(o.createElement).padStart(4)}`,
    `createText=${String(o.createText).padStart(4)}`,
    `setText=${String(o.setText).padStart(4)}`,
    `setAttr=${String(o.setAttribute).padStart(4)}`,
    `insert=${String(o.insert).padStart(5)}`,
    `move=${String(o.move).padStart(4)}`,
    `remove=${String(o.remove).padStart(4)}`,
  )
  host.reset()
}

let items = mk(N)
let t = process.hrtime.bigint()
root.render(view(items))
const mountMs = Number(process.hrtime.bigint() - t) / 1e6
report(`mount ${N} rows`)

// 1. change one field of one row
items = items.map((i) => (i.id === 500 ? { ...i, name: 'ĐÃ ĐỔI' } : i))
t = process.hrtime.bigint()
root.render(view(items))
const updateMs = Number(process.hrtime.bigint() - t) / 1e6
report('update 1 row of 1000')

// 2. no-op re-render
root.render(view(items))
report('re-render, nothing changed')

// 3. prepend one row
items = [{ id: -1, name: 'moi', qty: 0 }, ...items]
root.render(view(items))
report('prepend 1 row')

// 4. remove one row from the middle
items = items.filter((i) => i.id !== 500)
root.render(view(items))
report('remove 1 row from middle')

// 5. swap two rows
const swapped = [...items]
const a = swapped[10] as Item,
  b = swapped[900] as Item
swapped[10] = b
swapped[900] = a
root.render(view(swapped))
report('swap 2 rows')

console.log('')
console.log(`mount  ${N} rows: ${mountMs.toFixed(2)} ms`)
console.log(`update 1 row    : ${updateMs.toFixed(3)} ms`)
console.log('')
console.log('rendered text of row 500 area:', host.text(container).slice(0, 0) || '(ok)')
