import { defineTheme, loadTemplates } from 'ketjs'
import { tokens } from './tokens.ts'

/**
 * A theme's whole vocabulary lives in templates/ as .ktl files: the layout, the
 * page region, and one file per section type it supports. The file name is the
 * template name. There is no JavaScript there and there cannot be — a template
 * that wants behaviour places an island instead.
 */
export default defineTheme({
  name: 'theme_paper',
  version: '0.1.0',
  depends: ['website'],
  title: 'Theme Paper',
  summary: 'Giao diện mặc định cho website: nhẹ, nhiều khoảng trắng.',
  messages: {
    vi: {
      'app.title': 'Theme Paper',
      'app.summary': 'Giao diện mặc định cho website: nhẹ, nhiều khoảng trắng.',
      'app.category': 'Giao diện',
    },
    en: {
      'app.title': 'Paper theme',
      'app.summary': 'The default website look: light, roomy.',
      'app.category': 'Appearance',
    },
  },
  templates: loadTemplates(new URL('./templates/', import.meta.url)),
  tokens,
})
