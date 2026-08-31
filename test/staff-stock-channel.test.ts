import assert from 'node:assert/strict'
import { test, type TestContext } from 'node:test'
import type { Row } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import { ketsuite } from '../apps/ketsuite/deployment.ts'

type Envelope<T> = { data: T; error: { code: string } | null }

const boot = async (t: TestContext) => {
  const e2e = await createTestDeployment(ketsuite, { worker: false })
  t.after(() => e2e.close())
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call<Row>(name, input, { scope })

  await fixture('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'Kết Việt' })
  await fixture('company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  await fixture('user.createUser', {
    id: 'warehouse-user',
    login: 'warehouse-user',
    password: 'correct horse battery',
    name: 'Warehouse User',
    defaultCompanyId: 'acme',
    superuser: false,
  })
  await fixture('user.grantCompany', {
    id: 'warehouse-user:acme',
    userId: 'warehouse-user',
    companyId: 'acme',
  })
  await fixture('user.saveRole', { id: 'warehouse-reader', name: 'Warehouse reader' })
  for (const fnKey of [
    'stock.listPickingViews',
    'stock.getPickingView',
    'company.getCompany',
    'product.listVariants',
    'uom.listUnits',
    'user.listUsers',
    'stock_staff_channel.listActiveClaims',
    'stock_staff_channel.getScanContext',
    'stock_staff_channel.listCountSessions',
    'stock_staff_channel.getCountContext',
    'stock_staff_channel.claimPicking',
    'stock_staff_channel.releasePicking',
    'stock_staff_channel.completeGuidedPicking',
    'stock_staff_channel.completeExecution',
    'stock_staff_channel.completeReturnExecution',
    'stock_staff_channel.startScanSession',
    'stock_staff_channel.submitScanEvent',
    'stock_staff_channel.transitionScanSession',
    'stock_staff_channel.claimCountSession',
    'stock_staff_channel.resumeCountAttempt',
    'stock_staff_channel.recordCountLine',
    'stock_staff_channel.submitCountAttempt',
  ])
    await fixture('user.grantFunction', {
      id: `warehouse-reader:${fnKey}`,
      roleId: 'warehouse-reader',
      fnKey,
    })
  await fixture('user.assignRole', {
    id: 'warehouse-user:warehouse-reader',
    userId: 'warehouse-user',
    roleId: 'warehouse-reader',
  })
  await fixture('uom.saveUnit', { id: 'unit', name: 'Đơn vị', relativeFactor: '1' })
  await fixture('product.saveTemplate', {
    id: 'mango-template',
    name: 'Xoài Cát',
    type: 'goods',
    uomId: 'unit',
    listPrice: '50000',
    saleOk: true,
  })
  await fixture('product.saveVariant', {
    id: 'mango',
    templateId: 'mango-template',
    defaultCode: 'XCAT-01',
    barcode: '893000000001',
    combinationKey: '',
  })
  await fixture('stock.configureProduct', {
    templateId: 'mango-template',
    isStorable: true,
    tracking: 'none',
  })
  await fixture('stock.saveWarehouse', { id: 'wh', name: 'Kho chính', code: 'WH' })
  for (const [id, name, scheduledDate] of [
    ['pick-a', 'WH/OUT/00001', '2026-08-20T00:00:00.000Z'],
    ['pick-b', 'WH/OUT/00002', '2026-08-21T00:00:00.000Z'],
  ]) {
    await fixture('stock.createPicking', {
      id,
      name,
      pickingTypeId: 'wh:outgoing',
      scheduledDate,
    })
    await fixture('stock.addMove', {
      id: `${id}:move`,
      name: 'Xoài Cát',
      pickingId: id,
      productId: 'mango',
      productUomId: 'unit',
      productUomQty: id === 'pick-a' ? '10' : '5',
      origin: id === 'pick-a' ? 'SO/00001' : undefined,
    })
  }
  return e2e
}

