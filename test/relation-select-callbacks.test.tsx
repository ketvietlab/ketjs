import assert from 'node:assert/strict'
import { test } from 'node:test'
import { countingHost, mount, signal } from '@ketvietlab/ketjs-view'
import type { HostNode } from '@ketvietlab/ketjs-view'
import { createRelationSelectView } from '@ketvietlab/design-system'
import { relationSelectDemoConfig } from '../packages/design-system/src/interactions/relation-select/demo.ts'

const byUi = (node: HostNode, ui: string): HostNode[] => [
  ...(node.attrs?.['data-ui'] === ui ? [node] : []),
  ...(node.children ?? []).flatMap((child) => byUi(child, ui)),
]
const textOf = (node: HostNode): string => node.text ?? (node.children ?? []).map(textOf).join('')

test('relation select: local add picker searches all options, excludes selected records and passes a create draft', () => {
  class Input {
    value = ''
  }
  const globals = globalThis as unknown as Record<string, unknown>
  const previousInput = globals.HTMLInputElement
  globals.HTMLInputElement = Input
  const options = signal(
    Array.from({ length: 12 }, (_, i) => ({ value: `id-${i}`, label: `Attribute ${i}` })),
  )
  const disabled = signal(false)
  const selected: string[] = []
  const created: string[] = []
  const controller = createRelationSelectView(
    {
      id: 'add-attribute',
      config: {
        ...relationSelectDemoConfig,
        value: null,
        options: [],
      },
    },
    {
      options,
      disabled,
      resetAfterSelect: true,
      onSelect: (option) => {
        selected.push(option.value)
        options.set(options().filter((item) => item.value !== option.value))
      },
      onCreate: (query) => created.push(query),
    },
  )
  const host = countingHost()
  const root = host.root()
  const view = mount(host, root, controller.view)
  const click = (ui: string) => host.fire(byUi(root, ui)[0]!, 'click')
  try {
    click('relation-trigger')
    assert.equal(
      byUi(root, 'relation-option').length,
      12,
      'local records beyond the first seven remain reachable',
    )
    host.fire(byUi(root, 'relation-option')[11]!, 'click')
    assert.deepEqual(selected, ['id-11'])
    assert.equal(textOf(byUi(root, 'relation-value')[0]!), relationSelectDemoConfig.labels.choose)
    click('relation-trigger')
    assert.equal(byUi(root, 'relation-option').length, 11)
    const input = new Input()
    input.value = '  Capacity  '
    host.fire(byUi(root, 'relation-search')[0]!, 'input', { currentTarget: input })
    assert.equal(byUi(root, 'relation-option').length, 0)
    const actions = byUi(root, 'relation-footer')[0]!
    assert.doesNotMatch(textOf(actions), /Browse all/, 'there is no empty remote manager')
    const create = byUi(actions, 'action')[0]!
    disabled.set(true)
    host.fire(create, 'click')
    assert.deepEqual(created, [])
    disabled.set(false)
    host.fire(byUi(root, 'relation-footer').flatMap((node) => byUi(node, 'action'))[0]!, 'click')
    assert.deepEqual(created, ['Capacity'])
    assert.equal(byUi(root, 'relation-menu').length, 0)
  } finally {
    view.dispose()
    controller.dispose?.()
    if (previousInput === undefined) delete globals.HTMLInputElement
    else globals.HTMLInputElement = previousInput
  }
})

test('relation select: a local read-only catalogue has no create or manager action', () => {
  const controller = createRelationSelectView(
    { id: 'choose', config: relationSelectDemoConfig },
    {
      options: () => relationSelectDemoConfig.options,
    },
  )
  const host = countingHost()
  const root = host.root()
  const view = mount(host, root, controller.view)
  host.fire(byUi(root, 'relation-trigger')[0]!, 'click')
  assert.equal(byUi(root, 'relation-footer').length, 0)
  view.dispose()
})

test('relation select: Escape dismisses only the open picker and restores trigger focus', () => {
  const globals = globalThis as unknown as Record<string, unknown>
  const previous = globals.KeyboardEvent
  const Keyboard = {
    [Symbol.hasInstance](value: unknown) {
      return typeof value === 'object' && value !== null && 'key' in value
    },
  }
  globals.KeyboardEvent = Keyboard
  const controller = createRelationSelectView({ id: 'escape', config: relationSelectDemoConfig })
  const host = countingHost()
  const root = host.root()
  const view = mount(host, root, controller.view)
  let focused = false
  let prevented = 0
  let stopped = 0
  const event = {
    key: 'Escape',
    currentTarget: {
      querySelector: () => ({
        focus: () => {
          focused = true
        },
      }),
    },
    preventDefault: () => {
      prevented++
    },
    stopPropagation: () => {
      stopped++
    },
  }
  try {
    host.fire(byUi(root, 'relation-trigger')[0]!, 'click')
    host.fire(byUi(root, 'relation-select')[0]!, 'keydown', event)
    assert.equal(byUi(root, 'relation-menu').length, 0)
    assert.equal(focused, true)
    assert.equal(prevented, 1)
    assert.equal(stopped, 1)
    host.fire(byUi(root, 'relation-select')[0]!, 'keydown', event)
    assert.equal(stopped, 1, 'the next Escape can reach the enclosing modal')
  } finally {
    view.dispose()
    if (previous === undefined) delete globals.KeyboardEvent
    else globals.KeyboardEvent = previous
  }
})

test('relation select: closing the "more" dialog stays inside it so an enclosing record modal stays open', () => {
  for (const ui of ['modal-close', 'modal-backdrop']) {
    const controller = createRelationSelectView({ id: `nested-${ui}`, config: relationSelectDemoConfig })
    const host = countingHost()
    const root = host.root()
    const view = mount(host, root, controller.view)
    let stopped = 0
    try {
      host.fire(byUi(root, 'relation-trigger')[0]!, 'click')
      const more = byUi(byUi(root, 'relation-footer')[0]!, 'action')[0]!
      host.fire(more, 'click')
      assert.equal(byUi(root, 'modal-layer').length, 1)
      host.fire(byUi(root, ui)[0]!, 'click', {
        stopPropagation: () => {
          stopped++
        },
      })
      assert.equal(byUi(root, 'modal-layer').length, 0, `${ui} closes the dialog`)
      assert.equal(stopped, 1, `${ui} does not bubble to the record modal's document listener`)
    } finally {
      view.dispose()
    }
  }
})
