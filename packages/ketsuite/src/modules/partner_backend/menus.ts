import type { MenuDef } from '@ketvietlab/ketjs'

export const menus: Record<string, MenuDef> = {
  partner: { label: 'menu.app', icon: 'users', sequence: 12 },
  'partner.directory': {
    parent: 'partner',
    label: 'menu.directory',
    path: '/admin/partner/partners',
    needs: 'partner.listPartners',
    sequence: 10,
  },
}
