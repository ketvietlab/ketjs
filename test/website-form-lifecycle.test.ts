import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website, websiteForm } from '@ketvietlab/ketsuite'

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
const callAs = async (db: Adapter, actor: string, name: string, input: Record<string, unknown>) =>
  (await callFn(name, input, { adapter: db, manifest, scope: SCOPE, actor })).value

type Saved = { ok?: boolean; id?: string; errors?: Array<{ field: string; message: string }> }
type Listed = {
  id: string
  summary: Record<string, unknown>
  status: string
  held: boolean
  purgedAt: string | null
}

const schema = {
  fields: [
    { name: 'email', type: 'email', required: true },
    { name: 'message', type: 'textarea' },
    { name: 'company', type: 'text' },
  ],
}

const seed = async (db: Adapter, form: Record<string, unknown> = {}) => {
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  await call(db, 'website_form.saveForm', {
    id: 'f1',
    siteId: 'site1',
    name: 'Liên hệ',
    schema,
    successMessage: 'Đã nhận.',
    ...form,
  })
  // An actor with no membership has no role, so the administrator every test
  // below acts as has to exist as one.
  await call(db, 'website.saveSiteMember', {
    id: 'boss-member',
    siteId: 'site1',
    userId: 'boss',
    role: 'administrator',
  })
}

const submit = async (db: Adapter, payload: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  (await call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload,
    schemaVersion: 1,
    ...extra,
  })) as Saved

/**
 * Rows written a while ago.
 *
 * `submitForm` stamps the clock it runs on, and retention is measured against
 * that stamp, so a test about a window has to move one of the two. Moving the
 * rows is the honest half: the alternative is a fake clock threaded through
 * three call sites that production never uses.
 */
const backdate = async (db: Adapter, days: number) => {
  const at = new Date(Date.now() - days * 86_400_000).toISOString()
  await db.run('UPDATE website_form_form_submission SET "createdAt" = ?', [at])
}

const listed = async (db: Adapter): Promise<Listed[]> =>
  (await call(db, 'website_form.listSubmissions', { formId: 'f1' })) as Listed[]

test('form: taking a site down takes its forms down with it', async () => {
  const db = await boot()
  await seed(db)
  assert.ok(await call(db, 'website_form.getForm', { id: 'f1' }), 'live to begin with')

  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc',
    defaultLocale: 'vi',
    theme: 'theme_paper',
    active: false,
  })

  // The page a visitor already has open is exactly the case: the site is gone
  // and the submit button used to keep working.
  assert.equal(await call(db, 'website_form.getForm', { id: 'f1' }), null)
  const refused = await submit(db, { email: 'mai@example.test' })
  assert.equal(refused.ok, false)
  assert.equal(refused.errors?.[0]?.message, 'website_form.error.unavailable')
  assert.equal((await listed(db)).length, 0, 'and nothing was stored')
})

test('form: the worklist carries no answers unless the form says which are safe', async () => {
  const db = await boot()
  await seed(db)
  await submit(db, { email: 'mai@example.test', message: 'Cần báo giá', company: 'Mộc Lâm' })

  const before = await listed(db)
  assert.equal(before.length, 1)
  assert.deepEqual(before[0]?.summary, {}, 'nothing is previewable by default')

  await call(db, 'website_form.saveForm', {
    id: 'f1',
    siteId: 'site1',
    name: 'Liên hệ',
    schema,
    successMessage: 'Đã nhận.',
    summaryFields: ['company'],
  })
  const after = await listed(db)
  assert.deepEqual(after[0]?.summary, { company: 'Mộc Lâm' }, 'and only what was named')
})

test('form: declaring a preview field the form does not ask is refused, not dropped', async () => {
  const db = await boot()
  await seed(db)
  const refused = (await call(db, 'website_form.saveForm', {
    id: 'f1',
    siteId: 'site1',
    name: 'Liên hệ',
    schema,
    successMessage: 'Đã nhận.',
    summaryFields: ['telephone'],
  })) as Saved
  assert.equal(refused.ok, false)
  assert.equal(refused.errors?.[0]?.message, 'website_form.error.unknownSummaryField')
})

test('form: a save that does not mention retention leaves it alone', async () => {
  const db = await boot()
  await seed(db, { retentionDays: 30, summaryFields: ['company'] })
  await call(db, 'website_form.saveForm', {
    id: 'f1',
    siteId: 'site1',
    name: 'Liên hệ',
    schema,
    successMessage: 'Đã nhận nhé.',
  })
  const forms = (await call(db, 'website_form.listForms', { siteId: 'site1' })) as Array<{
    retentionDays: number | null
    summaryFields: unknown
  }>
  assert.equal(forms[0]?.retentionDays, 30, 'the screen that edits fields must not clear it')
  assert.deepEqual(forms[0]?.summaryFields, ['company'])
})

