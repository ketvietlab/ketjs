// Server rendering and hydration.
//
// The server walks the same parsed template the client does and emits the same
// structure, with one comment marker per hole. Hydration then adopts the existing
// DOM instead of rebuilding it: the static parts are already correct, so only the
// holes need to be located and wired up.
//
// Only holes need markers. Everything else is described by the template itself, so
// the walk knows exactly how many nodes each construct occupies.

import { templateFor } from './template.ts'
import type { TplAttr, TplEl, TplNode, TplRoot } from './template.ts'
import { EVENT_PREFIX, isResult, isEach } from './render.ts'
import type { EachResult, TemplateResult } from './render.ts'
import { escapeHtml } from './host.ts'
import { ISLAND_HOST_ATTRIBUTE, ISLAND_TAG } from './island-protocol.ts'

export const HOLE_MARKER = 'k'
export const HOLE_OPEN = 'k['

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

export function renderToString(result: TemplateResult): string {
  return writeResult(result, true)
}

/**
 * Render inert document markup without hydration comments. Explicit island hosts
 * remain hydratable, so their descendants keep the marker protocol they need.
 */
export function renderToStaticString(result: TemplateResult): string {
  return writeResult(result, false)
}

/**
 * Markup that has already been escaped by something trusted to do it.
 *
 * Framework-owned producers use this only after constructing or validating the
 * complete markup — for example KTL compiler output and an island rendered from a
 * trusted view factory. Escaping it again would render the tags as text, which is
 * what a plain string value correctly does and why this needs its own kind.
 *
 * Branded, so it cannot be made from an arbitrary string without saying so. Same
 * move as RouteResult: the dangerous construction has one name and one place.
 */
declare const MARKUP: unique symbol
export type Markup = { readonly html: string; readonly [MARKUP]: true }
export const isMarkup = (v: unknown): v is Markup =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as { html?: unknown }).html === 'string' &&
  MARKUP_TAG in (v as object)
const MARKUP_TAG = Symbol.for('ket.markup')
/** Only for markup a trusted producer constructed or validated. Never for user data. */
export const trustedMarkup = (html: string): Markup => ({ html, [MARKUP_TAG]: true }) as unknown as Markup

function writeValue(value: unknown, hydratable: boolean): string {
  // Text is by far the most common value and cannot be any of the kinds below.
  if (typeof value === 'string') return escapeHtml(value)
  if (isMarkup(value)) return value.html
  if (isResult(value)) return writeResult(value, hydratable)
  if (isEach(value)) {
    const list = value as EachResult
    let out = ''
    for (let i = 0; i < list.items.length; i++) out += writeResult(list.render(list.items[i], i), hydratable)
    return out
  }
  if (value == null || value === false) return ''
  return escapeHtml(value)
}

/**
 * Inside these, an HTML parser does not read `<!--` as a comment — the content is
 * text, and a hydration marker written there arrives as literal characters. It is
 * why a page title rendered as "<!--k[-->KetSuite<!--k-->" in the browser tab.
 *
 * Nothing is lost by leaving the markers out: the reason they exist is to keep
 * adjacent text nodes apart so the hydration walk counts correctly, and neither of
 * these elements has children to walk.
 */
const RCDATA = new Set(['title', 'textarea'])

// --- compiled templates ------------------------------------------------------
// Everything about a template's markup except its values is fixed per call site,
// so each template is compiled once into the static markup between its holes:
// tags, static attributes (already escaped) and hydration markers merged into as
// few strings as possible. A render then only concatenates those strings with its
// values. Walking the parsed tree on every render used to cost more than the
// values themselves.

/** A child hole. Its markers, when it has them, are in the neighbouring static strings. */
type ChildOp = { hole: number; hydrate: boolean }
/** An attribute hole, written with its leading ` name="` only when the value is present. */
type AttrOp = { attr: string; hole: number }
/**
 * An element whose island-host attribute is a hole. Whether its children carry
 * hydration markers depends on that value, so both outcomes are compiled, lazily.
 */
type HostOp = { element: TplEl; raw: boolean; hydrate: boolean; hosted: Op[] | null; plain: Op[] | null }
type Op = string | ChildOp | AttrOp | HostOp

const compiled = { hydratable: new WeakMap<TplRoot, Op[]>(), static: new WeakMap<TplRoot, Op[]>() }

const isHostAttribute = (attribute: TplAttr): boolean => attribute.name === ISLAND_HOST_ATTRIBUTE

