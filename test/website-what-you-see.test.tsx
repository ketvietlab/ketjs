import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
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

const site = {
  id: 'site1',
  name: 'moc',
  title: 'Moc',
  defaultLocale: 'vi',
  theme: 'theme_paper',
  active: true,
}

test('export: a filtered download is named for what it holds', async () => {
  const db = await boot()
  await call(db, 'website.saveSite', { ...site })
  await call(db, 'website_form.saveForm', {
    id: 'f1',
    siteId: 'site1',
    name: 'Lien he',
    schema: { fields: [{ name: 'email', type: 'email', required: true }] },
    successMessage: 'Da nhan.',
  })
  // exportSubmissions has always taken this and the route never passed it.
  const filtered = (await call(db, 'website_form.exportSubmissions', {
    formId: 'f1',
    fields: ['email'],
    status: 'purged',
    reason: 'test',
  })) as { ok?: boolean; rows?: unknown[] }
  assert.equal(filtered.ok, true)
  assert.deepEqual(filtered.rows, [], 'nothing is purged yet, so nothing is exported')
})

/**
 * `entryIds` has been on preflightPublication since it was written and nothing
 * passed it, so the only question the screen could ask was "every page", which
 * is the one that hits the scan ceiling and can then only answer "ask again by
 * id".
 */
test('preflight: the published set is a question with a definite answer', async () => {
  const db = await boot()
  await call(db, 'website.saveSite', { ...site })
  const layout = [{ type: 'website.rich_text', settings: { body: 'x' } }]
  for (const id of ['live', 'draft']) {
    await call(db, 'website.saveEntry', {
      id,
      siteId: 'site1',
      type: 'website.page',
      slug: id,
      path: `/${id}`,
      title: id,
      layout,
    })
  }
  await call(db, 'website.publishEntry', { id: 'live' })

  const whole = (await call(db, 'website.preflightPublication', { siteId: 'site1' })) as {
    checked?: number
  }
  const only = (await call(db, 'website.preflightPublication', {
    siteId: 'site1',
    entryIds: ['live'],
  })) as { checked?: number; capped?: boolean; ok?: boolean }
  assert.equal(whole.checked, 2)
  assert.equal(only.checked, 1)
  assert.equal(only.capped, false, 'a named set is never a partial scan')
  assert.equal(only.ok, true)
})
