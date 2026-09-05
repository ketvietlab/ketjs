import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  callFn,
  compose,
  createTheme,
  defineModule,
  defineTheme,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
  validateLayout,
} from '@ketvietlab/ketjs'
import type { Adapter, Manifest, Placement } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website } from '@ketvietlab/ketsuite'

const SCOPE = { company: 'acme', branches: null }
const modules = [address, partner, website, paperTheme]
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

type Saved = { ok?: boolean; revisionId?: string; errors?: Array<{ message: string; path?: string }> }
type Change = { id: string; change: string; path: string; from?: string; fields?: string[] }

const text = (body: string): Placement => ({ type: 'website.rich_text', settings: { body } })
const columns = (left: Placement[], right: Placement[] = []): Placement => ({
  type: 'website.columns',
  settings: {},
  slots: { left, right },
})

const seedSite = (db: Adapter) =>
  call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Moc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })

const save = async (db: Adapter, layout: Placement[], extra: Record<string, unknown> = {}) =>
  (await call(db, 'website.saveEntry', {
    id: 'p1',
    siteId: 'site1',
    type: 'website.page',
    slug: 'trang',
    path: '/trang',
    title: 'Trang',
    layout,
    fields: {},
    ...extra,
  })) as Saved

const storedLayout = async (db: Adapter): Promise<Placement[]> => {
  const got = (await call(db, 'website.getEntry', { id: 'p1' })) as {
    revision?: { layout?: Placement[] | string }
  } | null
  const raw = got?.revision?.layout
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  return Array.isArray(parsed) ? (parsed as Placement[]) : []
}

/** A manifest with an accepts rule, which no shipped section declares yet. */
const strictManifest = (): Manifest => {
  const strict = defineModule({
    name: 'strict_sections',
    depends: ['website'],
    sections: {
      'strict.only_text': {
        title: 'Chi nhan van ban',
        settings: {},
        slots: { body: { accepts: ['website.rich_text'], max: 2 } },
      },
    },
  })
  const theme = defineTheme({
    name: 'theme_strict_test',
    depends: ['website', 'strict_sections'],
    templates: {
      layout: '<html><body>{% region "website.page" %}</body></html>',
      'website.page': '<main>{% sections %}</main>',
      'website.hero': '<h1>{{ heading }}</h1>',
      'website.rich_text': '<p>{{ body }}</p>',
      'website.columns': '<div>{% slot "left" %}{% slot "right" %}</div>',
      'strict.only_text': '<div class="strict">{% slot "body" %}</div>',
    },
  })
  return compose([address, partner, website, strict, theme])
}

test('nesting: a section holds sections, and the theme draws them where the slot is', async () => {
  const db = await boot()
  await seedSite(db)
  assert.equal((await save(db, [columns([text('Ben trai')], [text('Ben phai')])])).ok, true)

  // Rendered from what was stored, not from what the test built, so the test
  // covers the round trip through the save that assigns ids.
  const theme = createTheme(manifest, modules)
  const html = theme.renderRegion('website.page', {
    sections: await storedLayout(db),
    page: { path: '/trang', title: 'Trang' },
  })

  assert.match(html, /col-left[\s\S]*?Ben trai[\s\S]*?col-right[\s\S]*?Ben phai/u)
  assert.equal(html.includes('Ben trai'), true)
  // The children are drawn where the slot is, not appended after the container.
  assert.ok(html.indexOf('Ben trai') < html.indexOf('col-right'), 'the left column holds the left child')
})

