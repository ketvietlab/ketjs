import { defineDeployment, sqliteStore } from '@ketvietlab/ketjs'
import type { OpenStore } from '@ketvietlab/ketjs'
import * as suite from '../index.ts'
import { commerceRoleTemplates } from '../role-templates.ts'
import {
  commonBusinessModules,
  productDefaults,
  productPermissions,
  productQueues,
  productServe,
} from './common.ts'

const modules = [
  ...commonBusinessModules,
  suite.pricing,
  suite.account,
  suite.businessReportStaffChannel,
  suite.quality,
  suite.qualityStaffChannel,
  suite.purchase,
  suite.purchaseStaffChannel,
  suite.pos,
  suite.posBackend,
  suite.posChannel,
  suite.loyalty,
  suite.loyaltyPos,
  suite.purchaseBackend,
  suite.accountBackend,
  suite.manufacturing,
  suite.manufacturingBackend,
]

/** Commerce: selling, the counter, purchasing, stock, manufacturing and accounting. */
export const createCommerceDeployment = (openStore: OpenStore = sqliteStore) =>
  defineDeployment({
    name: 'commerce',
    datastore: 'commerce',
    modules,
    permissions: productPermissions(modules, commerceRoleTemplates),
    theme: suite.paperTheme,
    worker: { queues: productQueues },
    serve: { ...productServe(openStore), defaults: productDefaults('commerce') },
  })
