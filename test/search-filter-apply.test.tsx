import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countingHost, mount } from '@ketvietlab/ketjs-view'
import type { HostNode, IslandElement } from '@ketvietlab/ketjs-view'
import { createSearchFilterView } from '../packages/design-system/src/interactions/search-filter/index.tsx'
import type { SearchFilterConfig } from '../packages/design-system/src/interactions/search-filter/index.tsx'
import type { SearchFilterNavigateDetail } from '../packages/design-system/src/interactions/search-filter/index.tsx'
import { searchFilterDemoConfig } from '../packages/design-system/src/interactions/search-filter/demo.ts'

// The bar reads its input through `instanceof HTMLInputElement`, which Node lacks.
class FakeInput {
  value = ''
}

const config: SearchFilterConfig = {
  ...searchFilterDemoConfig,
  customFilterFields: [
    ...searchFilterDemoConfig.customFilterFields,
    { value: 'state', label: 'State', type: 'selection' },
    { value: 'customerId', label: 'Customer', type: 'reference' },
  ],
  manager: { applyFunction: 'orders.applySearchFilter', bodyId: 'orders-body' },
}

const byUi = (node: HostNode, ui: string): HostNode[] => [
  ...(node.attrs?.['data-ui'] === ui ? [node] : []),
  ...(node.children ?? []).flatMap((child) => byUi(child, ui)),
]
const textOf = (node: HostNode): string => node.text ?? (node.children ?? []).map(textOf).join('')
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn++) await new Promise((resolve) => setImmediate(resolve))
}

const withGlobals = async (
  globals: Record<string, unknown>,
  run: () => Promise<void> | void,
): Promise<void> => {
  const scope = globalThis as unknown as Record<string, unknown>
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, scope[key]]))
  Object.assign(scope, { HTMLInputElement: FakeInput, document: { addEventListener() {} }, ...globals })
  try {
    await run()
  } finally {
    delete scope.HTMLInputElement
    delete scope.document
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete scope[key]
      else scope[key] = value
    }
  }
}

const renderBar = () => {
  const host = countingHost()
  const container = host.root()
  const controller = createSearchFilterView({ id: 'orders-filter', config })
  mount(host, container, () => controller.view())
  // The field as the browser shows it, which the counting host's attributes are not.
  const live = new FakeInput()
  controller.mount?.({
    root: { querySelectorAll: () => [live] } as unknown as IslandElement,
    lifetime: new AbortController().signal,
  })
  const input = byUi(container, 'search-filter-input')[0]!
  return {
    host,
    controller,
    container,
    input,
    live,
    type: (value: string): void => {
      live.value = value
      host.fire(input, 'input', { currentTarget: live })
    },
    suggestions: (): string[] => byUi(container, 'search-filter-suggestion').map(textOf),
    click: (ui: string, text = ''): void => {
      const node = byUi(container, ui).find((candidate) => textOf(candidate).includes(text))
      assert.ok(node, `no ${ui} reading "${text}"`)
      host.fire(node, 'click')
    },
    chips: (): string[] => byUi(container, 'search-filter-facet').map(textOf),
    notice: (): HostNode | undefined => byUi(container, 'notice')[0],
  }
}

test('search filter: free text is only suggested against fields it can filter', async () => {
  await withGlobals({}, () => {
    const bar = renderBar()

    bar.type('áo')
    const offered = bar.suggestions()
    assert.equal(offered.length, 2, 'the plain search and the one text field')
    assert.ok(offered.some((text) => text.includes('Reference')))
    for (const label of ['Total', 'Confirmed', 'Created on', 'State', 'Customer'])
      assert.ok(!offered.some((text) => text.includes(label)), `"áo" cannot filter ${label}`)

    bar.type('100')
    assert.ok(bar.suggestions().some((text) => text.includes('Total')))
    bar.type('1.000')
    assert.ok(
      !bar.suggestions().some((text) => text.includes('Total')),
      'a grouped number reads differently per locale, so it is not guessed at',
    )
  })
})

test('search filter: a refused filter puts the bar back and says so in the reader’s words', async () => {
  const bodies: unknown[] = []
  await withGlobals(
    {
      fetch: async (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)))
        return Response.json(
          { ok: false, errors: [{ message: 'invalid filter reference.contains' }] },
          { status: 400 },
        )
      },
    },
    async () => {
      const bar = renderBar()
      const before = bar.chips()

      bar.type('áo')
      bar.click('search-filter-suggestion', 'Reference')
      assert.ok(
        bar.chips().some((chip) => chip.includes('áo')),
        'the chip shows while the request is out',
      )
      assert.equal(bar.input.attrs?.value ?? '', '')
      assert.equal(bar.live.value, '', 'the field the reader sees empties with the state')
      await settle()

      assert.equal(bodies.length, 1)
      assert.deepEqual(bar.chips(), before, 'the chips the list still reflects, the saved search included')
      assert.equal(bar.input.attrs?.value, 'áo', 'the text the reader typed goes back to the field')
      assert.equal(bar.live.value, 'áo')
      const notice = bar.notice()
      assert.ok(notice)
      assert.equal(textOf(byUi(notice, 'notice-message')[0]!), config.labels.applyError)
      assert.doesNotMatch(textOf(notice), /invalid filter/)
      assert.equal(
        byUi(notice, 'action').length,
        0,
        'sending a refused filter again can only be refused again',
      )
    },
  )
})

