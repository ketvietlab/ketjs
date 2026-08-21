// What the admin puts in the sidebar.
//
// Data, not rows in a table. Odoo keeps menus in the database, which is why an
// upgrade can leave a menu pointing at an action that no longer exists, and why
// "who put this here" is answered by an XML id rather than by a file. Declared in
// the module, a menu arrives and leaves with the code that serves it.
//
// A heading carries no path. It is a place to hang things, and it disappears when
// nothing is left hanging on it.

import type { MenuDef } from '@ketvietlab/ketjs'

export const menus: Record<string, MenuDef> = {
  admin: { label: 'menu.admin', icon: 'settings', sequence: 90 },

  // The apps screen is the way back in, so it needs no heading above it.
  'admin.apps': { parent: 'admin', label: 'menu.apps', path: '/admin', sequence: 10 },

  'admin.content': { parent: 'admin', label: 'menu.content', sequence: 20 },
  'admin.pages': {
    parent: 'admin.content',
    label: 'menu.pages',
    path: '/admin/pages',
    needs: 'website.listPages',
    sequence: 10,
  },

  'admin.config': { parent: 'admin', label: 'menu.config', sequence: 90 },
  'admin.settings': { parent: 'admin.config', label: 'menu.settings', path: '/admin/settings', sequence: 10 },
}
