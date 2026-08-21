// Compile KTL to a tree of closures.
//
// There is no `new Function`, no `eval`, no string-to-code path anywhere here.
// A compiled template is a plain JavaScript function that can only read from the
// scope it is handed and call filters that were registered by name. That is the
// whole security argument for installing a stranger's theme.

import { parse } from './parser.ts'
import type { Expr, Node } from './parser.ts'
import { escapeHtml } from '@ketvietlab/ketjs-view'
import { KetError } from '../../kernel/errors.ts'

export type Filter = (value: unknown, arg?: unknown) => unknown
export type Scope = Record<string, unknown>
export type JointRenderer = (joint: string, scope: Scope) => string
export type RegionRenderer = (name: string, scope: Scope) => string
export type IslandRenderer = (name: string, scope: Scope) => string
export type SectionsRenderer = (scope: Scope) => string

export type CompileOpts = {
  filters?: Record<string, Filter>
  /** Bound translator. A theme writes {{ 'website.page.title' | _ }}. */
  translate?: (key: string, params?: Record<string, unknown>) => string
  renderJoint?: JointRenderer
  renderRegion?: RegionRenderer
  renderIsland?: IslandRenderer
  renderSections?: SectionsRenderer
  /** Renders another template by name, with the scope this one built for it. */
  renderTemplate?: (name: string, scope: Scope, from: string) => string
  name?: string
  /** Report templates may only produce data markup; web extension primitives and raw output are forbidden. */
  mode?: 'theme' | 'report'
  maxIterations?: number
}

export type Compiled = {
  render(scope: Scope): string
  jointsUsed: string[]
  regionsUsed: string[]
  islandsUsed: string[]
}

// Intl formatters are expensive to construct and cheap to reuse. Building one per
// interpolation made the money filter cost more than the entire rest of the
// template engine put together — 4.5s against 38ms over the same 5000 renders.
const formatters = new Map<string, Intl.NumberFormat>()
const formatter = (locale: string, opts: Intl.NumberFormatOptions): Intl.NumberFormat => {
  const key = locale + '|' + (opts.style ?? '') + (opts.currency ?? '')
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(locale, opts)
    formatters.set(key, f)
  }
  return f
}

const BASE_FILTERS: Record<string, Filter> = {
  upper: (v) => String(v ?? '').toUpperCase(),
  lower: (v) => String(v ?? '').toLowerCase(),
  money: (v, arg) =>
    formatter(String(arg ?? 'vi-VN'), { style: 'currency', currency: 'VND' }).format(Number(v ?? 0) / 100),
  number: (v) => formatter('vi-VN', {}).format(Number(v ?? 0)),
  default: (v, arg) => (v == null || v === '' ? arg : v),
  length: (v) => (Array.isArray(v) ? v.length : String(v ?? '').length),
  truncate: (v, arg) => {
    const n = Number(arg ?? 80)
    const s = String(v ?? '')
    return s.length > n ? s.slice(0, n) + '…' : s
  },
  json: (v) => JSON.stringify(v),
}

// Reads one own-property at a time. A drop is a null-prototype object, so there is
// nothing above it to walk into even if a name slipped past the parser.
const hasOwn = Object.prototype.hasOwnProperty

