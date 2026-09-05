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

type Result = { ok?: boolean; id?: string; errors?: Array<{ field: string; message: string }> }

const oneField = { fields: [{ name: 'email', type: 'email', required: true }] }
const twoFields = {
  fields: [
    { name: 'email', type: 'email', required: true },
    { name: 'company', type: 'text', required: true },
  ],
}

const seed = async (db: Adapter, schema: unknown = oneField) => {
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
  })
}

test('form: a new form starts at version 1 and reports it to the page', async () => {
  const db = await boot()
  await seed(db)
  const form = (await call(db, 'website_form.getForm', { id: 'f1' })) as { schemaVersion: number }
  assert.equal(form.schemaVersion, 1)
})

test('form: changing the field contract bumps the version', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website_form.saveForm', {
    id: 'f1',
    siteId: 'site1',
    name: 'Liên hệ',
    schema: twoFields,
    successMessage: 'Đã nhận.',
  })
  const form = (await call(db, 'website_form.getForm', { id: 'f1' })) as { schemaVersion: number }
  assert.equal(form.schemaVersion, 2)
})

test('form: editing the success message does not invalidate open pages', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website_form.saveForm', {
    id: 'f1',
    siteId: 'site1',
    name: 'Liên hệ',
    schema: oneField,
    successMessage: 'Cảm ơn bạn đã liên hệ.',
  })
  const form = (await call(db, 'website_form.getForm', { id: 'f1' })) as { schemaVersion: number }
  assert.equal(form.schemaVersion, 1, 'the field contract did not change')
})

test('form: re-saving the same fields in a different key order keeps the version', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website_form.saveForm', {
    id: 'f1',
    siteId: 'site1',
    name: 'Liên hệ',
    // Same contract, keys written the other way round.
    schema: { fields: [{ required: true, type: 'email', name: 'email' }] },
    successMessage: 'Đã nhận.',
  })
  const form = (await call(db, 'website_form.getForm', { id: 'f1' })) as { schemaVersion: number }
  assert.equal(form.schemaVersion, 1)
})

test('form: a page rendered against an older contract is told to reload', async () => {
  const db = await boot()
  await seed(db)
  // A visitor opened the form while it still had one field.
  const openedAt = ((await call(db, 'website_form.getForm', { id: 'f1' })) as { schemaVersion: number })
    .schemaVersion

  await call(db, 'website_form.saveForm', {
    id: 'f1',
    siteId: 'site1',
    name: 'Liên hệ',
    schema: twoFields,
    successMessage: 'Đã nhận.',
  })

  const stale = (await call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload: { email: 'mai@example.test' },
    schemaVersion: openedAt,
  })) as Result
  assert.equal(stale.ok, false)
  assert.equal(stale.errors?.[0]?.message, 'website_form.error.staleForm')
  assert.equal(
    stale.errors?.length,
    1,
    'the visitor is told the form moved, not that a field they never saw is missing',
  )
})

test('form: a submission on the current contract records the version it was accepted against', async () => {
  const db = await boot()
  await seed(db)
  const accepted = (await call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload: { email: 'mai@example.test' },
    schemaVersion: 1,
  })) as Result
  assert.equal(accepted.ok, true)

  const rows = (await call(db, 'website_form.listSubmissions', { formId: 'f1' })) as Array<{
    schemaVersion: number
  }>
  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.schemaVersion, 1)
})

test('form: a client that sends no version keeps the previous behaviour', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website_form.saveForm', {
    id: 'f1',
    siteId: 'site1',
    name: 'Liên hệ',
    schema: twoFields,
    successMessage: 'Đã nhận.',
  })
  const submitted = (await call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload: { email: 'mai@example.test', company: 'Mộc' },
  })) as Result
  assert.equal(submitted.ok, true)

  const rows = (await call(db, 'website_form.listSubmissions', { formId: 'f1' })) as Array<{
    schemaVersion: number
  }>
  assert.equal(rows[0]?.schemaVersion, 2, 'it is still recorded against the contract in force')
})

