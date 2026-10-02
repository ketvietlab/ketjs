/**
 * The consumer half of Két Design System visual contract: a check an application runs over its own CSS.
 *
 * The design system decides what a container looks like where it sits (a frame on
 * the canvas, flat inside a white region). An application that restyles those
 * containers answers the same question a second time, screen by screen, and the
 * answers drift. So an enforced stylesheet may not:
 *
 * - `owned-hook` (L8): set frame, spacing or heading type on an element the design
 *   system renders, that is, a selector whose subject carries `data-ui` or
 *   `data-pattern`;
 * - `hand-made-frame` (L2): draw its own card, a rule with a visible border on all
 *   sides together with a radius or a fill;
 * - `revert-layer` (L8): undo the design system's layer to style it again.
 *
 * Dividers (`border-block-start` and similar single sides) stay available to app
 * content, because L3 allows a hairline between peer sections.
 *
 * The parser is deliberately small: comments, strings, at-rule blocks and CSS
 * nesting are handled; anything it cannot read is skipped, never reported.
 */

export type LayoutRule = 'owned-hook' | 'hand-made-frame' | 'revert-layer'

export type LayoutViolation = {
  rule: LayoutRule
  line: number
  selector: string
  property: string
  message: string
}

/** Properties that decide how a container is framed, spaced or titled. */
const OWNED_PROPERTY =
  /^(?:border(?:-.+)?|outline(?:-.+)?|background(?:-.+)?|box-shadow|padding(?:-.+)?|margin(?:-.+)?|gap|row-gap|column-gap|font-size|font-weight|line-height|inset(?:-.+)?)$/u

/** At-rules whose block holds ordinary rules. Every other at-rule block is skipped. */
const CONDITIONAL_AT_RULE = /^@(?:media|supports|layer|container|scope|document)\b/u

type Declaration = { property: string; value: string; line: number }

const blank = (text: string): string => text.replace(/[^\n]/gu, ' ')

