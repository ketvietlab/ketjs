import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  bootDeployment,
  callFn,
  compose,
  defineDeployment,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website } from '@ketvietlab/ketsuite'
import { isReservedPath, reservedPrefixes } from '../packages/ketsuite/src/modules/website/paths.ts'

/**
 * The half of preview that nobody could reach.
 *
 * `previewEntry` has existed since preview tokens did, and no route, screen or
 * fixture ever called it - so a link could be minted, shown, copied and
 * revoked, and opening it reached nothing. These tests drive the real server,
 * because what is being claimed is a response: its body, and the three headers
 * that keep a draft out of an index, a cache and a referrer.
 */

const SCOPE = { company: 'acme', branches: null }
// The theme is passed to the deployment, not listed beside the modules: compose
// refuses the same name twice, and `theme:` is how a deployment names its own.
const modules = [address, partner, website]
const manifest = compose([...modules, paperTheme])
const memory = { KET_LOG: 'null', KET_SQLITE: ':memory:', KET_COMPANY: 'acme' }

const app = defineDeployment({
  name: 'preview_app',
  modules,
  theme: paperTheme,
  serve: {
    pages: {
      siteResolve: 'website.resolveSite',
      resolve: 'website.getEntryByPath',
      previewResolve: 'website.previewEntry',
      region: 'website.page',
    },
  },
})

const boot = async (): Promise<Adapter> => {
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, manifest)
  registerFunctions(modules)
  return db
}

const call = async (db: Adapter, name: string, input: Record<string, unknown>) =>
  (await callFn(name, input, { adapter: db, manifest, scope: SCOPE })).value

test('preview: a link renders the draft, and says it is not for the index', async () => {
  const booted = await bootDeployment(app, { env: memory, port: 0 })
  try {
    const db = booted.adapter!
    registerFunctions(modules)
    const at = async (name: string, input: Record<string, unknown>) =>
      (await callFn(name, input, { adapter: db, manifest: booted.manifest, scope: SCOPE })).value

    await at('website.saveSite', {
      id: 'site1',
      name: 'moc',
      title: 'Moc',
      defaultLocale: 'vi',
      theme: 'theme_paper',
      active: true,
    })
    await at('website.saveDomain', { id: 'd1', siteId: 'site1', host: '127.0.0.1', primary: true })
    await at('website.saveEntry', {
      id: 'p1',
      siteId: 'site1',
      type: 'website.page',
      slug: 'sap-ra',
      path: '/sap-ra',
      title: 'Sap ra mat',
      layout: [{ type: 'website.rich_text', settings: { body: 'Noi dung ban nhap' } }],
    })
    const minted = (await at('website.createPreviewToken', { entryId: 'p1' })) as { token: string }

    const response = await fetch(
      `http://127.0.0.1:${booted.port}/_ket/preview?token=${encodeURIComponent(minted.token)}`,
    )
    assert.equal(response.status, 200)
    const body = await response.text()
    // The draft was never published, so nothing else on the site can show it.
    assert.match(body, /Noi dung ban nhap/u)

    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow, noarchive')
    assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0')
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  } finally {
    await booted.close()
  }
})

test('preview: an ordinary page carries none of those headers', async () => {
  const booted = await bootDeployment(app, { env: memory, port: 0 })
  try {
    const db = booted.adapter!
    registerFunctions(modules)
    const at = async (name: string, input: Record<string, unknown>) =>
      (await callFn(name, input, { adapter: db, manifest: booted.manifest, scope: SCOPE })).value
    await at('website.saveSite', {
      id: 'site1',
      name: 'moc',
      title: 'Moc',
      defaultLocale: 'vi',
      theme: 'theme_paper',
      active: true,
    })
    await at('website.saveDomain', { id: 'd1', siteId: 'site1', host: '127.0.0.1', primary: true })
    await at('website.saveEntry', {
      id: 'p1',
      siteId: 'site1',
      type: 'website.page',
      slug: 'ra-roi',
      path: '/ra-roi',
      title: 'Da ra mat',
      layout: [{ type: 'website.rich_text', settings: { body: 'Noi dung cong khai' } }],
    })
    await at('website.publishEntry', { id: 'p1' })

    const response = await fetch(`http://127.0.0.1:${booted.port}/ra-roi`)
    assert.equal(response.status, 200)
    assert.match(await response.text(), /Noi dung cong khai/u)
    // A published page is meant to be indexed and cached; the private headers
    // belong only to the token path.
    assert.equal(response.headers.get('x-robots-tag'), null)
    assert.equal(response.headers.get('referrer-policy'), null)
  } finally {
    await booted.close()
  }
})

