import { lex, KtlSyntaxError } from './lexer.ts'
import type { Token } from './lexer.ts'

export type Expr =
  | { k: 'path'; parts: string[] }
  | { k: 'lit'; value: string | number | boolean }
  | { k: 'filter'; src: Expr; name: string; arg: Expr | null }
  | { k: 'cmp'; op: string; left: Expr; right: Expr }
  | { k: 'not'; src: Expr }

export type Node =
  | { k: 'text'; value: string }
  | { k: 'out'; expr: Expr; raw: boolean; line: number }
  | { k: 'if'; cond: Expr; then: Node[]; else: Node[]; line: number }
  | { k: 'for'; name: string; src: Expr; body: Node[]; line: number }
  | { k: 'joint'; joint: string; line: number }
  | { k: 'region'; name: string; line: number }

const IDENT = /^[a-zA-Z_][a-zA-Z0-9_]*$/
// Property names that could reach the prototype chain are rejected at parse time,
// so a malicious theme cannot even express the traversal.
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype', '__defineGetter__', '__defineSetter__'])

export function parseExpr(src: string, line: number): Expr {
  let s = src.trim()
  if (s.startsWith('not ')) return { k: 'not', src: parseExpr(s.slice(4), line) }

  for (const op of ['==', '!=', '>=', '<=', '>', '<']) {
    const at = splitTop(s, op)
    if (at >= 0) return { k: 'cmp', op, left: parseExpr(s.slice(0, at), line), right: parseExpr(s.slice(at + op.length), line) }
  }

  const pipe = splitTop(s, '|')
  if (pipe >= 0) {
    const head = parseExpr(s.slice(0, pipe), line)
    const rest = s.slice(pipe + 1).trim()
    const colon = rest.indexOf(':')
    const name = (colon === -1 ? rest : rest.slice(0, colon)).trim()
    if (!IDENT.test(name)) throw new KtlSyntaxError(`invalid filter name "${name}" at line ${line}`, line)
    const arg = colon === -1 ? null : parseExpr(rest.slice(colon + 1), line)
    return { k: 'filter', src: head, name, arg }
  }

  if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) return { k: 'lit', value: s.slice(1, -1) }
  if (/^-?\d+(\.\d+)?$/.test(s)) return { k: 'lit', value: Number(s) }
  if (s === 'true') return { k: 'lit', value: true }
  if (s === 'false') return { k: 'lit', value: false }

  const parts = s.split('.').map(p => p.trim())
  for (const p of parts) {
    if (!IDENT.test(p)) throw new KtlSyntaxError(`invalid path segment "${p}" at line ${line}`, line)
    if (FORBIDDEN.has(p)) throw new KtlSyntaxError(`forbidden property "${p}" at line ${line}`, line)
  }
  return { k: 'path', parts }
}

// find an operator that is not inside quotes
function splitTop(s: string, op: string): number {
  let q: string | null = null
  for (let i = 0; i < s.length; i++) {
    const c = s[i] as string
    if (q) { if (c === q) q = null; continue }
    if (c === "'" || c === '"') { q = c; continue }
    if (s.startsWith(op, i)) {
      if (op === '>' || op === '<') { if (s[i + 1] === '=') continue }
      if (op === '|' && (s[i + 1] === '|' || s[i - 1] === '|')) continue
      return i
    }
  }
  return -1
}

export function parse(src: string): Node[] {
  const tokens: Token[] = lex(src)
  let i = 0

  const parseBlock = (stopAt: string[]): { nodes: Node[]; stopped: string; line: number } => {
    const nodes: Node[] = []
    while (i < tokens.length) {
      const t = tokens[i] as Token
      if (t.type === 'text') { nodes.push({ k: 'text', value: t.value }); i++; continue }
      if (t.type === 'expr') {
        const raw = t.value.startsWith('raw ')
        nodes.push({ k: 'out', expr: parseExpr(raw ? t.value.slice(4) : t.value, t.line), raw, line: t.line })
        i++
        continue
      }
      const words = t.value.split(/\s+/)
      const head = words[0] as string
      if (stopAt.includes(head)) return { nodes, stopped: head, line: t.line }

      if (head === 'if') {
        i++
        const thenPart = parseBlock(['else', 'endif'])
        let elsePart: Node[] = []
        if (thenPart.stopped === 'else') { i++; const e = parseBlock(['endif']); elsePart = e.nodes }
        i++
        nodes.push({ k: 'if', cond: parseExpr(t.value.slice(2), t.line), then: thenPart.nodes, else: elsePart, line: t.line })
        continue
      }
      if (head === 'for') {
        const m = /^for\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+in\s+(.+)$/.exec(t.value)
        if (!m) throw new KtlSyntaxError(`bad for-loop at line ${t.line}: {% ${t.value} %}`, t.line)
        i++
        const body = parseBlock(['endfor'])
        i++
        nodes.push({ k: 'for', name: m[1] as string, src: parseExpr(m[2] as string, t.line), body: body.nodes, line: t.line })
        continue
      }
      if (head === 'joint') {
        const m = /^joint\s+["']([^"']+)["']$/.exec(t.value)
        if (!m) throw new KtlSyntaxError(`bad joint tag at line ${t.line}`, t.line)
        nodes.push({ k: 'joint', joint: m[1] as string, line: t.line })
        i++
        continue
      }
      if (head === 'region') {
        const m = /^region\s+["']([^"']+)["']$/.exec(t.value)
        if (!m) throw new KtlSyntaxError(`bad region tag at line ${t.line}`, t.line)
        nodes.push({ k: 'region', name: m[1] as string, line: t.line })
        i++
        continue
      }
      throw new KtlSyntaxError(`unknown tag "{% ${t.value} %}" at line ${t.line}`, t.line)
    }
    return { nodes, stopped: '', line: 0 }
  }

  const out = parseBlock([])
  return out.nodes
}
