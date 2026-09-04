import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website, websiteForm } from '@ketvietlab/ketsuite'

/**
 * The upgrade path for form schema versioning.
 *
 * `schemaVersion` was added to tables that already hold rows in every deployment
 * that ran the previous version. Those rows have no value for it, so the whole
 * feature rests on one claim: absent reads as version 1, everywhere, without a
 * backfill step someone has to remember to run.
 */

const SCOPE = { company: 'acme', branches: null }
const modules = [address, partner, website, websiteForm, paperTheme]
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

const oneField = { fields: [{ name: 'email', type: 'email', required: true }] }
const twoFields = {
  fields: [
    { name: 'email', type: 'email', required: true },
    { name: 'company', type: 'text', required: true },
  ],
}

/** A row as the previous release would have written it: no schemaVersion column value. */
const seedLegacyForm = async (db: Adapter) => {
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  await callFn(
    'website_form.saveForm',
    { id: 'f1', siteId: 'site1', name: 'Liên hệ', schema: oneField, successMessage: 'Đã nhận.' },
    { adapter: db, manifest, scope: SCOPE },
  )
  // Clear the column the way a row written by the previous release actually
  // looks. Raw SQL on purpose: no function can produce this state any more, and
  // the upgrade path is exactly the state no function can produce.
  await db.run(
    `UPDATE ${db.quoteIdent('website_form_form')} SET ${db.quoteIdent('schemaVersion')} = NULL WHERE ${db.quoteIdent('id')} = ?`,
    ['f1'],
  )
}

test('form upgrade: migrating twice is a no-op', async () => {
  const db = await boot()
  await migrateOne(db, manifest)
  const site = await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  assert.equal((site as { ok?: boolean }).ok, true, 'the schema still works after a repeat migration')
})

test('form upgrade: a row written before versioning reads as version 1', async () => {
  const db = await boot()
  await seedLegacyForm(db)
  const form = (await call(db, 'website_form.getForm', { id: 'f1' })) as { schemaVersion: number }
  assert.equal(form.schemaVersion, 1)
})

test('form upgrade: a legacy form accepts a submission declaring version 1', async () => {
  const db = await boot()
  await seedLegacyForm(db)
  const accepted = (await call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload: { email: 'mai@example.test' },
    schemaVersion: 1,
  })) as { ok?: boolean }
  assert.equal(accepted.ok, true)
})

test('form upgrade: changing a legacy form advances it to version 2, not back to 1', async () => {
  const db = await boot()
  await seedLegacyForm(db)
  await call(db, 'website_form.saveForm', {
    id: 'f1',
    siteId: 'site1',
    name: 'Liên hệ',
    schema: twoFields,
    successMessage: 'Đã nhận.',
  })
  const form = (await call(db, 'website_form.getForm', { id: 'f1' })) as { schemaVersion: number }
  assert.equal(form.schemaVersion, 2, 'two different contracts must never share a version number')

  // And the page that was open against the legacy contract is now stale.
  const stale = (await call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload: { email: 'mai@example.test' },
    schemaVersion: 1,
  })) as { ok?: boolean; errors?: Array<{ message: string }> }
  assert.equal(stale.ok, false)
  assert.equal(stale.errors?.[0]?.message, 'website_form.error.staleForm')
})

test('form upgrade: re-saving a legacy form unchanged backfills version 1 rather than bumping', async () => {
  const db = await boot()
  await seedLegacyForm(db)
  await call(db, 'website_form.saveForm', {
    id: 'f1',
    siteId: 'site1',
    name: 'Liên hệ mới',
    schema: oneField,
    successMessage: 'Đã nhận.',
  })
  const form = (await call(db, 'website_form.getForm', { id: 'f1' })) as { schemaVersion: number }
  assert.equal(form.schemaVersion, 1, 'renaming a form does not invalidate pages open against it')
})
