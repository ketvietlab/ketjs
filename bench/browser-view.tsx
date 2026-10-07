import { createRoot, domHost, each, type HostNode } from '@ketvietlab/ketjs-view'

type Item = { id: number; name: string; qty: number }
const host = domHost(document)
const view = (items: Item[]) => (
  <ul>
    {each(
      items,
      (item) => (item as Item).id,
      (item) => {
        const row = item as Item
        return (
          <li>
            <span>{row.name}</span>
            <b>{row.qty}</b>
          </li>
        )
      },
    )}
  </ul>
)
// domHost uses native DOM nodes behind the host-neutral renderer boundary.
const ui = createRoot(host, document.body as unknown as HostNode)
async function run() {
  const button = document.querySelector<HTMLButtonElement>('button')!
  const output = document.querySelector<HTMLPreElement>('#results')!
  const container = document.querySelector<HTMLElement>('#fixture')!
  button.disabled = true
  const samples: Record<string, number[]> = {
    mount: [],
    update: [],
    unchanged: [],
    swap: [],
    removeAndAdd: [],
  }
  for (let round = -5; round < 30; round++) {
    await new Promise(requestAnimationFrame)
    const root = createRoot(host, container as unknown as HostNode)
    let items = Array.from({ length: 1000 }, (_, id) => ({ id, name: `Item ${id}`, qty: id }))
    const measure = (name: string, operation: () => void) => {
      const start = performance.now()
      operation()
      const ms = performance.now() - start
      if (round >= 0) samples[name].push(ms)
    }
    measure('mount', () => root.render(view(items)))
    items = items.map((item) => (item.id === 500 ? { ...item, name: 'Changed' } : item))
    measure('update', () => root.render(view(items)))
    measure('unchanged', () => root.render(view(items)))
    const swapped = [...items]
    ;[swapped[10], swapped[900]] = [swapped[900], swapped[10]]
    measure('swap', () => root.render(view(swapped)))
    const removed = swapped.filter((item) => item.id !== 500)
    measure('removeAndAdd', () => {
      root.render(view(removed))
      root.render(view(swapped))
    })
    if (container.querySelectorAll('li').length !== 1000 || !container.textContent?.includes('Changed'))
      throw new Error('Invalid benchmark result')
    root.dispose()
    container.replaceChildren()
    output.textContent = `Measured ${round + 1} of 30 rounds…`
  }
  const operations = Object.fromEntries(
    Object.entries(samples).map(([name, values]) => {
      values.sort((a, b) => a - b)
      return [name, { medianMs: values[15], p95Ms: values[28], samples: values }]
    }),
  )
  output.textContent = JSON.stringify(
    { rows: 1000, warmups: 5, rounds: 30, userAgent: navigator.userAgent, operations },
    null,
    2,
  )
  button.disabled = false
}
ui.render(
  <main>
    <h1>ketjs-view browser benchmark</h1>
    <p>Actual DOM operations. Timings exclude layout and paint. Five warmups, thirty measured rounds.</p>
    <button type="button" onClick={() => void run()}>
      Run benchmark
    </button>
    <pre id="results">Ready</pre>
    <div id="fixture" />
  </main>,
)
