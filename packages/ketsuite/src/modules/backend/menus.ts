// What the admin puts in the sidebar.
//
// Data, not rows in a table. the domain contract keeps menus in the database, which is why an
// upgrade can leave a menu pointing at an action that no longer exists, and why
// "who put this here" is answered by an XML id rather than by a file. Declared in
// the module, a menu arrives and leaves with the code that serves it.
//
// A heading carries no path. It is a place to hang things, and it disappears when
// nothing is left hanging on it.

import type { MenuDef } from '@ketvietlab/ketjs'

export const menus: Record<string, MenuDef> = {
  admin: { label: 'menu.admin', icon: 'settings', sequence: 90 },

  // A heading other modules hang their configuration screens on: companies,
  // users, roles, sign-in providers, address data, print templates.
  'admin.config': { parent: 'admin', label: 'menu.config', sequence: 90 },
}
