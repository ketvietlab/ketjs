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
import { contentTypes, taxonomies } from './content-types.ts'
import { cmsFunctions } from './cms.ts'
import { jobs } from './jobs.ts'

export default defineModule({
  name: 'website',
  version: '0.1.0',
  app: true,
  title: 'Website',
  summary: 'Trang, section và điều hướng — nội dung soạn bằng dữ liệu, không phải code.',
  category: 'Website',
  messages: {
    vi: {
      'app.title': 'Website',
      'app.summary': 'Trang, section và điều hướng — nội dung soạn bằng dữ liệu, không phải code.',
      'app.category': 'Website',
      'page.notFound': 'Không tìm thấy trang',
      'content.page': 'Trang',
      'content.pages': 'Các trang',
      'content.post': 'Bài viết',
      'content.posts': 'Bài viết',
      'taxonomy.category': 'Chuyên mục',
      'taxonomy.categories': 'Chuyên mục',
      'taxonomy.tag': 'Thẻ',
      'taxonomy.tags': 'Thẻ',
    },
    en: {
      'app.title': 'Website',
      'app.summary': 'Pages, sections and navigation — composed as data, not code.',
      'app.category': 'Website',
      'page.notFound': 'Page not found',
      'content.page': 'Page',
      'content.pages': 'Pages',
      'content.post': 'Post',
      'content.posts': 'Posts',
      'taxonomy.category': 'Category',
      'taxonomy.categories': 'Categories',
      'taxonomy.tag': 'Tag',
      'taxonomy.tags': 'Tags',
    },
  },
  requires: ['layout', 'website.page'],
  models,
  contentTypes,
  taxonomies,
  joints,
  sections,
  views,
  functions: { ...functions, ...cmsFunctions },
  jobs,
  tokens,
})

export type { SectionPlacement } from './types.ts'
