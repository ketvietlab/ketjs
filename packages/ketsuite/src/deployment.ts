// The packaged KetSuite deployment declarations. Keeping these beside the
// modules lets the repository entry, the public CLI and a generated app run the
// exact same compositions instead of maintaining their own module lists.
//
// KetSuite ships products the way the private Két Việt deployments are cut:
// commerce, hospitality and office, each its own datastore, modules and roles,
// so a bad hospitality release can be stopped without touching the shop. The
// `ketsuite` deployment is the other kind: every public module composed once so
// a developer reaches the whole surface from one process, and the composition
// the test suite runs. It is not a product; if something only works there, it
// does not work.

import { defineDeployment, sqliteStore } from '@ketvietlab/ketjs'
import type { OpenStore, RoleTemplateDef } from '@ketvietlab/ketjs'
import { productDefaults, productServe, productQueues } from './deployments/common.ts'
import { createCommerceDeployment } from './deployments/commerce.ts'
import { createHospitalityDeployment } from './deployments/hospitality.ts'
import { createOfficeDeployment } from './deployments/office.ts'
import * as suite from './index.ts'
import backend from './modules/backend/index.ts'

export { createCommerceDeployment, createHospitalityDeployment, createOfficeDeployment }

/**
 * Every product's roles, so each job can be tried here. Keys never collide, but
 * names do — each product has its own "Quản trị công ty" — and a role name is
 * unique in a tenant, so here each one says which product it is from. A product
 * deployment keeps the plain name.
 */
const everyProductRole = (): Record<string, RoleTemplateDef> =>
  Object.fromEntries(
    Object.entries(suite.ketsuiteRoleTemplates).flatMap(([product, templates]) =>
      Object.entries(templates as Record<string, RoleTemplateDef>).map(([key, template]) => [
        key,
        {
          ...template,
          labels: {
            vi: `${template.labels.vi} · ${product}`,
            en: `${template.labels.en} · ${product}`,
          },
        },
      ]),
    ),
  )

/** The whole public surface in one process: development and tests, never a product. */
export const createKetsuiteDeployment = (openStore: OpenStore = sqliteStore) =>
  defineDeployment({
    name: 'ketsuite',
    modules: [
      suite.website,
      suite.channelApi,
      suite.websiteMenu,
      suite.websiteSeo,
      suite.websiteSearch,
      suite.websiteForm,
      suite.websiteFormMail,
      suite.websiteBackend,
      suite.websiteHospitality,
      suite.websiteRetail,
      suite.address,
      suite.partner,
      suite.company,
      suite.hr,
      suite.attendance,
      suite.hrBackend,
      suite.attendanceBackend,
      suite.storage,
      suite.user,
      suite.oauth,
      suite.userBackend,
      suite.oauthBackend,
      suite.mail,
      suite.mailStaffChannel,
      suite.mailBackend,
      suite.mailTransport,
      suite.mailTransportBackend,
      suite.mailInbound,
      suite.mailInboundBackend,
      suite.livedoc,
      suite.flow,
      suite.flowBackend,
      suite.flowStaffChannel,
      suite.activity,
      suite.activityBackend,
      suite.calendar,
      suite.calendarActivity,
      suite.calendarBackend,
      suite.calendarMailTransport,
      suite.uom,
      suite.product,
      suite.productMedia,
      suite.pricing,
      suite.stock,
      suite.stockStaffChannel,
      suite.inventoryStaffChannel,
      suite.quality,
      suite.qualityStaffChannel,
      suite.manufacturing,
      suite.account,
      suite.accountStaffChannel,
      suite.report,
      suite.purchase,
      suite.purchaseStaffChannel,
      suite.sale,
      suite.saleStaffChannel,
      suite.businessReportStaffChannel,
      suite.pos,
      suite.posChannel,
      suite.loyalty,
      suite.loyaltySale,
      suite.loyaltyPos,
      suite.crm,
      suite.crmStaffChannel,
      suite.crmSale,
      suite.crmWebsite,
      suite.accountPartner,
      suite.addressBackend,
      suite.partnerBackend,
      suite.partnerMailBackend,
      suite.companyBackend,
      suite.accountPartnerBackend,
      suite.productBackend,
      suite.pricingBackend,
      suite.stockBackend,
      suite.manufacturingBackend,
      suite.productMailBackend,
      suite.productVariantMailBackend,
      suite.stockMailBackend,
      suite.stockLotMailBackend,
      suite.productActivityBackend,
      suite.productVariantActivityBackend,
      suite.stockActivityBackend,
      suite.stockLotActivityBackend,
      suite.stockMailInbound,
      suite.accountBackend,
      suite.accountMailBackend,
      suite.accountActivityBackend,
      suite.reportBackend,
      suite.purchaseBackend,
      suite.saleBackend,
      suite.saleMailBackend,
      suite.saleActivityBackend,
      suite.posBackend,
      suite.loyaltyBackend,
      suite.crmBackend,
      backend,
      suite.hospitalityCore,
      suite.hospitalityBilling,
      suite.hospitalityStaffChannel,
    ],
    theme: suite.paperTheme,
    themes: [suite.hospitalityTheme, suite.retailTheme],
    datastore: 'main',
    permissions: { modules: suite.ketsuitePermissionModules, roleTemplates: everyProductRole() },
    worker: { queues: productQueues },
    serve: {
      ...productServe(openStore),
      defaults: { ...productDefaults('ketsuite') },
      pages: { ...productServe(openStore).pages, menuResolve: 'website_menu.publicMenu' },
    },
  })

export const ketsuite = createKetsuiteDeployment()
export const commerce = createCommerceDeployment()
export const hospitality = createHospitalityDeployment()
export const office = createOfficeDeployment()

/** What `ketsuite serve --deployment` and `ketsuite new --deployment` accept. */
export const ketsuiteDeployments: Record<string, ReturnType<typeof createKetsuiteDeployment>> = {
  commerce,
  hospitality,
  office,
  dev: ketsuite,
}
export const DEFAULT_KETSUITE_DEPLOYMENT = 'commerce'

export const deployments = [ketsuite]
