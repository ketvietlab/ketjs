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
  requires: ['layout', 'website.page'],
  models, joints, sections, views, functions, tokens,
})

export type { SectionPlacement } from './types.ts'
