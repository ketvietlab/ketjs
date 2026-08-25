// The packaged KetSuite deployment declaration. Keeping this beside the
// modules lets both the repository entry and the public CLI run the exact same
// composition instead of maintaining two module lists.

import { defineDeployment, sqliteStore } from '@ketvietlab/ketjs'
import type { OpenStore } from '@ketvietlab/ketjs'
import * as suite from './index.ts'
import backend from './modules/backend/index.ts'

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
      suite.mailBackend,
      suite.mailTransport,
      suite.mailTransportBackend,
      suite.mailInbound,
      suite.mailInboundBackend,
      suite.flow,
      suite.flowBackend,
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
      suite.manufacturing,
      suite.account,
      suite.accountStaffChannel,
      suite.report,
      suite.purchase,
      suite.purchaseStaffChannel,
      suite.sale,
      suite.saleStaffChannel,
      suite.pos,
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
    ],
    theme: suite.paperTheme,
    themes: [suite.hospitalityTheme, suite.retailTheme],
    datastore: 'main',
    worker: {
      queues: { default: 10, maintenance: 2, mail: 5 },
    },
    serve: {
      openStore,
      defaults: {
        sqliteFile: '.ket/ketsuite.db',
        defaultLocale: 'vi',
        fallbackLocale: 'vi',
        defaultTimezone: 'Asia/Ho_Chi_Minh',
      },
      sessions: { anonymous: { company: 'default' } },
      resolveSession: suite.resolveUserSession,
      resolveAudience: (_url, req) => {
        const authorization = String(req.headers.authorization ?? '')
        const cookies = String(req.headers.cookie ?? '')
        return /^Bearer\s+/i.test(authorization) || /(?:^|;\s*)ket_customer_session=/.test(cookies)
          ? 'customer'
          : 'anonymous'
      },
      permissions: (ctx, userId, url, req) =>
        ctx
          .callUnchecked('user.permitted', { userId }, url, req)
          .then((result) =>
            (result as { superuser: boolean; functions?: string[] }).superuser
              ? null
              : (result as { functions: string[] }).functions,
          ),
      pages: {
        siteResolve: 'website.resolveSite',
        resolve: 'website.getEntryByPath',
        region: 'website.page',
        notFound: 'website.page.notFound',
        siteTitle: 'KetSuite',
      },
    },
  })

export const ketsuite = createKetsuiteDeployment()
export const deployments = [ketsuite]
