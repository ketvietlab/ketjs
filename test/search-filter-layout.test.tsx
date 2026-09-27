import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countingHost, mount, renderToString } from '@ketvietlab/ketjs-view'
import type { HostNode, IslandElement } from '@ketvietlab/ketjs-view'
import { ModalSheet } from '../packages/design-system/src/patterns/modal-sheet/index.tsx'
import { createSearchFilterView } from '../packages/design-system/src/interactions/search-filter/index.tsx'
import type { SearchFilterConfig } from '../packages/design-system/src/interactions/search-filter/index.tsx'
import { searchFilterDemoConfig } from '../packages/design-system/src/interactions/search-filter/demo.ts'

const by = (node: HostNode, predicate: (node: HostNode) => boolean): HostNode[] => [
  ...(predicate(node) ? [node] : []),
  ...(node.children ?? []).flatMap((child) => by(child, predicate)),
]
const textOf = (node: HostNode): string => node.text ?? (node.children ?? []).map(textOf).join('')
const setup = (config: SearchFilterConfig) => {
  const host = countingHost()
  const root = host.root()
  const controller = createSearchFilterView({ id: 'layout', config })
  mount(host, root, () => controller.view())
  const ui = (value: string) => by(root, (node) => node.attrs?.['data-ui'] === value)
  const click = (value: string) => {
    assert.ok(ui(value)[0])
    host.fire(ui(value)[0]!, 'click')
  }
  return { host, root, controller, ui, click }
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
}

const withGlobals = async (globals: Record<string, unknown>, run: () => Promise<void>) => {
  const scope = globalThis as unknown as Record<string, unknown>
  const previous = Object.fromEntries(Object.keys(globals).map((key) => [key, scope[key]]))
  Object.assign(scope, globals)
  try {
    await run()
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete scope[key]
      else scope[key] = value
    }
  }
}

test('SearchFilter default separates search, three triggers, and all applied chips', () => {
  const bar = setup(searchFilterDemoConfig)
  assert.equal(bar.ui('search-filter-toggle').length, 1)
  assert.equal(bar.ui('search-filter-section-toggle').length, 2)
  assert.equal(
    by(bar.ui('search-filter-field')[0]!, (node) => node.attrs?.['data-ui'] === 'search-filter-facet').length,
    0,
  )
  assert.equal(bar.ui('search-filter-facet').length, 3)
  assert.match(textOf(bar.ui('search-filter-facets')[0]!), /Group by: Customer/)
})

test('SearchFilter clear preserves keyword and ordered groups in the actual apply request', async () => {
  const previousFetch = globalThis.fetch
  const previousDocument = globalThis.document
  let sent: Record<string, unknown> = {}
  globalThis.fetch = async (_url, init) => {
    sent = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ ok: true, value: { html: 'updated' } }))
  }
  globalThis.document = { getElementById: () => null } as unknown as Document
  try {
    const bar = setup({
      ...searchFilterDemoConfig,
      facets: [
        ...searchFilterDemoConfig.facets,
        { id: 'query:current', type: 'field', label: 'áo' },
        { id: 'rule:0', type: 'filter', label: 'Total > 10' },
      ],
      customFilters: [{ id: 'rule:0', field: 'total', operator: 'gt', value: '10', label: 'Total > 10' }],
      manager: { applyFunction: 'orders.apply', bodyId: 'body' },
    })
    bar.click('search-filter-clear')
    await settle()
    assert.deepEqual(sent.groupBy, ['customer'])
    assert.equal(sent.favoriteId, null)
    assert.deepEqual(sent.customFilters, [])
    assert.deepEqual(sent.filters, [])
    assert.deepEqual(
      (sent.facets as Array<{ type: string }>).map((facet) => facet.type),
      ['groupBy', 'field'],
    )
    assert.match(textOf(bar.ui('search-filter-facets')[0]!), /áo/)
  } finally {
    globalThis.fetch = previousFetch
    globalThis.document = previousDocument
  }
})

