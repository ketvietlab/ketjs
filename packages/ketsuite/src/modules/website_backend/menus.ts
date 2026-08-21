import type { MenuDef } from 'ketjs'

export const menus: Record<string, MenuDef> = {
  website: { label: 'menu.app', icon: 'globe', sequence: 18 },
  'website.content': {
    parent: 'website',
    label: 'menu.content',
    path: '/admin/content',
    needs: 'website.listEntries',
    sequence: 10,
  },
  'website.taxonomies': {
    parent: 'website',
    label: 'menu.taxonomies',
    path: '/admin/taxonomies',
    needs: 'website.listTaxonomyTerms',
    sequence: 20,
  },
  'website.media': {
    parent: 'website',
    label: 'menu.media',
    path: '/admin/media',
    needs: 'website.listMedia',
    sequence: 30,
  },
  'website.menus': {
    parent: 'website',
    label: 'menu.menus',
    path: '/admin/menus',
    needs: 'website_menu.listMenu',
    sequence: 40,
  },
  'website.forms': {
    parent: 'website',
    label: 'menu.forms',
    path: '/admin/forms',
    needs: 'website_form.listForms',
    sequence: 50,
  },
  'website.configuration': { parent: 'website', label: 'menu.configuration', sequence: 90 },
  'website.sites': {
    parent: 'website.configuration',
    label: 'menu.sites',
    path: '/admin/sites',
    needs: 'website.listSites',
    sequence: 10,
  },
}
