import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
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

type Placement = { id?: string; type: string; settings?: Record<string, unknown> }
type Saved = {
  ok?: boolean
  revisionId?: string
  errors?: Array<{ field?: string; message: string }>
  conflict?: { expectedRevisionId: string; headRevisionId: string; changes: Change[] } | null
}
type Change = {
  id: string
  type: string
  change: string
  at: number
  from?: number | string
  fields?: string[]
}
type Diff = { ok: boolean; changes: Change[]; identified: boolean; fromVersion: number; toVersion: number }

const hero = (heading: string): Placement => ({ type: 'website.hero', settings: { heading } })
const text = (body: string): Placement => ({ type: 'website.rich_text', settings: { body } })

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
    slug: 'gioi-thieu',
    path: '/gioi-thieu',
    title: 'Gioi thieu',
    layout,
    fields: {},
    ...extra,
  })) as Saved

const layoutAt = async (db: Adapter, revisionId: string): Promise<Placement[]> => {
  const rows = (await call(db, 'website.listRevisions', { entryId: 'p1' })) as Array<{ id: string }>
  assert.ok(
    rows.some((row) => row.id === revisionId),
    'the revision under test is the one the entry now points at',
  )
  const got = (await call(db, 'website.getEntry', { id: 'p1' })) as {
    revision?: { layout?: Placement[] | string }
  } | null
  const raw = got?.revision?.layout
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw
  return Array.isArray(parsed) ? (parsed as Placement[]) : []
}

test('layout: a save gives every placement an id, and keeps the one it is given', async () => {
  const db = await boot()
  await seedSite(db)
  const first = await save(db, [hero('Xin chao'), text('Noi dung')])
  assert.equal(first.ok, true)

  const stored = await layoutAt(db, String(first.revisionId))
  assert.equal(stored.length, 2)
  for (const placement of stored) assert.match(String(placement.id), /^[A-Za-z0-9_-]{8,64}$/)

  // An id the caller supplies is authoritative: identity is the client's to
  // keep across a session, and rewriting it here would break every undo.
  const mine = [{ ...hero('Xin chao'), id: 'chosen-by-client' }]
  const second = await save(db, mine, { expectedRevisionId: first.revisionId })
  const after = await layoutAt(db, String(second.revisionId))
  assert.equal(after[0]?.id, 'chosen-by-client')
})

test('layout: an id is derived from what the section says, not from where it sits', async () => {
  const db = await boot()
  await seedSite(db)
  const forwards = await save(db, [hero('A'), text('B')])
  const before = await layoutAt(db, String(forwards.revisionId))

  const other = await boot()
  await seedSite(other)
  // The same two sections, saved in the other order, out of a second database
  // that shares nothing with the first.
  const backwards = await save(other, [text('B'), hero('A')])
  const after = await layoutAt(other, String(backwards.revisionId))

  const idOf = (layout: Placement[], type: string) => layout.find((p) => p.type === type)?.id
  assert.equal(idOf(before, 'website.hero'), idOf(after, 'website.hero'))
  assert.equal(idOf(before, 'website.rich_text'), idOf(after, 'website.rich_text'))
})

test('layout: two identical sections still get separate ids', async () => {
  const db = await boot()
  await seedSite(db)
  const saved = await save(db, [text('Giong nhau'), text('Giong nhau')])
  const stored = await layoutAt(db, String(saved.revisionId))
  assert.equal(stored.length, 2)
  assert.notEqual(stored[0]?.id, stored[1]?.id, 'two rows, two identities')
})

test('layout: the same id twice is refused rather than resolved by guessing', async () => {
  const db = await boot()
  await seedSite(db)
  const refused = await save(db, [
    { ...hero('Mot'), id: 'same-id-here' },
    { ...text('Hai'), id: 'same-id-here' },
  ])
  assert.equal(refused.ok, false)
  assert.match(String(refused.errors?.[0]?.message), /already used/u)
})

test('layout: an id that is not an id is refused', async () => {
  const db = await boot()
  await seedSite(db)
  const refused = await save(db, [{ ...hero('Mot'), id: 'no spaces allowed' }])
  assert.equal(refused.ok, false)
  assert.match(String(refused.errors?.[0]?.message), /not a placement id/u)
})

test('layout: a reorder reads as a move, not as a deletion and an insertion', async () => {
  const db = await boot()
  await seedSite(db)
  const first = await save(db, [hero('A'), text('B')])
  const stored = await layoutAt(db, String(first.revisionId))

  const second = await save(db, [stored[1] as Placement, stored[0] as Placement], {
    expectedRevisionId: first.revisionId,
  })
  const diff = (await call(db, 'website.diffRevisions', {
    entryId: 'p1',
    fromRevisionId: first.revisionId,
    toRevisionId: second.revisionId,
  })) as Diff

  assert.equal(diff.ok, true)
  assert.equal(diff.identified, true)
  assert.deepEqual(
    diff.changes.map((change) => change.change).sort(),
    ['moved', 'moved'],
    'both moved; nothing was added or removed',
  )
})

