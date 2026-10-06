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
  ...commonBusinessModules.map((m) =>
    m.name === 'product_media' ? suite.productMediaWithWebsiteCatalog() : m,
  ),
  suite.websiteCatalog,
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
    permissions: productPermissions(
      modules,
      Object.fromEntries(
        Object.entries(commerceRoleTemplates).map(([key, value]) => [
          key,
          key === 'commerce.company-administrator'
            ? {
                ...value,
                version: value.version + 1,
                bundles: [...value.bundles, 'website_catalog.view', 'website_catalog.configure'],
              }
            : value,
        ]),
      ),
    ),
    theme: suite.paperTheme,
    worker: { queues: productQueues },
    serve: {
      ...productServe(openStore),
      pages: { ...productServe(openStore).pages!, resolve: 'website_catalog.getEntryByPath' },
      defaults: productDefaults('commerce'),
    },
  })
