import { defineModule } from 'ketjs'
import { functions } from './functions.ts'
import { models } from './models.ts'
import { sections } from './sections.ts'

export default defineModule({
  name: 'website_form',
  version: '0.1.0',
  app: true,
  install: 'auto',
  depends: ['website'],
  title: 'Biểu mẫu website',
  summary: 'Biểu mẫu có cấu trúc, chống spam và lưu submission theo từng website.',
  category: 'Website',
  messages: {
    vi: {
      'app.title': 'Biểu mẫu website',
      'app.summary': 'Biểu mẫu có cấu trúc, chống spam và lưu submission theo từng website.',
      'app.category': 'Website',
      'section.form': 'Biểu mẫu',
    },
    en: {
      'app.title': 'Website forms',
      'app.summary': 'Structured forms with spam protection and per-site submissions.',
      'app.category': 'Website',
      'section.form': 'Form',
    },
  },
  models,
  functions,
  sections,
})
