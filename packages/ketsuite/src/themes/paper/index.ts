import { defineTheme } from 'ketjs'
import { templates } from './templates.ts'
import { tokens } from './tokens.ts'

export default defineTheme({
  name: 'theme_paper',
  version: '0.1.0',
  depends: ['website'],
  title: 'Theme Paper',
  summary: 'Giao diện mặc định cho website: nhẹ, nhiều khoảng trắng.',
  messages: {
    vi: { 'app.title': 'Theme Paper', 'app.summary': 'Giao diện mặc định cho website: nhẹ, nhiều khoảng trắng.', 'app.category': 'Giao diện' },
    en: { 'app.title': 'Paper theme', 'app.summary': 'The default website look: light, roomy.', 'app.category': 'Appearance' },
  },
  templates, tokens,
})
