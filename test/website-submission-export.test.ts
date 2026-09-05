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
  websiteBackend,
  websiteForm,
  websiteMenu,
  websiteSeo,
} from '@ketvietlab/ketsuite'
import { csvCell, csvOf, safeFilename } from '../packages/ketsuite/src/modules/website_backend/csv.ts'

const SCOPE = { company: 'acme', branches: null }
const modules = [
  address,
  partner,
  company,
  storage,
  backend,
  website,
  websiteMenu,
  websiteSeo,
  websiteForm,
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

const seed = async (db: Adapter) => {
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Moc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  await call(db, 'website_form.saveForm', {
    id: 'f1',
    siteId: 'site1',
    name: 'Lien he',
    schema: {
      fields: [
        { name: 'email', type: 'email', required: true },
        { name: 'note', type: 'textarea' },
      ],
    },
    successMessage: 'Da nhan.',
  })
}

const submit = (db: Adapter, payload: Record<string, unknown>, key: string) =>
  call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload,
    schemaVersion: 1,
    submissionKey: key,
  })

test('export: only the named fields leave, and the envelope keeps its own names', async () => {
  const db = await boot()
  await seed(db)
  await submit(db, { email: 'mai@example.test', note: 'Rieng tu' }, 'a')

  const out = (await call(db, 'website_form.exportSubmissions', {
    formId: 'f1',
    fields: ['email'],
  })) as { ok: boolean; rows: Array<Record<string, unknown>>; fields: string[] }
  assert.equal(out.ok, true)
  assert.deepEqual(out.fields, ['email'])
  assert.equal(out.rows[0]?.email, 'mai@example.test')
  assert.equal('note' in (out.rows[0] ?? {}), false, 'a field nobody asked for does not travel')
  assert.deepEqual(Object.keys(out.rows[0] ?? {}).sort(), ['_createdAt', '_id', '_status', 'email'])
})

test('export: the audit says which fields left and how many rows', async () => {
  const db = await boot()
  await seed(db)
  await submit(db, { email: 'mai@example.test' }, 'a')
  await submit(db, { email: 'lan@example.test' }, 'b')
  await call(db, 'website_form.exportSubmissions', {
    formId: 'f1',
    fields: ['email'],
    reason: 'admin.export',
  })

  const audit = (await call(db, 'website_form.listSubmissionAudit', { formId: 'f1' })) as Array<{
    action: string
    fields: string[]
    rowCount: number
    reason: string | null
  }>
  const record = audit.find((entry) => entry.action === 'export')
  assert.deepEqual(record?.fields, ['email'])
  assert.equal(record?.rowCount, 2)
  assert.equal(record?.reason, 'admin.export')
})

/**
 * Escaping the delimiter is not the interesting half. A cell that begins with
 * an operator is executed by every spreadsheet there is, and every value in
 * this file was typed into a public form by somebody we have never met.
 */
test('csv: a value a spreadsheet would execute is carried as text', () => {
  for (const attack of ['=1+1', '+1', '-1', '@SUM(A1)', '=HYPERLINK("http://x","click")']) {
    const cell = csvCell(attack)
    const defused = cell.startsWith("'") || cell.startsWith('"\'')
    assert.equal(defused, true, `${attack} must not reach a spreadsheet as a formula`)
  }
})

test('csv: ordinary text is left exactly as it was typed', () => {
  assert.equal(csvCell('mai@example.test'), 'mai@example.test')
  assert.equal(csvCell('Can bao gia'), 'Can bao gia')
  assert.equal(csvCell(null), '')
})

test('csv: a delimiter, a quote or a newline is quoted rather than breaking the row', () => {
  assert.equal(csvCell('Ha Noi, Viet Nam'), '"Ha Noi, Viet Nam"')
  assert.equal(csvCell('noi "the" nay'), '"noi ""the"" nay"')
  assert.equal(csvCell('hai\ndong'), '"hai\ndong"')
})

test('csv: the file is a header row and one row per record, in column order', () => {
  assert.equal(
    csvOf(['_id', 'email'], [{ _id: 's1', email: 'mai@example.test' }]),
    '_id,email\r\ns1,mai@example.test',
  )
})

test('csv: a filename keeps only what a browser and a person can both read', () => {
  assert.equal(safeFilename('form 1/../etc'), 'form-1-..-etc')
  assert.equal(safeFilename('///'), 'export')
})

test('export: the routes exist, so the functions are reachable at all', () => {
  for (const route of [
    '/admin/website/forms/{id}/submissions/export',
    '/admin/website/forms/{id}/submissions/purge',
    '/admin/website/forms/{id}/submissions/{submissionId}',
  ])
    assert.ok(manifest.routes[route], `${route} must be composed`)
})