const mutationHeaders = (csrfToken: string, key: string, version: string) => ({
  'content-type': 'application/json',
  'x-csrf-token': csrfToken,
  'idempotency-key': key,
  'if-match': `"${version}"`,
})

const detail = async (e2e: Awaited<ReturnType<typeof boot>>, id = 'pick-a') =>
  (await e2e.client.json<Envelope<Row>>(`/api/staff/v1/warehouse/pickings/${id}`)).data

const prepareAssignedPicking = async (e2e: Awaited<ReturnType<typeof boot>>) => {
  const scope = { company: 'acme', branches: null }
  const fixture = (name: string, input: Record<string, unknown>) =>
    e2e.fixture.call<Row>(name, input, { scope })
  await fixture('stock.saveLocation', {
    id: 'inventory-loss',
    name: 'Inventory loss',
    usage: 'inventory',
  })
  await fixture('stock.adjustInventory', {
    id: 'warehouse-opening-stock',
    productId: 'mango',
    locationId: 'wh:stock',
    inventoryLocationId: 'inventory-loss',
    countedQuantity: '20',
    productUomId: 'unit',
  })
  await fixture('stock.confirmPicking', { id: 'pick-a' })
  const assigned = await fixture('stock.assignPicking', { id: 'pick-a' })
  assert.equal(assigned.value.ok, true, JSON.stringify(assigned.value))
}

test('staff warehouse channel pages company-scoped transfer summaries', async (t) => {
  const e2e = await boot(t)
  assert.equal((await e2e.client.get('/api/staff/v1/warehouse/pickings')).status, 401)
  await e2e.client.login({ login: 'warehouse-user', password: 'correct horse battery' })

  const first = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      '/api/staff/v1/warehouse/pickings?limit=1',
    )
  ).data
  assert.equal(first.items[0]?.id, 'pick-b')
  assert.deepEqual(first.items[0]?.context, {
    company: { id: 'acme', name: 'Kết Việt' },
    warehouse: { id: 'wh', name: 'Kho chính' },
    sourceLocation: { id: 'wh:stock', name: 'Stock' },
    destinationLocation: { id: 'wh:customer', name: 'Customer' },
    operation: { code: 'outgoing', name: 'Delivery Orders' },
    sourceDocument: { type: 'none' },
  })
  assert.match(String(first.items[0]?.version), /^pkv_[0-9a-f]{64}$/)
  assert.ok(first.nextCursor)

  const second = (
    await e2e.client.json<Envelope<{ items: Row[]; nextCursor: string | null }>>(
      `/api/staff/v1/warehouse/pickings?limit=1&cursor=${encodeURIComponent(first.nextCursor!)}`,
    )
  ).data
  assert.equal(second.items[0]?.id, 'pick-a')
  assert.equal(second.nextCursor, null)
})

test('staff warehouse channel returns canonical transfer lines and a strong ETag', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'warehouse-user', password: 'correct horse battery' })

  const response = await e2e.client.get('/api/staff/v1/warehouse/pickings/pick-a')
  assert.equal(response.status, 200)
  const detail = (await response.json()) as Envelope<Row>
  assert.equal(response.headers.get('etag'), `"${String(detail.data.version)}"`)
  assert.deepEqual(detail.data.context, {
    company: { id: 'acme', name: 'Kết Việt' },
    warehouse: { id: 'wh', name: 'Kho chính' },
    sourceLocation: { id: 'wh:stock', name: 'Stock' },
    destinationLocation: { id: 'wh:customer', name: 'Customer' },
    operation: { code: 'outgoing', name: 'Delivery Orders' },
    sourceDocument: { type: 'other', reference: 'SO/00001' },
  })
  assert.deepEqual(detail.data.lines, [
    {
      id: 'pick-a:move',
      product: { id: 'mango', name: 'Xoài Cát', sku: 'XCAT-01' },
      uom: { id: 'unit', name: 'Đơn vị' },
      expectedQuantity: '10',
      doneQuantity: '0',
      remainingQuantity: '10',
      tracking: 'none',
      trackingRequirement: 'not_required',
      lots: [],
    },
  ])
  assert.deepEqual(detail.data.progress, { lineCount: 1, completedLineCount: 0 })
  assert.deepEqual(detail.data.tracking, {
    lotOrSerialRequired: false,
    allRequirementsSatisfied: true,
  })
  assert.deepEqual(detail.data.quality, { status: 'unavailable', requirements: [] })
  assert.equal((detail.data.nextAction as Row).supported, true, JSON.stringify(detail.data.nextAction))
  assert.equal((detail.data.nextAction as Row).code, 'claim')

  const missing = await e2e.client.get('/api/staff/v1/warehouse/pickings/missing')
  assert.equal(missing.status, 404)
  assert.equal(((await missing.json()) as Envelope<null>).error?.code, 'stock_staff_channel.pickingNotFound')
})