/** `host` decides the island-host question for the top-level nodes; null reads it from the template. */
function compile(nodes: readonly TplNode[], raw: boolean, hydrate: boolean, host: boolean | null): Op[] {
  const ops: Op[] = []
  let chunk = ''
  const flush = (): void => {
    if (chunk) ops.push(chunk)
    chunk = ''
  }
  const emit = (node: TplNode, raw: boolean, hydrate: boolean, host: boolean | null): void => {
    if (node.type === 'text') {
      chunk += node.value
      return
    }
    if (node.type === 'hole') {
      // A hole is fenced on both sides. The closing marker is the anchor the client
      // builds too; the opening one exists because an HTML parser merges adjacent
      // text, so "giá trị " and "5" would arrive as a single node and the walk would
      // be one node short. A comment cannot merge, so it keeps them apart.
      const fenced = !raw && hydrate
      if (fenced) chunk += `<!--${HOLE_OPEN}-->`
      flush()
      ops.push({ hole: node.index, hydrate })
      if (fenced) chunk += `<!--${HOLE_MARKER}-->`
      return
    }
    const el = node as TplEl
    const staticHost = el.tag === 'div' && el.attrs.some((a) => isHostAttribute(a) && a.hole == null)
    if (host === null && !hydrate && !staticHost && el.tag === 'div' && el.attrs.some(isHostAttribute)) {
      flush()
      ops.push({ element: el, raw, hydrate, hosted: null, plain: null })
      return
    }
    chunk += `<${el.tag}`
    for (const a of el.attrs) {
      // on:* is behaviour, not markup. It is attached during hydration and must
      // never appear in the HTML, where it would be a dead string at best. The
      // prefix is the renderer's constant, not a second copy of it: the two walks
      // have to agree on what counts as an event or SSR emits what hydration binds.
      if (a.name.startsWith(EVENT_PREFIX)) continue
      if (a.hole != null) {
        flush()
        ops.push({ attr: ` ${a.name}="`, hole: a.hole })
        continue
      }
      if (a.value == null) continue
      chunk += ` ${a.name}="${escapeHtml(a.value)}"`
    }
    chunk += '>'
    if (VOID.has(el.tag)) return
    const rcdata = raw || RCDATA.has(el.tag)
    const hydrateChildren = hydrate || el.tag === ISLAND_TAG || (host ?? staticHost)
    for (const c of el.children) emit(c, rcdata, hydrateChildren, null)
    chunk += `</${el.tag}>`
  }
  for (const node of nodes) emit(node, raw, hydrate, host)
  flush()
  return ops
}

function run(ops: readonly Op[], values: readonly unknown[]): string {
  let out = ''
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i] as Op
    if (typeof op === 'string') {
      out += op
    } else if ('attr' in op) {
      const value = values[op.hole]
      if (value != null && value !== false) out += `${op.attr}${escapeHtml(value)}"`
    } else if ('hole' in op) {
      out += writeValue(values[op.hole], op.hydrate)
    } else {
      const hosted = op.element.attrs.some((attribute) => {
        if (!isHostAttribute(attribute)) return false
        const value = attribute.hole == null ? attribute.value : values[attribute.hole]
        return value != null && value !== false
      })
      const program = hosted
        ? (op.hosted ??= compile([op.element], op.raw, op.hydrate, true))
        : (op.plain ??= compile([op.element], op.raw, op.hydrate, false))
      out += run(program, values)
    }
  }
  return out
}

function writeResult(result: TemplateResult, hydratable: boolean): string {
  const tpl = templateFor(result.strings)
  const cache = hydratable ? compiled.hydratable : compiled.static
  let ops = cache.get(tpl)
  if (!ops) {
    ops = compile(tpl.children, false, hydratable, null)
    cache.set(tpl, ops)
  }
  return run(ops, result.values)
}

// --- hydration ------------------------------------------------------------
// The walk itself lives in render.ts, next to the Instance and Part it has to
// build. Only the error type is shared.

/**
 * An HTML parser does not give back exactly the markup it was handed: it inserts
 * implied elements. `<table><tr>` becomes `<table><tbody><tr>`, and a template that
 * omitted the tbody then walks into a node it never wrote. The mismatch is real and
 * the fix is to write the element, so the error says so instead of leaving the
 * author to discover it.
 */
const IMPLIED: Record<string, string> = {
  tbody: 'table',
  thead: 'table',
  tfoot: 'table',
  tr: 'tbody',
  html: '(document)',
  head: 'html',
  body: 'html',
}

export class HydrationMismatch extends Error {
  code = 'E_HYDRATION_MISMATCH'
  hint: string | null
  constructor(what: string, expected: string, got: string) {
    super(`hydration mismatch at ${what}: expected ${expected}, found ${got}`)
    const implied = Object.keys(IMPLIED).find((tag) => got.includes(`<${tag}>`))
    this.hint = implied
      ? `the HTML parser inserted <${implied}> on its own — write it in the template so the server and the browser agree`
      : 'the markup does not match the template that rendered it; fall back to a clean client render'
  }
}
