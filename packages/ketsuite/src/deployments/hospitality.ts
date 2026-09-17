import { defineDeployment, sqliteStore } from '@ketvietlab/ketjs'
import type { OpenStore } from '@ketvietlab/ketjs'
import * as suite from '../index.ts'
import backend from '../modules/backend/index.ts'
import { hospitalityRoleTemplates } from '../role-templates.ts'
import {
  productDefaults,
  productPermissions,
  productQueues,
  productServe,
  staffChannelModules,
} from './common.ts'

const modules = [
  suite.website,
  ...staffChannelModules,
  suite.uom,
  suite.product,
  suite.address,
  suite.partner,
  suite.company,
  suite.storage,
  suite.user,
  suite.oauth,
  suite.mail,
  suite.mailStaffChannel,
  backend,
  suite.userBackend,
  suite.oauthBackend,
  suite.account,
  suite.accountBackend,
  suite.hospitalityCore,
  suite.hospitalityBilling,
  suite.hospitalityStaffChannel,
]

/**
 * Where each shift starts, and the sidebar as a shift runs rather than as the
 * code is filed. Tried in order, first match wins, so the narrow sits above the
 * broad: a housekeeper reaches the cleaning worklist before the front-desk entry
 * can claim them, while a manager, who can do both, keeps the front desk.
 */
const navigation = {
  // Inspecting is the one job a menu cannot describe; whoever reads the audit keeps the whole sidebar.
  audit: ['user.listAuthorizationAudit'],
  // One product, one domain: a root chooser offers a hotel exactly one choice.
  rootList: 'never' as const,
  groups: [
    {
      id: 'operations',
      label: 'menu.operations',
      items: [
        'hospitality.frontDesk',
        'hospitality.tapeChart',
        'hospitality.reservations',
        'hospitality.stays',
        'hospitality.services',
      ],
    },
    { id: 'payments', label: 'menu.payments', items: ['hospitality.folios', 'hospitality.billing'] },
    {
      id: 'housekeeping',
      label: 'menu.housekeeping',
      items: ['hospitality.cleaningTasks', 'hospitality.housekeepingRooms'],
    },
    {
      id: 'controls',
      label: 'menu.controls',
      items: [
        'hospitality.nightAudit',
        'hospitality.stayNotices',
        'hospitality.inventory',
        'hospitality.ratePlans',
      ],
    },
    {
      id: 'setup',
      label: 'menu.setup',
      items: [
        'hospitality.properties',
        'hospitality.rooms',
        'hospitality.roomTypes',
        'hospitality.content',
        'hospitality.amenities',
        'hospitality.policies',
        'hospitality.billingRules',
      ],
    },
  ] as const,
  home: [
    { needs: 'hospitality_core.checkIn', path: '/admin/hospitality/front-desk' },
    { needs: 'hospitality_billing.recordFolioPayment', path: '/admin/hospitality/billing' },
    { needs: 'hospitality_core.requestNightAudit', path: '/admin/hospitality/night-audit' },
    { needs: 'hospitality_core.setRoomStatus', path: '/admin/hospitality/housekeeping/rooms' },
    { needs: 'hospitality_core.completeCleaningTask', path: '/admin/hospitality/housekeeping' },
    { needs: 'hospitality_core.confirmStayNotice', path: '/admin/hospitality/stay-notices' },
    { needs: 'hospitality_core.setInventoryRange', path: '/admin/hospitality/inventory' },
    { needs: 'hospitality_core.createReservation', path: '/admin/hospitality/reservations' },
  ],
}

/** Hospitality: reservations, stays, housekeeping, folios and night audit. */
export const createHospitalityDeployment = (openStore: OpenStore = sqliteStore) =>
  defineDeployment({
    name: 'hospitality',
    datastore: 'hospitality',
    modules,
    navigation,
    permissions: productPermissions(modules, hospitalityRoleTemplates),
    theme: suite.paperTheme,
    worker: { queues: productQueues },
    serve: { ...productServe(openStore), defaults: productDefaults('hospitality') },
  })
