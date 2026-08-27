import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

async function bootWorkCenters(t: TestContext) {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) => e2e.fixture.call(name, input, { scope })

  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await fixture('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'VND' })
  await fixture('user.createUser', {
    id: 'admin',
    login: 'admin',
    password: 'correct horse',
    name: 'Administrator',
    defaultCompanyId: 'acme',
    superuser: true,
  })
  await fixture('user.grantCompany', { id: 'admin:acme', userId: 'admin', companyId: 'acme' })
  await fixture('manufacturing.saveWorkCenter', {
    id: 'packing',
    code: 'PACK',
    name: 'Đóng gói',
    capacity: '3',
    timeEfficiency: '88',
    costPerHour: '125000',
  })
  await e2e.client.login({ login: 'admin', password: 'correct horse' })
  return e2e
}

const workCenterForm = (
  code: string,
  values: Partial<Record<'name' | 'capacity' | 'timeEfficiency' | 'costPerHour', string>> = {},
) =>
  new URLSearchParams({
    code,
    name: values.name ?? 'Lắp ráp',
    capacity: values.capacity ?? '2',
    timeEfficiency: values.timeEfficiency ?? '95',
    costPerHour: values.costPerHour ?? '75000',
  })

test('manufacturing work centers HTTP: modal CRUD keeps locale, numeric semantics and legacy POST', async (t) => {
  const e2e = await bootWorkCenters(t)

  const list = await (await e2e.client.get('/admin/manufacturing/work-centers?lang=vi')).text()
  assert.match(list, /data-ui="list-page"/)
  assert.match(list, /href="\/admin\/manufacturing\/work-centers\?create=1&amp;lang=vi"/)
  assert.match(list, /data-row-href="\/admin\/manufacturing\/work-centers\?edit=packing&amp;lang=vi"/)
  assert.match(list, /PACK/)
  assert.match(list, /Đóng gói/)
  assert.match(list, />88</)
  assert.match(list, />125000</)
  assert.doesNotMatch(list, /manufacturing-work-center-form|data-ui="modal-layer"/)

  const create = await (await e2e.client.get('/admin/manufacturing/work-centers?create=1&lang=vi')).text()
  assert.match(create, /data-ui="list-page"/)
  assert.match(create, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(create, /action="\/admin\/manufacturing\/work-centers\?create=1&amp;lang=vi"/)
  assert.match(create, /data-ui="modal-close" href="\/admin\/manufacturing\/work-centers\?lang=vi"/)

  const edit = await (await e2e.client.get('/admin/manufacturing/work-centers?edit=packing&lang=en')).text()
  assert.match(edit, /data-ui="modal-layer" data-route-modal="true"/)
  assert.match(edit, /action="\/admin\/manufacturing\/work-centers\?edit=packing&amp;lang=en"/)
  assert.match(edit, /name="id" value="packing"/)
  assert.match(edit, /name="code"[^>]*value="PACK"/)
  assert.match(edit, /name="capacity"[^>]*value="3"/)
  assert.match(edit, /name="timeEfficiency"[^>]*value="88"/)
  assert.match(edit, /name="costPerHour"[^>]*value="125000"/)

  const missing = await e2e.client.get('/admin/manufacturing/work-centers?edit=missing&lang=en')
  assert.equal(missing.status, 404)

  const refused = await e2e.client.post(
    '/admin/manufacturing/work-centers?create=1&lang=en',
    workCenterForm('CROSS'),
    {
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: 'https://cross-site.example',
      },
      redirect: 'manual',
    },
  )
  assert.equal(refused.status, 403)

  const invalid = await e2e.client.post(
    '/admin/manufacturing/work-centers?edit=packing&lang=vi',
    workCenterForm('PACK', { capacity: '-2', timeEfficiency: '88', costPerHour: '125000' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(invalid.status, 200)
  const invalidHtml = await invalid.text()
  assert.match(invalidHtml, /data-ui="form-errors" role="alert"/)
  assert.match(invalidHtml, /name="id" value="packing"/)
  assert.match(invalidHtml, /name="capacity"[^>]*value="-2"/)
  assert.match(invalidHtml, /name="timeEfficiency"[^>]*value="88"/)
  assert.match(invalidHtml, /name="costPerHour"[^>]*value="125000"/)

  const updated = await e2e.client.post(
    '/admin/manufacturing/work-centers?edit=packing&lang=en',
    workCenterForm('PACK', { name: 'Packing', capacity: '4', timeEfficiency: '92', costPerHour: '150000' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(updated.status, 303)
  assert.equal(updated.headers.get('location'), '/admin/manufacturing/work-centers?lang=en')

  const archived = await e2e.client.post(
    '/admin/manufacturing/work-centers?lang=vi',
    new URLSearchParams({ action: 'archive', id: 'packing' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(archived.status, 303)
  assert.equal(archived.headers.get('location'), '/admin/manufacturing/work-centers?lang=vi')
  const archivedList = await (await e2e.client.get('/admin/manufacturing/work-centers?lang=vi')).text()
  assert.match(archivedList, /PACK/)
  assert.match(archivedList, /data-ui="badge" data-tone="neutral"[\s\S]*?Đã lưu trữ/)
  assert.match(archivedList, /name="action" value="restore"/)

  const projected = await e2e.client.call<Row[]>('manufacturing.listWorkCenters', {
    includeArchived: true,
  })
  const packing = projected.value.find((row) => row.id === 'packing')!
  assert.deepEqual(
    {
      active: packing.active,
      capacity: packing.capacity,
      costPerHour: packing.costPerHour,
      timeEfficiency: packing.timeEfficiency,
    },
    { active: false, capacity: '4', costPerHour: '150000', timeEfficiency: '92' },
  )

  const restored = await e2e.client.post(
    '/admin/manufacturing/work-centers?lang=en',
    new URLSearchParams({ action: 'restore', id: 'packing' }),
    { headers: { 'content-type': 'application/x-www-form-urlencoded' }, redirect: 'manual' },
  )
  assert.equal(restored.status, 303)
  assert.equal(restored.headers.get('location'), '/admin/manufacturing/work-centers?lang=en')

  const legacy = workCenterForm('LEGACY')
  legacy.set('id', 'legacy-center')
  const legacyCreated = await e2e.client.post('/admin/manufacturing/work-centers?lang=vi', legacy, {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    redirect: 'manual',
  })
  assert.equal(legacyCreated.status, 303)
  assert.equal(legacyCreated.headers.get('location'), '/admin/manufacturing/work-centers?lang=vi')

  const finalRows = await e2e.client.call<Row[]>('manufacturing.listWorkCenters', {
    includeArchived: true,
  })
  assert.deepEqual(finalRows.value.map((row) => row.code).sort(), ['LEGACY', 'PACK'])
  assert.equal(finalRows.value.find((row) => row.id === 'packing')?.active, true)
})
