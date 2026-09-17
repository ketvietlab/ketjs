import type { MenuDef } from '@ketvietlab/ketjs'

export const menus: Record<string, MenuDef> = {
  'admin.users': {
    parent: 'admin.config',
    label: 'menu.users',
    path: '/admin/users',
    needs: 'user.listUsers',
    sequence: 25,
  },
  // `admin.roles` is off with its route: see the note in routes.ts.
}
