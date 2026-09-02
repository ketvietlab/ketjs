import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, defineModule, permissionDigest } from '@ketvietlab/ketjs'
import type { KetError } from '@ketvietlab/ketjs'

const handler = () => ({ ok: true })

const sales = defineModule({
  name: 'sales',
  functions: {
    list: { handler },
    save: { handler },
    confirm: { handler },
    callback: { anonymous: true, handler },
    repair: { exposure: 'internal', handler },
  },
  permissions: {
    posture: 'permission-bearing',
    owner: 'sales',
    bundles: {
      'sales.view': { labels: { en: 'View sales', vi: 'Xem bán hàng' } },
      'sales.operate': {
        labels: { en: 'Operate sales', vi: 'Thao tác bán hàng' },
        includes: ['sales.view'],
      },
      'sales.approve': {
        labels: { en: 'Approve sales', vi: 'Duyệt bán hàng' },
        includes: ['sales.view'],
      },
    },
    functions: {
      'sales.list': { risk: 'read', bundles: ['sales.view'], owner: 'sales' },
      'sales.save': { risk: 'operate', bundles: ['sales.operate'], owner: 'sales' },
      'sales.confirm': {
        risk: 'approve',
        bundles: ['sales.approve'],
        owner: 'sales',
        policy: 'sales.order-confirmation',
      },
    },
    exemptions: {
      'sales.callback': { reason: 'anonymous', authority: 'signed customer callback' },
      'sales.repair': { reason: 'internal-route', authority: 'sales repair route' },
    },
  },
})

const hasDiagnostic = (error: unknown, code: string): boolean =>
  Boolean((error as KetError).items?.some((item) => item.code === code))

test('permission bundles compile deterministically to exact functions and managed templates', () => {
  const roleTemplates = {
    'commerce.sales-representative': {
      version: 1,
      labels: { en: 'Sales Representative', vi: 'Nhân viên bán hàng' },
      bundles: ['sales.operate'],
    },
  }
  const first = compose([sales], { requirePermissionCoverage: true, roleTemplates }).permissions
  const second = compose([sales], { requirePermissionCoverage: true, roleTemplates }).permissions
  assert.equal(first.digest, second.digest)
  assert.deepEqual(first.bundles['sales.operate']?.functions, ['sales.list', 'sales.save'])
  assert.deepEqual(first.roleTemplates['commerce.sales-representative']?.functions, [
    'sales.list',
    'sales.save',
  ])
  assert.equal(first.functions['sales.confirm']?.policy, 'sales.order-confirmation')
})

test('permission digests are stable for key order and total over undefined evidence', () => {
  assert.equal(permissionDigest({ a: 1, b: undefined }), permissionDigest({ b: undefined, a: 1 }))
  assert.equal(permissionDigest(undefined), permissionDigest(undefined))
})

test('permission coverage fails closed for a new function', () => {
  const changed = defineModule({
    name: 'sales',
    functions: { ...sales.functions, exportAll: { handler } },
    permissions: sales.permissions!,
  })
  assert.throws(
    () => compose([changed], { requirePermissionCoverage: true }),
    (error) => hasDiagnostic(error, 'E_PERMISSION_FUNCTION_UNCLASSIFIED'),
  )
})

test('permission bundles reject cycles and duplicate includes', () => {
  const broken = defineModule({
    name: 'sales',
    functions: sales.functions,
    permissions: {
      ...sales.permissions!,
      bundles: {
        ...sales.permissions!.bundles,
        'sales.view': {
          labels: { en: 'View sales', vi: 'Xem bán hàng' },
          includes: ['sales.operate', 'sales.operate'],
        },
      },
    },
  })
  assert.throws(
    () => compose([broken], { requirePermissionCoverage: true }),
    (error) =>
      hasDiagnostic(error, 'E_PERMISSION_CATALOG_INVALID') &&
      hasDiagnostic(error, 'E_PERMISSION_BUNDLE_CYCLE'),
  )
})

test('permission bundle references cannot cross an undeclared dependency', () => {
  const extension = defineModule({
    name: 'extension',
    functions: { execute: { handler } },
    permissions: {
      posture: 'permission-bearing',
      owner: 'extension',
      bundles: {
        'extension.operate': {
          labels: { en: 'Operate extension', vi: 'Thao tác mở rộng' },
          includes: ['sales.view'],
        },
      },
      functions: {
        'extension.execute': {
          risk: 'operate',
          bundles: ['extension.operate'],
          owner: 'extension',
        },
      },
      exemptions: {},
    },
  })
  assert.throws(
    () => compose([sales, extension], { requirePermissionCoverage: true }),
    (error) => hasDiagnostic(error, 'E_PERMISSION_CATALOG_INVALID'),
  )
})

test('permission declarations reject missing functions and high risk without policy', () => {
  const broken = defineModule({
    name: 'sales',
    functions: sales.functions,
    permissions: {
      ...sales.permissions!,
      functions: {
        ...sales.permissions!.functions,
        'sales.confirm': {
          risk: 'approve',
          bundles: ['sales.approve'],
          owner: 'sales',
        },
        'sales.removed': { risk: 'read', bundles: ['sales.view'], owner: 'sales' },
      },
    },
  })
  assert.throws(
    () => compose([broken], { requirePermissionCoverage: true }),
    (error) => hasDiagnostic(error, 'E_PERMISSION_FUNCTION_STALE'),
  )
})
