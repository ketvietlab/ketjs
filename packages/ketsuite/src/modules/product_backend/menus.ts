// The catalogue's place in the sidebar.
//
// It lives in the bridge, with the route it points at: install the admin without
// the catalogue and neither the entry nor the page exists. `needs` names the
// function behind the screen, so an account that may not list templates is not
// offered a screen that lists them.

import type { MenuDef } from '@ketvietlab/ketjs'

export const menus: Record<string, MenuDef> = {
  product: { label: 'menu.app', icon: 'package', sequence: 20 },
  'product.templates': {
    parent: 'product',
    label: 'menu.templates',
    path: '/admin/product/templates',
    needs: 'product.listTemplates',
    sequence: 1010,
  },
  'product.attributes': {
    parent: 'product',
    label: 'menu.attributes',
    path: '/admin/product/attributes',
    needs: 'product.listAttributes',
    sequence: 1020,
  },
}
