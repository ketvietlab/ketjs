import type { ViewDef } from 'ketjs'

export const views: Record<string, ViewDef> = {
  item: { of: 'website_menu.MenuItem', fields: ['id', 'label', 'href', 'position'] },
}
