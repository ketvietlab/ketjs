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
  /**
   * The revision a site's navigation was last saved at, keyed by the site id.
   *
   * Menu items are separate rows, so no single row can carry a revision for the
   * whole tree. The Studio replaces the tree at once and needs one value to
   * compare against, or two editors saving the same menu silently overwrite
   * each other. A row also marks the navigation as edited through the Studio,
   * whose saves reach visitors immediately.
   */
  Menu: {
    scope: 'company',
    fields: {
      id: 'id',
      siteId: 'ref:website.Site',
      title: 'text?',
      revision: 'text',
    },
    indexes: { site: { fields: ['siteId'], unique: true } },
  },
}
