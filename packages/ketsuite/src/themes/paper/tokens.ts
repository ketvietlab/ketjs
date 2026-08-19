// Design tokens become CSS custom properties in the ket.theme cascade layer, so an
// app or a user can override them without a specificity fight.
export const tokens: Record<string, string> = {
  'color-ink': 'oklch(0.24 0.02 60)',
  'color-bg': 'oklch(0.99 0.005 90)',
  'color-accent': 'oklch(0.55 0.18 268)',
  'font-sans': '"Inter", system-ui, sans-serif',
  'radius': '0.75rem',
  'page-max-width': '68rem',
}
