import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from '@ketvietlab/ketjs'
import type { Adapter, ServeContext } from '@ketvietlab/ketjs'
import { address, paperTheme, partner, website, websiteForm } from '@ketvietlab/ketsuite'

/**
 * The public submit endpoint, driven the way a browser drives it.
 *
 * Every other form test calls submitForm directly, so the route's own work —
 * reserving transport keys out of the payload, reading the version back out of
 * a string, and deciding a status code — shipped unverified.
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

/** A form-encoded POST, as an HTML form makes it. */
const post = async (db: Adapter, formId: string, body: Record<string, string>) => {
  const entry = manifest.routes['/website/forms/{id}/submit']
  if (!entry) throw new Error('the public submit route is not composed')
  const route = entry.make({
    call: async (name: string, input: Record<string, unknown>) =>
      (await callFn(name, input, { adapter: db, manifest, scope: SCOPE })).value,
  } as unknown as ServeContext)

  const raw = new URLSearchParams(body).toString()
  const req = Object.assign(Readable.from([Buffer.from(raw, 'utf8')]), {
    method: 'POST',
    headers: {
      host: 'moc.example',
      'content-type': 'application/x-www-form-urlencoded',
      'content-length': String(Buffer.byteLength(raw)),
    },
    socket: { remoteAddress: '203.0.113.7' },
  })
  const result = await route(new URL('http://moc.example/website/forms/f1/submit'), req as never, {
    id: formId,
  })
  return { status: result.status ?? 200, body: JSON.parse(String(result.body)) as Record<string, unknown> }
}

const oneField = { fields: [{ name: 'email', type: 'email', required: true }] }

const seed = async (db: Adapter, extra: Record<string, unknown> = {}) => {
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
    schema: oneField,
    successMessage: 'Đã nhận.',
    ...extra,
  })
}

test('route: a plain form post is accepted', async () => {
  const db = await boot()
  await seed(db)
  const res = await post(db, 'f1', { email: 'mai@example.test', _schemaVersion: '1' })
  assert.equal(res.status, 200)
  assert.equal(res.body.ok, true)
})

test('route: a ticked checkbox posts "on", and that counts as agreement', async () => {
  const db = await boot()
  await seed(db, { consentText: 'Tôi đồng ý.' })

  // <input type="checkbox" name="consent"> with no value attribute posts "on".
  // Rejecting it told a visitor who had ticked the box that they must agree.
  const res = await post(db, 'f1', {
    email: 'mai@example.test',
    consent: 'on',
    _schemaVersion: '1',
  })
  assert.equal(res.status, 200, JSON.stringify(res.body))
  assert.equal(res.body.ok, true)

  const rows = (await call(db, 'website_form.listSubmissions', { formId: 'f1' })) as Array<{
    consent: boolean
    consentText: string
  }>
  assert.equal(rows[0]?.consent, true)
  assert.equal(rows[0]?.consentText, 'Tôi đồng ý.')
})

test('route: an unticked checkbox is simply absent, and is refused', async () => {
  const db = await boot()
  await seed(db, { consentText: 'Tôi đồng ý.' })
  // A browser sends nothing at all for an unticked box.
  const res = await post(db, 'f1', { email: 'mai@example.test', _schemaVersion: '1' })
  assert.equal(res.status, 422)
  assert.equal(res.body.ok, false)
})

test('route: the version is read from the string a form posts', async () => {
  const db = await boot()
  await seed(db)
  await call(db, 'website_form.saveForm', {
    id: 'f1',
    siteId: 'site1',
    name: 'Liên hệ',
    schema: {
      fields: [
        { name: 'email', type: 'email', required: true },
        { name: 'company', type: 'text' },
      ],
    },
    successMessage: 'Đã nhận.',
  })
  // The page was rendered at version 1; the form has since moved to 2.
  const res = await post(db, 'f1', { email: 'mai@example.test', _schemaVersion: '1' })
  assert.equal(res.status, 409, 'reload, not a field error')
  assert.equal(res.body.ok, false)
})

test('route: a form field named schemaVersion reaches the payload', async () => {
  const db = await boot()
  await seed(db, {
    schema: {
      fields: [
        { name: 'email', type: 'email', required: true },
        { name: 'schemaVersion', type: 'text' },
      ],
    },
  })
  const res = await post(db, 'f1', {
    email: 'mai@example.test',
    schemaVersion: 'bản 3',
    _schemaVersion: '1',
  })
  assert.equal(res.status, 200, JSON.stringify(res.body))

  const rows = (await call(db, 'website_form.listSubmissions', { formId: 'f1' })) as Array<{
    payload: Record<string, unknown>
    schemaVersion: number
  }>
  assert.equal(rows[0]?.payload.schemaVersion, 'bản 3', "the visitor's answer is not the transport key")
  assert.equal(rows[0]?.schemaVersion, 1)
})

test('route: a consenting post that names no version is told to reload', async () => {
  const db = await boot()
  await seed(db, { consentText: 'Tôi đồng ý.' })
  const res = await post(db, 'f1', { email: 'mai@example.test', consent: 'on' })
  assert.equal(res.status, 409)
  assert.equal(res.body.ok, false)
  assert.deepEqual(await call(db, 'website_form.listSubmissions', { formId: 'f1' }), [])
})

test('route: the public submit endpoint is anonymous by declaration', () => {
  const entry = manifest.routes['/website/forms/{id}/submit']
  assert.ok(entry, 'the route is composed')
  assert.equal(entry?.anonymous, true, 'a visitor has no session')
  assert.equal(entry?.by, 'website_form')
})
