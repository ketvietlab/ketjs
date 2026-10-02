import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, ServeContext } from '@ketvietlab/ketjs'
import backend from '@ketvietlab/ketsuite/backend'
import {
  address,
  company,
  paperTheme,
  partner,
  storage,
  website,
  livedoc,
  user,
  websiteBackend,
  websiteForm,
  websiteMenu,
  websiteSearch,
  websiteSeo,
} from '@ketvietlab/ketsuite'

const SCOPE = { company: 'acme', branches: null }
const modules = [
  address,
  partner,
  company,
  storage,
  backend,
  website,
  websiteMenu,
  websiteSearch,
  websiteSeo,
  websiteForm,
  livedoc,
  user,
  websiteBackend,
  paperTheme,
]
const manifest = compose(modules)

const boot = async (): Promise<Adapter> => {
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, manifest)
  registerFunctions(modules)
  return db
}

const call = async (db: Adapter, name: string, input: Record<string, unknown>) =>
  (await callFn(name, input, { adapter: db, manifest, scope: SCOPE })).value

type DomainRow = { host: string; primary: boolean }
type RedirectRow = { toPath: string }

const seed = async (db: Adapter) => {
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Moc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
    active: true,
  })
}

/**
 * A host could be attached and never detached, and the row kept its unique
 * claim on that name for ever - so a typo took the name out of circulation.
 */
test('domains: a host that is not the primary can be taken off', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.saveDomain', { id: 'd1', siteId: 'site1', host: 'moc.vn', primary: true })
  await call(db, 'website.saveDomain', { id: 'd2', siteId: 'site1', host: 'moc.com', primary: false })

  const removed = (await call(db, 'website.deleteDomain', { id: 'd2' })) as { ok?: boolean }
  assert.equal(removed.ok, true)
  const left = (await call(db, 'website.listDomains', { siteId: 'site1' })) as DomainRow[]
  assert.deepEqual(
    left.map((row) => row.host),
    ['moc.vn'],
  )
})

test('domains: the primary cannot be taken off while the site has others', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.saveDomain', { id: 'd1', siteId: 'site1', host: 'moc.vn', primary: true })
  await call(db, 'website.saveDomain', { id: 'd2', siteId: 'site1', host: 'moc.com', primary: false })

  // Canonical URLs and the sitemap are built from the primary, so a site left
  // with hosts and no primary publishes the wrong address to every crawler.
  const refused = (await call(db, 'website.deleteDomain', { id: 'd1' })) as {
    ok?: boolean
    errors?: Array<{ message?: string }>
  }
  assert.equal(refused.ok, false)
  assert.equal(refused.errors?.[0]?.message, 'website.error.primaryDomainInUse')

  // Promote the other one and the way out opens.
  await call(db, 'website.saveDomain', { id: 'd2', siteId: 'site1', host: 'moc.com', primary: true })
  const now = (await call(db, 'website.deleteDomain', { id: 'd1' })) as { ok?: boolean }
  assert.equal(now.ok, true)
})

test('domains: the last host goes, primary or not', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.saveDomain', { id: 'd1', siteId: 'site1', host: 'moc.vn', primary: true })
  const removed = (await call(db, 'website.deleteDomain', { id: 'd1' })) as { ok?: boolean }
  assert.equal(removed.ok, true)
  assert.deepEqual(await call(db, 'website.listDomains', { siteId: 'site1' }), [])
})

test('domains: saving the same row promotes it and demotes the old primary', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.saveDomain', { id: 'd1', siteId: 'site1', host: 'moc.vn', primary: true })
  await call(db, 'website.saveDomain', { id: 'd2', siteId: 'site1', host: 'moc.com', primary: false })

  // The create route minted a fresh id every time, so this reached saveDomain
  // as a new row and only ever collided with the unique host index.
  await call(db, 'website.saveDomain', { id: 'd2', siteId: 'site1', host: 'moc.com', primary: true })
  const rows = (await call(db, 'website.listDomains', { siteId: 'site1' })) as DomainRow[]
  assert.deepEqual(Object.fromEntries(rows.map((row) => [row.host, row.primary])), {
    'moc.com': true,
    'moc.vn': false,
  })
})

/**
 * `site_from` is unique, so a correction submitted as a new row collided with
 * the typo it was correcting and the wrong address kept the path.
 */
test('redirects: correcting one in place is what frees a path', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.saveRedirect', {
    id: 'r1',
    siteId: 'site1',
    fromPath: '/cu',
    toPath: '/moi-sai',
  })

  // Nothing checked the unique index before writing, so this reached the
  // driver and came back as a 500 rather than as an answer.
  const collided = (await call(db, 'website.saveRedirect', {
    id: 'r2',
    siteId: 'site1',
    fromPath: '/cu',
    toPath: '/moi',
  })) as { ok?: boolean; errors?: Array<{ message?: string }> }
  assert.equal(collided.ok, false)
  assert.equal(collided.errors?.[0]?.message, 'website.error.duplicateRedirect')

  const fixed = (await call(db, 'website.saveRedirect', {
    id: 'r1',
    siteId: 'site1',
    fromPath: '/cu',
    toPath: '/moi',
  })) as { ok?: boolean }
  assert.equal(fixed.ok, true)
  const rows = (await call(db, 'website.listRedirects', { siteId: 'site1' })) as RedirectRow[]
  assert.deepEqual(
    rows.map((row) => row.toPath),
    ['/moi'],
  )
})

test('redirects: the off switch on the contract can now be reached', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website.saveRedirect', { id: 'r1', siteId: 'site1', fromPath: '/cu', toPath: '/moi' })
  await call(db, 'website.saveRedirect', {
    id: 'r1',
    siteId: 'site1',
    fromPath: '/cu',
    toPath: '/moi',
    active: false,
  })
  assert.deepEqual(await call(db, 'website.listRedirects', { siteId: 'site1', active: true }), [])
  const off = (await call(db, 'website.listRedirects', { siteId: 'site1', active: false })) as RedirectRow[]
  assert.equal(off.length, 1)
})

const studioApiGet = async (operation: string): Promise<number | undefined> => {
  const entry = manifest.routes['/website/api/{operation}']
  if (!entry) throw new Error('the Studio API is not composed')
  const route = entry.make({} as unknown as ServeContext)
  const req = { method: 'GET', headers: { host: 'moc.example' } }
  const result = await route(new URL(`http://moc.example/website/api/${operation}`), req as never, {
    operation,
  })
  return result.status
}

test('routes: redirects and domains change state, so none of them answers a GET', async () => {
  for (const operation of ['website.saveRedirect', 'website.saveDomain'])
    assert.equal(await studioApiGet(operation), 405, `${operation} must refuse a GET`)
})