test('form: retention outside a decade of days is refused', async () => {
  const db = await boot()
  await seed(db)
  for (const retentionDays of [0, -5, 4_000]) {
    const refused = (await call(db, 'website_form.saveForm', {
      id: 'f1',
      siteId: 'site1',
      name: 'Liên hệ',
      schema,
      successMessage: 'Đã nhận.',
      retentionDays,
    })) as Saved
    assert.equal(refused.ok, false, `${retentionDays} is not a retention window`)
    assert.equal(refused.errors?.[0]?.message, 'website_form.error.invalidRetention')
  }
  // Half a day never reaches the handler: `int?` is refused at the input layer,
  // which is the earlier and better place to say so.
  await assert.rejects(
    call(db, 'website_form.saveForm', {
      id: 'f1',
      siteId: 'site1',
      name: 'Liên hệ',
      schema,
      successMessage: 'Đã nhận.',
      retentionDays: 1.5,
    }),
    /integer/,
  )
})

test('form: opening one record hands over the answers and writes down who looked', async () => {
  const db = await boot()
  await seed(db)
  await submit(db, { email: 'mai@example.test', message: 'Cần báo giá' })
  const [row] = await listed(db)

  const record = (await callAs(db, 'boss', 'website_form.readSubmission', {
    id: row?.id,
    reason: 'trả lời khách',
  })) as { payload: Record<string, unknown> } | null
  assert.equal(record?.payload.email, 'mai@example.test')

  const audit = (await call(db, 'website_form.listSubmissionAudit', { formId: 'f1' })) as Array<{
    action: string
    actorKey: string
    submissionId: string
    reason: string | null
  }>
  assert.equal(audit.length, 1)
  assert.equal(audit[0]?.action, 'read')
  assert.equal(audit[0]?.actorKey, 'boss')
  assert.equal(audit[0]?.submissionId, row?.id)
  assert.equal(audit[0]?.reason, 'trả lời khách')
})

test('form: an editor works the queue but cannot open a record', async () => {
  const db = await boot()
  await seed(db)
  await submit(db, { email: 'mai@example.test', message: 'Cần báo giá' })
  const [row] = await listed(db)
  await call(db, 'website.saveSiteMember', {
    id: 'm1',
    siteId: 'site1',
    userId: 'editor-1',
    role: 'editor',
  })

  const queue = (await callAs(db, 'editor-1', 'website_form.listSubmissions', {
    formId: 'f1',
  })) as Listed[]
  assert.equal(queue.length, 1, 'the queue is workable')
  assert.deepEqual(queue[0]?.summary, {})

  // Refused the same way a missing row is refused, so the answer does not
  // confirm that this submission exists.
  assert.equal(await callAs(db, 'editor-1', 'website_form.readSubmission', { id: row?.id }), null)
  assert.deepEqual(await callAs(db, 'editor-1', 'website_form.listSubmissionAudit', { formId: 'f1' }), [])
})

test('form: an export names its fields, and the record says exactly what left', async () => {
  const db = await boot()
  await seed(db)
  await submit(
    db,
    { email: 'mai@example.test', message: 'Bí mật', company: 'Mộc Lâm' },
    {
      submissionKey: 'a',
    },
  )
  await submit(
    db,
    { email: 'lan@example.test', message: 'Cũng bí mật', company: 'Lâm Mộc' },
    {
      submissionKey: 'b',
    },
  )

  const out = (await callAs(db, 'boss', 'website_form.exportSubmissions', {
    formId: 'f1',
    fields: ['email', 'company'],
    reason: 'gửi phòng kinh doanh',
  })) as { ok: boolean; rows: Array<Record<string, unknown>>; count: number; capped: boolean }
  assert.equal(out.ok, true)
  assert.equal(out.count, 2)
  assert.equal(out.capped, false)
  assert.deepEqual(Object.keys(out.rows[0] ?? {}).sort(), [
    '_createdAt',
    '_id',
    '_status',
    'company',
    'email',
  ])
  assert.equal('message' in (out.rows[0] ?? {}), false, 'a field nobody asked for does not travel')

  const audit = (await call(db, 'website_form.listSubmissionAudit', { formId: 'f1' })) as Array<{
    action: string
    fields: string[]
    rowCount: number
  }>
  const record = audit.find((entry) => entry.action === 'export')
  assert.deepEqual(record?.fields, ['email', 'company'])
  assert.equal(record?.rowCount, 2)
})

