// Compile TSX so static intrinsic JSX becomes `html` templates.
//
// TypeScript's automatic runtime turns every JSX element into one runtime call, and
// the runtime makes every element its own template. This compiler finds each
// maximal static subtree instead and writes it as one tagged template: the shape the
// renderer is fastest with, because its markup between holes is fixed per call site.
//
// It never needs to be clever. Anything a template cannot express exactly — spread
// props, style objects, components, refs, names the runtime would reject — stays JSX
// and goes through the same runtime as before, so a construct the compiler does not
// understand costs speed, never behaviour.
//
// Server markup and the client that hydrates it must come from the same transform:
// templates place hydration markers per hole, and the compiled tree has fewer holes
// than the runtime one. Build both sides with `ketJsxPlugin`, or neither.

import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { Parser } from 'acorn'
import acornJsx from 'acorn-jsx'
import { transform } from 'esbuild'
import type { Plugin } from 'esbuild'

export type KetJsxOptions = {
  /** Package that provides `html` and the JSX runtime. Defaults to `@ketvietlab/ketjs-view`. */
  importSource?: string
  /** How to read the source. Defaults to `tsx`. */
  loader?: 'tsx' | 'jsx'
  /** Named in parse errors. */
  sourcefile?: string
}

export type KetJsxResult = {
  code: string
  /** JSX written as templates, and JSX left to the runtime. */
  templates: number
  fallbacks: number
}

type AstNode = { type: string; start: number; end: number }
type Named = AstNode & { name?: string }
type Literal = AstNode & { type: 'Literal'; value: unknown }
type ExpressionContainer = AstNode & { type: 'JSXExpressionContainer'; expression: AstNode }
type JsxText = AstNode & { type: 'JSXText'; value: string }
type JsxAttribute = AstNode & {
  type: 'JSXAttribute'
  name: Named
  value: Literal | ExpressionContainer | JsxElement | JsxFragment | null
}
type JsxSpreadAttribute = AstNode & { type: 'JSXSpreadAttribute'; argument: AstNode }
type JsxElement = AstNode & {
  type: 'JSXElement'
  openingElement: AstNode & {
    name: Named
    attributes: Array<JsxAttribute | JsxSpreadAttribute>
    selfClosing: boolean
  }
  closingElement: AstNode | null
  children: JsxChild[]
}
type JsxFragment = AstNode & { type: 'JSXFragment'; children: JsxChild[] }
type JsxChild = JsxText | ExpressionContainer | JsxElement | JsxFragment | AstNode