test('search filter: a request that got no verdict is sent again exactly as attempted', async () => {
  const bodies: unknown[] = []
  const assigned: string[] = []
  const answers = [
    () => Promise.reject(new TypeError('fetch failed')),
    () => Promise.resolve(Response.json({ ok: false, message: 'internal error' }, { status: 503 })),
    () => Promise.resolve(Response.json({ ok: true, value: { href: '/orders?q=%C3%A1o' } })),
  ]
  await withGlobals(
    {
      fetch: (_url: unknown, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)))
        return answers[bodies.length - 1]!()
      },
      document: { addEventListener() {}, getElementById: () => null },
      window: { location: { assign: (href: string) => assigned.push(href) } },
    },
    async () => {
      const bar = renderBar()
      const before = bar.chips()

      bar.type('áo')
      bar.click('search-filter-suggestion', 'Search for')
      await settle()
      assert.deepEqual(bar.chips(), before)
      assert.equal(bar.input.attrs?.value, 'áo')
      bar.click('action', config.labels.retry)
      await settle()
      assert.equal(bodies.length, 2)
      assert.deepEqual(bodies[1], bodies[0], 'a network failure is retried with what was attempted')

      bar.click('action', config.labels.retry)
      await settle()
      assert.equal(bodies.length, 3)
      assert.deepEqual(bodies[2], bodies[0], 'so is a server fault')
      assert.deepEqual(assigned, ['/orders?q=%C3%A1o'])
      assert.equal(bar.notice(), undefined)
    },
  )
})

test('search filter: a failed fragment rolls back to the last displayed list and retries the same draft', async () => {
  const requests: unknown[] = []
  const navigations: SearchFilterNavigateDetail[] = []
  let failure: number | null = null
  await withGlobals(
    {
      fetch: (_url: unknown, init?: RequestInit) => {
        requests.push(JSON.parse(String(init?.body)))
        return Promise.resolve(Response.json({ ok: true, value: { href: '/orders?q=shirt' } }))
      },
      document: {
        addEventListener() {},
        getElementById: () => null,
        dispatchEvent: (event: CustomEvent<SearchFilterNavigateDetail>) => {
          assert.equal(event.type, 'ket:search-filter-navigate')
          navigations.push(event.detail)
          event.detail.respondWith(
            failure === null
              ? Promise.resolve()
              : Promise.reject(
                  Object.assign(new Error('private server diagnostic'), { retryable: failure >= 500 }),
                ),
          )
        },
      },
      window: { location: { assign: () => assert.fail('the shell must not reload the document') } },
    },
    async () => {
      const bar = renderBar()
      bar.type('shirt')
      bar.click('search-filter-suggestion', 'Search for')
      await settle()
      const displayed = bar.chips()
      failure = 503
      bar.type('coat')
      bar.click('search-filter-suggestion', 'Search for')
      await settle()
      assert.deepEqual(bar.chips(), displayed, 'RPC success alone must not settle the draft')
      assert.equal(bar.live.value, 'coat')
      assert.match(textOf(bar.notice()!), /Could not apply|Unable to apply/)
      assert.doesNotMatch(textOf(bar.notice()!), /private server diagnostic/)
      failure = null
      bar.click('action', config.labels.retry)
      await settle()
      assert.deepEqual(requests[2], requests[1])
      assert.notDeepEqual(bar.chips(), displayed)
      assert.equal(bar.notice(), undefined)
      assert.equal(navigations.length, 3)
      assert.equal(navigations[0]!.id, 'orders-filter')

      failure = 403
      bar.type('denied')
      bar.click('search-filter-suggestion', 'Search for')
      await settle()
      assert.equal(
        byUi(bar.container, 'action').some((node) => textOf(node) === config.labels.retry),
        false,
      )
    },
  )
})

test('search filter: a newer draft cancels navigation and disposal ignores late RPC responses', async () => {
  const navigations: SearchFilterNavigateDetail[] = []
  let finishRpc: ((response: Response) => void) | undefined
  await withGlobals(
    {
      fetch: () =>
        new Promise<Response>((resolve) => {
          finishRpc = resolve
        }),
      document: {
        addEventListener() {},
        getElementById: () => null,
        dispatchEvent: (event: CustomEvent<SearchFilterNavigateDetail>) => {
          navigations.push(event.detail)
          event.detail.respondWith(
            new Promise<void>((_resolve, reject) => {
              event.detail.signal.addEventListener('abort', () =>
                reject(new DOMException('Aborted', 'AbortError')),
              )
            }),
          )
        },
      },
    },
    async () => {
      const bar = renderBar()
      bar.type('old')
      bar.click('search-filter-suggestion', 'Search for')
      finishRpc!(Response.json({ ok: true, value: { href: '/orders?q=old' } }))
      await settle()
      assert.equal(navigations.length, 1)
      bar.type('new')
      bar.click('search-filter-suggestion', 'Search for')
      assert.equal(navigations[0]!.signal.aborted, true)
      bar.controller.dispose?.()
      finishRpc!(Response.json({ ok: true, value: { href: '/orders?q=new' } }))
      await settle()
      assert.equal(navigations.length, 1, 'a departed screen cannot navigate on its late response')
      assert.equal(bar.notice(), undefined)
    },
  )
})

test('search filter: a native navigation supersedes an unfinished apply RPC', async () => {
  const events = new EventTarget()
  let finish!: (response: Response) => void
  await withGlobals(
    {
      fetch: () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
      document: {
        addEventListener: events.addEventListener.bind(events),
        dispatchEvent: () => assert.fail('a stale RPC must not replace the requested page'),
        getElementById: () => null,
      },
    },
    async () => {
      const bar = renderBar()
      const before = bar.chips()
      bar.type('old')
      bar.click('search-filter-suggestion', 'Search for')
      events.dispatchEvent(new Event('ket:navigation-start'))
      finish(Response.json({ ok: true, value: { href: '/orders?q=old' } }))
      await settle()
      assert.deepEqual(bar.chips(), before)
      assert.equal(bar.notice(), undefined)
    },
  )
})