test('staff warehouse version tracks every label the projection resolves', async (t) => {
  const e2e = await boot(t)
  await e2e.client.login({ login: 'warehouse-user', password: 'correct horse battery' })
  const detailOf = async () => {
    const response = await e2e.client.get('/api/staff/v1/warehouse/pickings/pick-a')
    const body = (await response.json()) as Envelope<Row>
    const line = (body.data.lines as Row[])[0] as Row
    return {
      version: String(body.data.version),
      etag: response.headers.get('etag'),
      uom: String((line.uom as Row).name),
    }
  }
  const listedVersion = async () => {
    const listed = (
      await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/warehouse/pickings?limit=50')
    ).data
    return String(listed.items.find((item) => String(item.id) === 'pick-a')?.version)
  }

  const before = await detailOf()
  // A picking is one thing. The screen it was read from must not change its
  // version, or a client comparing a list entry against a detail sees a
  // conflict that never happened.
  assert.equal(await listedVersion(), before.version)

  // The unit name is resolved from uom, not from the picking row. Before this
  // was hashed, renaming it changed the answer and left the version alone —
  // a caller holding the old ETag would never have seen the new name.
  await e2e.fixture.call<Row>(
    'uom.saveUnit',
    { id: 'unit', name: 'Thùng carton', relativeFactor: '1' },
    { scope: { company: 'acme', branches: null } },
  )
  const after = await detailOf()
  assert.equal(after.uom, 'Thùng carton')
  assert.notEqual(after.version, before.version)
  assert.equal(after.etag, `"${after.version}"`)
  assert.equal(await listedVersion(), after.version)
})