test('form: a stale submission is refused without consuming the rate budget', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website_form.saveForm', {
    id: 'f1',
    siteId: 'site1',
    name: 'Liên hệ',
    schema: twoFields,
    successMessage: 'Đã nhận.',
  })
  const stale = (await call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload: { email: 'mai@example.test' },
    schemaVersion: 1,
    rateKey: 'visitor-1',
  })) as Result
  assert.equal(stale.errors?.[0]?.message, 'website_form.error.staleForm')

  const rows = (await call(db, 'website_form.listSubmissions', { formId: 'f1' })) as unknown[]
  assert.equal(rows.length, 0, 'nothing was stored')

  // A visitor turned away because the form moved has not spent an attempt: the
  // next submission on the current contract must still be accepted.
  const retried = (await call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload: { email: 'mai@example.test', company: 'Mộc' },
    schemaVersion: 2,
    rateKey: 'visitor-1',
  })) as Result
  assert.equal(retried.ok, true)
})

test('form: two contracts can never share a version number', async () => {
  const db = await boot()
  await seed(db)
  const base = {
    id: 'f1',
    siteId: 'site1',
    name: 'Liên hệ',
    successMessage: 'Đã nhận.',
  }
  // Both writers read version 1 and both compute 2. Without a guard on the
  // version, the loser would publish a different contract under the same number
  // and the staleness check would then certify a stale payload as current.
  const [first, second] = await Promise.all([
    call(db, 'website_form.saveForm', { ...base, schema: twoFields }),
    call(db, 'website_form.saveForm', {
      ...base,
      schema: {
        fields: [
          { name: 'email', type: 'email', required: true },
          { name: 'phone', type: 'tel' },
        ],
      },
    }),
  ])
  const results = [first, second] as Result[]
  const won = results.filter((r) => r.ok === true)
  const lost = results.filter((r) => r.ok === false)
  assert.equal(won.length, 1, 'exactly one save may advance the version')
  assert.equal(lost[0]?.errors?.[0]?.message, 'website_form.error.saveConflict')

  const form = (await call(db, 'website_form.getForm', { id: 'f1' })) as {
    schemaVersion: number
    schema: { fields: Array<{ name: string }> }
  }
  assert.equal(form.schemaVersion, 2)
  // The stored contract is the one that won, not a blend of the two.
  const names = form.schema.fields.map((f) => f.name).sort()
  assert.ok(
    JSON.stringify(names) === JSON.stringify(['company', 'email']) ||
      JSON.stringify(names) === JSON.stringify(['email', 'phone']),
    `unexpected stored contract: ${names.join(',')}`,
  )
})

test('form: a field actually named schemaVersion still works', async () => {
  const db = await boot()
  await seed(db, {
    fields: [
      { name: 'email', type: 'email', required: true },
      // A legal field name: the transport uses `_schemaVersion` precisely so a
      // form asking this question does not answer 409 for ever.
      { name: 'schemaVersion', type: 'text' },
    ],
  })
  const accepted = (await call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload: { email: 'mai@example.test', schemaVersion: 'ban 3' },
    schemaVersion: 1,
  })) as Result
  assert.equal(accepted.ok, true)

  const rows = (await call(db, 'website_form.listSubmissions', { formId: 'f1' })) as Array<{
    id: string
    schemaVersion: number
  }>
  assert.equal(rows[0]?.schemaVersion, 1, 'the contract version is recorded separately')
  const record = (await call(db, 'website_form.readSubmission', { id: rows[0]?.id })) as {
    payload: Record<string, unknown>
  }
  assert.equal(record?.payload.schemaVersion, 'ban 3', "the visitor's answer is preserved")
})

test('form: listForms and getForm agree on the version', async () => {
  const db = await boot()
  await seed(db)
  const list = (await call(db, 'website_form.listForms', { siteId: 'site1' })) as Array<{
    schemaVersion: number
  }>
  const one = (await call(db, 'website_form.getForm', { id: 'f1' })) as { schemaVersion: number }
  assert.equal(list[0]?.schemaVersion, one.schemaVersion)
  assert.equal(one.schemaVersion, 1)
})

// --- consent is part of the same contract ----------------------------------

