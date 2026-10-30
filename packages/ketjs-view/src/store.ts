// Island stores: the state that belongs to one island instance.
//
// A store is a pure factory. Its setup runs once per instance, during a server render
// and again in the browser, so it must not touch browser state: listeners, timers and
// subscriptions start in connect(), which runs only after attach(lifetime). Outside
// the store its state is read-only; writes go through actions, which batch. There is
// deliberately no global store: a module-level instance would be shared by every
// request a server renders.
import type { ReadonlySignal } from './form.ts'
import { batch, computed, signal, untracked } from './signal.ts'
import type { Computed, Signal } from './signal.ts'

export type TaskConcurrency = 'exclusive' | 'latest'

export type TaskOptions = {
  /**
   * `exclusive` (the default) rejects a run while one is pending; `latest` aborts the
   * pending run and starts the new one.
   */
  concurrency?: TaskConcurrency
}

export type TaskOutcome<R> =
  | { status: 'done'; value: R }
  | { status: 'failed'; error: unknown }
  /** A newer run of a `latest` task aborted this one. */
  | { status: 'superseded' }
  /** An `exclusive` task was already running. */
  | { status: 'rejected' }
  /** The lifetime ended or the store was disposed while the task ran. */
  | { status: 'aborted' }

export type Task<I, R> = {
  /** Never throws: the outcome says what happened. A task without input runs as `run()`. */
  run(...input: undefined extends I ? [input?: I] : [input: I]): Promise<TaskOutcome<R>>
  readonly pending: ReadonlySignal<boolean>
  /** The last failure; cleared when a run starts. */
  readonly error: ReadonlySignal<unknown>
}

export type StoreScope = {
  /**
   * State owned by the store, writable inside the store only. Plain objects and arrays
   * are frozen in place when they are written; other objects are held as they are.
   */
  state<T>(initial: T): Signal<T>
  /** A value computed from other signals, disposed with the store. */
  derived<T>(fn: () => T): ReadonlySignal<T>
  /** A write that runs in one batch and without tracking. It does nothing after dispose. */
  action<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R | undefined
  /** Async work outside any cache, with explicit concurrency. */
  task<I, R>(run: (input: I, signal: AbortSignal) => Promise<R>, options?: TaskOptions): Task<I, R>
  /**
   * Browser wiring. Runs on every attach(), never during a server render; the cleanup
   * and the lifetime's abort run when the lifetime aborts or the store is disposed.
   */
  connect(fn: (lifetime: AbortSignal) => () => void): void
  connect(fn: (lifetime: AbortSignal) => void): void
  /** Dispose a child (a Mirror reading, a form session, a nested store) with this store. */
  own<D extends { dispose(): void }>(child: D): D
}

/** The members a setup returns; its own top-level state is read-only from outside. */
export type StoreMembers<S> = {
  readonly [K in keyof S]: S[K] extends Signal<infer T> ? ReadonlySignal<T> : S[K]
}

export type Store<S> = StoreMembers<S> & {
  readonly id: string
  /** Start connect() wiring for one lifetime, such as an island's mount lifetime. */
  attach(lifetime: AbortSignal): void
  dispose(): void
  /** A JSON copy of the top-level state members, for tests and diagnostics. */
  snapshot(): Readonly<Record<string, unknown>>
}

export type StoreFactory<Input, Deps, S> = (
  input: Readonly<Input>,
  ...deps: undefined extends Deps ? [deps?: Deps] : [deps: Deps]
) => Store<S>

const RESERVED = new Set(['id', 'attach', 'dispose', 'snapshot'])

const isSignal = (value: unknown): value is Signal<unknown> =>
  typeof value === 'function' &&
  typeof (value as Partial<Signal<unknown>>).set === 'function' &&
  typeof (value as Partial<Signal<unknown>>).peek === 'function'

const isPlain = (value: object): boolean => {
  if (Array.isArray(value)) return true
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

// Subtrees this helper froze all the way down. Object.isFrozen() is not enough to skip
// one: a value frozen only at its top still has mutable children.
const deepFrozen = new WeakSet<object>()

/**
 * Freeze plain objects and arrays in place. A subtree frozen here before is skipped, so
 * writing a new list that reuses frozen rows costs only the new nodes, and identity is kept.
 */
function freeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || deepFrozen.has(value) || !isPlain(value)) return value
  // Marked first, so a cycle ends here.
  deepFrozen.add(value)
  Object.freeze(value)
  for (const child of Object.values(value)) freeze(child)
  return value
}

/**
 * Report an error that has no caller to receive it: an effect that failed while a task
 * published its state. The task's own bookkeeping and outcome are unaffected.
 */
