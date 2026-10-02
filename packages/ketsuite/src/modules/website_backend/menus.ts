import type { MenuDef } from '@ketvietlab/ketjs'
export const menus: Record<string, MenuDef> = {
  website: {
    label: 'menu.app',
    icon: 'globe',
    path: '/website',
    needs: 'website_backend.studioContext',
    requires: ['website.getEntry'],
    for: ['website.saveEntry', 'website.publishEntry'],
    sequence: 30,
  },
}
