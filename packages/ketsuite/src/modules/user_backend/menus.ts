import type { MenuDef } from '@ketvietlab/ketjs'

export const menus: Record<string, MenuDef> = {
  'admin.users': {
    parent: 'admin.config',
    label: 'menu.users',
    path: '/admin/users',
    needs: 'user.listUsers',
    requires: ['user.listRoles', 'company.listCompanies'],
    sequence: 25,
  },
  'admin.access-policies': {
    parent: 'admin.config',
    label: 'menu.policies',
    path: '/admin/access-policies',
    needs: 'user.listAccessPolicies',
    requires: ['user.listRoles', 'company.listCompanies'],
    sequence: 27,
  },
}