function report(error: unknown): void {
  const host = globalThis as { reportError?: (error: unknown) => void }
  if (typeof host.reportError === 'function') host.reportError(error)
  else
    queueMicrotask(() => {
      throw error
    })
}

/** Write signals in one batch; an effect that throws while they settle is reported. */
function publish(fn: () => void): void {
  try {
    batch(fn)
  } catch (error) {
    report(error)
  }
}

function readonly<T>(source: { (): T; peek(): T }): ReadonlySignal<T> {
  const read = (() => source()) as ReadonlySignal<T>
  read.peek = () => source.peek()
  return read
}

function settleAll(steps: Array<() => void>, message: string): void {
  const errors: unknown[] = []
  for (const step of steps)
    try {
      step()
    } catch (error) {
      errors.push(error)
    }
  if (errors.length === 1) throw errors[0]
  if (errors.length > 1) throw new AggregateError(errors, message)
}

/**
 * Define a store factory. Call the factory once per island instance, with the
 * island's serializable props as `input` and its services as `deps`.
 */
export function defineStore<Input, Deps, S extends Record<string, unknown>>(
  id: string,
  setup: (input: Readonly<Input>, deps: Deps, use: StoreScope) => S,
): StoreFactory<Input, Deps, S> {
  if (typeof id !== 'string' || id === '') throw new TypeError('defineStore() needs a non-empty id')
  if (typeof setup !== 'function') throw new TypeError(`store "${id}": setup must be a function`)
  return ((input: Readonly<Input>, deps?: Deps) =>
    createStore(id, setup, input, deps as Deps)) as StoreFactory<Input, Deps, S>
}

