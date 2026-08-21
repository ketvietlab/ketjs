import type { MenuDef } from '@ketvietlab/ketjs'

export const menus: Record<string, MenuDef> = {
  'admin.users': {
    parent: 'admin.config',
    label: 'menu.users',
    path: '/admin/users',
    needs: 'user.listUsers',
    sequence: 25,
  },
  'admin.roles': {
    parent: 'admin.config',
    label: 'menu.roles',
    path: '/admin/roles',
    needs: 'user.listRoles',
    sequence: 26,
  },
  'admin.permission-presets': {
    parent: 'admin.config',
    label: 'menu.presets',
    path: '/admin/permission-presets',
    needs: 'user.applyPreset',
    sequence: 27,
  },
}
