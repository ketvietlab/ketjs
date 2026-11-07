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
  /** The flush that last counted this effect's runs. */
  epoch: number
  runs: number
}

/**
 * One effect re-running this often inside a single flush is a feedback cycle,
 * not a workload: it writes a signal it also reads. Without a bound the flush
 * loop never ends and the page stops responding.
 */
const MAX_EFFECT_RUNS_PER_FLUSH = 100

let active: Effect | null = null
let batchDepth = 0
const pending = new Set<Effect>()
let flushing = false
let flushEpoch = 0

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
  const epoch = ++flushEpoch
  // One failing effect must not starve the others queued by the same write, and
  // must not surface at an unrelated later write either. Every queued effect runs;
  // the failures are rethrown to this writer once the graph has settled.
  const errors: unknown[] = []
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
      if (next.epoch !== epoch) {
        next.epoch = epoch
        next.runs = 0
      }
      if (++next.runs > MAX_EFFECT_RUNS_PER_FLUSH) {
        // Skipped for the rest of this flush and reported once. It stays subscribed,
        // so the next write retries it rather than silently disabling it.
        if (next.runs === MAX_EFFECT_RUNS_PER_FLUSH + 1)
          errors.push(
            new Error(
              `signal cycle: an effect ran ${MAX_EFFECT_RUNS_PER_FLUSH} times in one flush; ` +
                'it writes a signal it also reads',
            ),
          )
        continue
      }
      try {
        runEffect(next)
      } catch (error) {
        errors.push(error)
      }
    }
  } finally {
    flushing = false
  }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, `${errors.length} effects failed in one flush`)
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
  const eff: Effect = { fn, deps: new Set(), disposed: false, cleanup: null, computed, epoch: 0, runs: 0 }
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

/**
 * Run fn without subscribing the current effect to the signals it reads. Internal:
 * the Mirror cache calls application callbacks from inside its binding effects, and
 * a signal read there must not turn into a reason to rebind.
 */
export function untracked<T>(fn: () => T): T {
  const prev = active
  active = null
  try {
    return fn()
  } finally {
    active = prev
  }
}
