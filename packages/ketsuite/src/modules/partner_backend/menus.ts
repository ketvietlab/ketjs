import type { MenuDef } from 'ketjs'

export const menus: Record<string, MenuDef> = {
  partner: { label: 'menu.app', icon: 'users', sequence: 15 },
  'partner.directory': {
    parent: 'partner',
    label: 'menu.directory',
    path: '/admin/partners',
    needs: 'partner.listPartners',
    sequence: 10,
  },
}
