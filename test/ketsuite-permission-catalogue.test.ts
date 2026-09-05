import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose } from '@ketvietlab/ketjs'
import { ketsuitePermissionModuleNames, ketsuitePermissionModules } from '@ketvietlab/ketsuite'
import { createKetsuiteDeployment } from '../packages/ketsuite/src/deployment.ts'

test('public production permission catalogue covers every function owned by its modules', () => {
  const deployment = createKetsuiteDeployment()
  const modules = [
    ...deployment.modules,
    ...(deployment.theme ? [deployment.theme] : []),
    ...(deployment.themes ?? []),
  ]
  const manifest = compose(modules, {
    modulePermissionDeclarations: ketsuitePermissionModules,
  })

  assert.equal(ketsuitePermissionModuleNames.length, 65)
  assert.equal(Object.keys(manifest.permissions.modules).length, 65)
  assert.equal(Object.keys(manifest.permissions.bundles).length, 156)
  assert.equal(Object.keys(manifest.permissions.functions).length, 768)
  assert.equal(Object.keys(manifest.permissions.exemptions).length, 79)

  const coveredModules = new Set(ketsuitePermissionModuleNames)
  const missing = Object.entries(manifest.functions)
    .filter(([, fn]) => coveredModules.has(fn.by))
    .map(([key]) => key)
    .filter((key) => !manifest.permissions.functions[key] && !manifest.permissions.exemptions[key])
  assert.deepEqual(missing, [])
})

test('public catalogue separates identity administration from sensitive inspection', () => {
  const declaration = ketsuitePermissionModules.user
  assert.deepEqual(declaration?.functions['user.cloneManagedRole'], {
    risk: 'security',
    bundles: ['user.security'],
    owner: 'user',
    policy: 'user.security-audit',
  })
  assert.deepEqual(declaration?.functions['user.effectiveAccess'], {
    risk: 'sensitive',
    bundles: ['user.sensitive'],
    owner: 'user',
    policy: 'user.sensitive-data',
  })
})

test('public catalogue keeps ordinary POS operation below cash, refund, void, and configuration authority', () => {
  const declaration = ketsuitePermissionModules.pos
  assert.deepEqual(declaration?.functions['pos.createOrder']?.bundles, ['pos.order-operate'])
  assert.deepEqual(declaration?.functions['pos.addPayment']?.bundles, ['pos.tender'])
  assert.deepEqual(declaration?.functions['pos.refundOrder']?.bundles, ['pos.refund'])
  assert.deepEqual(declaration?.functions['pos.voidPayment']?.bundles, ['pos.void'])
  assert.deepEqual(declaration?.functions['pos.recordCashMovement']?.bundles, ['pos.cash-control'])
  assert.deepEqual(declaration?.functions['pos.validateOrder']?.bundles, ['pos.reconcile'])
  assert.deepEqual(declaration?.functions['pos.saveConfig']?.bundles, ['pos.configure'])
})

test('public catalogue keeps quotation work separate from confirmation, cancellation, invoicing, and reporting', () => {
  const declaration = ketsuitePermissionModules.sale
  assert.deepEqual(declaration?.functions['sale.saveDraft']?.bundles, ['sale.quote-operate'])
  assert.deepEqual(declaration?.functions['sale.confirmOrder']?.bundles, ['sale.confirm'])
  assert.deepEqual(declaration?.functions['sale.cancelOrder']?.bundles, ['sale.cancel'])
  assert.deepEqual(declaration?.functions['sale.createInvoice']?.bundles, ['sale.invoice'])
  assert.deepEqual(declaration?.functions['sale.getSalesOrderReport']?.bundles, ['sale.report'])
})

test('public catalogue separates CRM agent work from assignment, merge, analytics, and configuration', () => {
  const declaration = ketsuitePermissionModules.crm
  assert.deepEqual(declaration?.functions['crm.case.save']?.bundles, ['crm.agent-operate'])
  assert.deepEqual(declaration?.functions['crm.case.reassign']?.bundles, ['crm.assignment'])
  assert.deepEqual(declaration?.functions['crm.case.merge']?.bundles, ['crm.merge'])
  assert.deepEqual(declaration?.functions['crm.enrichment.preview']?.bundles, ['crm.analytics'])
  assert.deepEqual(declaration?.functions['crm.assignmentRule.save']?.bundles, ['crm.configure'])
})

