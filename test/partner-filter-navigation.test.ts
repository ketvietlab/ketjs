import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Ctx } from '@ketvietlab/ketjs'
import { functions } from '../packages/ketsuite/src/modules/partner_backend/functions.ts'

test('partner filter changes retain visible columns and locale while replacing filters and resetting paging', async () => {
  const result = (await functions.applyFilter.handler({} as Ctx, {
    lang: 'vi',
    cols: 'id',
    page: 3,
    facets: [
      { id: 'search:old', type: 'field', label: 'Old' },
      { id: 'customer', type: 'filter', label: 'Customer' },
      { id: 'supplier', type: 'filter', label: 'Supplier' },
      { id: 'state', type: 'groupBy', label: 'State' },
      { id: 'search:new', type: 'field', label: 'Minh An' },
    ],
  })) as { href: string }
  const target = new URL(result.href, 'https://ket.test')
  assert.equal(target.pathname, '/admin/partner/partners')
  assert.deepEqual(Object.fromEntries(target.searchParams), {
    q: 'Minh An',
    role: 'supplier',
    groupBy: 'state',
    lang: 'vi',
    cols: 'id',
  })
})