test('staff warehouse channel covers claim, scanning, execution, and return as one fenced lifecycle', async (t) => {
  const e2e = await boot(t)
  await prepareAssignedPicking(e2e)
  await e2e.client.login({ login: 'warehouse-user', password: 'correct horse battery' })
  const bootstrap = await e2e.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')
  const csrf = bootstrap.data.csrfToken

  const ready = await detail(e2e)
  const claim = await e2e.client.request('/api/staff/v1/warehouse/pickings/pick-a/claim', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'warehouse-claim-1', String(ready.version)),
    body: JSON.stringify({ expectedVersion: ready.version, reason: 'Start picking the transfer' }),
  })
  assert.equal(claim.status, 200)
  const claimed = (await claim.json()) as Envelope<Row>
  assert.equal((claimed.data.claim as Row).ownedByCurrentActor, true)
  assert.equal((claimed.data.claim as Row).state, 'active')
  assert.notEqual((claimed.data.picking as Row).version, ready.version)

  // The claim moved the aggregate version, so a retry of that same POST carries a
  // version that is already stale. A dropped response is the ordinary case on a
  // handheld, and the retry is the recovery path: replaying the command under its
  // own key has to return the claim, not refuse it as somebody else's.
  const replayedClaim = await e2e.client.request('/api/staff/v1/warehouse/pickings/pick-a/claim', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'warehouse-claim-1', String(ready.version)),
    body: JSON.stringify({ expectedVersion: ready.version, reason: 'Start picking the transfer' }),
  })
  assert.equal(replayedClaim.status, 200, await replayedClaim.clone().text())
  const replayed = (await replayedClaim.json()) as Envelope<Row>
  assert.equal((replayed.data.claim as Row).id, (claimed.data.claim as Row).id)
  assert.equal((replayed.data.claim as Row).state, 'active')
  // A different key against a transfer somebody already holds is still a refusal.
  const secondClaim = await e2e.client.request('/api/staff/v1/warehouse/pickings/pick-a/claim', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'warehouse-claim-2', String((replayed.data.picking as Row).version)),
    body: JSON.stringify({
      expectedVersion: (replayed.data.picking as Row).version,
      reason: 'Second claim must be refused',
    }),
  })
  assert.equal(secondClaim.status, 422)

  const staleRelease = await e2e.client.request('/api/staff/v1/warehouse/pickings/pick-a/release', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'warehouse-release-stale', String(ready.version)),
    body: JSON.stringify({ expectedVersion: ready.version, reason: 'Stale release must fail' }),
  })
  assert.equal(staleRelease.status, 409)

  const claimedPicking = claimed.data.picking as Row
  const scanStart = await e2e.client.request('/api/staff/v1/warehouse/pickings/pick-a/scan-sessions', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'warehouse-scan-start-1', String(claimedPicking.version)),
    body: JSON.stringify({ expectedVersion: claimedPicking.version }),
  })
  assert.equal(scanStart.status, 200)
  const scan = (await scanStart.json()) as Envelope<Row>
  assert.match(String(scan.data.version), /^msv_[0-9a-f]{64}$/)
  assert.equal((scan.data.progress as Row).scanned, '0')

  const rejectedResponse = await e2e.client.request(
    `/api/staff/v1/warehouse/scan-sessions/${String(scan.data.publicId)}/events`,
    {
      method: 'POST',
      headers: mutationHeaders(csrf, 'warehouse-scan-event-rejected', String(scan.data.version)),
      body: JSON.stringify({ expectedVersion: scan.data.version, scan: 'PRIVATE-NOT-EXPECTED' }),
    },
  )
  assert.equal(rejectedResponse.status, 200)
  const rejected = (await rejectedResponse.json()) as Envelope<Row>
  assert.equal((rejected.data.feedback as Row).reason, 'PRODUCT_NOT_EXPECTED')
  assert.equal(JSON.stringify(rejected).includes('PRIVATE-NOT-EXPECTED'), false)
  assert.notEqual(rejected.data.version, scan.data.version)

  const scannedResponse = await e2e.client.request(
    `/api/staff/v1/warehouse/scan-sessions/${String(scan.data.publicId)}/events`,
    {
      method: 'POST',
      headers: mutationHeaders(csrf, 'warehouse-scan-event-1', String(rejected.data.version)),
      body: JSON.stringify({ expectedVersion: rejected.data.version, scan: '893000000001' }),
    },
  )
  assert.equal(scannedResponse.status, 200)
  const scanned = (await scannedResponse.json()) as Envelope<Row>
  assert.equal((scanned.data.progress as Row).scanned, '1')
  assert.notEqual(scanned.data.version, scan.data.version)

  const pause = await e2e.client.request(
    `/api/staff/v1/warehouse/scan-sessions/${String(scan.data.publicId)}/transitions`,
    {
      method: 'POST',
      headers: mutationHeaders(csrf, 'warehouse-scan-pause-1', String(scanned.data.version)),
      body: JSON.stringify({ expectedVersion: scanned.data.version, targetState: 'paused' }),
    },
  )
  assert.equal(pause.status, 200)
  assert.equal(((await pause.json()) as Envelope<Row>).data.state, 'paused')

  const preview = await e2e.client.json<Envelope<Row>>('/api/staff/v1/warehouse/pickings/pick-a/execution')
  assert.match(String(preview.data.expectedVersion), /^opv_[0-9a-f]{64}$/)
  const move = (preview.data.moves as Row[])[0]!
  const reservation = (move.reservations as Row[])[0]!
  const executionBody = {
    expectedVersion: preview.data.expectedVersion,
    lines: [
      {
        moveId: move.moveId,
        moveLineId: reservation.moveLineId,
        productId: move.productId,
        quantity: '10',
        sourceLocationId: reservation.sourceLocationId,
        destinationLocationId: move.destinationLocationId,
      },
    ],
  }
  const execution = await e2e.client.request('/api/staff/v1/warehouse/pickings/pick-a/execution/complete', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'warehouse-execution-1', String(preview.data.expectedVersion)),
    body: JSON.stringify(executionBody),
  })
  assert.equal(execution.status, 200)
  const executed = (await execution.json()) as Envelope<Row>
  assert.equal(executed.data.status, 'done')
  assert.equal((await detail(e2e)).state, 'done')

  // A lost success response must be recoverable without creating another stock
  // movement or backorder. Replay the exact logical command after the aggregate
  // version has advanced and require the original canonical result.
  const replayedExecution = await e2e.client.request(
    '/api/staff/v1/warehouse/pickings/pick-a/execution/complete',
    {
      method: 'POST',
      headers: mutationHeaders(csrf, 'warehouse-execution-1', String(preview.data.expectedVersion)),
      body: JSON.stringify(executionBody),
    },
  )
  assert.equal(replayedExecution.status, 200, await replayedExecution.clone().text())
  const replayedExecutionBody = (await replayedExecution.json()) as Envelope<Row>
  assert.equal(replayedExecutionBody.data.status, executed.data.status)
  assert.deepEqual(replayedExecutionBody.data.backorderIds, executed.data.backorderIds)

  const done = await detail(e2e)
  const returnClaimResponse = await e2e.client.request('/api/staff/v1/warehouse/pickings/pick-a/claim', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'warehouse-return-claim-1', String(done.version)),
    body: JSON.stringify({ expectedVersion: done.version, reason: 'Prepare customer return' }),
  })
  assert.equal(returnClaimResponse.status, 200)
  const returnPreviewResponse = await e2e.client.get(
    '/api/staff/v1/warehouse/pickings/pick-a/return-execution',
  )
  assert.equal(returnPreviewResponse.status, 200)
  const reverse = (await returnPreviewResponse.json()) as Envelope<Row>
  assert.match(String(reverse.data.expectedVersion), /^orv_[0-9a-f]{64}$/)
  const reverseLine = (reverse.data.lines as Row[])[0]!
  const returnInput = {
    sourceMoveLineId: reverseLine.sourceMoveLineId,
    productId: reverseLine.productId,
    quantity: reverseLine.quantity,
    sourceLocationId: reverseLine.sourceLocationId,
    destinationLocationId: reverseLine.destinationLocationId,
    ...(reverseLine.lotId ? { lotId: reverseLine.lotId } : {}),
  }
  const returned = await e2e.client.request(
    '/api/staff/v1/warehouse/pickings/pick-a/return-execution/complete',
    {
      method: 'POST',
      headers: mutationHeaders(csrf, 'warehouse-return-1', String(reverse.data.expectedVersion)),
      body: JSON.stringify({ expectedVersion: reverse.data.expectedVersion, lines: [returnInput] }),
    },
  )
  const returnedBody = (await returned.json()) as Envelope<Row>
  assert.equal(returned.status, 200, JSON.stringify(returnedBody))
  assert.equal(returnedBody.data.status, 'done')
  assert.match(String(returnedBody.data.returnPickingId), /^staff_wreturn_[0-9a-f]{64}$/)
})

