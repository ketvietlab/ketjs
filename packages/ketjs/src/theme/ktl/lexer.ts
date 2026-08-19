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
  const countLines = (s: string) => {
    for (const ch of s) if (ch === '\n') line++
  }

  while (i < src.length) {
    const openExpr = src.indexOf('{{', i)
    const openTag = src.indexOf('{%', i)
    const openNote = src.indexOf('{#', i)
    const next = [openExpr, openTag, openNote].filter((n) => n !== -1).sort((a, b) => a - b)[0] ?? -1

    if (next === -1) {
      const value = src.slice(i)
      if (value) out.push({ type: 'text', value, line })
      break
    }
    if (next > i) {
      const value = src.slice(i, next)
      out.push({ type: 'text', value, line })
      countLines(value)
    }

    // A comment is lexed and dropped rather than left to the text branch, so it
    // never reaches the output. Templates are files now; a language a theme author
    // cannot annotate is a language they will annotate wrongly, in the markup.
    const open = src.slice(next, next + 2)
    const closer = open === '{{' ? '}}' : open === '{%' ? '%}' : '#}'
    const close = src.indexOf(closer, next + 2)
    if (close === -1) throw new KtlSyntaxError(`unterminated ${open} at line ${line}`, line)
    const raw = src.slice(next + 2, close).trim()
    if (open !== '{#') out.push({ type: open === '{{' ? 'expr' : 'tag', value: raw, line })
    countLines(src.slice(next, close))
    i = close + closer.length
  }
  return out
}

export class KtlSyntaxError extends Error {
  code = 'E_KTL_SYNTAX'
  line: number
  constructor(message: string, line: number) {
    super(message)
    this.line = line
  }
}
