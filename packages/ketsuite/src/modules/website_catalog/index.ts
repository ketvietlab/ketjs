import { defineModule } from '@ketvietlab/ketjs'
import { publicRoutes } from './public.ts'
import { models } from './models.ts'
import { functions } from './functions.ts'
import { mediaFunctions, mediaJobs, mediaRoutes } from './media.ts'
import { catalogSections } from './cards.ts'
export default defineModule({
  name: 'website_catalog',
  version: '0.1.0',
  depends: [
    'website',
    'product',
    'product_media',
    'storage',
    'website_menu',
    'website_search',
    'website_seo',
  ],
  title: 'Sản phẩm trên website',
  summary: 'Sản phẩm ERP, template và nội dung riêng theo website.',
  category: 'Website',
  models,
  sections: catalogSections,
  extend: {
    'product_media.Media': { role: 'text?' },
    'website_menu.MenuItem': { catalogCategoryId: 'ref:website_catalog.Category?' },
  },
  functions: { ...functions, ...mediaFunctions },
  jobs: mediaJobs,
  routes: { ...mediaRoutes, ...publicRoutes },
})
