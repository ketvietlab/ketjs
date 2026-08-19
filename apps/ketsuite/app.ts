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
    suite.website, suite.websiteMenu, suite.websiteSeo, suite.websiteSearch,
    suite.partner, suite.company, suite.user,
    suite.uom, suite.product, backend,
  ],
  theme: suite.paperTheme,
  datastore: 'main',
  serve: {
    openStore,
    defaults: { sqliteFile: '.ket/ketsuite.db', defaultLocale: 'vi', fallbackLocale: 'vi' },
    bootstrap: ['website', 'theme_paper', 'backend', 'product', 'user'],
    pages: { resolve: 'website.getPageByPath', notFound: 'website.page.notFound', siteTitle: 'KetSuite' },
  },
})

export const apps = [ketsuite]
