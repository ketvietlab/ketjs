import { defineTheme, loadTemplates } from 'ketjs'

// A theme may only declare templates, fills, tokens and regions. Try adding
// `models` or `functions` here and defineTheme() refuses it.
//
// The templates are .ktl files in templates/ — the file name is the template name.
export default defineTheme({
  name: 'theme_default',
  version: '1.0.0',
  depends: ['catalog'],

  templates: loadTemplates(new URL('./templates/', import.meta.url)),

  tokens: {
    'color-accent': 'oklch(0.58 0.19 268)',
    radius: '0.75rem',
  },
})