test('form: an export envelope cannot be overwritten by an answer', async () => {
  const db = await boot()
  // "status" is an ordinary thing to ask on a form, and it collides with the
  // column the export carries beside the answers.
  const colliding = {
    fields: [
      { name: 'email', type: 'email', required: true },
      { name: 'status', type: 'text' },
    ],
  }
  await seed(db, { schema: colliding })
  await submit(db, { email: 'mai@example.test', status: 'khách cũ' }, { submissionKey: 'a' })

  const out = (await callAs(db, 'boss', 'website_form.exportSubmissions', {
    formId: 'f1',
    fields: ['status'],
  })) as { rows: Array<Record<string, unknown>> }
  assert.equal(out.rows[0]?.status, 'khách cũ', "the visitor's answer is the answer")
  assert.equal(out.rows[0]?._status, 'new', 'and the row still says what state it is in')
})

test('form: an export cannot name a field the form does not ask', async () => {
  const db = await boot()
  await seed(db)
  const refused = (await callAs(db, 'boss', 'website_form.exportSubmissions', {
    formId: 'f1',
    fields: ['email', 'nationalId'],
  })) as Saved
  assert.equal(refused.ok, false)
  assert.equal(refused.errors?.[0]?.message, 'website_form.error.unknownField')
})

test('form: retention erases the answers and keeps the consent record', async () => {
  const db = await boot()
  await seed(db, { retentionDays: 30, consentText: 'Tôi đồng ý được liên hệ.' })
  await submit(
    db,
    { email: 'mai@example.test', message: 'Cần báo giá' },
    {
      consent: true,
      submissionKey: 'once',
    },
  )
  await backdate(db, 40)

  const swept = (await call(db, 'website_form.purgeSubmissions', { formId: 'f1' })) as {
    erased: number
    more: boolean
  }
  assert.equal(swept.erased, 1)
  assert.equal(swept.more, false)

  const [row] = await listed(db)
  assert.equal(row?.status, 'purged')
  assert.ok(row?.purgedAt, 'the row says when')

  const record = (await call(db, 'website_form.readSubmission', { id: row?.id })) as {
    payload: Record<string, unknown>
    consent: boolean
    consentText: string
    source: string | null
  }
  assert.deepEqual(record?.payload, {}, 'the answers are gone')
  assert.equal(record?.source, null, 'and so is where they came from')
  assert.equal(record?.consent, true, 'but the consent stands')
  assert.equal(record?.consentText, 'Tôi đồng ý được liên hệ.', 'and it can still say what was agreed to')
})

test('form: a replay after erasure is still recognised as the same submission', async () => {
  const db = await boot()
  await seed(db, { retentionDays: 30 })
  const first = await submit(db, { email: 'mai@example.test' }, { submissionKey: 'once' })
  await backdate(db, 40)
  await call(db, 'website_form.purgeSubmissions', { formId: 'f1' })

  // The reason the row survives its own erasure: deleting it would free the
  // dedupe key, and a client retrying a months-old request would be accepted
  // as new.
  const replay = await submit(db, { email: 'mai@example.test' }, { submissionKey: 'once' })
  assert.equal(replay.ok, true)
  assert.equal(replay.id, first.id)
  assert.equal((await listed(db)).length, 1, 'no second row')
})

test('form: a hold outlives the retention window, and releasing it does not erase', async () => {
  const db = await boot()
  await seed(db, { retentionDays: 30 })
  await submit(db, { email: 'mai@example.test' }, { submissionKey: 'a' })
  await submit(db, { email: 'lan@example.test' }, { submissionKey: 'b' })
  await backdate(db, 40)

  const rows = await listed(db)
  const kept = rows[0]
  await callAs(db, 'boss', 'website_form.holdSubmission', {
    id: kept?.id,
    reason: 'tranh chấp hợp đồng',
  })

  const swept = (await call(db, 'website_form.purgeSubmissions', { formId: 'f1' })) as {
    erased: number
  }
  assert.equal(swept.erased, 1, 'the other one went')
  const afterSweep = await listed(db)
  const survivor = afterSweep.find((row) => row.id === kept?.id)
  assert.equal(survivor?.held, true)
  assert.equal(survivor?.purgedAt, null)

  // Releasing a hold is not a request to delete: the row rejoins the ordinary
  // queue and waits for a sweep like everything else.
  await callAs(db, 'boss', 'website_form.holdSubmission', { id: kept?.id })
  const released = (await listed(db)).find((row) => row.id === kept?.id)
  assert.equal(released?.held, false)
  assert.equal(released?.purgedAt, null, 'released, not erased')

  const audit = (await call(db, 'website_form.listSubmissionAudit', { formId: 'f1' })) as Array<{
    action: string
  }>
  assert.deepEqual(
    audit.map((entry) => entry.action).sort(),
    ['hold', 'purge', 'release'],
    'each of those is written down',
  )
})

