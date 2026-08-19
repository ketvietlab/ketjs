import type { ModelDef } from 'ketjs'

export const models: Record<string, ModelDef> = {
  MenuItem: {
    scope: 'company',
    fields: {
      id: 'id',
      label: 'text',
      href: 'text',
      position: 'int',
      parentId: 'ref:website_menu.MenuItem?',
    },
  },
}
