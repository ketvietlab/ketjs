import { defineModule } from '@ketvietlab/ketjs'
import { functions } from './functions.ts'
import { menus } from './menus.ts'
import { createStudioRoutes } from './studio/routes.ts'
import { studioPresets } from '../website/studio-style.ts'
import type { StudioOptions } from './studio/transport.ts'

const spec = {
  name: 'website_backend',
  version: '0.1.0',
  depends: ['backend', 'website', 'website_form', 'website_menu', 'website_seo', 'website_search', 'livedoc'],
  title: 'Website trong quản trị',
  summary: 'Quản trị đa website, nội dung, revision, taxonomy, media, menu và biểu mẫu.',
  category: 'Hệ thống',
  assets: new URL('./client/', import.meta.url),
  routes: createStudioRoutes(),
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
} satisfies Parameters<typeof defineModule>[0]

export default defineModule(spec)

/**
 * The same module with what a deployment decides about its Studio, such as the look a new site
 * starts with. Compose it in place of the default export, never beside it.
 */
export const websiteBackendWith = (options: StudioOptions) => {
  if (options.defaultPreset && !studioPresets.includes(options.defaultPreset))
    throw new Error(`website_backend: unknown Studio preset ${JSON.stringify(options.defaultPreset)}`)
  return defineModule({ ...spec, routes: createStudioRoutes(options) })
}
