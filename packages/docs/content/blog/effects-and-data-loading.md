---
title: Fetching data without losing control of effects
description: Understand synchronous reactive tracking, browser lifecycle cleanup, initial SSR data and race-safe requests in ketjs-view islands.
category: Frontend
author: KetJS team
date: "2026-09-18"
order: 5
---
A task list that fetches JSON seems simple until the user changes its filter quickly. The first request starts, the second finishes, and then the first response arrives late. Without an ownership rule, the interface displays old data even though every request succeeded.

This is a lifecycle problem as much as a networking problem. In ketjs-view, signals represent state, views describe the DOM and reactive effects synchronize browser behavior with tracked state. Keeping those roles separate makes data loading easier to reason about.

The discussion follows the **0.2.0 Preview** contract. The [complete effects reference](/docs/view-effects-data/) and [data-loading lesson](/learn/data-fetching/) contain the full implementation and response validation.

## A view should describe, not start, a request

Rendering a loading message is view work. Starting a network request is a side effect. If the view starts that request, another render can accidentally repeat it, and server rendering encounters browser-specific behavior it should never own.

An island factory creates its state. Its browser mount lifecycle starts effects and attaches cleanup. This places the request inside a concrete owner: the island instance. Removing that instance must stop its reactive subscriptions and invalidate any pending work.

For initial SSR data, the server can perform the authorized read before rendering and supply presentation props. For a static page, the browser may load data after mount. Neither case requires putting `fetch()` inside the TSX expression that describes the list.

## Track the inputs that should cause a reload

A reactive effect runs synchronously and tracks the signals read during that execution. Reading a filter or reload revision tells the runtime which state changes should run the effect again.

Loading flags, results and error messages are usually outputs of that process. Accidentally reading them while establishing dependencies can create a feedback loop: loading starts, a status signal changes, the effect runs again and starts another request.

Write down the dependency set before implementing the loader. For a task list it might be a selected filter and a refresh revision. Updating the rows should not itself mean “fetch the rows again.” Derived display values belong in a computed value or the view, rather than a second request effect.

An explicit refresh revision is useful because “refresh” is an event, not a new filter value. Incrementing it can rerun the request even when the filter stays the same.

## Keep the effect callback synchronous

An `async` function returns a promise immediately. If it is passed directly as an effect callback, the runtime does not receive a synchronous cleanup function. Reads after an `await` also occur after synchronous dependency tracking has finished.

Use a synchronous callback that captures the tracked inputs, starts a separate async loader and returns cleanup immediately. The async loader can then handle the request and update output signals without pretending that asynchronous work is itself the tracking phase.

This division makes the timeline clear: establish dependencies, create a request owner, launch asynchronous work, then register cancellation. A later signal change can invalidate that owner before the request finishes.

## Cancellation and stale-result protection solve different problems

Give each run an `AbortController` and pass its signal to the fetch helper. On rerun or removal, abort the previous request. This tells the network layer that the result is no longer wanted.

Also keep a per-run flag or generation check. A response may already have reached a parsing step, or another async stage may not react immediately to cancellation. Before updating rows, errors or the loading flag, verify that the run still owns the result.

That last point includes `finally`. An old request that clears the loading flag can hide the indicator for a newer request still in progress. The stale guard belongs on every visible state update, not only the assignment of successful rows.

Cleanup should invalidate ownership before calling `abort()`. That order prevents an abort-related callback from updating the current interface under an already obsolete run.

## Initial data needs an explicit policy

If SSR already provided tasks, immediately fetching the same list may waste a request and produce a visible loading transition. A loader can skip its first request when initial data is present, while allowing later refreshes.

Check for the presence of initial data, not whether the array has items. An empty array is a valid server result. Treating it as “missing” changes the behavior of precisely the empty state users are likely to encounter first.

That policy is not a cache strategy. Decide separately how long data is acceptable, whether navigation should reuse it and when an external change warrants invalidation. ketjs-view signals and effects do not automatically supply application-level caching, deduplication or freshness semantics.

## Validate the response at the boundary

A TypeScript cast does not validate JSON. Check the HTTP status and the actual response shape before assigning it to a typed signal. Report a useful loading error without treating cancellation as a user-facing failure.

Authentication, mutation authorization and domain validation remain server responsibilities. A browser effect can request data; it cannot grant itself permission to read it. Use [HTTP contracts](/docs/openapi/) and [form validation](/docs/form-validation/) when the feature grows beyond a simple read.

## Test the timeline, not only the happy response

Use two controllable requests. Start A, start B, resolve B, then resolve A. The visible list should remain B's result. Repeat with A rejecting after B begins, and verify that A cannot replace B's error or loading state.

Remove the island while a request is pending and check that its effect stops and its request is invalidated. Test initial empty data, manual refresh and invalid JSON separately.

Those cases establish who owns state at each point in time. Once that ownership is clear, a loading spinner becomes the easy part. For asynchronous work that must survive the browser entirely, continue with [durable jobs](/blog/durable-jobs/).
