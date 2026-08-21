// KetSuite — the application, as a declaration.
//
// What is left here is only what the framework cannot know: which modules ship,
// which function turns a path into a page, and how to open a datastore that is not
// SQLite. Screens, stylesheets and static files belong to the modules that own
// them — an app that named another module's files would go on serving them after
// that module was switched off.

import { defineApp } from 'ketjs'
import * as suite from 'ketsuite'
import backend from 'ketsuite/backend'
import { openStore } from './config.ts'

export const ketsuite = defineApp({
  name: 'ketsuite',
  /** Every module KetSuite ships. Adding one here is what makes it installable. */
  modules: [
    suite.website,
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
    suite.activity,
    suite.activityBackend,
    suite.calendar,
    suite.calendarActivity,
    suite.calendarBackend,
    suite.calendarMailTransport,
    suite.odooCollaborationImport,
    suite.uom,
    suite.product,
    suite.productMedia,
    suite.pricing,
    suite.stock,
    suite.account,
    suite.purchase,
    suite.sale,
    suite.pos,
    suite.loyalty,
    suite.loyaltySale,
    suite.loyaltyPos,
    suite.crm,
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
    suite.purchaseBackend,
    suite.saleBackend,
    suite.saleMailBackend,
    suite.saleActivityBackend,
    suite.posBackend,
    suite.loyaltyBackend,
    suite.crmBackend,
    backend,
    suite.hospitalityCore,
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
    bootstrap: [
      'website',
      'website_menu',
      'website_form',
      'website_backend',
      'website_hospitality',
      'website_retail',
      'theme_paper',
      'theme_hospitality',
      'theme_retail',
      'backend',
      'address',
      'product',
      'product_media',
      'pricing',
      'stock',
      'account',
      'purchase',
      'sale',
      'pos',
      'loyalty',
      'loyalty_sale',
      'loyalty_pos',
      'loyalty_backend',
      'crm',
      'crm_sale',
      'crm_website',
      'crm_backend',
      'user',
      'oauth',
      'user_backend',
      'oauth_backend',
      'storage',
      'hr',
      'attendance',
      'hospitality_core',
      'mail',
      'mail_transport',
      'mail_inbound',
      'activity',
      'calendar',
      'odoo_collaboration_import',
    ],
    /**
     * Identity comes from a signed cookie now, not from X-Ket-Company. The store
     * is the database, so several pods share sessions without extra infrastructure;
     * anonymous requests still get a company, because a public storefront needs one.
     */
    sessions: { anonymous: { company: 'default' } },
    resolveSession: suite.resolveUserSession,
    /**
     * The framework enforces the list; this decides what is in it. Resolved per
     * request, so revoking a role takes effect on the next call rather than on the
     * next login — one query is a better trade than "why can they still do that".
     */
    permissions: (ctx, userId) =>
      ctx
        .callUnchecked('user.permitted', { userId }, new URL('http://x/'), { headers: {} } as never)
        .then((r) =>
          (r as { superuser: boolean; functions?: string[] }).superuser
            ? null
            : (r as { functions: string[] }).functions,
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

export const apps = [ketsuite]