const withNotice = {
  id: 'f1',
  siteId: 'site1',
  name: 'Liên hệ',
  schema: oneField,
  successMessage: 'Đã nhận.',
  consentText: 'Tôi đồng ý để Mộc liên hệ lại.',
}

test('form: changing the privacy notice bumps the same version the fields use', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website_form.saveForm', withNotice)
  const v2 = (await call(db, 'website_form.getForm', { id: 'f1' })) as {
    schemaVersion: number
    consentText: string
  }
  assert.equal(v2.schemaVersion, 2, 'adding a notice changes what the page means')
  assert.equal(v2.consentText, 'Tôi đồng ý để Mộc liên hệ lại.')

  await call(db, 'website_form.saveForm', {
    ...withNotice,
    consentText: 'Tôi đồng ý để Mộc liên hệ lại và lưu thông tin của tôi.',
  })
  const v3 = (await call(db, 'website_form.getForm', { id: 'f1' })) as { schemaVersion: number }
  assert.equal(v3.schemaVersion, 3, 'one version covers fields and notice, so they cannot disagree')
})

test('form: a page open against the old notice is told to reload', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website_form.saveForm', withNotice)
  const shownTo = ((await call(db, 'website_form.getForm', { id: 'f1' })) as { schemaVersion: number })
    .schemaVersion

  await call(db, 'website_form.saveForm', { ...withNotice, consentText: 'Điều khoản mới.' })

  const stale = (await call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload: { email: 'mai@example.test' },
    consent: true,
    schemaVersion: shownTo,
  })) as Result
  assert.equal(stale.ok, false)
  assert.equal(
    stale.errors?.[0]?.message,
    'website_form.error.staleForm',
    'agreement to a notice that has been replaced is not agreement to the new one',
  )
})

test('form: a form that shows a notice will not accept a submission without agreement', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website_form.saveForm', withNotice)

  const refused = (await call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload: { email: 'mai@example.test' },
  })) as Result
  assert.equal(refused.ok, false)
  assert.equal(refused.errors?.[0]?.field, 'consent')
  assert.equal(refused.errors?.[0]?.message, 'website_form.error.consentRequired')
  assert.deepEqual(await call(db, 'website_form.listSubmissions', { formId: 'f1' }), [])
})

test('form: a submission records the exact notice it agreed to', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website_form.saveForm', withNotice)
  const agreedAt = ((await call(db, 'website_form.getForm', { id: 'f1' })) as { schemaVersion: number })
    .schemaVersion
  await call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload: { email: 'mai@example.test' },
    consent: true,
    schemaVersion: agreedAt,
  })

  // The notice then changes. A Form is one mutable row with no history, so the
  // version number alone could never be resolved back to the old text — the
  // submission has to carry it.
  await call(db, 'website_form.saveForm', { ...withNotice, consentText: 'Điều khoản mới.' })

  const rows = (await call(db, 'website_form.listSubmissions', { formId: 'f1' })) as Array<{
    consent: boolean
    consentText: string
    schemaVersion: number
  }>
  assert.equal(rows[0]?.consent, true)
  assert.equal(rows[0]?.schemaVersion, agreedAt)
  assert.equal(
    rows[0]?.consentText,
    'Tôi đồng ý để Mộc liên hệ lại.',
    'the text they agreed to survives the notice being rewritten',
  )
  assert.equal(
    ((await call(db, 'website_form.getForm', { id: 'f1' })) as { consentText: string }).consentText,
    'Điều khoản mới.',
  )
})

test('form: a save that omits the notice leaves it alone', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website_form.saveForm', withNotice)
  const before = (await call(db, 'website_form.getForm', { id: 'f1' })) as {
    schemaVersion: number
    consentText: string
  }

  // The shipped admin editor has no consentText field, so this is what every
  // save through it looks like. It used to wipe the notice and disarm the gate.
  await call(db, 'website_form.saveForm', {
    id: 'f1',
    siteId: 'site1',
    name: 'Liên hệ (đổi tên)',
    schema: oneField,
    successMessage: 'Đã nhận.',
  })
  const after = (await call(db, 'website_form.getForm', { id: 'f1' })) as {
    schemaVersion: number
    consentText: string
  }
  assert.equal(after.consentText, before.consentText, 'the notice survives an unrelated edit')
  assert.equal(after.schemaVersion, before.schemaVersion, 'and the contract did not change')

  const refused = (await call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload: { email: 'mai@example.test' },
    schemaVersion: after.schemaVersion,
  })) as Result
  assert.equal(refused.ok, false, 'the gate is still armed')
})

