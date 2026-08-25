// Markdown in, blocks out.
//
// The editor's vocabulary and Markdown's overlap almost exactly, which is the
// whole reason this is worth having: people already write `## ` and `**bold**`
// out of habit, and they paste from README files, chat and issue trackers that
// speak it. What arrives on the clipboard is the source, and the source is
// what somebody meant.
//
// A deliberately small subset — the blocks the editor has and the marks it can
// carry, and nothing else. There is no table, no image, no footnote, no
// reference link, because there is nowhere to put them: a parser that produced
// a node the renderer cannot draw would lose it silently, which is worse than
// leaving the characters alone. Anything unrecognised stays literal text.
//
// Pure and DOM-free on purpose, so it can be tested without a browser — which
// is most of why the paste path is worth trusting.
import type { Attributes, BlockType, Delta } from './blocks.ts'

export type MarkdownBlock = { type: BlockType; checked: boolean; delta: Delta }

/**
 * Emphasis, innermost text first.
 *
 * No inner text may contain its own delimiter, and it may not begin or end
 * with a space: the second half stops `2 * 3 * 4` turning half a sum italic,
 * and the first stops the italic rule opening on the first `*` of a bold pair
 * and eating the second as content. Inline code does not recurse — what is
 * inside it is characters.
 *
 * `word` marks the two rules that may not open or close inside a word, which
 * is CommonMark's own asymmetry between `_` and `*` and exists for exactly one
 * reason: `snake_case_name` is a name, not a sentence with a slant in it.
 */
const EMPHASIS: Array<{ pattern: RegExp; mark: Attributes; word?: false }> = [
  { pattern: /^\*\*([^*\s](?:[^*]*[^*\s])?)\*\*/, mark: { bold: true } },
  { pattern: /^__([^_\s](?:[^_]*[^_\s])?)__/, mark: { bold: true }, word: false },
  { pattern: /^~~([^~\s](?:[^~]*[^~\s])?)~~/, mark: { strike: true } },
  { pattern: /^\*([^*\s](?:[^*]*[^*\s])?)\*/, mark: { italic: true } },
  { pattern: /^_([^_\s](?:[^_]*[^_\s])?)_/, mark: { italic: true }, word: false },
]

const WORD = /[\p{L}\p{N}_]/u

const CODE_SPAN = /^`([^`]+)`/
const LINK = /^\[([^\]]+)\]\(([^)\s]+)\)/
const ESCAPED = /^\\([\\`*_~[\]()])/

const merge = (delta: Delta, mark: Attributes): Delta =>
  delta.map((op) => ({ ...op, attributes: { ...mark, ...(op.attributes ?? {}) } }))

/** Runs of the same marks are one op, so a paste and a keystroke produce the same shape. */
const compact = (delta: Delta): Delta => {
  const out: Delta = []
  for (const op of delta) {
    const last = out[out.length - 1]
    const same = last && JSON.stringify(last.attributes ?? null) === JSON.stringify(op.attributes ?? null)
    if (same && last) last.insert += op.insert
    else out.push({ ...op })
  }
  return out.filter((op) => op.insert.length > 0)
}

/** One line of Markdown as marked-up text. */
export function inlineDelta(source: string): Delta {
  const out: Delta = []
  let rest = source
  let plain = ''
  let previous = ''
  const flush = () => {
    if (plain) out.push({ insert: plain })
    plain = ''
  }
  const take = (count: number) => {
    previous = rest[count - 1] as string
    rest = rest.slice(count)
  }
  while (rest) {
    const escaped = ESCAPED.exec(rest)
    if (escaped) {
      plain += escaped[1]
      take(escaped[0].length)
      continue
    }
    const link = LINK.exec(rest)
    if (link) {
      flush()
      out.push(...merge(inlineDelta(link[1] as string), { link: link[2] as string }))
      take(link[0].length)
      continue
    }
    const code = CODE_SPAN.exec(rest)
    if (code) {
      flush()
      out.push({ insert: code[1] as string, attributes: { code: true } })
      take(code[0].length)
      continue
    }
    const emphasis = EMPHASIS.map((rule) => ({ rule, match: rule.pattern.exec(rest) })).find(
      (found) =>
        found.match &&
        // A word-boundary rule has to be at one on both sides: opening after a
        // letter, or closing before one, is somebody's identifier.
        (found.rule.word !== false ||
          (!WORD.test(previous) && !WORD.test(rest[found.match[0].length] ?? ''))),
    )
    if (emphasis?.match) {
      flush()
      out.push(...merge(inlineDelta(emphasis.match[1] as string), emphasis.rule.mark))
      take(emphasis.match[0].length)
      continue
    }
    plain += rest[0]
    take(1)
  }
  flush()
  return compact(out)
}

const FENCE = /^\s{0,3}```/
const HEADING = /^(#{1,3}) +(.*)$/
const QUOTE = /^ {0,3}> ?(.*)$/
const CHECK = /^ {0,3}[-*+] +\[([ xX])\] +(.*)$/
const BULLET = /^ {0,3}[-*+] +(.*)$/
const ORDERED = /^ {0,3}\d+[.)] +(.*)$/

const block = (type: BlockType, delta: Delta, checked = false): MarkdownBlock => ({
  type,
  checked,
  delta,
})

/**
 * A Markdown document as the editor's blocks.
 *
 * Consecutive plain lines join into one paragraph and a blank line ends it,
 * which is Markdown's own rule and the reason pasting a soft-wrapped README
 * does not arrive as forty one-line paragraphs. Anything with its own marker —
 * a heading, a list item, a quote — is its own block regardless.
 */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const lines = String(source ?? '').split(/\r\n|\r|\n/)
  const blocks: MarkdownBlock[] = []
  let paragraph: string[] = []
  const closeParagraph = () => {
    if (paragraph.length) blocks.push(block('p', inlineDelta(paragraph.join(' '))))
    paragraph = []
  }

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] as string

    if (FENCE.test(line)) {
      closeParagraph()
      const body: string[] = []
      index++
      while (index < lines.length && !FENCE.test(lines[index] as string)) {
        body.push(lines[index] as string)
        index++
      }
      // An unclosed fence still becomes a code block: the alternative is
      // deciding, on somebody's behalf, that they meant none of it.
      blocks.push(block('code', body.length ? [{ insert: body.join('\n') }] : []))
      continue
    }

    if (!line.trim()) {
      closeParagraph()
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      closeParagraph()
      const level = (heading[1] as string).length
      blocks.push(block(`h${level}` as BlockType, inlineDelta(heading[2] as string)))
      continue
    }

    const check = CHECK.exec(line)
    if (check) {
      closeParagraph()
      blocks.push(block('check', inlineDelta(check[2] as string), (check[1] as string).toLowerCase() === 'x'))
      continue
    }

    const bullet = BULLET.exec(line)
    if (bullet) {
      closeParagraph()
      blocks.push(block('bullet', inlineDelta(bullet[1] as string)))
      continue
    }

    const ordered = ORDERED.exec(line)
    if (ordered) {
      closeParagraph()
      blocks.push(block('ordered', inlineDelta(ordered[1] as string)))
      continue
    }

    const quote = QUOTE.exec(line)
    if (quote) {
      closeParagraph()
      blocks.push(block('quote', inlineDelta(quote[1] as string)))
      continue
    }

    paragraph.push(line)
  }
  closeParagraph()
  return blocks
}