test('nesting: an empty slot leaves no trace in the markup', () => {
  const theme = createTheme(manifest, modules)
  const html = theme.renderRegion('website.page', {
    sections: [columns([], [])],
    page: { path: '/trang', title: 'Trang' },
  })
  assert.match(html, /col-left"><\/div>/u, 'an empty column renders as an empty column')
})

test('nesting: an empty slot draws nothing rather than failing', () => {
  const check = validateLayout(manifest, [columns([], [])])
  assert.equal(check.ok, true, 'a container being built out is an ordinary state of a page')
})

test('nesting: a slot the section never declared is refused', async () => {
  const db = await boot()
  await seedSite(db)
  const refused = await save(db, [
    { type: 'website.columns', settings: {}, slots: { middle: [text('Sai cho')] } },
  ])
  assert.equal(refused.ok, false)
  assert.match(String(refused.errors?.[0]?.message), /is not a slot of this section/u)
})

test('nesting: a slot says which sections it accepts, and refuses the rest', () => {
  const strict = strictManifest()
  const allowed = validateLayout(strict, [
    { type: 'strict.only_text', settings: {}, slots: { body: [text('Duoc')] } },
  ])
  assert.equal(allowed.ok, true)

  const refused = validateLayout(strict, [
    {
      type: 'strict.only_text',
      settings: {},
      slots: { body: [{ type: 'website.hero', settings: { heading: 'Khong duoc' } }] },
    },
  ])
  assert.equal(refused.ok, false)
  assert.match(String(refused.errors[0]?.message), /is not accepted by slot "body"/u)
  assert.equal(refused.errors[0]?.path, '0.body.0')
})

test('nesting: a slot that is full refuses the next one', () => {
  const strict = strictManifest()
  const refused = validateLayout(strict, [
    { type: 'strict.only_text', settings: {}, slots: { body: [text('a'), text('b'), text('c')] } },
  ])
  assert.equal(refused.ok, false)
  assert.match(String(refused.errors[0]?.message), /this slot takes 2/u)
})

test('nesting: a page is bounded by how many sections it holds, not by its top level', () => {
  const many = Array.from({ length: 60 }, (_, n) => text(`p${n}`))
  const nested = [columns(many.slice(0, 20), many.slice(20, 40)), ...many.slice(40)]
  assert.equal(validateLayout(manifest, nested).ok, true, '63 nodes is a page')

  const overflowing = Array.from({ length: 50 }, () => columns([text('a')], [text('b')]))
  const check = validateLayout(manifest, overflowing)
  assert.equal(check.ok, false, '150 nodes is not')
  assert.match(String(check.errors[0]?.message), /a page may hold 100/u)
})

test('nesting: a tree deeper than the ceiling is refused', () => {
  let deep: Placement = text('day')
  for (let level = 0; level < 8; level += 1) deep = columns([deep])
  const check = validateLayout(manifest, [deep])
  assert.equal(check.ok, false)
  assert.ok(
    check.errors.some((error) => /nests deeper than 6 levels/u.test(error.message)),
    'the refusal names the ceiling',
  )
})

test('nesting: an unknown section inside a slot is caught like one at the top', () => {
  const check = validateLayout(manifest, [
    { type: 'website.columns', settings: {}, slots: { left: [{ type: 'website.ghost', settings: {} }] } },
  ])
  assert.equal(check.ok, false)
  assert.match(String(check.errors[0]?.message), /no composed module provides this section/u)
  assert.equal(check.errors[0]?.path, '0.left.0')
})

test('nesting: children get ids too, and no two share one', async () => {
  const db = await boot()
  await seedSite(db)
  await save(db, [columns([text('mot'), text('hai')], [text('ba')])])
  const stored = await storedLayout(db)

  const ids: string[] = []
  const collect = (layout: Placement[]) => {
    for (const placement of layout) {
      ids.push(String((placement as { id?: string }).id))
      for (const children of Object.values(placement.slots ?? {})) collect(children)
    }
  }
  collect(stored)
  assert.equal(ids.length, 4, 'the container and its three children')
  for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{8,64}$/)
  assert.equal(new Set(ids).size, ids.length, 'identity is unique across the tree, not per level')
})

test('nesting: the same id at two depths is refused', async () => {
  const db = await boot()
  await seedSite(db)
  const refused = await save(db, [
    {
      type: 'website.columns',
      settings: {},
      id: 'shared-identity',
      slots: { left: [{ ...text('con'), id: 'shared-identity' }] },
    },
  ])
  assert.equal(refused.ok, false)
  assert.match(String(refused.errors?.[0]?.message), /already used/u)
})

test('nesting: a change deep in a subtree is reported on the node that changed', async () => {
  const db = await boot()
  await seedSite(db)
  const first = await save(db, [columns([text('cu')], [text('giu nguyen')])])
  const stored = await storedLayout(db)

  const container = stored[0] as Placement
  const edited: Placement = {
    ...container,
    slots: {
      left: [{ ...(container.slots?.left?.[0] as Placement), settings: { body: 'moi' } }],
      right: container.slots?.right ?? [],
    },
  }
  const second = await save(db, [edited], { expectedRevisionId: first.revisionId })

  const diff = (await call(db, 'website.diffRevisions', {
    entryId: 'p1',
    fromRevisionId: first.revisionId,
    toRevisionId: second.revisionId,
  })) as { ok: boolean; changes: Change[] }

  assert.equal(diff.ok, true)
  assert.deepEqual(
    diff.changes.map((change) => [change.path, change.change, change.fields]),
    [['0.left.0', 'settings', ['body']]],
    'the container did not change; its child did',
  )
})

test('nesting: dragging a child to the other slot reads as one move', async () => {
  const db = await boot()
  await seedSite(db)
  const first = await save(db, [columns([text('di chuyen')], [])])
  const stored = await storedLayout(db)
  const container = stored[0] as Placement
  const child = container.slots?.left?.[0] as Placement

  const moved: Placement = { ...container, slots: { left: [], right: [child] } }
  const second = await save(db, [moved], { expectedRevisionId: first.revisionId })

  const diff = (await call(db, 'website.diffRevisions', {
    entryId: 'p1',
    fromRevisionId: first.revisionId,
    toRevisionId: second.revisionId,
  })) as { ok: boolean; changes: Change[] }

  assert.deepEqual(
    diff.changes.map((change) => change.change),
    ['moved'],
    'one move, not a removal here and an arrival there',
  )
  assert.equal(diff.changes[0]?.from, '0.left.0')
  assert.equal(diff.changes[0]?.path, '0.right.0')
})