test('layout: a diff names the settings that changed, and the sections that came and went', async () => {
  const db = await boot()
  await seedSite(db)
  const first = await save(db, [hero('Cu'), text('Giu nguyen')])
  const stored = await layoutAt(db, String(first.revisionId))
  const edited = [
    { ...(stored[0] as Placement), settings: { heading: 'Moi' } },
    stored[1] as Placement,
    text('Them vao'),
  ]
  const second = await save(db, edited, { expectedRevisionId: first.revisionId })

  const diff = (await call(db, 'website.diffRevisions', {
    entryId: 'p1',
    fromRevisionId: first.revisionId,
    toRevisionId: second.revisionId,
  })) as Diff
  const byChange = Object.fromEntries(diff.changes.map((change) => [change.change, change]))
  assert.deepEqual(byChange.settings?.fields, ['heading'])
  assert.equal(byChange.added?.at, 2)
  assert.equal(
    diff.changes.some((change) => change.change === 'removed'),
    false,
  )
})

test('layout: a section that changed type is reported as retyped, never as an edit', async () => {
  const db = await boot()
  await seedSite(db)
  const first = await save(db, [hero('Chao')])
  const stored = await layoutAt(db, String(first.revisionId))
  const second = await save(
    db,
    [{ id: stored[0]?.id, type: 'website.rich_text', settings: { body: 'Chao' } }],
    {
      expectedRevisionId: first.revisionId,
    },
  )

  const diff = (await call(db, 'website.diffRevisions', {
    entryId: 'p1',
    fromRevisionId: first.revisionId,
    toRevisionId: second.revisionId,
  })) as Diff
  const change = diff.changes[0]
  assert.equal(change?.change, 'retyped')
  assert.equal(change?.from, 'website.hero')
  assert.equal(change?.type, 'website.rich_text')
})

test('layout: a refused save says what it conflicted with', async () => {
  const db = await boot()
  await seedSite(db)
  const first = await save(db, [hero('A'), text('B')])
  const stored = await layoutAt(db, String(first.revisionId))

  // Someone else saves in the meantime.
  await save(db, [stored[0] as Placement], { expectedRevisionId: first.revisionId })

  const refused = await save(db, [stored[1] as Placement, stored[0] as Placement], {
    expectedRevisionId: first.revisionId,
  })
  assert.equal(refused.ok, false)
  assert.equal(refused.errors?.[0]?.message, 'website.error.editConflict')
  assert.ok(refused.conflict, 'a refusal that leaves the editor to find the difference by eye is not enough')
  assert.equal(refused.conflict?.expectedRevisionId, first.revisionId)
  assert.deepEqual(
    refused.conflict?.changes.map((change) => change.change),
    ['removed'],
    'the other save dropped a section, and the report says so',
  )
})

test('layout: restoring an old revision leaves identified placements behind', async () => {
  const db = await boot()
  await seedSite(db)
  const first = await save(db, [hero('A'), text('B')])
  const stored = await layoutAt(db, String(first.revisionId))
  const second = await save(db, [stored[0] as Placement], { expectedRevisionId: first.revisionId })

  const restored = (await call(db, 'website.restoreRevision', {
    entryId: 'p1',
    revisionId: first.revisionId,
  })) as Saved
  assert.equal(restored.ok, true)

  const back = await layoutAt(db, String(restored.revisionId))
  assert.deepEqual(
    back.map((placement) => placement.id),
    stored.map((placement) => placement.id),
    'a restore brings the identities back with the content',
  )

  const diff = (await call(db, 'website.diffRevisions', {
    entryId: 'p1',
    fromRevisionId: second.revisionId,
    toRevisionId: restored.revisionId,
  })) as Diff
  assert.deepEqual(
    diff.changes.map((change) => change.change),
    ['added'],
  )
})

test('layout: a revision belonging to another page is not comparable', async () => {
  const db = await boot()
  await seedSite(db)
  const mine = await save(db, [hero('A')])
  const theirs = (await call(db, 'website.saveEntry', {
    id: 'p2',
    siteId: 'site1',
    type: 'website.page',
    slug: 'khac',
    path: '/khac',
    title: 'Khac',
    layout: [hero('B')],
    fields: {},
  })) as Saved

  // A revision id must not be a way to read another page's history.
  const refused = (await call(db, 'website.diffRevisions', {
    entryId: 'p1',
    fromRevisionId: mine.revisionId,
    toRevisionId: theirs.revisionId,
  })) as Saved
  assert.equal(refused.ok, false)
  assert.equal(refused.errors?.[0]?.message, 'website.error.revisionNotFound')
})