function createStore<Input, Deps, S extends Record<string, unknown>>(
  id: string,
  setup: (input: Readonly<Input>, deps: Deps, use: StoreScope) => S,
  input: Readonly<Input>,
  deps: Deps,
): Store<S> {
  let settingUp = true
  let disposed = false
  const views = new Map<unknown, ReadonlySignal<unknown>>()
  const derivedValues: Computed<unknown>[] = []
  const owned: Array<{ dispose(): void }> = []
  const connectors: Array<(lifetime: AbortSignal) => unknown> = []
  // Runs in flight. Aborting one frees its task at once, so a new lifetime can start it again.
  const running = new Set<{ abort(): void }>()
  let attachment: { controller: AbortController; cleanups: Array<() => void> } | null = null

  const duringSetup = (name: string): void => {
    if (!settingUp)
      throw new Error(`store "${id}": use.${name}() is available only while the store is set up`)
  }

  const detach = (): void => {
    const current = attachment
    if (!current) return
    attachment = null
    current.controller.abort()
    for (const run of [...running]) run.abort()
    settleAll(current.cleanups.reverse(), `store "${id}": ${current.cleanups.length} cleanups failed`)
  }

  const use: StoreScope = {
    state<T>(initial: T): Signal<T> {
      duringSetup('state')
      const inner = signal(freeze(initial))
      const handle = (() => inner()) as Signal<T>
      handle.set = (next) => {
        if (disposed) return inner.peek()
        const value = typeof next === 'function' ? (next as (prev: T) => T)(inner.peek()) : next
        return inner.set(freeze(value))
      }
      handle.peek = inner.peek
      views.set(handle, readonly(inner))
      return handle
    },

    derived<T>(fn: () => T): ReadonlySignal<T> {
      duringSetup('derived')
      const value = computed(fn)
      derivedValues.push(value as Computed<unknown>)
      return readonly(value)
    },

    action<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R | undefined {
      duringSetup('action')
      return (...args: A) => (disposed ? undefined : batch(() => untracked(() => fn(...args))))
    },

    task<I, R>(
      perform: (input: I, signal: AbortSignal) => Promise<R>,
      options: TaskOptions = {},
    ): Task<I, R> {
      duringSetup('task')
      const concurrency = options.concurrency ?? 'exclusive'
      if (concurrency !== 'exclusive' && concurrency !== 'latest')
        throw new TypeError(`store "${id}": task concurrency must be "exclusive" or "latest"`)
      const pending = signal(false)
      const error = signal<unknown>(undefined)
      type Run = { controller: AbortController; superseded: boolean; abort(): void }
      let current: Run | null = null

      // Free the slot now; the run's promise resolves to `aborted` when its work settles.
      const release = (mine: Run): void => {
        if (current !== mine) return
        current = null
        if (!disposed) publish(() => pending.set(false))
      }

      const settle = (mine: Run, outcome: TaskOutcome<R>): TaskOutcome<R> => {
        running.delete(mine)
        const result: TaskOutcome<R> = mine.superseded
          ? { status: 'superseded' }
          : mine.controller.signal.aborted
            ? { status: 'aborted' }
            : outcome
        if (current === mine) {
          current = null
          if (!disposed)
            publish(() => {
              pending.set(false)
              if (result.status === 'failed') error.set(result.error)
            })
        }
        return result
      }

      return {
        pending: readonly(pending),
        error: readonly(error),
        run(...args: [input?: I]): Promise<TaskOutcome<R>> {
          const value = args[0] as I
          if (disposed) return Promise.resolve({ status: 'aborted' })
          if (current) {
            if (concurrency === 'exclusive') return Promise.resolve({ status: 'rejected' })
            current.superseded = true
            current.controller.abort()
          }
          const mine: Run = {
            controller: new AbortController(),
            superseded: false,
            abort: () => {
              mine.controller.abort()
              release(mine)
            },
          }
          current = mine
          running.add(mine)
          publish(() => {
            pending.set(true)
            error.set(undefined)
          })
          let work: Promise<R>
          try {
            work = Promise.resolve(untracked(() => perform(value, mine.controller.signal)))
          } catch (cause) {
            work = Promise.reject(cause)
          }
          return work.then(
            (result) => settle(mine, { status: 'done', value: result }),
            (cause) => settle(mine, { status: 'failed', error: cause }),
          )
        },
      }
    },

    connect(fn: (lifetime: AbortSignal) => unknown): void {
      duringSetup('connect')
      if (typeof fn !== 'function') throw new TypeError(`store "${id}": connect() takes a function`)
      connectors.push(fn)
    },

    own<D extends { dispose(): void }>(child: D): D {
      if (!child || typeof child.dispose !== 'function')
        throw new TypeError(`store "${id}": own() takes an object with dispose()`)
      if (disposed) child.dispose()
      else owned.push(child)
      return child
    },
  }

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    settleAll(
      [
        detach,
        () => {
          for (const run of [...running]) run.abort()
        },
        ...derivedValues.map((value) => () => value.dispose()),
        ...owned.reverse().map((child) => () => child.dispose()),
      ],
      `store "${id}": dispose failed`,
    )
  }

  let members: S
  try {
    members = untracked(() => setup(input, deps, use))
    if (!members || typeof members !== 'object' || Array.isArray(members))
      throw new TypeError(`store "${id}": setup must return an object of members`)
    for (const name of Object.keys(members))
      if (RESERVED.has(name))
        throw new TypeError(`store "${id}": "${name}" is reserved and cannot be a member`)
  } catch (error) {
    settingUp = false
    try {
      dispose()
    } catch {
      // The setup failure is the error worth reporting.
    }
    throw error
  }
  settingUp = false

  const exposed: Record<string, unknown> = {}
  const stateNames: Array<[string, ReadonlySignal<unknown>]> = []
  for (const [name, member] of Object.entries(members)) {
    const view = views.get(member)
    if (view) stateNames.push([name, view])
    // Any other writable signal is exposed read-only too, so the runtime matches the type.
    exposed[name] = view ?? (isSignal(member) ? readonly(member) : member)
  }

  return Object.freeze({
    ...exposed,
    id,
    attach(lifetime: AbortSignal): void {
      if (disposed) throw new Error(`store "${id}" is disposed`)
      if (attachment) throw new Error(`store "${id}" is already attached; attach it once per lifetime`)
      if (lifetime.aborted) return
      const controller = new AbortController()
      const current = { controller, cleanups: [] as Array<() => void> }
      attachment = current
      lifetime.addEventListener('abort', detach, { once: true, signal: controller.signal })
      try {
        for (const connect of connectors) {
          const cleanup = untracked(() => connect(controller.signal))
          if (attachment === current) {
            if (typeof cleanup === 'function') current.cleanups.push(cleanup as () => void)
            continue
          }
          // The lifetime ended inside this connect(): nothing will call its cleanup later,
          // and the connectors after it must not start.
          if (typeof cleanup === 'function') (cleanup as () => void)()
          return
        }
      } catch (error) {
        try {
          detach()
        } catch {
          // The failing connect() is the error worth reporting.
        }
        throw error
      }
    },
    dispose,
    snapshot(): Readonly<Record<string, unknown>> {
      const out: Record<string, unknown> = {}
      for (const [name, view] of stateNames) out[name] = view.peek()
      return JSON.parse(JSON.stringify(out)) as Record<string, unknown>
    },
  }) as unknown as Store<S>
}
