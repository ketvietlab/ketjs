---
title: "Own browser effects and cleanup"
description: "Attach browser resources after hydration and release them when the island is removed."
stage: "Build the frontend"
duration: 30
lab: "Local View project"
order: 7
---

Before you start: complete [Validate a form with a shared schema](/learn/forms/), or make sure you can pass its checkpoint.

## Why a lifecycle is needed

A view can run during static generation, when there is no document or localStorage. A browser listener can also survive longer than its UI if nobody removes it. The island controller makes both ownership boundaries explicit.

Create a clock island to see this distinction:

```tsx
// File: learn-view/src/islands/clock.tsx
import { signal, type IslandFactory } from '@ketvietlab/ketjs-view'

const clock: IslandFactory<{ initial: string }> = props => {
  const time = signal(props.initial)
  return {
    view: () => <p>Browser time: <time>{time()}</time></p>,
    mount({ lifetime }) {
      const tick = () => time.set(new Date().toLocaleTimeString())
      tick()
      const timer = setInterval(tick, 1000)
      lifetime.addEventListener('abort', () => clearInterval(timer), { once: true })
    },
  }
}
export default clock
```

Register the island and place it on a page with `{ initial: 'Waiting for browser' }`. That deterministic initial text is the same during generation and hydration. The clock changes only after `mount` runs in the browser.

## Add persistence carefully

To persist the todo draft, read localStorage in `mount`, parse it with a guarded JSON parse, and validate its shape before updating signals. Attach a storage listener with `{ signal: lifetime }` if you want cross-tab updates. A storage failure should leave the in-memory example usable.

If you create an `effect`, keep its disposer and call it when the lifetime aborts. Do the same for timers, observers and subscriptions. A lifecycle `mount` hook does not use a returned cleanup function; use the provided lifetime or the controller's `dispose` hook.

Continue with [Reactive effects](/learn/effects/) for dependency tracking and per-run cleanup, then [Data fetching](/learn/data-fetching/) for cancellable requests.

## Check ownership during navigation

Visit the clock page, navigate away, and return. Only the current instance should tick. Use a temporary console log in the timer to observe cleanup, then remove that debug log. Test a build as well as the development browser: accessing a browser global too early may work in one context and fail in the other.

## Checkpoint

The static build succeeds without browser globals, and leaving the page releases its timer.

## Practice on your own

Persist the todo list with a versioned localStorage key. Handle malformed stored JSON and preserve a deterministic first render.

## Reference

For the complete API contract, read [Rendering](/docs/rendering/).
