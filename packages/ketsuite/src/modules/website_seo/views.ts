import type { ViewDef } from 'ketjs'

export const views: Record<string, ViewDef> = {
  meta: { of: 'website.Page', fields: ['title', 'metaDescription', 'canonical', 'noindex', 'ogImage'] },
}