test('staff warehouse channel covers the complete inventory count lease and submit flow', async (t) => {
  const e2e = await boot(t)
  await prepareAssignedPicking(e2e)
  const scope = { company: 'acme', branches: null }
  const created = await e2e.fixture.call<Row>(
    'stock_staff_channel.createCountSession',
    {
      id: 'count-session-1',
      warehouseId: 'wh',
      locationId: 'wh:stock',
      productId: 'mango',
      mode: 'guided',
      requiredAttemptCount: 1,
    },
    { scope },
  )
  assert.equal(created.value.ok, true, JSON.stringify(created.value))
  await e2e.client.login({ login: 'warehouse-user', password: 'correct horse battery' })
  const bootstrap = await e2e.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')
  const csrf = bootstrap.data.csrfToken

  const worklist = await e2e.client.json<Envelope<{ items: Row[] }>>('/api/staff/v1/warehouse/count-sessions')
  assert.equal(worklist.data.items[0]?.publicId, 'count-session-1')
  assert.equal(worklist.data.items[0]?.claimable, true)

  const count = await e2e.client.json<Envelope<Row>>('/api/staff/v1/warehouse/count-sessions/count-session-1')
  const claim = await e2e.client.request('/api/staff/v1/warehouse/count-sessions/count-session-1/claim', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'warehouse-count-claim-1', String(count.data.version)),
    body: JSON.stringify({ expectedVersion: count.data.version }),
  })
  assert.equal(claim.status, 200)
  const claimed = (await claim.json()) as Envelope<Row>
  assert.match(String(claimed.data.attemptPublicId), /^staff_wcount_attempt_[0-9a-f]{64}$/)
  assert.match(String(claimed.data.attemptVersion), /^ica_[0-9a-f]{64}$/)

  const resume = await e2e.client.request(
    `/api/staff/v1/warehouse/count-attempts/${String(claimed.data.attemptPublicId)}/resume`,
    {
      method: 'POST',
      headers: mutationHeaders(csrf, 'warehouse-count-resume-1', String(claimed.data.attemptVersion)),
      body: JSON.stringify({ expectedVersion: claimed.data.attemptVersion }),
    },
  )
  assert.equal(resume.status, 200)
  const resumed = (await resume.json()) as Envelope<Row>
  assert.notEqual(resumed.data.attemptVersion, claimed.data.attemptVersion)

  const current = await e2e.client.json<Envelope<Row>>(
    '/api/staff/v1/warehouse/count-sessions/count-session-1',
  )
  const attempt = current.data.attempt as Row
  const line = (attempt.lines as Row[])[0]!
  assert.equal(line.systemQuantity, '20')
  const entry = await e2e.client.request(
    `/api/staff/v1/warehouse/count-lines/${String(line.publicId)}/entries`,
    {
      method: 'POST',
      headers: mutationHeaders(csrf, 'warehouse-count-entry-1', String(line.version)),
      body: JSON.stringify({ expectedVersion: line.version, quantity: '20' }),
    },
  )
  assert.equal(entry.status, 200)
  const recorded = (await entry.json()) as Envelope<Row>
  assert.equal(recorded.data.countedQuantity, '20')
  assert.notEqual(recorded.data.attemptVersion, resumed.data.attemptVersion)

  // A token that does not read the body it is handed out with is a 304 carrying
  // the wrong answer. Recording a line advances the line and the attempt and
  // leaves the session row alone, so the session's progress used to move under an
  // unchanged token; renaming the location did the same to the labels.
  const afterEntry = await e2e.client.get('/api/staff/v1/warehouse/count-sessions/count-session-1')
  const afterEntryBody = (await afterEntry.json()) as Envelope<Row>
  assert.equal(current.data.countedLineCount, 0)
  assert.equal(afterEntryBody.data.countedLineCount, 1)
  assert.notEqual(afterEntryBody.data.version, current.data.version)
  // The mutation echo and the next read have to name the same version, or the
  // caller's following command is refused by a resource nobody touched.
  assert.equal(recorded.data.sessionVersion, afterEntryBody.data.version)

  const submit = await e2e.client.request(
    `/api/staff/v1/warehouse/count-attempts/${String(claimed.data.attemptPublicId)}/submit`,
    {
      method: 'POST',
      headers: mutationHeaders(csrf, 'warehouse-count-submit-1', String(recorded.data.attemptVersion)),
      body: JSON.stringify({ expectedVersion: recorded.data.attemptVersion }),
    },
  )
  assert.equal(submit.status, 200)
  const submitted = (await submit.json()) as Envelope<Row>
  assert.equal(submitted.data.attemptState, 'submitted')
  assert.equal(submitted.data.sessionState, 'review_ready')
  assert.equal(submitted.data.completedAttemptCount, 1)

  // The ETag is the wider promise and covers the labels the body resolves. The
  // version deliberately does not: renaming a location belongs to somebody else
  // and must not refuse the next quantity a counter types.
  const beforeRename = await e2e.client.get('/api/staff/v1/warehouse/count-sessions/count-session-1')
  const beforeRenameBody = (await beforeRename.json()) as Envelope<Row>
  await e2e.fixture.call<Row>(
    'stock.saveLocation',
    { id: 'wh:stock', name: 'Kho đã đổi tên', usage: 'internal' },
    { scope },
  )
  const afterRename = await e2e.client.get('/api/staff/v1/warehouse/count-sessions/count-session-1')
  const afterRenameBody = (await afterRename.json()) as Envelope<Row>
  assert.equal(String((beforeRenameBody.data.location as Row).name), 'Stock')
  assert.equal(String((afterRenameBody.data.location as Row).name), 'Kho đã đổi tên')
  assert.notEqual(afterRename.headers.get('etag'), beforeRename.headers.get('etag'))
  assert.equal(afterRenameBody.data.version, beforeRenameBody.data.version)
})

