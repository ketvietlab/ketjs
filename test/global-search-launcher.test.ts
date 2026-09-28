import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync('packages/design-system/src/runtime/index.js', 'utf8')
const code = source
  .slice(
    source.indexOf('const attachGlobalSearch'),
    source.indexOf('export const attachDesignSystemInteractions'),
  )
  .replace('export const', 'const')

function fixture(platform = 'MacIntel') {
  let active: ElementStub | null = null
  let blocked = false
  class ElementStub extends EventTarget {
    id = ''
    hidden = true
    textContent = ''
    isConnected = true
    inert = false
    attributes = new Map<string, string>()
    children = new Map<string, ElementStub>()
    querySelector(selector: string) {
      return this.children.get(selector) ?? null
    }
    getAttribute(name: string) {
      return this.attributes.get(name) ?? null
    }
    setAttribute(name: string, value: string) {
      this.attributes.set(name, value)
    }
    closest(selector: string) {
      return selector === '[inert]' ? (this.inert ? this : null) : this === close ? this : null
    }
    parent: ElementStub | null = null
    append(node: ElementStub) {
      node.parent = this
    }
    focus() {
      active = this
    }
  }
  class Input extends ElementStub {
    value = 'unfinished query'
    selected = false
    select() {
      this.selected = true
    }
  }
  class Dialog extends ElementStub {
    open = false
    showModal() {
      this.open = true
    }
    close() {
      this.open = false
      this.dispatchEvent(new Event('close'))
    }
  }
  const trigger = new ElementStub()
  const badge = new ElementStub()
  const input = new Input()
  const close = new ElementStub()
  const dialog = new Dialog()
  class Template extends ElementStub {
    content = new ElementStub()
  }
  const template = new Template()
  const layer = new ElementStub()
  const body = new ElementStub()
  template.content.append(layer)
  template.content.children.set('[data-ui="modal-layer"]', layer)
  template.content.children.set('[data-ui="modal-body"]', body)
  dialog.children.set('template', template)
  dialog.children.set('[data-ui="global-search"]', new ElementStub())
  dialog.id = 'search'
  trigger.setAttribute('aria-controls', 'search')
  trigger.children.set('[data-ui="global-search-shortcut"]', badge)
  dialog.children.set('[data-ui="global-search-input"]', input)
  const document = new EventTarget()
  const root = {
    querySelectorAll: (selector: string) => (selector.includes('trigger') ? [trigger] : [dialog]),
    querySelector: () => (blocked ? {} : null),
  }
  const attach = new Function(
    'document',
    'navigator',
    'HTMLElement',
    'HTMLDialogElement',
    'HTMLInputElement',
    'HTMLTemplateElement',
    'Element',
    `${code}\nreturn attachGlobalSearch`,
  )(document, { platform }, ElementStub, Dialog, Input, Template, ElementStub)
  const cleanup = attach(root) as () => void
  const click = (ctrlKey = false) => {
    const event = new Event('click', { cancelable: true })
    Object.assign(event, { button: 0, ctrlKey })
    trigger.dispatchEvent(event)
    return event
  }
  const shortcut = () => {
    const event = new Event('keydown', { cancelable: true })
    Object.assign(event, { key: 'k', metaKey: true })
    document.dispatchEvent(event)
    return event
  }
  return {
    trigger,
    badge,
    input,
    dialog,
    layer,
    template,
    cleanup,
    click,
    shortcut,
    active: () => active,
    block: () => {
      blocked = true
    },
  }
}

test('global search opens from its launcher, focuses/selects the draft and returns focus on Escape', () => {
  const f = fixture()
  assert.equal(f.layer.parent, f.template.content)
  assert.equal(f.badge.textContent, '⌘ K')
  assert.equal(f.badge.hidden, false)
  assert.equal(f.click().defaultPrevented, true)
  assert.equal(f.dialog.open, true)
  assert.equal(f.layer.parent, f.dialog)
  assert.equal(f.active(), f.input)
  assert.equal(f.input.selected, true)
  assert.equal(f.trigger.getAttribute('aria-expanded'), 'true')
  const cancellation = new Event('cancel', { cancelable: true })
  f.dialog.dispatchEvent(cancellation)
  assert.equal(cancellation.defaultPrevented, true)
  assert.equal(f.dialog.open, false)
  assert.equal(f.active(), f.trigger)
  assert.equal(f.layer.parent, f.template.content)
  assert.equal(f.trigger.getAttribute('aria-expanded'), 'false')
  assert.equal(f.input.value, 'unfinished query')
  assert.equal(f.shortcut().defaultPrevented, true)
  assert.equal(f.dialog.open, true)
  f.cleanup()
  assert.equal(f.dialog.open, false)
  assert.equal(f.shortcut().defaultPrevented, false)
})

test('global search preserves modified native links and does not open above another modal', () => {
  const f = fixture('Win32')
  assert.equal(f.badge.textContent, 'Ctrl K')
  assert.equal(f.click(true).defaultPrevented, false)
  assert.equal(f.dialog.open, false)
  f.block()
  assert.equal(f.shortcut().defaultPrevented, false)
  assert.equal(f.dialog.open, false)
  f.cleanup()
})
