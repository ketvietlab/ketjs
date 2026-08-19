// Assembly only. Each concern lives in its own file so a reader looking for the
// models, the extension points or the server functions knows where to go without
// scrolling past the other two.

import { defineModule } from 'ketjs'
import { models } from './models.ts'
import { joints } from './joints.ts'
import { sections } from './sections.ts'
import { views } from './views.ts'
import { functions } from './functions.ts'
import { tokens } from './tokens.ts'

export default defineModule({
  name: 'website',
  version: '0.1.0',
  app: true,
  title: 'Website',
  summary: 'Trang, section và điều hướng — nội dung soạn bằng dữ liệu, không phải code.',
  category: 'Website',
  messages: {
    vi: { 'app.title': "Website", 'app.summary': "Trang, section và điều hướng — nội dung soạn bằng dữ liệu, không phải code.", 'app.category': "Website" },
    en: { 'app.title': "Website", 'app.summary': "Pages, sections and navigation — composed as data, not code.", 'app.category': "Website" },
  },
  requires: ['layout', 'website.page'],
  models, joints, sections, views, functions, tokens,
})

export type { SectionPlacement } from './types.ts'
