import assert from 'node:assert/strict'
import { test } from 'node:test'
import { each, html, signal } from '@ketvietlab/ketjs-view'
import { productEditorBehavior } from '../packages/ketsuite/src/modules/product_backend/client/editor-view.mjs'
import { saleEditorBehavior } from '../packages/ketsuite/src/modules/sale_backend/client/editor-view.mjs'
import { stockEditorBehavior } from '../packages/ketsuite/src/modules/stock_backend/client/editor-view.mjs'
import { createRecordActivityView } from '../packages/ketsuite/src/ui/client/activity-view.mjs'
import { createChatterView } from '../packages/ketsuite/src/ui/client/mail-view.mjs'

const runtime = { each, html, signal }

test('record editor behaviors bind document submits to their browser lifetime', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const added: Array<[string, EventListener, AddEventListenerOptions | boolean | undefined]> = []
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      addEventListener: (
        name: string,
        listener: EventListener,
        options?: AddEventListenerOptions | boolean,
      ) => added.push([name, listener, options]),
    },
  })

  try {
    const lifetime = new AbortController()
    const navigation = {
      navigate: async () => {},
      apply: async () => {},
      replace: () => {},
      reload: () => {},
    }
    const context = { navigation, lifetime: lifetime.signal }
    const cleanups = [
      productEditorBehavior(context),
      stockEditorBehavior(context),
      saleEditorBehavior(context),
    ]
    assert.equal(added.length, 3)
    assert.ok(
      added.every(
        ([name, , options]) =>
          name === 'submit' && typeof options === 'object' && options.signal === lifetime.signal,
      ),
    )
    lifetime.abort()
    for (const cleanup of cleanups) cleanup?.()
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})

test('a removed collaboration island aborts its active request', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const previousFetch = globalThis.fetch
  let activeSignal: AbortSignal | undefined

  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { visibilityState: 'visible' },
  })
  globalThis.fetch = (_input, init) => {
    activeSignal = init?.signal ?? undefined
    return new Promise((_resolve, reject) =>
      activeSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
        once: true,
      }),
    )
  }

  try {
    const chatter = createChatterView(runtime, {
      resModel: 'product.Template',
      resId: 'product-1',
      lang: 'vi',
    })
    chatter.mount()
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.ok(activeSignal, 'the initial collaboration request started')
    chatter.dispose()
    assert.equal(activeSignal!.aborted, true)
    await new Promise<void>((resolve) => setImmediate(resolve))
  } finally {
    globalThis.fetch = previousFetch
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})

test('a removed activity island clears its polling timer', async () => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const previousFetch = globalThis.fetch
  const previousSetTimeout = globalThis.setTimeout
  const previousClearTimeout = globalThis.clearTimeout
  let scheduled: ReturnType<typeof setTimeout> | undefined
  let cleared = false

  Object.defineProperty(globalThis, 'window', { configurable: true, value: {} })
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: { visibilityState: 'visible' },
  })
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ ok: true, value: [] }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  globalThis.setTimeout = ((handler: () => void, timeout?: number) => {
    scheduled = previousSetTimeout(handler, timeout)
    return scheduled
  }) as unknown as typeof setTimeout
  globalThis.clearTimeout = ((timer: ReturnType<typeof setTimeout>) => {
    if (timer === scheduled) cleared = true
    return previousClearTimeout(timer)
  }) as typeof clearTimeout

  try {
    const activity = createRecordActivityView(runtime, {
      resModel: 'product.Template',
      resId: 'product-1',
      lang: 'vi',
    })
    activity.mount()
    await new Promise<void>((resolve) => setImmediate(resolve))
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.ok(scheduled, 'polling starts after the initial activity request')
    activity.dispose()
    assert.equal(cleared, true)
  } finally {
    if (scheduled) previousClearTimeout(scheduled)
    globalThis.fetch = previousFetch
    globalThis.setTimeout = previousSetTimeout
    globalThis.clearTimeout = previousClearTimeout
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
    else Reflect.deleteProperty(globalThis, 'document')
  }
})
