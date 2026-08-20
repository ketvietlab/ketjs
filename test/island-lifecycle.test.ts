import assert from 'node:assert/strict'
import { test } from 'node:test'
import { each, html, signal } from 'ketjs-view'
import { createProductEditorView } from '../packages/ketsuite/src/modules/product_backend/client/editor-view.mjs'
import { createStockEditorView } from '../packages/ketsuite/src/modules/stock_backend/client/editor-view.mjs'
import { createRecordActivityView } from '../packages/ketsuite/src/ui/client/activity-view.mjs'
import { createChatterView } from '../packages/ketsuite/src/ui/client/mail-view.mjs'

const runtime = { each, html, signal }

test('editor islands remove their document submit listener when disposed', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  const added: Array<[string, EventListener]> = []
  const removed: Array<[string, EventListener]> = []
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      querySelectorAll: () => [],
      addEventListener: (name: string, listener: EventListener) => added.push([name, listener]),
      removeEventListener: (name: string, listener: EventListener) => removed.push([name, listener]),
    },
  })

  try {
    const product = createProductEditorView(runtime, {
      identity: 'template:product-1',
      templateId: 'product-1',
      lang: 'vi',
    })
    const stock = createStockEditorView(runtime, { pickingId: 'picking-1', lang: 'vi' })
    assert.equal(added.length, 2)
    product.dispose()
    stock.dispose()
    assert.deepEqual(removed, added)
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
