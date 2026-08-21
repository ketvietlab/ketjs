import type { ModelDef } from '@ketvietlab/ketjs'

export const models: Record<string, ModelDef> = {
  MenuItem: {
    scope: 'company',
    fields: {
      id: 'id',
      siteId: 'ref:website.Site?',
      label: 'text',
      href: 'text',
      position: 'int',
      parentId: 'ref:website_menu.MenuItem?',
    },
    indexes: { site_position: { fields: ['companyId', 'siteId', 'position'] } },
  },
}
