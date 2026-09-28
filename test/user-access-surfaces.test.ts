import assert from 'node:assert/strict'
import { test } from 'node:test'
import { compose, defineModule } from '@ketvietlab/ketjs'
import { surfaceRows } from '../packages/ketsuite/src/modules/user/access-surfaces.ts'

const probe = defineModule({
  name: 'surface_probe',
  functions: Object.fromEntries(
    ['read', 'lookup', 'write'].map((key) => [key, { handler: () => ({ ok: true }) }]),
  ),
  menus: {
    page: {
      label: 'Page',
      path: '/page',
      needs: 'surface_probe.read',
      for: ['surface_probe.write'],
      requires: ['surface_probe.lookup', 'surface_probe.lookup'],
    },
  },
  permissions: {
    posture: 'permission-bearing',
    owner: 'surface_probe',
    bundles: Object.fromEntries(
      ['read', 'lookup', 'write'].map((key) => [`surface_probe.${key}`, { labels: { vi: key, en: key } }]),
    ),
    functions: Object.fromEntries(
      ['read', 'lookup', 'write'].map((key) => [
        `surface_probe.${key}`,
        {
          owner: 'surface_probe',
          risk: key === 'write' ? ('operate' as const) : ('read' as const),
          bundles: [`surface_probe.${key}`],
        },
      ]),
    ),
    exemptions: {},
  },
})
const manifest = compose([probe], {
  headless: true,
  roleTemplates: {
    'test.exact': { version: 1, labels: { vi: 'Tra cứu', en: 'Lookup' }, bundles: ['surface_probe.lookup'] },
    'test.broad': {
      version: 1,
      labels: { vi: 'Quản lý', en: 'Manager' },
      bundles: ['surface_probe.lookup', 'surface_probe.write'],
    },
  },
})

test('surfaces diagnose required lookups, deduplicate gaps and never suggest unrelated authority', () => {
  const [row] = surfaceRows({ manifest }, 'en', (fn) => fn === 'surface_probe.read')
  assert.equal(row.status, 'partial')
  assert.deepEqual(row.missing, [{ key: 'surface_probe.lookup', label: 'lookup', tier: 'read' }])
  assert.deepEqual(row.fixes, ['Lookup'])
  const [readOnly] = surfaceRows({ manifest }, 'en', (fn) => fn !== 'surface_probe.write')
  assert.equal(readOnly.status, 'full')
  assert.deepEqual(readOnly.missing, [])
  assert.deepEqual(
    surfaceRows({ manifest }, 'en', () => false),
    [],
  )
})
