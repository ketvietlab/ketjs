// Synchronous cost of applying one response: JSON.parse, optional structural
// sharing, one signal write and the render it triggers. No timers, no promises,
// so the numbers are not mixed with scheduling. Run from this directory: node cost.ts
import { countingHost, each, html, mount, signal } from '../../packages/ketjs-view/src/index.ts'
import type { TemplateResult } from '../../packages/ketjs-view/src/index.ts'
import { replaceEqualDeep } from '@tanstack/query-core'
// share is internal to ketjs-view; the benchmark imports the module directly.
import { share } from '../../packages/ketjs-view/src/mirror-share.ts'

type Item = { id: number; name: string; qty: number }
const sizes = (process.env.ROWS ?? '1000,10000').split(',').map(Number)

const body = (n: number, change: (i: number) => Partial<Item>) =>
  JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: i, name: `item ${i}`, qty: i, ...change(i) })))

const strategies: Record<string, (prev: Item[], next: Item[]) => Item[]> = {
  replace: (_prev, next) => next,
  'mirror share': (prev, next) => share(prev, next),
  'tanstack replaceEqualDeep': (prev, next) => replaceEqualDeep(prev, next),
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] as number
const p90 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.9)] as number

for (const n of sizes) {
  const iterations = n >= 10000 ? 60 : 300
  const mid = n >> 1
  // Two alternating bodies per case, so every response after the first is a real change.
  const cases: Record<string, [string, string]> = {
    'nothing changed': [body(n, () => ({})), body(n, () => ({}))],
    '1 row changed': [body(n, () => ({})), body(n, (i) => (i === mid ? { name: 'changed' } : {}))],
    'every row changed': [body(n, () => ({})), body(n, (i) => ({ qty: i + 1 }))],
  }
  console.log(`\n${n} rows, ${iterations} responses per cell (median / p90 ms, rows rebuilt per response)`)
  console.log(
    `${'case'.padEnd(20)}${'strategy'.padEnd(28)}${'view'.padEnd(7)}${'median'.padStart(8)}${'p90'.padStart(8)}${'rows'.padStart(8)}`,
  )
  for (const [caseName, bodies] of Object.entries(cases)) {
    for (const [strategyName, apply] of Object.entries(strategies)) {
      for (const memo of [false, true]) {
        const host = countingHost()
        const container = host.root()
        const data = signal<Item[]>(JSON.parse(bodies[0]))
        const cache = new WeakMap<Item, TemplateResult>()
        let rows = 0
        const row = (item: Item) => {
          const hit = memo ? cache.get(item) : undefined
          if (hit) return hit
          rows++
          const result = html`<li data-id=${item.id}><span>${item.name}</span><b>${item.qty}</b></li>`
          if (memo) cache.set(item, result)
          return result
        }
        const mounted = mount(host, container, () => html`<ul>${each(data(), (it) => it.id, row)}</ul>`)
        const samples: number[] = []
        let rebuilt = 0
        for (let i = 0; i < iterations + 20; i++) {
          const text = bodies[(i + 1) % 2] as string
          rows = 0
          const start = process.hrtime.bigint()
          data.set(apply(data.peek(), JSON.parse(text)))
          const ms = Number(process.hrtime.bigint() - start) / 1e6
          if (i >= 20) {
            samples.push(ms)
            rebuilt += rows
          }
        }
        mounted.dispose()
        console.log(
          `${caseName.padEnd(20)}${strategyName.padEnd(28)}${(memo ? 'memo' : 'plain').padEnd(7)}${median(samples).toFixed(2).padStart(8)}${p90(samples).toFixed(2).padStart(8)}${String(Math.round(rebuilt / iterations)).padStart(8)}`,
        )
      }
    }
  }
}
