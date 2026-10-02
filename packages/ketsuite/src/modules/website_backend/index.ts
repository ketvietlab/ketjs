import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { menus } from './menus.ts'
import { studioRoutes as routes } from './studio/routes.ts'

export default defineModule({
  name: 'website_backend',
  version: '0.1.0',
  depends: ['backend', 'website', 'website_form', 'website_menu', 'website_seo', 'website_search', 'livedoc'],
  title: 'Website trong quản trị',
  summary: 'Quản trị đa website, nội dung, revision, taxonomy, media, menu và biểu mẫu.',
  category: 'Hệ thống',
  assets: new URL('./client/', import.meta.url),
  routes,
  functions,
  menus,
  messages: {
    vi: {
      'app.title': 'Website trong quản trị',
      'app.summary': 'Quản trị đa website, nội dung, revision, taxonomy, media, menu và biểu mẫu.',
      'app.category': 'Hệ thống',
      'menu.app': 'Website',
    },
    en: {
      'app.title': 'Website administration',
      'app.summary': 'Manage multiple sites, content, revisions, taxonomies, media, menus and forms.',
      'app.category': 'System',
      'menu.app': 'Website',
    },
  },
})