/**
 * Picking less than was asked for is the ordinary case, and it leaves work behind.
 *
 * The execution preview promises `createBackorder: 'always'`, and `completePicking`
 * hands the new transfer's id back, but the channel was dropping it and answering
 * with an empty list — so a partial pick reported itself as a finished one and the
 * caller had no way to reach the remainder.
 */
test('staff warehouse channel names the backorder a partial execution leaves behind', async (t) => {
  const e2e = await boot(t)
  await prepareAssignedPicking(e2e)
  const scope = { company: 'acme', branches: null }
  await e2e.client.login({ login: 'warehouse-user', password: 'correct horse battery' })
  const bootstrap = await e2e.client.json<Envelope<{ csrfToken: string }>>('/api/staff/v1/bootstrap')
  const csrf = bootstrap.data.csrfToken

  const ready = await detail(e2e)
  const claim = await e2e.client.request('/api/staff/v1/warehouse/pickings/pick-a/claim', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'warehouse-partial-claim-1', String(ready.version)),
    body: JSON.stringify({ expectedVersion: ready.version, reason: 'Pick what is on the shelf' }),
  })
  assert.equal(claim.status, 200)

  const preview = await e2e.client.json<Envelope<Row>>('/api/staff/v1/warehouse/pickings/pick-a/execution')
  const move = (preview.data.moves as Row[])[0]!
  const reservation = (move.reservations as Row[])[0]!
  assert.equal(move.quantity, '10')
  const execution = await e2e.client.request('/api/staff/v1/warehouse/pickings/pick-a/execution/complete', {
    method: 'POST',
    headers: mutationHeaders(csrf, 'warehouse-partial-execution-1', String(preview.data.expectedVersion)),
    body: JSON.stringify({
      expectedVersion: preview.data.expectedVersion,
      lines: [
        {
          moveId: move.moveId,
          moveLineId: reservation.moveLineId,
          productId: move.productId,
          quantity: '4',
          sourceLocationId: reservation.sourceLocationId,
          destinationLocationId: move.destinationLocationId,
        },
      ],
    }),
  })
  assert.equal(execution.status, 200, await execution.clone().text())
  const executed = (await execution.json()) as Envelope<{ backorderIds: string[] }>
  assert.equal(executed.data.backorderIds.length, 1)

  const pickings = await e2e.fixture.call<Row[]>('stock.listPickingViews', {}, { scope })
  const backorder = pickings.value.find((row) => String(row.id) === String(executed.data.backorderIds[0]))
  assert.ok(backorder, `no transfer named ${String(executed.data.backorderIds[0])}`)
  assert.equal(String(backorder.backorderId), 'pick-a')
})
