// Compile KTL to a tree of closures.
//
// There is no `new Function`, no `eval`, no string-to-code path anywhere here.
// A compiled template is a plain JavaScript function that can only read from the
// scope it is handed and call filters that were registered by name. That is the
// whole security argument for installing a stranger's theme.

import { parse } from './parser.ts'
import type { Expr, Node } from './parser.ts'
import { escapeHtml } from '../../view/host.ts'
import { KetError } from '../../kernel/errors.ts'

export type Filter = (value: unknown, arg?: unknown) => unknown
export type Scope = Record<string, unknown>
export type JointRenderer = (joint: string, scope: Scope) => string
export type RegionRenderer = (name: string, scope: Scope) => string

export type CompileOpts = {
  filters?: Record<string, Filter>
  renderJoint?: JointRenderer
  renderRegion?: RegionRenderer
  name?: string
}

export type Compiled = { render(scope: Scope): string; jointsUsed: string[]; regionsUsed: string[] }

const BASE_FILTERS: Record<string, Filter> = {
  upper: v => String(v ?? '').toUpperCase(),
  lower: v => String(v ?? '').toLowerCase(),
  money: (v, arg) => new Intl.NumberFormat(String(arg ?? 'vi-VN'), { style: 'currency', currency: 'VND' }).format(Number(v ?? 0) / 100),
  number: v => new Intl.NumberFormat('vi-VN').format(Number(v ?? 0)),
  default: (v, arg) => (v == null || v === '' ? arg : v),
  length: v => (Array.isArray(v) ? v.length : String(v ?? '').length),
  truncate: (v, arg) => { const n = Number(arg ?? 80); const s = String(v ?? ''); return s.length > n ? s.slice(0, n) + '…' : s },
  json: v => JSON.stringify(v),
}

// Reads one own-property at a time. A drop is a null-prototype object, so there is
// nothing above it to walk into even if a name slipped past the parser.
function readPath(scope: Scope, parts: string[], name: string): unknown {
  let cur: unknown = scope
  for (const p of parts) {
    if (cur == null) return undefined
    if (typeof cur !== 'object') return undefined
    if (!Object.prototype.hasOwnProperty.call(cur, p)) return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  if (typeof cur === 'function') {
    throw new KetError({ code: 'E_KTL_CALLABLE', message: `template "${name}" reached a function via "${parts.join('.')}"`, hint: 'view models must expose data only' })
  }
  return cur
}

type Thunk = (scope: Scope) => unknown

function compileExpr(e: Expr, o: Required<Pick<CompileOpts, 'filters' | 'name'>>): Thunk {
  if (e.k === 'lit') { const v = e.value; return () => v }
  if (e.k === 'path') { const parts = e.parts; return (s) => readPath(s, parts, o.name) }
  if (e.k === 'not') { const inner = compileExpr(e.src, o); return (s) => !inner(s) }
  if (e.k === 'cmp') {
    const l = compileExpr(e.left, o), r = compileExpr(e.right, o), op = e.op
    return (s) => {
      const a = l(s), b = r(s)
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
      message: `template "${o.name}" uses unknown filter "${e.name}"`,
      hint: `registered filters: ${Object.keys(o.filters).sort().join(', ')}`,
    })
  }
  return (s) => fn(src(s), arg ? arg(s) : undefined)
}

export function compileKtl(source: string, opts: CompileOpts = {}): Compiled {
  const name = opts.name ?? '(anonymous)'
  const filters = { ...BASE_FILTERS, ...(opts.filters ?? {}) }
  const jointsUsed: string[] = []
  const regionsUsed: string[] = []

  const compileNodes = (nodes: Node[]): Array<(s: Scope, out: string[]) => void> =>
    nodes.map(n => {
      if (n.k === 'text') { const v = n.value; return (_s, out) => { out.push(v) } }
      if (n.k === 'out') {
        const t = compileExpr(n.expr, { filters, name })
        const raw = n.raw
        return (s, out) => { const v = t(s); out.push(v == null ? '' : raw ? String(v) : escapeHtml(v)) }
      }
      if (n.k === 'if') {
        const cond = compileExpr(n.cond, { filters, name })
        const a = compileNodes(n.then), b = compileNodes(n.else)
        return (s, out) => { for (const f of (cond(s) ? a : b)) f(s, out) }
      }
      if (n.k === 'for') {
        const src = compileExpr(n.src, { filters, name })
        const body = compileNodes(n.body)
        const varName = n.name
        return (s, out) => {
          const list = src(s)
          if (!Array.isArray(list)) return
          for (let i = 0; i < list.length; i++) {
            const inner: Scope = Object.assign(Object.create(null) as Scope, s)
            inner[varName] = list[i]
            inner['loop'] = { index: i, first: i === 0, last: i === list.length - 1, length: list.length }
            for (const f of body) f(inner, out)
          }
        }
      }
      if (n.k === 'joint') {
        jointsUsed.push(n.joint)
        const key = n.joint
        return (s, out) => { out.push(opts.renderJoint ? opts.renderJoint(key, s) : '') }
      }
      regionsUsed.push(n.name)
      const rname = n.name
      return (s, out) => { out.push(opts.renderRegion ? opts.renderRegion(rname, s) : '') }
    })

  const program = compileNodes(parse(source))

  return {
    jointsUsed,
    regionsUsed,
    render(scope) {
      const out: string[] = []
      const safe: Scope = Object.assign(Object.create(null) as Scope, scope)
      for (const f of program) f(safe, out)
      return out.join('')
    },
  }
}
