import type { MenuDef } from '@ketvietlab/ketjs'

export const menus: Record<string, MenuDef> = {
  website: { label: 'menu.app', icon: 'globe', sequence: 18 },
  'website.pages': {
    parent: 'website',
    label: 'menu.pages',
    path: '/admin/website/pages',
    needs: 'website.listEntries',
    sequence: 10,
  },
  'website.posts': {
    parent: 'website',
    label: 'menu.posts',
    path: '/admin/website/posts',
    needs: 'website.listEntries',
    sequence: 15,
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
