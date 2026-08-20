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
    suite.partner,
    suite.company,
    suite.storage,
    suite.user,
    suite.uom,
    suite.product,
    suite.productMedia,
    suite.pricing,
    suite.stock,
    suite.account,
    suite.purchase,
    suite.sale,
    suite.pos,
    suite.accountPartner,
    suite.partnerBackend,
    suite.accountPartnerBackend,
    suite.productBackend,
    suite.pricingBackend,
    suite.stockBackend,
    suite.accountBackend,
    suite.purchaseBackend,
    suite.saleBackend,
    suite.posBackend,
    backend,
    suite.hospitalityCore,
  ],
  theme: suite.paperTheme,
  datastore: 'main',
  worker: {
    queues: { default: 10, maintenance: 2 },
  },
  serve: {
    openStore,
    defaults: { sqliteFile: '.ket/ketsuite.db', defaultLocale: 'vi', fallbackLocale: 'vi' },
    bootstrap: [
      'website',
      'theme_paper',
      'backend',
      'product',
      'product_media',
      'pricing',
      'stock',
      'account',
      'purchase',
      'sale',
      'pos',
      'user',
      'storage',
      'hospitality_core',
    ],
    /**
     * Identity comes from a signed cookie now, not from X-Ket-Company. The store
     * is the database, so several pods share sessions without extra infrastructure;
     * anonymous requests still get a company, because a public storefront needs one.
     */
    sessions: { anonymous: { company: 'default' } },
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
    pages: { resolve: 'website.getPageByPath', notFound: 'website.page.notFound', siteTitle: 'KetSuite' },
  },
})

export const apps = [ketsuite]