test('SearchFilter editor uses choices, translated operators, and two typed range endpoints', () => {
  class Select {
    value: string
    constructor(value: string) {
      this.value = value
    }
  }
  const previous = globalThis.HTMLSelectElement
  globalThis.HTMLSelectElement = Select as unknown as typeof HTMLSelectElement
  try {
    const bar = setup({
      ...searchFilterDemoConfig,
      customFilterFields: [
        ...searchFilterDemoConfig.customFilterFields,
        { value: 'kind', label: 'Loại', type: 'selection', choices: [{ value: 'goods', label: 'Hàng hóa' }] },
      ],
      labels: { ...searchFilterDemoConfig.labels, operatorLabels: { between: 'trong khoảng' } },
    })
    const change = (label: string, value: string) => {
      const node = by(bar.root, (node) => node.tag === 'select' && node.attrs?.['aria-label'] === label)[0]!
      assert.ok(node)
      bar.host.fire(node, 'change', { currentTarget: new Select(value) })
    }
    change('Field', 'total')
    assert.match(textOf(bar.root), /trong khoảng/)
    change('Condition', 'between')
    assert.equal(by(bar.root, (node) => node.tag === 'input' && node.attrs?.type === 'number').length, 2)
    assert.equal(bar.ui('custom-filter-add')[0]?.attrs?.disabled, 'true')
    change('Field', 'kind')
    change('Condition', 'equals')
    assert.match(textOf(bar.root), /Hàng hóa/)
    assert.equal(
      by(bar.root, (node) => node.tag === 'select' && node.attrs?.['aria-label'] === 'Value').length,
      1,
    )
    change('Field', 'confirmed')
    change('Condition', 'isTrue')
    assert.equal(by(bar.root, (node) => node.attrs?.['aria-label'] === 'Value').length, 0)
  } finally {
    globalThis.HTMLSelectElement = previous
  }
})

test('SearchFilter favorite form is lazy; a supplied favorite URL remains a native link', () => {
  const config = {
    ...searchFilterDemoConfig,
    manager: { applyFunction: 'apply', bodyId: 'body', saveFavoriteFunction: 'save' },
  }
  const bar = setup(config)
  assert.equal(bar.ui('favorite-save').length, 0)
  const opener = bar.ui('favorite-save-toggle')[0]!
  bar.host.fire(opener, 'click')
  assert.equal(bar.ui('favorite-save').length, 1)
  const html = renderToString(
    createSearchFilterView({
      id: 'linked',
      config: { ...config, favoriteHref: '/products?modal=favorite' },
    }).view(),
  )
  assert.match(html, /href="\/products\?modal=favorite"/)
  assert.doesNotMatch(html, /data-ui="favorite-save"/)
})

test('SearchFilter favorite failures use the default favorite error for save, remove and set-default', async () => {
  class Input {
    value = 'My search'
  }
  await withGlobals(
    {
      HTMLInputElement: Input,
      fetch: async () =>
        new Response(JSON.stringify({ ok: false, message: 'internal database diagnostic' }), { status: 400 }),
    },
    async () => {
      for (const operation of ['save', 'remove', 'set-default']) {
        const bar = setup({
          ...searchFilterDemoConfig,
          manager: {
            applyFunction: 'apply',
            bodyId: 'body',
            saveFavoriteFunction: 'save',
            deleteFavoriteFunction: 'remove',
            setDefaultFavoriteFunction: 'set-default',
          },
        })
        if (operation === 'save') {
          bar.click('favorite-save-toggle')
          const input = by(
            bar.ui('favorite-save')[0]!,
            (node) => node.tag === 'input' && node.attrs?.type === 'text',
          )[0]!
          bar.host.fire(input, 'input', { currentTarget: new Input() })
          bar.host.fire(bar.ui('favorite-save')[0]!, 'submit', { preventDefault() {} })
        } else bar.click(operation === 'remove' ? 'favorite-item-remove' : 'favorite-item-default')
        await settle()
        assert.equal(textOf(bar.ui('notice-message')[0]!), 'Could not save changes to saved searches')
        assert.doesNotMatch(textOf(bar.root), /internal database diagnostic/)
        assert.equal(bar.ui('notice-actions').length, 0)
      }
    },
  )
})

test('ModalSheet can delegate semantics to its native dialog parent without changing the default', () => {
  const props = { id: 'sheet', title: 'Filters', body: 'Body', closeLabel: 'Close', mode: 'client' as const }
  assert.match(renderToString(ModalSheet(props)), /role="dialog"/)
  const contained = renderToString(ModalSheet({ ...props, dialogSemantics: 'parent' }))
  assert.doesNotMatch(contained, /role="dialog"|aria-modal=/)
  assert.match(contained, /data-ui="modal-close"/)
  assert.match(contained, /data-ui="modal-backdrop"[^>]*aria-hidden="true"[^>]*tabindex="-1"/i)
})

