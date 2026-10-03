import assert from 'node:assert/strict'
import { test } from 'node:test'
import { attachClientModalInteractions } from '../packages/design-system/src/runtime/client-modal.js'

// The focus lifetime needs browser objects, not a transport or navigation mock.
// Browser geometry/real keyboard evidence is recorded separately in CONTEXT-CONTROLS.md.
class Element {
  constructor(id) {
    this.id = id
    this.children = []
    this.inert = false
    this.isConnected = true
  }
  focus() {
    document.activeElement = this
  }
  matches() {
    return false
  }
  closest() {
    return null
  }
  getClientRects() {
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
  modal.querySelector = () => close
  const listeners = new Set()
  globalThis.HTMLElement = Element
  globalThis.document = {
    activeElement: opener,
    addEventListener: (_, listener) => listeners.add(listener),
    removeEventListener: (_, listener) => listeners.delete(listener),
  }
  let closes = 0
  close.click = () => {
    closes++
  }
  const dispose = attachClientModalInteractions(root)
  assert.equal(document.activeElement, close)
  assert.equal(background.inert, true)
  const press = (key, shiftKey = false) => {
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
  assert.equal(document.activeElement, last)
  last.focus()
  assert.equal(press('Tab').prevented, true)
  assert.equal(document.activeElement, close)
  input.focus()
  assert.equal(press('Tab').prevented, false)
  assert.deepEqual(press('Escape'), { prevented: true, stopped: true })
  assert.equal(closes, 1)
  dispose()
  assert.equal(background.inert, false)
  assert.equal(alreadyInert.inert, true)
  assert.equal(document.activeElement, opener)
  assert.equal(listeners.size, 0)
  delete globalThis.HTMLElement
  delete globalThis.document
})
