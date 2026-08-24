import { defineTheme, loadTemplates } from '@ketvietlab/ketjs'
import { tokens } from './tokens.ts'

export default defineTheme({
  name: 'theme_retail',
  group: 'commerce',
  version: '0.1.0',
  depends: ['website', 'website_menu', 'website_form', 'website_retail'],
  title: 'Theme Retail',
  summary: 'Theme KTL đậm, rõ và tập trung chuyển đổi cho bán lẻ.',
  messages: {
    vi: {
      'app.title': 'Theme Retail',
      'app.summary': 'Theme KTL đậm, rõ và tập trung chuyển đổi cho bán lẻ.',
      'app.category': 'Giao diện',
    },
    en: {
      'app.title': 'Retail theme',
      'app.summary': 'A bold, conversion-focused KTL theme for retail.',
      'app.category': 'Appearance',
    },
  },
  assets: new URL('./assets/', import.meta.url),
  styles: ['theme.css'],
  templates: loadTemplates(new URL('./templates/', import.meta.url)),
  tokens,
})
