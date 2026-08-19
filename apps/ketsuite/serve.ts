#!/usr/bin/env node
// KetSuite — the application.
//
//   npm start                                  SQLite in .ket/ketsuite.db
//   DATABASE_URL=postgres://… npm start        Postgres
//
// What this does on boot: open the database, migrate to the manifest, install the
// bootstrap apps if none are installed yet, then serve.
//
// ── The gap you should know about ──────────────────────────────────────────────
// There is no authentication yet, so the company a request acts as comes from the
// X-Ket-Company header (falling back to a configured default), and the branch from
// X-Ket-Branch. That is fine for development and NOT fine for production: anyone
// who can reach the port can name any company. The resolver is deliberately one
// function so that replacing it with a real session is a single change.

import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  callFn, compose, createAppRegistry, createKetServer, createTheme, migrateOne,
  registerFunctions, restrictManifest, translator, agentDescriptor,
} from 'ketjs'
import type { Adapter, Manifest, Scope } from 'ketjs'
import * as suite from 'ketsuite'
import backend, { appsScreen, pagesScreen, settingsScreen } from 'ketsuite/backend'
import { renderToString } from 'ketjs-view'
import type { TemplateResult } from 'ketjs-view'
import { readConfig, openDatabase } from './config.ts'

const config = readConfig()

/** Every module KetSuite ships. Adding one here is what makes it installable. */
const modules = [
  suite.website, suite.websiteMenu, suite.websiteSeo, suite.websiteSearch,
  suite.product, suite.paperTheme, backend,
]
const manifest: Manifest = compose(modules)

if (!config.databaseUrl) await mkdir(dirname(config.sqliteFile), { recursive: true })
const db: Adapter = await openDatabase(config)

if (config.migrateOnBoot) {
  const ops = await migrateOne(db, manifest)
  if (ops.length) console.log(`  migrate: ${ops.length} operation(s)`)
}

registerFunctions(modules)
const apps = await createAppRegistry(manifest, db)

// An empty database is not a useful one to look at, so a first run installs enough
// to see something. A database that has been used is left exactly as it is.
if ((await apps.enabled()).size === 0) {
  for (const name of config.bootstrapApps) await apps.install(name)
  console.log(`  first run, installed: ${[...(await apps.enabled())].sort().join(', ')}`)
}

/**
 * The one place a request's identity is decided. Until authentication exists this
 * reads headers; afterwards it reads a session, and nothing else changes.
 */
const scopeOf = (_url: URL, req: { headers: Record<string, unknown> }): Scope => ({
  company: (req.headers['x-ket-company'] as string | undefined) ?? config.defaultCompany,
  branches: ((req.headers['x-ket-branch'] as string | undefined) ?? '').split(',').filter(Boolean) || null,
})
const localeOf = (url: URL, req: { headers: Record<string, unknown> }): string =>
  url.searchParams.get('lang')
  ?? (req.headers['accept-language'] as string | undefined)?.split(',')[0]?.split('-')[0]
  ?? config.defaultLocale

const page = (locale: string, body: TemplateResult): string =>
  `<!doctype html><html lang="${locale}"><head><meta charset="utf-8">` +
  `<meta name="viewport" content="width=device-width, initial-scale=1"><title>KetSuite</title>` +
  `<link rel="stylesheet" href="/design/tokens.css"><link rel="stylesheet" href="/design/admin.css">` +
  `</head><body>${renderToString(body)}</body></html>`

const admin = (build: (_: ReturnType<typeof translator>, live: Manifest) => Promise<TemplateResult> | TemplateResult) =>
  async (url: URL, req: { headers: Record<string, unknown> }) => {
    const locale = localeOf(url, req)
    const live = restrictManifest(manifest, await apps.enabled())
    return { body: page(locale, await build(translator(manifest, locale, { fallback: 'vi' }), live)) }
  }

const app = await createKetServer({
  manifest, adapter: db,
  resolveLocale: localeOf,
  resolveScope: scopeOf,
  assets: { prefix: '/design/', dir: new URL('../../packages/ketsuite/src/modules/backend/design/', import.meta.url).pathname },
  theme: createTheme(restrictManifest(manifest, await apps.enabled()), modules, {
    translate: translator(manifest, config.defaultLocale, { fallback: 'vi' }),
  }),
  /**
   * The storefront: a path becomes a page, and a page becomes its sections.
   *
   * The lookup runs through callFn like anything else, so the company filter and
   * the app-installed check apply to a public page exactly as they do to an API
   * call — the front of the site is not a second door with different rules.
   */
  pageScope: async (url, req) => {
    const live = restrictManifest(manifest, await apps.enabled())
    const scope = scopeOf(url, req as never)
    const page = (await callFn('website.getPageByPath', { path: url.pathname },
      { adapter: db, manifest: live, scope })).value as { id: string; title: string; layout: unknown } | null

    if (!page) {
      const _ = translator(manifest, localeOf(url, req as never), { fallback: config.defaultLocale })
      return { site: { title: 'KetSuite' }, page: { path: url.pathname, title: _('website.page.notFound') }, sections: [] }
    }
    return {
      site: { title: 'KetSuite' },
      page: { id: page.id, path: url.pathname, title: page.title },
      meta: {},
      sections: typeof page.layout === 'string' ? JSON.parse(page.layout) : page.layout,
    }
  },
  routes: {
    '/admin': admin(async (_) => appsScreen(_, await apps.list())),
    '/admin/apps': admin(async (_) => appsScreen(_, await apps.list())),
    '/admin/pages': admin(async (_, live) => {
      const rows = (await callFn('website.listPages', { includeDrafts: true },
        { adapter: db, manifest: live, scope: { company: config.defaultCompany, branches: null } })).value
      return pagesScreen(_, (rows as Array<{ id: string; path: string; title: string; published: number }>)
        .map(r => ({ ...r, published: !!r.published })))
    }),
    '/admin/settings': admin(_ => settingsScreen(_, manifest.tokens)),
    '/_ket/health': async () => ({
      type: 'application/json',
      body: JSON.stringify({
        ok: true,
        database: db.name,
        apps: [...(await apps.enabled())].sort(),
        orphans: await apps.orphans(),
        locales: Object.keys(manifest.messages ?? {}),
      }, null, 2),
    }),
    '/_ket/agent': async () => ({
      type: 'application/json',
      body: JSON.stringify(agentDescriptor(restrictManifest(manifest, await apps.enabled())), null, 2),
    }),
  },
})

const port = await app.listen(config.port)
const enabled = [...(await apps.enabled())].sort()
console.log(`
  KetSuite is running

    site                http://127.0.0.1:${port}/
    admin               http://127.0.0.1:${port}/admin
    health              http://127.0.0.1:${port}/_ket/health
    agent descriptor    http://127.0.0.1:${port}/_ket/agent

    database            ${db.name}${config.databaseUrl ? '' : ` (${config.sqliteFile})`}
    apps installed      ${enabled.join(', ') || '(none)'}
    locales             ${Object.keys(manifest.messages ?? {}).join(', ')}

  No authentication yet: the company comes from the X-Ket-Company header,
  defaulting to "${config.defaultCompany}". Fine for development, NOT for production.
`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { void app.close().then(() => db.close()).then(() => process.exit(0)) })
}