test('form: an explicit null still removes the notice', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website_form.saveForm', withNotice)
  await call(db, 'website_form.saveForm', { ...withNotice, consentText: null })
  const after = (await call(db, 'website_form.getForm', { id: 'f1' })) as { consentText: string | null }
  assert.equal(after.consentText, null)
})

test('form: a page that will not say which notice it showed is refused', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website_form.saveForm', withNotice)

  // Consent given, but no version. Stamping this with the version in force
  // would record agreement to whatever the notice says now.
  const refused = (await call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload: { email: 'mai@example.test' },
    consent: true,
  })) as Result
  assert.equal(refused.ok, false)
  assert.equal(refused.errors?.[0]?.field, 'schemaVersion')
  assert.equal(refused.errors?.[0]?.message, 'website_form.error.consentVersionRequired')
  assert.deepEqual(await call(db, 'website_form.listSubmissions', { formId: 'f1' }), [])
})

test('form: a form with no notice still accepts an unversioned submission', async () => {
  const db = await boot()
  await seed(db)
  const accepted = (await call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload: { email: 'mai@example.test' },
  })) as Result
  assert.equal(accepted.ok, true, 'the stricter rule applies only where a notice is shown')
})

test('form: a form with no notice is unaffected', async () => {
  const db = await boot()
  await seed(db)
  const accepted = (await call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload: { email: 'mai@example.test' },
  })) as Result
  assert.equal(accepted.ok, true, 'consent is only required where a notice is shown')
})

test('form: re-saving an unchanged notice keeps the version', async () => {
  const db = await boot()
  await seed(db)
  // Surrounding whitespace on purpose: the stored value is trimmed, and hashing
  // the raw input instead made every save disagree with the last one and bump
  // the version forever, invalidating every page open against the form.
  const padded = { ...withNotice, consentText: '  Tôi đồng ý để Mộc liên hệ lại.  ' }
  await call(db, 'website_form.saveForm', padded)
  const first = (await call(db, 'website_form.getForm', { id: 'f1' })) as {
    schemaVersion: number
    consentText: string
  }
  assert.equal(first.consentText, 'Tôi đồng ý để Mộc liên hệ lại.', 'stored trimmed')

  await call(db, 'website_form.saveForm', padded)
  await call(db, 'website_form.saveForm', padded)
  const later = (await call(db, 'website_form.getForm', { id: 'f1' })) as { schemaVersion: number }
  assert.equal(later.schemaVersion, first.schemaVersion, 'saving the same notice changes nothing')

  // The trimmed form of the same notice is the same contract too.
  await call(db, 'website_form.saveForm', { ...withNotice, consentText: first.consentText })
  const trimmed = (await call(db, 'website_form.getForm', { id: 'f1' })) as { schemaVersion: number }
  assert.equal(trimmed.schemaVersion, first.schemaVersion)
})

test('form: an empty notice is the same as none', async () => {
  const db = await boot()
  await seed(db)
  const base = { id: 'f1', siteId: 'site1', name: 'Liên hệ', schema: oneField, successMessage: 'Đã nhận.' }
  const start = ((await call(db, 'website_form.getForm', { id: 'f1' })) as { schemaVersion: number })
    .schemaVersion

  await call(db, 'website_form.saveForm', { ...base, consentText: '' })
  await call(db, 'website_form.saveForm', { ...base, consentText: '   ' })
  const after = (await call(db, 'website_form.getForm', { id: 'f1' })) as {
    schemaVersion: number
    consentText: string | null
  }
  assert.equal(after.consentText, null)
  assert.equal(after.schemaVersion, start, 'a blank notice is not a notice')

  // And with no notice, consent stays optional.
  const accepted = (await call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload: { email: 'mai@example.test' },
  })) as Result
  assert.equal(accepted.ok, true)
})
