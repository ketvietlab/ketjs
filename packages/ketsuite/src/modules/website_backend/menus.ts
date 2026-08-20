import type { MenuDef } from 'ketjs'

export const menus: Record<string, MenuDef> = {
  'admin.website': { parent: 'admin', label: 'menu.website', sequence: 25 },
  'admin.website.content': {
    parent: 'admin.website',
    label: 'menu.content',
    path: '/admin/content',
    needs: 'website.listEntries',
    sequence: 10,
  },
  'admin.website.taxonomies': {
    parent: 'admin.website',
    label: 'menu.taxonomies',
    path: '/admin/taxonomies',
    needs: 'website.listTaxonomyTerms',
    sequence: 20,
  },
  'admin.website.media': {
    parent: 'admin.website',
    label: 'menu.media',
    path: '/admin/media',
    needs: 'website.listMedia',
    sequence: 30,
  },
  'admin.website.menus': {
    parent: 'admin.website',
    label: 'menu.menus',
    path: '/admin/menus',
    needs: 'website_menu.listMenu',
    sequence: 40,
  },
  'admin.website.forms': {
    parent: 'admin.website',
    label: 'menu.forms',
    path: '/admin/forms',
    needs: 'website_form.listForms',
    sequence: 50,
  },
  'admin.website.sites': {
    parent: 'admin.website',
    label: 'menu.sites',
    path: '/admin/sites',
    needs: 'website.listSites',
    sequence: 90,
  },
}
