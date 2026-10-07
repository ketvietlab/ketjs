---
title: "Understand effects and reactive dependencies"
description: "Learn when an effect runs, what it tracks, how cleanup works, and why async work needs an explicit owner."
stage: "Build the frontend"
duration: 35
lab: "Browser + local View project"
order: 8
---

Before you start: complete [Own browser effects and cleanup](/learn/lifecycle/).

## Choose the right primitive

A signal stores a value. A computed value derives another value. A view describes UI. An effect synchronizes reactive state with something outside that description: a subscription, timer, browser API or request.

Do not use an effect just to copy `count()` into another signal. Use `computed(() => count() * 2)` for derived state, and dispose that computed when its owner ends. The renderer already tracks reads in your view; an extra effect is not required to update text on screen.

The browser `effect()` API is unrelated to the backend function's `effects` declaration. The latter declares capabilities such as reading a model or enqueueing a job; it does not subscribe to signals.

## Predict an effect's execution

```ts
// File: learn-view/src/effect-exercise.ts
import { signal, effect, batch } from '@ketvietlab/ketjs-view'

const active = signal(true)
const count = signal(0)
const stop = effect(() => {
  if (!active()) return
  const value = count()
  console.log('subscribe', value)
  return () => console.log('cleanup', value)
})
count.set(1)
batch(() => { count.set(2); count.set(3) })
active.set(false)
count.set(4)
stop()
```

The first subscription runs immediately with `0`. Setting `1` cleans up `0`, then subscribes with `1`. The batch produces one final rerun with `3`. Turning `active` off cleans up `3` and stops reading `count`. Changing `count` to `4` therefore does not rerun this effect. `stop()` removes its remaining dependency on `active`.

Dependencies are the signals read synchronously on the current run, not a static array. They are rediscovered each time. `count.peek()` reads without subscribing. Setting the same value according to `Object.is` does not notify subscribers.

## Create browser effects after hydration

Move browser-specific effects into the controller's `mount({ lifetime })`. Creating an effect in `view()` creates a new subscription on every render. Creating one in the factory can run it during SSR or static generation as well.

```tsx
// File: learn-view/src/islands/title-counter.tsx
import { signal, effect, type IslandFactory } from '@ketvietlab/ketjs-view'

const titleCounter: IslandFactory<Record<string, never>> = () => {
  const count = signal(0)
  return {
    view: () => <button onClick={() => count.set(n => n + 1)}>Count: {count()}</button>,
    mount({ lifetime }) {
      const original = document.title
      const stop = effect(() => { document.title = `Count: ${count()}` })
      lifetime.addEventListener('abort', () => {
        stop()
        document.title = original
      }, { once: true })
    },
  }
}
export default titleCounter
```

Register this island just like the counter from the earlier lesson. Open two counters and notice that each owns its own signal. For an application-wide resource such as the page title, choose one owner instead of mounting competing title writers.

## Understand cleanup and async work

The callback may return a cleanup function. It runs before the next execution and when you call the disposer returned by `effect`. The island lifecycle does not automatically discover arbitrary effects you create: attach that disposer to its lifetime.

Keep the effect callback synchronous. An `async` callback returns a Promise, which is not a cleanup function. Reads after an `await` are not tracked. Instead, read dependencies first, start the asynchronous operation inside the callback, and return synchronous cleanup that cancels it. The [next lesson](/learn/data-fetching/) implements this pattern with a real request.

Do not read a state signal and then write to that same signal unconditionally inside an effect: this can create a reactive loop. Keep request status separate from the query signals that trigger the request.

## Checkpoint

Explain the exact log sequence above, including why `count.set(4)` is silent. Mount the title counter, change its count, then navigate away: the original title must return and the old subscription must stop.

## Practice on your own

Replace the title writer with a storage subscription. Handle unavailable storage, load the initial value in `mount`, and ensure persistence does not overwrite saved data before it has been read.

## Reference

Read [Effects and data fetching](/docs/view-effects-data/) for execution contracts, server boundaries and cancellation rules.