test('SearchFilter hides unavailable CRM sections but keeps every supported favorite path', () => {
  const config = { ...searchFilterDemoConfig, groupBy: [], favorites: [], facets: [] }
  const bar = setup(config)
  assert.equal(bar.ui('search-filter-section-toggle').length, 0)
  assert.equal(bar.ui('search-filter-column').length, 1)
  assert.equal(bar.ui('search-filter-columns')[0]?.attrs?.['data-columns'], '1')
  for (const enabled of [
    { favorites: searchFilterDemoConfig.favorites },
    { favoriteHref: '/favorites/new' },
    { manager: { applyFunction: 'apply', bodyId: 'body', saveFavoriteFunction: 'save' } },
  ]) {
    const supported = setup({ ...config, ...enabled })
    assert.equal(supported.ui('search-filter-section-toggle').length, 1)
    assert.equal(supported.ui('search-filter-column').length, 2)
    assert.equal(
      setup({ ...config, ...enabled, capabilities: { favorites: false } }).ui('search-filter-section-toggle')
        .length,
      0,
    )
  }
  assert.match(
    renderToString(
      createSearchFilterView({ id: 'route', config: { ...config, favoriteHref: '/favorites/new' } }).view(),
    ),
    /href="\/favorites\/new"/,
  )
})

test('SearchFilter opens its save form below the trigger, focuses the name, and restores focus after cancel/save', async () => {
  let active: Control | null = null
  const requests: Array<{ url: string; body: Record<string, unknown> }> = []
  class Control {
    value = 'New favorite'
    focus() {
      active = this
    }
  }
  const opener = new Control()
  const input = new Control()
  await withGlobals(
    {
      HTMLElement: Control,
      HTMLInputElement: Control,
      document: { addEventListener() {}, getElementById: () => null },
      fetch: async (url: string, init: RequestInit) => {
        requests.push({ url, body: JSON.parse(String(init.body)) })
        return new Response(JSON.stringify({ ok: true, value: { id: 'new', html: 'updated' } }))
      },
    },
    async () => {
      const bar = setup({
        ...searchFilterDemoConfig,
        manager: {
          applyFunction: 'apply',
          bodyId: 'body',
          saveFavoriteFunction: 'save',
          applyInput: { listKey: 'sales.orders', returnTo: '/admin/sales/orders?lang=vi' },
        },
      })
      bar.controller.mount?.({
        root: {
          querySelectorAll: (selector: string) => (selector.includes('input') ? [input] : [opener]),
        } as unknown as IslandElement,
        lifetime: new AbortController().signal,
      })
      const savedTrigger = bar
        .ui('search-filter-section-toggle')
        .find((node) => node.attrs?.['data-section'] === 'favorite')!
      bar.host.fire(savedTrigger, 'click', { stopPropagation() {}, currentTarget: opener })
      assert.equal(bar.ui('menu-panel')[0]?.attrs?.['aria-label'], searchFilterDemoConfig.labels.favorites)
      assert.equal(
        bar.ui('search-filter-toggle')[0]?.attrs?.['aria-label'],
        searchFilterDemoConfig.labels.filters,
      )
      bar.click('favorite-save-toggle')
      await settle()
      assert.equal(bar.ui('menu')[0]?.attrs?.open, 'true')
      assert.equal(active, input)
      const column = bar
        .ui('search-filter-column')
        .find((node) => node.attrs?.['data-facet-type'] === 'favorite')!
      const controls = by(column, (node) =>
        ['favorite-save-toggle', 'favorite-save'].includes(node.attrs?.['data-ui'] ?? ''),
      )
      assert.deepEqual(
        controls.map((node) => node.attrs?.['data-ui']),
        ['favorite-save-toggle', 'favorite-save'],
      )
      bar.host.fire(
        by(bar.ui('favorite-save')[0]!, (node) => node.tag === 'button' && textOf(node) === 'Cancel')[0]!,
        'click',
        { stopPropagation() {} },
      )
      await settle()
      assert.equal(active, opener)
      assert.equal(bar.ui('favorite-save').length, 0)
      bar.click('favorite-save-toggle')
      bar.host.fire(
        by(bar.ui('favorite-save')[0]!, (node) => node.tag === 'input' && node.attrs?.type === 'text')[0]!,
        'input',
        { currentTarget: input },
      )
      bar.host.fire(bar.ui('favorite-save')[0]!, 'submit', { preventDefault() {} })
      await settle()
      assert.equal(active, opener)
      assert.equal(bar.ui('favorite-save').length, 0)
      assert.match(textOf(bar.root), /New favorite/)
      const saved = requests.find((request) => request.url.endsWith('/save'))!.body
      assert.deepEqual(Object.keys(saved).sort(), ['isDefault', 'name', 'state'])
      assert.equal((saved.state as Record<string, unknown>).listKey, 'sales.orders')
      assert.equal((saved.state as Record<string, unknown>).returnTo, '/admin/sales/orders?lang=vi')
    },
  )
})

