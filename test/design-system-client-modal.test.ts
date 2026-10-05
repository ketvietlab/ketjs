import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attachClientModalInteractions } from '../packages/design-system/src/runtime/client-modal.js'

type Key = { key: string; shiftKey: boolean; preventDefault: () => void; stopPropagation: () => void }
type Listener = (event: Key) => void
const fakeDocument: { activeElement: unknown; addEventListener: unknown; removeEventListener: unknown } = {
  activeElement: null,
  addEventListener: null,
  removeEventListener: null,
}

// The focus lifetime needs browser objects, not a transport or navigation mock.
// Browser geometry/real keyboard evidence is recorded separately in CONTEXT-CONTROLS.md.
class Element {
  readonly id: string
  children: Element[] = []
  inert = false
  isConnected = true
  parentElement: Element | null = null
  querySelector: (selector: string) => Element | null = () => null
  querySelectorAll: (selector: string) => Element[] = () => []
  click = (): void => {}
  constructor(id: string) {
    this.id = id
  }
  focus(): void {
    fakeDocument.activeElement = this
  }
  matches(): boolean {
    return false
  }
  closest(): null {
    return null
  }
  getClientRects(): object[] {
    return [{}]
  }
}

test('client sheet traps both tab boundaries, closes once, and restores prior inertness/focus', () => {
  const opener = new Element('opener'),
    background = new Element('background'),
    alreadyInert = new Element('already-inert'),
    layer = new Element('layer'),
    modal = new Element('modal'),
    close = new Element('close'),
    input = new Element('input'),
    last = new Element('last')
  alreadyInert.inert = true
  const root = new Element('root')
  root.children = [background, alreadyInert, layer]
  layer.parentElement = root
  root.querySelector = () => layer
  layer.querySelector = () => modal
  modal.querySelectorAll = () => [close, input, last]
  let innerLayer: Element | null = null
  modal.querySelector = (selector) => (selector === '[data-ui="modal-close"]' ? close : innerLayer)
  const listeners = new Set<Listener>()
  fakeDocument.activeElement = opener
  fakeDocument.addEventListener = (_: string, listener: Listener) => listeners.add(listener)
  fakeDocument.removeEventListener = (_: string, listener: Listener) => listeners.delete(listener)
  const globals = globalThis as Record<string, unknown>
  globals.HTMLElement = Element
  globals.document = fakeDocument
  let closes = 0
  close.click = () => {
    closes++
  }
  const dispose = attachClientModalInteractions(root as unknown as HTMLElement)
  assert.equal(fakeDocument.activeElement, close)
  assert.equal(background.inert, true)
  const press = (key: string, shiftKey = false) => {
    let prevented = false,
      stopped = false
    for (const fn of listeners)
      fn({
        key,
        shiftKey,
        preventDefault: () => {
          prevented = true
        },
        stopPropagation: () => {
          stopped = true
        },
      })
    return { prevented, stopped }
  }
  close.focus()
  assert.equal(press('Tab', true).prevented, true)
  assert.equal(fakeDocument.activeElement, last)
  last.focus()
  assert.equal(press('Tab').prevented, true)
  assert.equal(fakeDocument.activeElement, close)
  input.focus()
  assert.equal(press('Tab').prevented, false)
  // An open menu inside the sheet takes Escape first; the sheet stays open.
  innerLayer = new Element('open-menu')
  assert.deepEqual(press('Escape'), { prevented: false, stopped: false })
  assert.equal(closes, 0)
  innerLayer = null
  assert.deepEqual(press('Escape'), { prevented: true, stopped: true })
  assert.equal(closes, 1)
  dispose()
  assert.equal(background.inert, false)
  assert.equal(alreadyInert.inert, true)
  assert.equal(fakeDocument.activeElement, opener)
  assert.equal(listeners.size, 0)
  delete globals.HTMLElement
  delete globals.document
})