test('public catalogue separates Flow reading, working, writing documents, and project configuration', () => {
  const declaration = ketsuitePermissionModules.flow
  // Reading is the floor and pulls nothing else in with it.
  assert.deepEqual(declaration?.functions['flow.issue.list']?.bundles, ['flow.view'])
  // Ordinary work: moving an issue is the one door that checks dependencies.
  assert.deepEqual(declaration?.functions['flow.issue.move']?.bundles, ['flow.operate'])
  // Writing the collaborative document is its own right: a reviewer may hold it
  // without holding the right to rename the record.
  assert.deepEqual(declaration?.functions['flow.issue.editDescription']?.bundles, ['flow.author'])
  assert.deepEqual(declaration?.functions['flow.page.editContent']?.bundles, ['flow.author'])
  assert.notDeepEqual(
    declaration?.functions['flow.page.save']?.bundles,
    declaration?.functions['flow.page.editContent']?.bundles,
  )
  // Changing a column's `terminalState` changes what "done" means for the whole
  // project — and with it every progress figure and every blocking check. That is
  // audited configuration, not day-to-day work.
  assert.equal(declaration?.functions['flow.column.save']?.risk, 'configure')
  assert.equal(declaration?.functions['flow.column.save']?.policy, 'flow.configuration-audit')
  // The two keys whose reach exceeds one project both carry a policy authority.
  assert.equal(declaration?.functions['flow.tag.archive']?.policy, 'flow.configuration-audit')
  assert.equal(declaration?.functions['flow.page.move']?.policy, 'flow.domain-policy')
  // Live Doc's four commit functions are not a right anybody is granted: they are
  // exempt because the route calling them has already run its own record check.
  const bridge = ketsuitePermissionModules.flow_backend
  assert.equal(bridge?.posture, 'projection/bridge')
  assert.deepEqual(Object.keys(bridge?.functions ?? {}), [])
  assert.deepEqual(bridge?.exemptions['flow_backend.sync.commitContent'], {
    reason: 'internal-route',
    authority: 'flow_backend.trusted-route-worker-or-service',
  })
})

test('public catalogue exposes least-privilege Hospitality job bundles without removing legacy grants', () => {
  const declaration = ketsuitePermissionModules.hospitality_core

  assert.deepEqual(declaration?.functions['hospitality_core.startCleaningTask']?.bundles, [
    'hospitality_core.operate',
    'hospitality_core.housekeeping-attend',
  ])
  assert.deepEqual(declaration?.functions['hospitality_core.setRoomStatus']?.bundles, [
    'hospitality_core.configure',
    'hospitality_core.housekeeping-supervise',
  ])
  assert.deepEqual(declaration?.functions['hospitality_core.requestNightAudit']?.bundles, [
    'hospitality_core.sensitive',
    'hospitality_core.night-audit',
  ])
  assert.deepEqual(declaration?.functions['hospitality_core.createReservation']?.bundles, [
    'hospitality_core.operate',
    'hospitality_core.reservation-input',
  ])
  assert.deepEqual(declaration?.functions['hospitality_core.setInventoryRange']?.bundles, [
    'hospitality_core.configure',
    'hospitality_core.revenue-operate',
  ])
  assert.deepEqual(declaration?.functions['hospitality_core.confirmStayNotice']?.bundles, [
    'hospitality_core.approve',
    'hospitality_core.compliance-operate',
  ])
  assert.deepEqual(declaration?.functions['hospitality_core.listProperties']?.bundles, [
    'hospitality_core.view',
    'hospitality_core.night-audit',
    'hospitality_core.property-reference',
    'hospitality_core.reservation-input',
    'hospitality_core.revenue-operate',
  ])
  assert.ok(
    declaration?.functions['hospitality_core.listRooms']?.bundles.includes(
      'hospitality_core.housekeeping-supervise',
    ),
  )

  assert.equal(
    declaration?.functions['hospitality_core.listGuestDocuments']?.bundles.includes(
      'hospitality_core.housekeeping-attend',
    ),
    false,
  )
  assert.equal(
    declaration?.functions['hospitality_core.addCharge']?.bundles.includes(
      'hospitality_core.revenue-operate',
    ),
    false,
  )
})
