// The automatic JSX runtime for Ket.
//
// JSX is authoring syntax only. It compiles to calls in this file, and those calls
// produce the same TemplateResult the tagged-template API does. There is no VDOM:
// static element shapes are cached, while props and children remain renderer holes.

import { html } from './render.ts'
import type { TemplateResult } from './render.ts'

/** Renderer holes deliberately accept application-defined branded values too. */
export type JSXChild = unknown
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
  disabled?: boolean
  checked?: boolean
  selected?: boolean
  hidden?: boolean
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
    children: unknown
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
const shapeCache = new Map<string, TemplateStringsArray>()
const fragmentCache = new Map<number, TemplateStringsArray>()

const templateStrings = (segments: string[]): TemplateStringsArray => {
  const strings = [...segments] as unknown as TemplateStringsArray
  Object.defineProperty(strings, 'raw', { value: Object.freeze([...segments]), enumerable: false })
  return Object.freeze(strings)
}

const shapeFor = (tag: string, attributes: string[], hasChildren: boolean): TemplateStringsArray => {
  const key = JSON.stringify([tag, attributes, hasChildren])
  const cached = shapeCache.get(key)
  if (cached) return cached

  const segments = [`<${tag}`]
  for (const name of attributes) {
    segments[segments.length - 1] += ` ${name}=`
    segments.push('')
  }
  segments[segments.length - 1] += '>'
  if (hasChildren) segments.push('')
  if (!VOID.has(tag)) segments[segments.length - 1] += `</${tag}>`

  const strings = templateStrings(segments)
  shapeCache.set(key, strings)
  return strings
}

const fragmentShape = (length: number): TemplateStringsArray => {
  const cached = fragmentCache.get(length)
  if (cached) return cached
  const strings = templateStrings(Array.from({ length: length + 1 }, () => ''))
  fragmentCache.set(length, strings)
  return strings
}

const fragment = (children: unknown): TemplateResult => {
  const values = Array.isArray(children) ? children.map(normalizeChild) : [normalizeChild(children)]
  return html(fragmentShape(values.length), ...values)
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

type RuntimeProps = Record<string, unknown> & { children?: unknown }

export function jsx(
  type: string | JSXComponent<RuntimeProps>,
  properties: RuntimeProps | null,
  _key?: unknown,
): TemplateResult {
  const props = properties ?? {}
  if (typeof type === 'function') return type(props)
  if (!TAG.test(type)) throw new TypeError(`invalid JSX element name "${type}"`)
  if ('dangerouslySetInnerHTML' in props) {
    throw new TypeError(
      'Ket JSX has no dangerouslySetInnerHTML; pass trusted compiler output through trustedMarkup()',
    )
  }
  if ('ref' in props) throw new TypeError('Ket JSX does not expose mutable element refs')

  const entries = Object.entries(props)
    .filter(([name]) => name !== 'children' && name !== 'key')
    .map(([sourceName, value]) => ({ sourceName, name: attributeName(sourceName), value }))

  const seen = new Set<string>()
  for (const entry of entries) {
    if (!ATTRIBUTE.test(entry.name)) throw new TypeError(`invalid JSX attribute name "${entry.name}"`)
    if (seen.has(entry.name)) throw new TypeError(`JSX attribute "${entry.name}" was provided more than once`)
    seen.add(entry.name)
  }

  const hasChildren = props.children !== undefined && props.children !== null && props.children !== false
  if (VOID.has(type) && hasChildren)
    throw new TypeError(`<${type}> is a void element and cannot have children`)

  const values = entries.map((entry) =>
    entry.sourceName === 'style' ? styleValue(entry.value) : entry.value,
  )
  if (hasChildren) values.push(normalizeChild(props.children))
  return html(
    shapeFor(
      type,
      entries.map((entry) => entry.name),
      hasChildren,
    ),
    ...values,
  )
}

export const jsxs = jsx

export function Fragment(props: { children?: unknown }): TemplateResult {
  if (props.children === undefined || props.children === null || props.children === false) return fragment([])
  return fragment(props.children)
}
