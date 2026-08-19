import { defineModule } from 'ketjs'
import { models } from './models.ts'
import { sections } from './sections.ts'
import { views } from './views.ts'
import { functions } from './functions.ts'

export default defineModule({
  name: 'website_menu',
  version: '0.1.0',
  depends: ['website'],
  models, sections, views, functions,
})