// The runtime's own rules, so the compiler only writes what the runtime would accept.
const TAG = /^[a-z][a-z0-9-]*$/
const ATTRIBUTE = /^[A-Za-z_:][A-Za-z0-9:._-]*$/
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
// Static template text is written as-is by the server but used verbatim by the
// client renderer, so anything an HTML parser would decode on one side only stays a
// value. U+FFFC is the template parser's own hole marker.
const UNSAFE_TEXT = /[&<>"'￼]/
const UNSAFE_ATTRIBUTE = /["￼]/

const JsxParser = Parser.extend(acornJsx())

const isNode = (value: unknown): value is AstNode =>
  typeof value === 'object' && value !== null && typeof (value as AstNode).type === 'string'
const isJsx = (node: AstNode): node is JsxElement | JsxFragment =>
  node.type === 'JSXElement' || node.type === 'JSXFragment'

const attributeName = (name: string): string => {
  if (name === 'className') return 'class'
  if (name === 'htmlFor') return 'for'
  if (/^on[A-Z]/.test(name)) return `on:${name.slice(2).toLowerCase()}`
  return name
}

/** JSX text whitespace, exactly as React's compilers apply it. */
function cleanText(value: string): string {
  const lines = value.split(/\r\n|\n|\r/)
  let lastNonEmpty = 0
  for (let i = 0; i < lines.length; i++) if (/[^ \t]/.test(lines[i] as string)) lastNonEmpty = i
  let out = ''
  for (let i = 0; i < lines.length; i++) {
    let line = (lines[i] as string).replace(/\t/g, ' ')
    if (i !== 0) line = line.replace(/^ +/, '')
    if (i !== lines.length - 1) line = line.replace(/ +$/, '')
    if (!line) continue
    out += i === lastNonEmpty ? line : `${line} `
  }
  return out
}

const quoteChunk = (text: string): string =>
  text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${')

type Plan = { tag: string; attributes: Array<{ name: string; node: JsxAttribute }> }

/** The template an element becomes, or null when the runtime has to decide. */
function plan(element: JsxElement): Plan | null {
  const opening = element.openingElement
  const tag = opening.name.type === 'JSXIdentifier' ? (opening.name.name as string) : ''
  if (!TAG.test(tag)) return null
  const attributes: Plan['attributes'] = []
  const seen = new Set<string>()
  for (const attribute of opening.attributes) {
    if (attribute.type !== 'JSXAttribute' || attribute.name.type !== 'JSXIdentifier') return null
    const source = attribute.name.name as string
    if (source === 'key') continue
    // Each of these either needs the runtime's conversion or is one of its errors.
    if (source === 'style' || source === 'ref' || source === 'dangerouslySetInnerHTML') return null
    if (source === 'children') return null
    const name = attributeName(source)
    if (!ATTRIBUTE.test(name) || seen.has(name)) return null
    seen.add(name)
    attributes.push({ name, node: attribute })
  }
  for (const child of element.children) {
    if (child.type === 'JSXSpreadChild') return null
    if (VOID.has(tag) && (child.type !== 'JSXText' || cleanText((child as JsxText).value))) return null
  }
  return { tag, attributes }
}

export async function transformKetJsx(source: string, options: KetJsxOptions = {}): Promise<KetJsxResult> {
  const importSource = options.importSource ?? '@ketvietlab/ketjs-view'
  const stripped = await transform(source, {
    loader: options.loader ?? 'tsx',
    jsx: 'preserve',
    format: 'esm',
    target: 'esnext',
    sourcefile: options.sourcefile,
  })
  const code = stripped.code
  const program = JsxParser.parse(code, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as AstNode
  let templates = 0
  let fallbacks = 0

  const collect = (node: unknown, found: Array<JsxElement | JsxFragment>): void => {
    if (!isNode(node)) return
    if (isJsx(node)) {
      found.push(node)
      return
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const item of value) collect(item, found)
      else collect(value, found)
    }
  }

  /** The node's source, with every outermost JSX node inside it compiled. */
  const rewrite = (node: AstNode): string => {
    if (isJsx(node)) return compile(node)
    const found: Array<JsxElement | JsxFragment> = []
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const item of value) collect(item, found)
      else collect(value, found)
    }
    found.sort((a, b) => a.start - b.start)
    let out = ''
    let at = node.start
    for (const jsx of found) {
      out += code.slice(at, jsx.start) + compile(jsx)
      at = jsx.end
    }
    return out + code.slice(at, node.end)
  }

  const compile = (node: JsxElement | JsxFragment): string => {
    const root = node.type === 'JSXElement' ? plan(node) : null
    if (node.type === 'JSXElement' && !root) return fallback(node)

    const chunks = ['']
    const holes: string[] = []
    const text = (value: string): void => {
      chunks[chunks.length - 1] += value
    }
    const hole = (expression: string): void => {
      holes.push(expression)
      chunks.push('')
    }
    const child = (node: JsxChild): void => {
      if (node.type === 'JSXText') {
        const value = cleanText((node as JsxText).value)
        if (!value) return
        if (UNSAFE_TEXT.test(value)) hole(JSON.stringify(value))
        else text(value)
        return
      }
      if (node.type === 'JSXExpressionContainer') {
        const expression = (node as ExpressionContainer).expression
        if (expression.type === 'JSXEmptyExpression') return
        if (expression.type === 'Literal') hole(code.slice(expression.start, expression.end))
        else hole(`__ket_child(${rewrite(expression)})`)
        return
      }
      if (node.type === 'JSXFragment') {
        for (const c of (node as JsxFragment).children) child(c)
        return
      }
      const nested = plan(node as JsxElement)
      if (nested) element(node as JsxElement, nested)
      else hole(fallback(node as JsxElement))
    }
    const element = (node: JsxElement, plan: Plan): void => {
      text(`<${plan.tag}`)
      for (const { name, node: attribute } of plan.attributes) {
        const value = attribute.value
        if (value === null) {
          // A bare attribute is the value true to the runtime, and is written as such.
          text(` ${name}=`)
          hole('true')
        } else if (value.type === 'Literal' && !UNSAFE_ATTRIBUTE.test(String(value.value))) {
          text(` ${name}="${String(value.value)}"`)
        } else if (value.type === 'Literal') {
          text(` ${name}=`)
          hole(JSON.stringify(value.value))
        } else if (value.type === 'JSXExpressionContainer') {
          text(` ${name}=`)
          hole(rewrite(value.expression))
        } else {
          text(` ${name}=`)
          hole(compile(value))
        }
      }
      text('>')
      if (VOID.has(plan.tag)) return
      for (const c of node.children) child(c)
      text(`</${plan.tag}>`)
    }

    templates++
    if (node.type === 'JSXFragment') for (const c of node.children) child(c)
    else element(node, root as Plan)
    let out = `__ket_html\`${quoteChunk(chunks[0] as string)}`
    for (let i = 0; i < holes.length; i++) out += `\${${holes[i]}}${quoteChunk(chunks[i + 1] as string)}`
    return `${out}\``
  }

  /** JSX the runtime keeps. Its expressions and children are still compiled where they can be. */
  const fallback = (node: JsxElement): string => {
    fallbacks++
    const opening = node.openingElement
    let out = code.slice(opening.start, opening.name.end)
    for (const attribute of opening.attributes) {
      out += ' '
      if (attribute.type === 'JSXSpreadAttribute') {
        out += `{...${rewrite(attribute.argument)}}`
        continue
      }
      const value = attribute.value
      const name = code.slice(attribute.name.start, attribute.name.end)
      if (value === null || value.type === 'Literal') out += code.slice(attribute.start, attribute.end)
      else if (value.type === 'JSXExpressionContainer')
        out +=
          value.expression.type === 'JSXEmptyExpression'
            ? code.slice(attribute.start, attribute.end)
            : `${name}={${rewrite(value.expression)}}`
      else out += `${name}={${compile(value)}}`
    }
    if (opening.selfClosing) return `${out} />`
    out += '>'
    for (const c of node.children) {
      if (c.type === 'JSXExpressionContainer') {
        const expression = (c as ExpressionContainer).expression
        out +=
          expression.type === 'JSXEmptyExpression' ? code.slice(c.start, c.end) : `{${rewrite(expression)}}`
      } else if (isJsx(c)) out += `{${compile(c)}}`
      else out += code.slice(c.start, c.end)
    }
    const closing = node.closingElement as AstNode
    return out + code.slice(closing.start, closing.end)
  }

  const body = rewrite(program)
  const prelude = templates
    ? `import { html as __ket_html } from ${JSON.stringify(importSource)};\n` +
      `import { Fragment as __ket_Fragment, jsx as __ket_jsx } from ${JSON.stringify(`${importSource}/jsx-runtime`)};\n` +
      // A list in a hole renders as the runtime's fragment, exactly as it did as a JSX child.
      'const __ket_child = (value) => (Array.isArray(value) ? __ket_jsx(__ket_Fragment, { children: value }) : value);\n'
    : ''
  const out = await transform(prelude + body, {
    loader: 'jsx',
    jsx: 'automatic',
    jsxImportSource: importSource,
    format: 'esm',
    target: 'esnext',
    sourcefile: options.sourcefile,
  })
  return { code: out.code, templates, fallbacks }
}

/**
 * Compile `.tsx` and `.jsx` modules as they load. Add it to the server build and the
 * client bundle together: markup hydrates only with the transform that rendered it.
 */
export function ketJsxPlugin(options: Pick<KetJsxOptions, 'importSource'> = {}): Plugin {
  return {
    name: 'ket-jsx',
    setup(build) {
      build.onLoad({ filter: /\.[jt]sx$/ }, async (args) => {
        if (/[\\/]node_modules[\\/]/.test(args.path)) return undefined
        const source = await readFile(args.path, 'utf8')
        const result = await transformKetJsx(source, {
          ...options,
          loader: args.path.endsWith('.tsx') ? 'tsx' : 'jsx',
          sourcefile: args.path,
        })
        return { contents: result.code, loader: 'js', resolveDir: dirname(args.path) }
      })
    },
  }
}
