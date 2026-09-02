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

  assert.equal(ketsuitePermissionModuleNames.length, 59)
  assert.equal(Object.keys(manifest.permissions.modules).length, 59)
  assert.equal(Object.keys(manifest.permissions.bundles).length, 140)
  assert.equal(Object.keys(manifest.permissions.functions).length, 698)
  assert.equal(Object.keys(manifest.permissions.exemptions).length, 70)

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
