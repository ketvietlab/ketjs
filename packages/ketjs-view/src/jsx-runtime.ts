// The automatic JSX runtime for Ket.
//
// JSX is authoring syntax only. It compiles to calls in this file, and those calls
// produce the same TemplateResult the tagged-template API does. There is no VDOM:
// static element shapes are cached, while props and children remain renderer holes.

import { templateResult } from './render.ts'
import type { Renderable, TemplateResult } from './render.ts'

/** JSX additionally normalises nested arrays into fragments before rendering. */
export type JSXChild = Renderable | readonly JSXChild[]
export type JSXComponent<Props = Record<string, unknown>> = (props: Props) => TemplateResult

export type IntrinsicProps = {
  children?: JSXChild
  class?: string
  className?: string
  id?: string
  title?: string
  role?: string
  href?: string | null
  type?: string
  name?: string | null
  value?: unknown
  // Null and false omit a boolean attribute; an empty string writes it bare, as markup does.
  disabled?: boolean | '' | null
  checked?: boolean | '' | null
  selected?: boolean | '' | null
  hidden?: boolean | '' | null
  style?: string | Record<string, string | number | null | undefined>
  onClick?: (event: Event) => void
  onInput?: (event: Event) => void
  onChange?: (event: Event) => void
  onSubmit?: (event: Event) => void
  [name: string]: unknown
}

export namespace JSX {
  export type Element = TemplateResult
  export type ElementType = string | JSXComponent<never>
  export interface ElementChildrenAttribute {
    children: JSXChild
  }
  export interface IntrinsicElements {
    [tag: string]: IntrinsicProps
  }
}

const VOID = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
])
const TAG = /^[a-z][a-z0-9-]*$/
const ATTRIBUTE = /^[A-Za-z_:][A-Za-z0-9:._-]*$/

// Where an element's children go. A single child — including a list built at run
// time — fills one hole. Static siblings (`jsxs`, which the compiler emits only for
// children written out in source) each get their own hole in the element's shape,
// so `<li><span/><b/></li>` is one template rather than an element plus a fragment.
const NO_CHILDREN = -1
const ONE_CHILD = -2

type Shape = {
  strings: TemplateStringsArray
  /** Position of the style prop among the values, which needs its object form flattened; -1 if none. */
  style: number
}

/**
 * Shapes are found by walking the element's own prop names, in order. Compiled JSX
 * passes object literals whose keys are constant strings, so every step is a lookup
 * on an already-hashed key: no cache key is built per element, and two different
 * name lists can never collide on one entry the way a joined string key could.
 */
type ShapeNode = { next: Map<string, ShapeNode> | null; shapes: Map<number, Shape> | null }
const shapeRoots = new Map<string, ShapeNode>()
const fragmentCache = new Map<number, TemplateStringsArray>()

const templateStrings = (segments: string[]): TemplateStringsArray => {
  const strings = [...segments] as unknown as TemplateStringsArray
  Object.defineProperty(strings, 'raw', { value: Object.freeze([...segments]), enumerable: false })
  return Object.freeze(strings)
}

const fragmentShape = (length: number): TemplateStringsArray => {
  const cached = fragmentCache.get(length)
  if (cached) return cached
  const strings = templateStrings(Array.from({ length: length + 1 }, () => ''))
  fragmentCache.set(length, strings)
  return strings
}

const fragment = (children: unknown): TemplateResult => {
  if (!Array.isArray(children)) return templateResult(fragmentShape(1), [normalizeChild(children)])
  const values = new Array(children.length)
  for (let i = 0; i < children.length; i++) values[i] = normalizeChild(children[i])
  return templateResult(fragmentShape(values.length), values)
}

const normalizeChild = (child: unknown): unknown => (Array.isArray(child) ? fragment(child) : child)

const cssName = (name: string): string => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
const styleValue = (value: unknown): unknown => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return Object.entries(value as Record<string, unknown>)
    .filter(([, part]) => part != null && part !== false)
    .map(([name, part]) => `${cssName(name)}:${String(part)}`)
    .join(';')
}

const attributeName = (name: string): string => {
  if (name === 'className') return 'class'
  if (name === 'htmlFor') return 'for'
  if (/^on[A-Z]/.test(name)) return `on:${name.slice(2).toLowerCase()}`
  return name
}

