import type { ViewDef } from '@ketvietlab/ketjs'

/** The only shape of a page a theme is ever handed. */
export const views: Record<string, ViewDef> = {
  page: { of: 'website.Page', fields: ['id', 'path', 'title'] },
}
