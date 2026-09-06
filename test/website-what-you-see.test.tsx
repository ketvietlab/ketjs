import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, Translator } from '@ketvietlab/ketjs'
import { renderToString } from '@ketvietlab/ketjs-view'
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
import {
  formsScreen,
  type FormRow,
  preflightScreen,
  type SiteRow,
  sitesScreen,
  submissionsScreen,
  type SubmissionRow,
} from '../packages/ketsuite/src/modules/website_backend/screens/index.tsx'

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

const translate = ((key: string) => key) as Translator
translate.locale = 'en'
translate.has = () => true
translate.resolves = () => true

const site: SiteRow = {
  id: 'site1',
  name: 'moc',
  title: 'Moc',
  defaultLocale: 'vi',
  theme: 'theme_paper',
  active: true,
}

/**
 * The list filtered by status and the export ignored it, so narrowing the
 * screen to the rows you meant and pressing Export handed you every row the
 * form has ever taken.
 */
test('export: the download carries the filter the screen is showing', () => {
  const rows: SubmissionRow[] = [
    {
      id: 's1',
      formId: 'f1',
      summary: {},
      consent: true,
      status: 'new',
      createdAt: '2026-09-01T00:00:00.000Z',
      held: false,
    },
  ]
  const scoped = renderToString(
    submissionsScreen(translate, rows, {}, { formId: 'f1', fields: ['email'], status: 'purged' }),
  )
  assert.match(scoped, /name="status" value="purged"/u)
  assert.match(scoped, /submissions\.exportScoped/u)

  // Unfiltered, the export says nothing extra: there is nothing to warn about.
  const all = renderToString(
    submissionsScreen(translate, rows, {}, { formId: 'f1', fields: ['email'], status: 'all' }),
  )
  assert.match(all, /name="status" value="all"/u)
  assert.equal(all.includes('submissions.exportScoped'), false)
})

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

test('sites: a suspended site is not the same as a live one, and the list can say so', () => {
  const html = renderToString(sitesScreen(translate, [site], {}, '', 'inactive'))
  assert.match(html, /\/admin\/website\/sites\?state=active/u)
  assert.match(html, /\/admin\/website\/sites\?state=inactive/u)
  assert.match(html, /\/admin\/website\/sites\?state=all/u)
})

test('forms: the same three, carrying the site they belong to', () => {
  const rows: FormRow[] = [{ id: 'f1', name: 'Lien he', active: true }]
  const html = renderToString(formsScreen(translate, rows, 'site1', {}, '', 'active'))
  // `&` arrives escaped, which is the renderer doing its job.
  assert.match(html, /\/admin\/website\/forms\?site=site1&amp;state=inactive/u)
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

test('preflight screen: both questions are offered, and the current one is marked', () => {
  const html = renderToString(
    preflightScreen(
      translate,
      { ok: true, checked: 3, capped: false, unrenderable: [] },
      'site1',
      {},
      '',
      'published',
    ),
  )
  assert.match(html, /scope=all/u)
  assert.match(html, /scope=published/u)
  assert.match(html, /preflight\.scopePublished/u)
})