test('SearchFilter Escape dismisses the nearest disclosure before the desktop panel', async () => {
  let active: ElementStub | null = null
  class ElementStub {
    focus() {
      active = this
    }
    closest() {
      return disclosure.open ? disclosure : null
    }
  }
  const summary = new ElementStub()
  class Details extends ElementStub {
    open = true
    querySelector() {
      return summary
    }
  }
  const disclosure = new Details()
  const opener = new ElementStub()
  await withGlobals(
    { Element: ElementStub, HTMLElement: ElementStub, HTMLDetailsElement: Details },
    async () => {
      const bar = setup(searchFilterDemoConfig)
      const trigger = bar
        .ui('search-filter-section-toggle')
        .find((node) => node.attrs?.['data-section'] === 'groupBy')!
      bar.host.fire(trigger, 'click', { stopPropagation() {}, currentTarget: opener })
      let prevented = 0
      let stopped = 0
      const event = {
        key: 'Escape',
        target: new ElementStub(),
        preventDefault() {
          prevented++
        },
        stopPropagation() {
          stopped++
        },
      }
      bar.host.fire(bar.ui('search-filter')[0]!, 'keydown', event)
      assert.equal(disclosure.open, false)
      assert.equal(active, summary)
      assert.equal(bar.ui('menu')[0]?.attrs?.open, 'true')
      bar.host.fire(bar.ui('search-filter')[0]!, 'keydown', event)
      await settle()
      assert.equal(active, opener)
      assert.equal(bar.ui('menu')[0]?.attrs?.open, undefined)
      assert.equal(prevented, 2)
      assert.equal(stopped, 2)
    },
  )
})

test('SearchFilter mobile sheet focuses the visible close control and dismisses nested disclosures first', async () => {
  let active: Control | null = null
  class Control {
    focus() {
      active = this
    }
    closest() {
      return disclosure.open ? disclosure : null
    }
  }
  class Details extends Control {
    open = true
    querySelector() {
      return summary
    }
  }
  class Dialog extends Control {
    open = false
    showModal() {
      this.open = true
      backdrop.focus()
    }
    close() {
      this.open = false
    }
  }
  const disclosure = new Details()
  const summary = new Control()
  const backdrop = new Control()
  const close = new Control()
  const opener = new Control()
  const dialog = new Dialog()
  await withGlobals(
    {
      Element: Control,
      HTMLElement: Control,
      HTMLDetailsElement: Details,
      HTMLDialogElement: Dialog,
      document: { addEventListener() {} },
      window: { matchMedia: () => ({ matches: true }) },
    },
    async () => {
      const bar = setup(searchFilterDemoConfig)
      bar.controller.mount?.({
        root: {
          querySelectorAll: (selector: string) => (selector.includes('modal-close') ? [close] : [dialog]),
        } as unknown as IslandElement,
        lifetime: new AbortController().signal,
      })
      bar.host.fire(bar.ui('search-filter-toggle')[0]!, 'click', {
        currentTarget: opener,
        preventDefault() {},
      })
      await settle()
      assert.equal(dialog.open, true)
      assert.equal(active, close)
      const event = { key: 'Escape', target: new Control(), preventDefault() {}, stopPropagation() {} }
      bar.host.fire(bar.ui('search-filter-sheet')[0]!, 'keydown', event)
      assert.equal(disclosure.open, false)
      assert.equal(dialog.open, true)
      assert.equal(active, summary)
      bar.host.fire(bar.ui('search-filter-sheet')[0]!, 'keydown', event)
      assert.equal(dialog.open, false)
      assert.equal(active, opener)
    },
  )
})
