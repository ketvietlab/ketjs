import type { ViewDef } from '@ketvietlab/ketjs'

export const views: Record<string, ViewDef> = {
  meta: { of: 'website.Page', fields: ['title', 'metaDescription', 'canonical', 'noindex', 'ogImage'] },
  entryMeta: { of: 'website.Entry', fields: ['title', 'metaDescription', 'canonical', 'noindex', 'ogImage'] },
}
