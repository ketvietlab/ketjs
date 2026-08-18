// Reactivity is runtime, not compile-time. That single choice is what keeps the
// template compiler small enough to write without a JS parser: it never has to
// analyse dependencies, because the graph builds itself while the effect runs.

type Effect = { fn: () => void; deps: Set<Set<Effect>>; disposed: boolean }

let active: Effect | null = null
let batchDepth = 0
const pending = new Set<Effect>()

export type Signal<T> = {
  (): T
  set(next: T | ((prev: T) => T)): T
  peek(): T
}

export function signal<T>(initial: T): Signal<T> {
  let value = initial
  const subs = new Set<Effect>()
  const read = (() => {
    if (active) { subs.add(active); active.deps.add(subs) }
    return value
  }) as Signal<T>
  read.set = (next) => {
    const v = typeof next === 'function' ? (next as (p: T) => T)(value) : next
    if (Object.is(v, value)) return value       // a no-op write costs nothing
    value = v
    for (const s of [...subs]) schedule(s)
    return value
  }
  read.peek = () => value
  return read
}

function schedule(eff: Effect): void {
  if (batchDepth > 0) { pending.add(eff); return }
  runEffect(eff)
}

function runEffect(eff: Effect): void {
  if (eff.disposed) return
  for (const dep of eff.deps) dep.delete(eff)
  eff.deps.clear()
  const prev = active
  active = eff
  try { eff.fn() } finally { active = prev }
}

export function effect(fn: () => void): () => void {
  const eff: Effect = { fn, deps: new Set(), disposed: false }
  runEffect(eff)
  return () => { eff.disposed = true; for (const d of eff.deps) d.delete(eff); eff.deps.clear() }
}

export function computed<T>(fn: () => T): () => T {
  const s = signal<T>(undefined as T)
  effect(() => { s.set(fn()) })
  return () => s()
}

export function batch<T>(fn: () => T): T {
  batchDepth++
  try { return fn() } finally {
    batchDepth--
    if (batchDepth === 0) {
      const q = [...pending]
      pending.clear()
      for (const e of q) runEffect(e)
    }
  }
}
