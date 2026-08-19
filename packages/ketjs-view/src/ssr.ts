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
import type { TplEl, TplNode } from './template.ts'
import { isResult, isEach } from './render.ts'
import type { EachResult, TemplateResult } from './render.ts'
import { escapeHtml } from './host.ts'

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
  const out: string[] = []
  writeResult(result, out)
  return out.join('')
}

/**
 * Markup that has already been escaped by something trusted to do it.
 *
 * The only producer is the KTL compiler, which escapes every interpolation and
 * cannot run code — so what arrives here is a string of markup rather than a
 * string of data. Escaping it again would render the tags as text, which is what
 * a plain string value correctly does and why this needs its own kind.
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
/** Only for output a sandboxed compiler produced. Never for user data. */
export const trustedMarkup = (html: string): Markup => ({ html, [MARKUP_TAG]: true }) as unknown as Markup

function writeValue(value: unknown, out: string[]): void {
  if (isMarkup(value)) {
    out.push(value.html)
    return
  }
  if (isResult(value)) {
    writeResult(value, out)
    return
  }
  if (isEach(value)) {
    const list = value as EachResult
    for (let i = 0; i < list.items.length; i++) writeResult(list.render(list.items[i], i), out)
    return
  }
  if (value == null || value === false) return
  out.push(escapeHtml(value))
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

function writeResult(result: TemplateResult, out: string[]): void {
  const tpl = templateFor(result.strings)
  const write = (node: TplNode, raw = false): void => {
    if (node.type === 'text') {
      out.push(node.value)
      return
    }
    if (node.type === 'hole') {
      // A hole is fenced on both sides. The closing marker is the anchor the client
      // builds too; the opening one exists because an HTML parser merges adjacent
      // text, so "giá trị " and "5" would arrive as a single node and the walk would
      // be one node short. A comment cannot merge, so it keeps them apart.
      if (raw) {
        writeValue(result.values[node.index], out)
        return
      }
      out.push(`<!--${HOLE_OPEN}-->`)
      writeValue(result.values[node.index], out)
      out.push(`<!--${HOLE_MARKER}-->`)
      return
    }
    const el = node as TplEl
    out.push(`<${el.tag}`)
    for (const a of el.attrs) {
      // on:* is behaviour, not markup. It is attached during hydration and must
      // never appear in the HTML, where it would be a dead string at best.
      if (a.name.startsWith('on:')) continue
      const v = a.hole != null ? result.values[a.hole] : a.value
      if (v == null || v === false) continue
      out.push(` ${a.name}="${escapeHtml(v)}"`)
    }
    out.push('>')
    if (VOID.has(el.tag)) return
    const rcdata = raw || RCDATA.has(el.tag)
    for (const c of el.children) write(c, rcdata)
    out.push(`</${el.tag}>`)
  }
  for (const n of tpl.children) write(n)
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
