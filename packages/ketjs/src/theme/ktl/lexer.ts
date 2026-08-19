// KTL — Ket Template Language.
//
// Themes are third-party code installed into somebody else's app, so a theme must
// not be able to run arbitrary JavaScript: no fetch, no env, no database. That is
// why this is a separate language rather than a tagged template literal, and why
// it compiles to a tree of closures instead of through `new Function`.

export type Token =
  | { type: 'text'; value: string; line: number }
  | { type: 'expr'; value: string; line: number }
  | { type: 'tag'; value: string; line: number }

export function lex(src: string): Token[] {
  const out: Token[] = []
  let i = 0
  let line = 1
  const countLines = (s: string) => { for (const ch of s) if (ch === '\n') line++ }

  while (i < src.length) {
    const openExpr = src.indexOf('{{', i)
    const openTag = src.indexOf('{%', i)
    const next = openExpr === -1 ? openTag : openTag === -1 ? openExpr : Math.min(openExpr, openTag)

    if (next === -1) { const value = src.slice(i); if (value) out.push({ type: 'text', value, line }); break }
    if (next > i) { const value = src.slice(i, next); out.push({ type: 'text', value, line }); countLines(value) }

    const isExpr = src.startsWith('{{', next)
    const close = src.indexOf(isExpr ? '}}' : '%}', next + 2)
    if (close === -1) throw new KtlSyntaxError(`unterminated ${isExpr ? '{{' : '{%'} at line ${line}`, line)
    const raw = src.slice(next + 2, close).trim()
    out.push({ type: isExpr ? 'expr' : 'tag', value: raw, line })
    countLines(src.slice(next, close))
    i = close + 2
  }
  return out
}

export class KtlSyntaxError extends Error {
  code = 'E_KTL_SYNTAX'
  line: number
  constructor(message: string, line: number) { super(message); this.line = line }
}
