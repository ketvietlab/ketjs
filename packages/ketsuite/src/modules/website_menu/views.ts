import type { ViewDef } from '@ketvietlab/ketjs'

export const views: Record<string, ViewDef> = {
  item: { of: 'website_menu.MenuItem', fields: ['id', 'label', 'href', 'position'] },
}
