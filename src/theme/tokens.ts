// Theme tokens become CSS custom properties inside an explicit cascade layer, so
// override order is a declared contract rather than a specificity accident:
//   ket.reset < ket.theme < ket.app < ket.user
// Native CSS only — no preprocessor, no CSS-in-JS, nothing to install.

export const LAYER_ORDER = ['ket.reset', 'ket.theme', 'ket.app', 'ket.user'] as const

export function tokensToCss(tokens: Record<string, string>, layer: (typeof LAYER_ORDER)[number] = 'ket.theme'): string {
  const decls = Object.entries(tokens)
    .map(([k, v]) => `  --ket-${k.replace(/[^a-zA-Z0-9-]/g, '-')}: ${v};`)
    .join('\n')
  return `@layer ${LAYER_ORDER.join(', ')};\n\n@layer ${layer} {\n  :root {\n${decls}\n  }\n}\n`
}

export function scopedCss(section: string, css: string): string {
  return `@layer ket.theme {\n  @scope ([data-ket-section="${section}"]) {\n${css}\n  }\n}\n`
}
