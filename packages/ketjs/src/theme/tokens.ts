// Theme tokens become CSS custom properties inside an explicit cascade layer, so
// override order is a declared contract rather than a specificity accident:
//   ket.reset < ket.theme < ket.app < ket.user
// Native CSS only — no preprocessor, no CSS-in-JS, nothing to install.

export const LAYER_ORDER = ['ket.reset', 'ket.theme', 'ket.app', 'ket.user'] as const

/**
 * The statement that fixes the order, for the document to emit before the first
 * stylesheet loads. `@layer a, b, c;` establishes precedence on its own; where the
 * layers are then written no longer matters.
 */
export const LAYER_ORDER_CSS = `@layer ${LAYER_ORDER.join(', ')};`

/**
 * A custom-property value that cannot leave the declaration it is in.
 *
 * Theme tokens are written by whoever wrote the theme, so this never mattered
 * for them. Site tokens are typed into a form, and `}` alone would end the
 * rule and hand the rest of the page to the person typing.
 */
const CSS_VALUE = /^[\w\s#.,%()/+*-]{0,200}$/

export const isTokenValue = (value: unknown): value is string =>
  typeof value === 'string' && CSS_VALUE.test(value)

/**
 * The tokens of a record that are safe to render, and nothing else.
 *
 * Silently dropping a bad value would be worse than refusing it, so the caller
 * gets both halves and decides: the writer refuses, the reader renders what is
 * left rather than serving a broken stylesheet over an old bad value.
 */
export const partitionTokens = (
  tokens: Record<string, unknown>,
): { safe: Record<string, string>; rejected: string[] } => {
  const safe: Record<string, string> = {}
  const rejected: string[] = []
  for (const [key, value] of Object.entries(tokens)) {
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(key) || !isTokenValue(value)) rejected.push(key)
    else safe[key] = value
  }
  return { safe, rejected }
}

export function tokensToCss(
  tokens: Record<string, string>,
  layer: (typeof LAYER_ORDER)[number] = 'ket.theme',
): string {
  const decls = Object.entries(tokens)
    .map(([k, v]) => `  --ket-${k.replace(/[^a-zA-Z0-9-]/g, '-')}: ${v};`)
    .join('\n')
  return `@layer ${LAYER_ORDER.join(', ')};\n\n@layer ${layer} {\n  :root {\n${decls}\n  }\n}\n`
}

export function scopedCss(section: string, css: string): string {
  return `@layer ket.theme {\n  @scope ([data-ket-section="${section}"]) {\n${css}\n  }\n}\n`
}