function readPath(scope: Scope, parts: string[], where: string): unknown {
  // The scope chain bottoms out at a null-prototype object, so the first hop needs
  // no own-property guard: "constructor" and friends resolve to undefined anyway.
  let cur: unknown = scope[parts[0] as string]
  for (let i = 1; i < parts.length; i++) {
    if (cur == null || typeof cur !== 'object') return undefined
    const p = parts[i] as string
    if (!hasOwn.call(cur, p)) return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  if (typeof cur === 'function') {
    throw new KetError({
      code: 'E_KTL_CALLABLE',
      message: `${where} reached a function via "${parts.join('.')}"`,
      hint: 'view models must expose data only',
    })
  }
  return cur
}

type Thunk = (scope: Scope) => unknown

function compileExpr(e: Expr, o: Required<Pick<CompileOpts, 'filters' | 'name'>> & { line?: number }): Thunk {
  if (e.k === 'lit') {
    const v = e.value
    return () => v
  }
  if (e.k === 'path') {
    const parts = e.parts,
      where = at(o)
    return (s) => readPath(s, parts, where)
  }
  if (e.k === 'not') {
    const inner = compileExpr(e.src, o)
    return (s) => !inner(s)
  }
  if (e.k === 'cmp') {
    const l = compileExpr(e.left, o),
      r = compileExpr(e.right, o),
      op = e.op
    return (s) => {
      const a = l(s),
        b = r(s)
      if (op === '==') return a === b
      if (op === '!=') return a !== b
      if (op === '>') return (a as number) > (b as number)
      if (op === '<') return (a as number) < (b as number)
      if (op === '>=') return (a as number) >= (b as number)
      return (a as number) <= (b as number)
    }
  }
  const src = compileExpr(e.src, o)
  const arg = e.arg ? compileExpr(e.arg, o) : null
  const fn = o.filters[e.name]
  if (!fn) {
    throw new KetError({
      code: 'E_KTL_UNKNOWN_FILTER',
      message: `${at(o)} uses unknown filter "${e.name}"`,
      hint: `registered filters: ${Object.keys(o.filters).sort().join(', ')}`,
    })
  }
  return (s) => fn(src(s), arg ? arg(s) : undefined)
}

/** Where an error is: the template name doubles as its file name, plus the line. */
const at = (o: { name: string; line?: number }): string =>
  `template "${o.name}"` + (o.line ? ` line ${o.line}` : '')

export function compileKtl(source: string, opts: CompileOpts = {}): Compiled {
  const name = opts.name ?? '(anonymous)'
  if (opts.mode === 'report' && source.length > 256_000) {
    throw new KetError({ code: 'E_REPORT_TEMPLATE_LIMIT', message: `template "${name}" exceeds 256 KiB` })
  }
  // Translation arrives as a filter rather than a function in scope, because scope
  // holds data only — a theme that could call functions would be a theme that could
  // run code, which is the whole thing KTL exists to prevent.
  //
  // The filter is named _ , the way gettext and the domain contract name it: it appears often
  // enough in markup that a longer name would cost more than it explains.
  const filters: Record<string, Filter> = {
    ...BASE_FILTERS,
    ...(opts.translate
      ? {
          _: (v: unknown, arg?: unknown) =>
            opts.translate!(String(v), arg as Record<string, unknown> | undefined),
        }
      : {}),
    ...(opts.filters ?? {}),
  }
  const jointsUsed: string[] = []
  const regionsUsed: string[] = []
  const islandsUsed: string[] = []

  let iterations = 0
  const maxIterations = opts.maxIterations ?? (opts.mode === 'report' ? 10_000 : Number.MAX_SAFE_INTEGER)
  const compileNodes = (nodes: Node[]): Array<(s: Scope, out: string[]) => void> =>
    nodes.map((n) => {
      if (n.k === 'text') {
        const v = n.value
        return (_s, out) => {
          out.push(v)
        }
      }
      if (n.k === 'out') {
        if (opts.mode === 'report' && n.raw) {
          throw new KetError({
            code: 'E_REPORT_RAW_OUTPUT',
            message: `${at({ name, line: n.line })} uses raw output`,
            hint: 'report expressions are escaped and report markup is parsed after rendering',
          })
        }
        const t = compileExpr(n.expr, { filters, name, line: n.line })
        const raw = n.raw
        return (s, out) => {
          const v = t(s)
          out.push(v == null ? '' : raw ? String(v) : escapeHtml(v))
        }
      }
      if (n.k === 'if') {
        const cond = compileExpr(n.cond, { filters, name, line: n.line })
        const a = compileNodes(n.then),
          b = compileNodes(n.else)
        return (s, out) => {
          for (const f of cond(s) ? a : b) f(s, out)
        }
      }
      if (n.k === 'for') {
        const src = compileExpr(n.src, { filters, name, line: n.line })
        const body = compileNodes(n.body)
        const varName = n.name
        return (s, out) => {
          const list = src(s)
          if (!Array.isArray(list)) return
          const n = list.length
          // One child scope for the whole loop rather than one per item. The body
          // runs synchronously and never retains it, so reuse is safe.
          const inner = Object.create(s) as Scope
          const loop = { index: 0, first: true, last: n === 1, length: n }
          inner['loop'] = loop
          for (let i = 0; i < n; i++) {
            iterations++
            if (iterations > maxIterations) {
              throw new KetError({
                code: 'E_REPORT_RENDER_LIMIT',
                message: `template "${name}" exceeded ${maxIterations} loop iterations`,
              })
            }
            inner[varName] = list[i]
            loop.index = i
            loop.first = i === 0
            loop.last = i === n - 1
            for (const f of body) f(inner, out)
          }
        }
      }
      if (n.k === 'joint') {
        if (opts.mode === 'report')
          throw new KetError({
            code: 'E_REPORT_WEB_PRIMITIVE',
            message: `${at({ name, line: n.line })} uses joint`,
          })
        jointsUsed.push(n.joint)
        const key = n.joint
        return (s, out) => {
          out.push(opts.renderJoint ? opts.renderJoint(key, s) : '')
        }
      }
      if (n.k === 'sections') {
        if (opts.mode === 'report')
          throw new KetError({
            code: 'E_REPORT_WEB_PRIMITIVE',
            message: `${at({ name, line: n.line })} uses sections`,
          })
        return (s, out) => {
          out.push(opts.renderSections ? opts.renderSections(s) : '')
        }
      }
      if (n.k === 'render') {
        const target = n.template
        const args = Object.entries(n.args).map(
          ([k, e]) => [k, compileExpr(e, { filters, name, line: n.line })] as const,
        )
        const where = at({ name, line: n.line })
        return (s, out) => {
          // A null-prototype object with only what was passed. Not Object.create(s):
          // the callee must not be able to read the caller by accident, or on purpose.
          const inner = Object.create(null) as Scope
          for (const [k, thunk] of args) inner[k] = thunk(s)
          out.push(opts.renderTemplate ? opts.renderTemplate(target, inner, where) : '')
        }
      }
      if (n.k === 'island') {
        if (opts.mode === 'report')
          throw new KetError({
            code: 'E_REPORT_WEB_PRIMITIVE',
            message: `${at({ name, line: n.line })} uses island`,
          })
        islandsUsed.push(n.name)
        const iname = n.name
        return (s, out) => {
          out.push(opts.renderIsland ? opts.renderIsland(iname, s) : '')
        }
      }
      if (opts.mode === 'report')
        throw new KetError({
          code: 'E_REPORT_WEB_PRIMITIVE',
          message: `${at({ name, line: n.line })} uses region`,
        })
      regionsUsed.push(n.name)
      const rname = n.name
      return (s, out) => {
        out.push(opts.renderRegion ? opts.renderRegion(rname, s) : '')
      }
    })

  const program = compileNodes(parse(source))

  return {
    jointsUsed,
    regionsUsed,
    islandsUsed,
    render(scope) {
      iterations = 0
      const out: string[] = []
      // sealScope() already hands over a null-prototype object; copying it again
      // on every render was pure waste.
      const safe: Scope =
        Object.getPrototypeOf(scope) === null ? scope : Object.assign(Object.create(null) as Scope, scope)
      for (const f of program) f(safe, out)
      return out.join('')
    },
  }
}