test('preview: a revoked link opens nothing, and does not fall through to a page', async () => {
  const booted = await bootDeployment(app, { env: memory, port: 0 })
  try {
    const db = booted.adapter!
    registerFunctions(modules)
    const at = async (name: string, input: Record<string, unknown>) =>
      (await callFn(name, input, { adapter: db, manifest: booted.manifest, scope: SCOPE })).value
    await at('website.saveSite', {
      id: 'site1',
      name: 'moc',
      title: 'Moc',
      defaultLocale: 'vi',
      theme: 'theme_paper',
      active: true,
    })
    await at('website.saveDomain', { id: 'd1', siteId: 'site1', host: '127.0.0.1', primary: true })
    await at('website.saveEntry', {
      id: 'p1',
      siteId: 'site1',
      type: 'website.page',
      slug: 'rieng',
      path: '/rieng',
      title: 'Rieng tu',
      layout: [{ type: 'website.rich_text', settings: { body: 'Khong duoc doc' } }],
    })
    const minted = (await at('website.createPreviewToken', { entryId: 'p1' })) as { token: string }
    await at('website.revokePreviewTokens', { entryId: 'p1' })

    const body = await (
      await fetch(`http://127.0.0.1:${booted.port}/_ket/preview?token=${encodeURIComponent(minted.token)}`)
    ).text()
    assert.equal(body.includes('Khong duoc doc'), false, 'a revoked link must not draw the draft')
  } finally {
    await booted.close()
  }
})

test('preview: a one-time link is spent by the first reader', async () => {
  const booted = await bootDeployment(app, { env: memory, port: 0 })
  try {
    const db = booted.adapter!
    registerFunctions(modules)
    const at = async (name: string, input: Record<string, unknown>) =>
      (await callFn(name, input, { adapter: db, manifest: booted.manifest, scope: SCOPE })).value
    await at('website.saveSite', {
      id: 'site1',
      name: 'moc',
      title: 'Moc',
      defaultLocale: 'vi',
      theme: 'theme_paper',
      active: true,
    })
    await at('website.saveDomain', { id: 'd1', siteId: 'site1', host: '127.0.0.1', primary: true })
    await at('website.saveEntry', {
      id: 'p1',
      siteId: 'site1',
      type: 'website.page',
      slug: 'mot-lan',
      path: '/mot-lan',
      title: 'Mot lan',
      layout: [{ type: 'website.rich_text', settings: { body: 'Chi mot nguoi doc' } }],
    })
    const minted = (await at('website.createPreviewToken', { entryId: 'p1', oneTime: true })) as {
      token: string
    }
    const url = `http://127.0.0.1:${booted.port}/_ket/preview?token=${encodeURIComponent(minted.token)}`

    assert.match(await (await fetch(url)).text(), /Chi mot nguoi doc/u)
    assert.equal((await (await fetch(url)).text()).includes('Chi mot nguoi doc'), false)
  } finally {
    await booted.close()
  }
})

test('preview: the path it is served from is one no page can be published at', () => {
  // The derivation only sees module routes, so the framework's own namespace
  // was claimable: a page at /_ket/health would have been advertised in the
  // sitemap while the framework answered the path.
  const prefixes = reservedPrefixes(Object.keys(manifest.routes ?? {}))
  assert.ok(isReservedPath('/_ket/preview', prefixes))
  assert.ok(isReservedPath('/_ket/health', prefixes))
  // Per segment, as before: a page merely starting with the same letters stays.
  assert.equal(isReservedPath('/_ketchup', prefixes), false)
})

test('boot: a preview resolver naming nothing is refused before the first request', async () => {
  const broken = defineDeployment({
    name: 'broken_preview',
    modules,
    theme: paperTheme,
    serve: {
      pages: { resolve: 'website.getEntryByPath', previewResolve: 'website.notAThing' },
    },
  })
  await assert.rejects(
    () => bootDeployment(broken, { env: memory, port: 0 }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_PREVIEW_RESOLVER_MISSING')
      return true
    },
  )
})

test('boot: a preview path a page could claim is refused', async () => {
  const claimable = defineDeployment({
    name: 'claimable_preview',
    modules,
    theme: paperTheme,
    serve: {
      pages: {
        resolve: 'website.getEntryByPath',
        previewResolve: 'website.previewEntry',
        previewPath: '/preview',
      },
    },
  })
  await assert.rejects(
    () => bootDeployment(claimable, { env: memory, port: 0 }),
    (e: unknown) => {
      assert.equal((e as { code: string }).code, 'E_PREVIEW_PATH_UNRESERVED')
      return true
    },
  )
})

test('preview: the answer is the same shape the storefront already renders', async () => {
  const db = await boot()
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Moc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
    active: true,
  })
  await call(db, 'website.saveEntry', {
    id: 'p1',
    siteId: 'site1',
    type: 'website.page',
    slug: 'a',
    path: '/a',
    title: 'A',
    layout: [{ type: 'website.rich_text', settings: { body: 'x' } }],
  })
  const minted = (await call(db, 'website.createPreviewToken', { entryId: 'p1' })) as { token: string }
  const row = (await call(db, 'website.previewEntry', { token: minted.token })) as Record<string, unknown>
  // One renderer draws both, so a second shape would mean a second renderer.
  assert.deepEqual(Object.keys(row).sort(), [
    'excerpt',
    'fields',
    'id',
    'layout',
    'meta',
    'path',
    'published',
    'siteId',
    'title',
    'type',
  ])
  assert.equal(row.path, '/a')
  assert.equal(row.published, false)
})
