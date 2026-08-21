import type { MenuDef } from '@ketvietlab/ketjs'

export const menus: Record<string, MenuDef> = {
  'admin.oauth-providers': {
    parent: 'admin.config',
    label: 'menu.providers',
    path: '/admin/oauth/providers',
    needs: 'oauth.manageOptions',
    sequence: 28,
  },
  'admin.oauth-identities': {
    parent: 'admin.config',
    label: 'menu.identities',
    path: '/admin/oauth/identities',
    needs: 'oauth.manageOptions',
    sequence: 29,
  },
}
