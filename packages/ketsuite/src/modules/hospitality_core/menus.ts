import type { MenuDef } from 'ketjs'

export const menus: Record<string, MenuDef> = {
  hospitality: { label: 'menu.app', icon: 'building-2', sequence: 10 },
  'hospitality.operations': { parent: 'hospitality', label: 'menu.operations', sequence: 10 },
  'hospitality.properties': {
    parent: 'hospitality.operations',
    label: 'menu.properties',
    path: '/admin/hospitality/properties',
    needs: 'hospitality_core.listProperties',
    sequence: 10,
  },
  'hospitality.rooms': {
    parent: 'hospitality.operations',
    label: 'menu.rooms',
    path: '/admin/hospitality/rooms',
    needs: 'hospitality_core.listRooms',
    sequence: 20,
  },
  'hospitality.configuration': { parent: 'hospitality', label: 'menu.configuration', sequence: 90 },
  'hospitality.roomTypes': {
    parent: 'hospitality.configuration',
    label: 'menu.roomTypes',
    path: '/admin/hospitality/room-types',
    needs: 'hospitality_core.listRoomTypes',
    sequence: 10,
  },
  'hospitality.amenities': {
    parent: 'hospitality.configuration',
    label: 'menu.amenities',
    path: '/admin/hospitality/amenities',
    needs: 'hospitality_core.listAmenities',
    sequence: 20,
  },
  'hospitality.policies': {
    parent: 'hospitality.configuration',
    label: 'menu.policies',
    path: '/admin/hospitality/policies',
    needs: 'hospitality_core.listCancellationPolicies',
    sequence: 30,
  },
}