test('form: a second sweep over the same rows erases nothing and claims nothing', async () => {
  const db = await boot()
  await seed(db, { retentionDays: 30 })
  await submit(db, { email: 'mai@example.test' }, { submissionKey: 'a' })
  await backdate(db, 40)

  assert.equal(
    ((await call(db, 'website_form.purgeSubmissions', { formId: 'f1' })) as { erased: number }).erased,
    1,
  )
  assert.equal(
    ((await call(db, 'website_form.purgeSubmissions', { formId: 'f1' })) as { erased: number }).erased,
    0,
    'an erasure is counted once',
  )
  const audit = (await call(db, 'website_form.listSubmissionAudit', { formId: 'f1' })) as unknown[]
  assert.equal(audit.length, 1, 'and a pass that did nothing files nothing')
})

test('form: a form with no retention period keeps everything', async () => {
  const db = await boot()
  await seed(db)
  await submit(db, { email: 'mai@example.test' }, { submissionKey: 'a' })
  await backdate(db, 4_000)

  const refused = (await call(db, 'website_form.purgeSubmissions', { formId: 'f1' })) as Saved
  assert.equal(refused.ok, false)
  assert.equal(refused.errors?.[0]?.message, 'website_form.error.noRetention')
  assert.equal((await listed(db))[0]?.purgedAt, null)
})

test('form: a submission inside its window is not touched', async () => {
  const db = await boot()
  await seed(db, { retentionDays: 30 })
  await submit(db, { email: 'mai@example.test' }, { submissionKey: 'a' })
  await backdate(db, 10)

  const swept = (await call(db, 'website_form.purgeSubmissions', { formId: 'f1' })) as {
    erased: number
  }
  assert.equal(swept.erased, 0)
  assert.equal((await listed(db))[0]?.purgedAt, null)
})

test('form: an erased submission cannot be exported or newly held', async () => {
  const db = await boot()
  await seed(db, { retentionDays: 30 })
  await submit(db, { email: 'mai@example.test' }, { submissionKey: 'a' })
  await backdate(db, 40)
  await call(db, 'website_form.purgeSubmissions', { formId: 'f1' })
  const [row] = await listed(db)

  const out = (await callAs(db, 'boss', 'website_form.exportSubmissions', {
    formId: 'f1',
    fields: ['email'],
  })) as { count: number }
  assert.equal(out.count, 0, 'an export has nothing to carry')

  const refused = (await callAs(db, 'boss', 'website_form.holdSubmission', {
    id: row?.id,
    reason: 'muộn mất rồi',
  })) as Saved
  assert.equal(refused.ok, false)
  assert.equal(refused.errors?.[0]?.message, 'website_form.error.submissionPurged')
})

test('form: the queue can be paged honestly', async () => {
  const db = await boot()
  await seed(db)
  for (let n = 0; n < 5; n += 1)
    await submit(db, { email: `khach${n}@example.test` }, { submissionKey: `k${n}` })

  const total = (await call(db, 'website_form.countSubmissions', { formId: 'f1' })) as {
    count: number
  }
  assert.equal(total.count, 5)
  const firstPage = (await call(db, 'website_form.listSubmissions', {
    formId: 'f1',
    limit: 2,
  })) as Listed[]
  assert.equal(firstPage.length, 2)
})

test('form: retention is scheduled, and its sweep is the job that fans out', () => {
  const sweep = manifest.jobs['website_form.retentionSweep']
  assert.ok(sweep, 'a retention period nobody enforces is a sentence in a notice')
  assert.deepEqual(sweep?.schedule, { every: '24h' })
  assert.equal(sweep?.crossCompany, true)
  assert.ok(sweep?.effects.includes('enqueue:website_form.purgeExpired'))
  assert.equal(manifest.jobs['website_form.purgeExpired']?.crossCompany, false)
})
