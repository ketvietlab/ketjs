import { defineModule } from 'ketjs'
import { models } from './models.ts'
import { sections } from './sections.ts'
import { views } from './views.ts'
import { functions } from './functions.ts'

export default defineModule({
  name: 'website_menu',
  version: '0.1.0',
  app: true,
  title: 'Menu điều hướng',
  summary: 'Thanh menu cho website.',
  category: 'Website',
  depends: ['website'],
  models, sections, views, functions,
})
