// Reactivity is runtime, not compile-time. That single choice is what keeps the
// template compiler small enough to write without a JS parser: it never has to
// analyse dependencies, because the graph builds itself while the effect runs.

type Cleanup = () => void
type Effect = {
  fn: () => unknown
  deps: Set<Set<Effect>>
  disposed: boolean
  cleanup: Cleanup | null
  computed: boolean
}

let active: Effect | null = null
let batchDepth = 0
const pending = new Set<Effect>()
let flushing = false

export type Signal<T> = {
  (): T
  set(next: T | ((prev: T) => T)): T
  peek(): T
}

export function signal<T>(initial: T): Signal<T> {
  let value = initial
  const subs = new Set<Effect>()
  const read = (() => {
    if (active) {
      subs.add(active)
      active.deps.add(subs)
    }
    return value
  }) as Signal<T>
  read.set = (next) => {
    const v = typeof next === 'function' ? (next as (p: T) => T)(value) : next
    if (Object.is(v, value)) return value // a no-op write costs nothing
    value = v
    for (const s of subs) pending.add(s)
    if (batchDepth === 0) flush()
    return value
  }
  read.peek = () => value
  return read
}

function flush(): void {
  if (flushing || batchDepth > 0) return
  flushing = true
  try {
    while (pending.size) {
      // Derived values must settle before ordinary effects observe them. Picking one
      // item at a time also lets a computed enqueue another computed ahead of a
      // render that was already waiting, without a second render or a stale read.
      let next: Effect | undefined
      for (const effect of pending) {
        if (!effect.computed) continue
        next = effect
        break
      }
      next ??= pending.values().next().value
      if (!next) break
      pending.delete(next)
      runEffect(next)
    }
  } finally {
    flushing = false
  }
}

function runEffect(eff: Effect): void {
  if (eff.disposed) return
  const cleanup = eff.cleanup
  eff.cleanup = null
  for (const dep of eff.deps) dep.delete(eff)
  eff.deps.clear()
  cleanup?.()
  const prev = active
  active = eff
  try {
    const cleanup = eff.fn()
    if (typeof cleanup === 'function') eff.cleanup = cleanup as Cleanup
  } finally {
    active = prev
  }
}

function makeEffect(fn: () => unknown, computed: boolean): () => void {
  const eff: Effect = { fn, deps: new Set(), disposed: false, cleanup: null, computed }
  try {
    runEffect(eff)
  } catch (error) {
    // An effect that fails during its eager first run never reaches its caller, so
    // nobody can dispose it. Roll its subscriptions back here or a later signal
    // write would revive a half-created render/hydration effect.
    eff.disposed = true
    pending.delete(eff)
    for (const dep of eff.deps) dep.delete(eff)
    eff.deps.clear()
    eff.cleanup?.()
    eff.cleanup = null
    throw error
  }
  return () => {
    eff.disposed = true
    pending.delete(eff)
    for (const d of eff.deps) d.delete(eff)
    eff.deps.clear()
    eff.cleanup?.()
    eff.cleanup = null
  }
}

export function effect(fn: () => Cleanup): () => void
export function effect(fn: () => void): () => void
export function effect(fn: () => unknown): () => void {
  return makeEffect(fn, false)
}

export type Computed<T> = {
  (): T
  peek(): T
  dispose(): void
}

export function computed<T>(fn: () => T): Computed<T> {
  const s = signal<T>(undefined as T)
  const dispose = makeEffect(() => {
    s.set(fn())
  }, true)
  const read = (() => s()) as Computed<T>
  read.peek = s.peek
  read.dispose = dispose
  return read
}

export function batch<T>(fn: () => T): T {
  batchDepth++
  try {
    return fn()
  } finally {
    batchDepth--
    if (batchDepth === 0) {
      flush()
    }
  }
}
