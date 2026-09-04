import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter } from '@ketvietlab/ketjs'
import {
  address,
  mail,
  mailTransport,
  company,
  paperTheme,
  partner,
  storage,
  user,
  website,
  websiteForm,
  websiteFormMail,
} from '@ketvietlab/ketsuite'
import { SAFE_KEYS } from '../packages/ketsuite/src/modules/website_form_mail/index.ts'

const SCOPE = { company: 'acme', branches: null }
const modules = [
  address,
  partner,
  company,
  storage,
  user,
  mail,
  mailTransport,
  website,
  websiteForm,
  websiteFormMail,
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

/** Outbox administration requires a signed-in user; queueing does not. */
const callAsStaff = async (db: Adapter, name: string, input: Record<string, unknown>) =>
  (await callFn(name, input, { adapter: db, manifest, scope: SCOPE, actor: 'staff-1' })).value

const NOTICE_TEMPLATE = {
  id: 'tpl-form',
  name: 'website_form.submission_received',
  fromAddress: 'no-reply@moc.example',
  fromName: 'Mộc',
  subjectTemplate: '{{siteTitle}} · {{formName}} có 1 yêu cầu mới',
  textTemplate: 'Form {{formName}} nhận một yêu cầu lúc {{receivedAt}}.\nMở: {{adminUrl}}',
  allowedKeys: [...SAFE_KEYS],
  active: true,
}

const seed = async (db: Adapter) => {
  await call(db, 'website.saveSite', {
    id: 'site1',
    name: 'moc',
    title: 'Mộc · Trà & gốm',
    defaultLocale: 'vi',
    theme: 'theme_paper',
  })
  await call(db, 'website_form.saveForm', {
    id: 'f1',
    siteId: 'site1',
    name: 'Tư vấn quà tặng',
    schema: {
      fields: [
        { name: 'email', type: 'email', required: true },
        { name: 'loiNhan', type: 'textarea' },
      ],
    },
    successMessage: 'Đã nhận.',
    notifyTo: 'cskh@moc.example',
  })
  await callAsStaff(db, 'mail_transport.saveTemplate', NOTICE_TEMPLATE)
  const sent = (await call(db, 'website_form.submitForm', {
    formId: 'f1',
    payload: { email: 'mai@example.test', loiNhan: 'Tôi muốn đặt 30 bộ ấm trà tặng nhân viên.' },
    schemaVersion: 1,
  })) as { ok: boolean; id: string }
  assert.equal(sent.ok, true)
  return sent.id
}

const deliveryOf = async (db: Adapter, id: string) => {
  const rows = await db.all(
    `SELECT * FROM ${db.quoteIdent('mail_transport_delivery')} WHERE ${db.quoteIdent('id')} = ?`,
    [id],
  )
  return rows[0] as Record<string, unknown> | undefined
}

test('form mail: the notification says a request arrived and where to open it', async () => {
  const db = await boot()
  const submissionId = await seed(db)

  const queued = (await call(db, 'website_form_mail.notifySubmission', {
    submissionId,
    templateId: 'tpl-form',
    baseUrl: 'https://admin.moc.example',
  })) as { deliveryId: string; to: string }

  assert.equal(queued.to, 'cskh@moc.example')
  const delivery = await deliveryOf(db, queued.deliveryId)
  assert.ok(delivery, 'a delivery was queued')
  assert.equal(delivery?.subject, 'Mộc · Trà & gốm · Tư vấn quà tặng có 1 yêu cầu mới')
  assert.match(
    String(delivery?.text),
    new RegExp(`https://admin\\.moc\\.example/admin/website/forms/f1/submissions/${submissionId}`),
  )
})

test('form mail: nothing the visitor typed reaches the mail', async () => {
  const db = await boot()
  const submissionId = await seed(db)
  const queued = (await call(db, 'website_form_mail.notifySubmission', {
    submissionId,
    templateId: 'tpl-form',
    baseUrl: 'https://admin.moc.example',
  })) as { deliveryId: string }

  const delivery = await deliveryOf(db, queued.deliveryId)
  // A Delivery keeps an immutable body snapshot, so anything that lands here is
  // a second copy of the data outside the submission's retention policy.
  const body = `${String(delivery?.subject)}\n${String(delivery?.text)}\n${String(delivery?.html ?? '')}`
  for (const secret of ['mai@example.test', 'Tôi muốn đặt 30 bộ ấm trà', 'loiNhan']) {
    assert.ok(!body.includes(secret), `the mail must not carry "${secret}"`)
  }
  // And the address the mail goes to is the operator's, not the visitor's.
  const recipients = JSON.parse(String(delivery?.to)) as Array<{ address: string }>
  assert.deepEqual(recipients, [{ address: 'cskh@moc.example' }])
})

test('form mail: the context is built from the allowlist, not filtered into it', async () => {
  // A field added to a form tomorrow cannot appear in a notification, because
  // the context is assembled key by key from SAFE_KEYS rather than derived from
  // the submission and pruned.
  assert.deepEqual([...SAFE_KEYS], ['siteTitle', 'formName', 'submissionId', 'receivedAt', 'adminUrl'])
  assert.ok(
    !SAFE_KEYS.some((key) => ['payload', 'consent', 'consentText', 'fingerprint'].includes(key)),
    'no key that could carry visitor data',
  )
})

test('form mail: a template that asks for the payload cannot even be saved', async () => {
  const db = await boot()
  await seed(db)
  // Two independent guards, so neither is the only thing in the way: the bridge
  // never puts the payload in a context, and the outbox refuses a template that
  // references a key outside its allowlist — at save time, before any mail
  // could be queued against it.
  await assert.rejects(
    callAsStaff(db, 'mail_transport.saveTemplate', {
      ...NOTICE_TEMPLATE,
      id: 'tpl-greedy',
      name: 'greedy',
      textTemplate: 'Nội dung: {{payload}}',
    }),
    /not allowlisted/,
  )

  // Widening the allowlist is the only way in, and that is a deliberate act.
  await assert.rejects(
    callAsStaff(db, 'mail_transport.saveTemplate', {
      ...NOTICE_TEMPLATE,
      id: 'tpl-greedy2',
      name: 'greedy2',
      textTemplate: 'Nội dung: {{loiNhan}}',
    }),
    /not allowlisted/,
  )
})

test('form mail: notifying twice queues one delivery', async () => {
  const db = await boot()
  const submissionId = await seed(db)
  const args = { submissionId, templateId: 'tpl-form', baseUrl: 'https://admin.moc.example' }
  const first = (await call(db, 'website_form_mail.notifySubmission', args)) as { deliveryId: string }
  const again = (await call(db, 'website_form_mail.notifySubmission', args)) as { deliveryId: string }
  assert.equal(again.deliveryId, first.deliveryId, 'the id is derived from the submission')

  const rows = await db.all(`SELECT * FROM ${db.quoteIdent('mail_transport_delivery')}`)
  assert.equal(rows.length, 1, 'a retry must not send a second mail')
})

test('form mail: a form with nobody to notify queues nothing', async () => {
  const db = await boot()
  const submissionId = await seed(db)
  await call(db, 'website_form.saveForm', {
    id: 'f1',
    siteId: 'site1',
    name: 'Tư vấn quà tặng',
    schema: {
      fields: [
        { name: 'email', type: 'email', required: true },
        { name: 'loiNhan', type: 'textarea' },
      ],
    },
    successMessage: 'Đã nhận.',
    notifyTo: null,
  })
  await assert.rejects(
    call(db, 'website_form_mail.notifySubmission', {
      submissionId,
      templateId: 'tpl-form',
      baseUrl: 'https://admin.moc.example',
    }),
    /nobody to notify/,
  )
})

test('form mail: the link origin must be http(s)', async () => {
  const db = await boot()
  const submissionId = await seed(db)
  for (const bad of ['javascript:alert(1)', 'not-a-url', 'ftp://moc.example']) {
    await assert.rejects(
      call(db, 'website_form_mail.notifySubmission', {
        submissionId,
        templateId: 'tpl-form',
        baseUrl: bad,
      }),
      /http\(s\) origin/,
      bad,
    )
  }
})