type RuntimeProps = Record<string, unknown> & { children?: JSXChild }

const isChildless = (children: unknown): boolean =>
  children === undefined || children === null || children === false

/**
 * The first time a tag meets a given list of prop names. Everything that depends
 * only on the names — validation included — happens here, once, and a shape that
 * validated is valid for every later set of values. A rejected shape is never
 * cached, so it is rejected again on every call.
 */
function createShape(type: string, props: RuntimeProps, names: readonly string[], childHoles: number): Shape {
  if (!TAG.test(type)) throw new TypeError(`invalid JSX element name "${type}"`)
  if ('dangerouslySetInnerHTML' in props) {
    throw new TypeError(
      'Ket JSX has no dangerouslySetInnerHTML; pass trusted compiler output through trustedMarkup()',
    )
  }
  if ('ref' in props) throw new TypeError('Ket JSX does not expose mutable element refs')

  const attributes = names.map(attributeName)
  const seen = new Set<string>()
  for (const name of attributes) {
    if (!ATTRIBUTE.test(name)) throw new TypeError(`invalid JSX attribute name "${name}"`)
    if (seen.has(name)) throw new TypeError(`JSX attribute "${name}" was provided more than once`)
    seen.add(name)
  }
  if (VOID.has(type) && !isChildless(props.children))
    throw new TypeError(`<${type}> is a void element and cannot have children`)

  const segments = [`<${type}`]
  for (const name of attributes) {
    segments[segments.length - 1] += ` ${name}=`
    segments.push('')
  }
  segments[segments.length - 1] += '>'
  for (let i = 0; i < childHoles; i++) segments.push('')
  if (!VOID.has(type)) segments[segments.length - 1] += `</${type}>`
  return { strings: templateStrings(segments), style: names.indexOf('style') }
}

function element(type: string, props: RuntimeProps, staticChildren: boolean): TemplateResult {
  const keys = Object.keys(props)
  const values: unknown[] = []
  let names: string[] | null = null
  let node = shapeRoots.get(type)
  for (let i = 0; i < keys.length; i++) {
    const name = keys[i] as string
    if (name === 'children' || name === 'key') {
      // Only the miss path needs the attribute names on their own.
      if (!names) names = keys.slice(0, i)
      continue
    }
    names?.push(name)
    values.push(props[name])
    node = node?.next?.get(name)
  }

  const children = props.children
  let mode = NO_CHILDREN
  if (!isChildless(children)) {
    if (staticChildren && Array.isArray(children)) {
      mode = children.length
      for (let i = 0; i < children.length; i++) values.push(normalizeChild(children[i]))
    } else {
      mode = ONE_CHILD
      values.push(normalizeChild(children))
    }
  }

  let shape = node?.shapes?.get(mode)
  if (!shape) {
    const attributes = names ?? keys
    shape = createShape(type, props, attributes, mode === NO_CHILDREN ? 0 : mode === ONE_CHILD ? 1 : mode)
    let at = shapeRoots.get(type)
    if (!at) shapeRoots.set(type, (at = { next: null, shapes: null }))
    for (const name of attributes) {
      at.next ??= new Map()
      let next = at.next.get(name)
      if (!next) at.next.set(name, (next = { next: null, shapes: null }))
      at = next
    }
    at.shapes ??= new Map()
    at.shapes.set(mode, shape)
  }
  if (shape.style !== -1) values[shape.style] = styleValue(values[shape.style])
  return templateResult(shape.strings, values)
}

export function jsx(
  type: string | JSXComponent<RuntimeProps>,
  properties: RuntimeProps | null,
  _key?: unknown,
): TemplateResult {
  const props = properties ?? {}
  if (typeof type === 'function') return type(props)
  return element(type, props, false)
}

/** Emitted for children written out in source, so their count is fixed per call site. */
export function jsxs(
  type: string | JSXComponent<RuntimeProps>,
  properties: RuntimeProps | null,
  _key?: unknown,
): TemplateResult {
  const props = properties ?? {}
  if (typeof type === 'function') return type(props)
  return element(type, props, true)
}

export function Fragment(props: { children?: JSXChild }): TemplateResult {
  if (props.children === undefined || props.children === null || props.children === false) return fragment([])
  return fragment(props.children)
}