/** Replaces comments and string contents with spaces, keeping every offset and line. */
const mask = (source: string): string =>
  source
    .replace(/\/\*[\s\S]*?\*\//gu, blank)
    .replace(
      /"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/gu,
      (text) => `${text[0]}${blank(text.slice(1, -1))}${text[0]}`,
    )

/** Splits at `separator` where it is not inside brackets or parentheses. */
const splitTopLevel = (text: string, separator: string): { part: string; offset: number }[] => {
  const parts: { part: string; offset: number }[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (char === separator && depth === 0) {
      parts.push({ part: text.slice(start, index), offset: start })
      start = index + 1
    }
  }
  parts.push({ part: text.slice(start), offset: start })
  return parts
}

/** Removes the arguments of `:not(...)` and `:has(...)`, which name other elements. */
const stripRelational = (compound: string): string => {
  let result = compound
  for (;;) {
    const match = /:(?:not|has)\(/u.exec(result)
    if (!match) return result
    let depth = 1
    let end = match.index + match[0].length
    while (end < result.length && depth > 0) {
      if (result[end] === '(') depth++
      else if (result[end] === ')') depth--
      end++
    }
    result = result.slice(0, match.index) + result.slice(end)
  }
}

/**
 * The compound a rule styles. A universal subject (`*`, `:not(...)`, `:first-child`)
 * styles the children of the compound before it, so it belongs to whoever owns
 * that one: `[data-ui="surface"] > :not(.x)` restyles the surface's own parts,
 * while `.my-list > * + *` spaces the app's own list.
 */
const subjectOf = (selector: string): string => {
  const compounds: string[] = []
  let depth = 0
  let start = 0
  for (let index = 0; index <= selector.length; index++) {
    const char = selector[index] ?? ' '
    if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (depth === 0 && /[\s>+~]/u.test(char)) {
      if (index > start) compounds.push(selector.slice(start, index))
      start = index + 1
    }
  }
  for (let index = compounds.length - 1; index >= 0; index--) {
    const compound = stripRelational(compounds[index])
    const identity = compound
      .replace(/::?(?!is\(|where\()[\w-]+(?:\([^)]*\))?/gu, '')
      .replace(/\*/gu, '')
      .trim()
    if (identity) return compound
  }
  return ''
}

const ownsHook = (selector: string): boolean => /\[\s*data-(?:ui|pattern)\b/u.test(subjectOf(selector))

const lineAt = (source: string, offset: number): number => source.slice(0, offset).split('\n').length

const visibleBorder = (value: string): boolean =>
  !/^(?:0(?:px)?|none|hidden|initial|unset|revert|revert-layer)(?:\s|$)/u.test(value.trim())

const check = (selectors: string[], declarations: Declaration[], violations: LayoutViolation[]): void => {
  const selector = selectors.join(', ')
  for (const declaration of declarations) {
    if (/\brevert-layer\b/u.test(declaration.value))
      violations.push({
        rule: 'revert-layer',
        line: declaration.line,
        selector,
        property: declaration.property,
        message: 'revert-layer undoes the design system to restyle it; change the component instead',
      })
  }
  const owned = selectors.filter(ownsHook)
  if (owned.length > 0)
    for (const declaration of declarations)
      if (OWNED_PROPERTY.test(declaration.property))
        violations.push({
          rule: 'owned-hook',
          line: declaration.line,
          selector: owned.join(', '),
          property: declaration.property,
          message: `${declaration.property} on a design-system element; the component owns its frame, spacing and headings`,
        })
  const border = declarations.find(
    (declaration) => declaration.property === 'border' && visibleBorder(declaration.value),
  )
  const shaped = declarations.some((declaration) =>
    /^(?:border-radius|background|background-color)$/u.test(declaration.property),
  )
  if (border && shaped && owned.length === 0)
    violations.push({
      rule: 'hand-made-frame',
      line: border.line,
      selector,
      property: border.property,
      message: 'a bordered, rounded or filled box is a hand-made card; use Surface, Section or a divider',
    })
}

const walk = (
  source: string,
  masked: string,
  from: number,
  to: number,
  parents: string[] | null,
  violations: LayoutViolation[],
): void => {
  let cursor = from
  let statementStart = from
  const declarations: Declaration[] = []
  const flush = (text: string, offset: number) => {
    const colon = text.indexOf(':')
    if (colon < 0) return
    const property = text.slice(0, colon).trim().toLowerCase()
    if (!/^-?[a-z][a-z-]*$/u.test(property)) return
    const valueStart = offset + colon + 1
    const value = source.slice(valueStart, offset + text.length).trim()
    declarations.push({ property, value, line: lineAt(source, offset + text.search(/\S/u)) })
  }
  while (cursor < to) {
    const char = masked[cursor]
    if (char === ';') {
      if (parents) flush(masked.slice(statementStart, cursor), statementStart)
      statementStart = cursor + 1
    } else if (char === '{') {
      let depth = 1
      let end = cursor + 1
      while (end < to && depth > 0) {
        if (masked[end] === '{') depth++
        else if (masked[end] === '}') depth--
        end++
      }
      const prelude = masked.slice(statementStart, cursor).trim()
      const bodyStart = cursor + 1
      const bodyEnd = end - 1
      if (prelude.startsWith('@')) {
        if (CONDITIONAL_AT_RULE.test(prelude)) walk(source, masked, bodyStart, bodyEnd, parents, violations)
      } else if (prelude) {
        const own = splitTopLevel(
          source.slice(statementStart, cursor).replace(/\/\*[\s\S]*?\*\//gu, ' '),
          ',',
        )
          .map(({ part }) => part.replace(/\s+/gu, ' ').trim())
          .filter(Boolean)
        const selectors = parents
          ? parents.flatMap((parent) =>
              own.map((child) =>
                child.includes('&') ? child.replaceAll('&', parent) : `${parent} ${child}`,
              ),
            )
          : own
        walk(source, masked, bodyStart, bodyEnd, selectors, violations)
      }
      cursor = end
      statementStart = end
      continue
    }
    cursor++
  }
  if (parents) {
    flush(masked.slice(statementStart, to), statementStart)
    check(parents, declarations, violations)
  }
}

/** Every layout-rule violation in one stylesheet, in source order. */
export const auditLayoutCss = (source: string): LayoutViolation[] => {
  const violations: LayoutViolation[] = []
  walk(source, mask(source), 0, source.length, null, violations)
  return violations.sort((left, right) => left.line - right.line)
}
