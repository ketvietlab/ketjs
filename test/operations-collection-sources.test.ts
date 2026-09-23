import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Route, ServeContext } from '@ketvietlab/ketjs'
import accountBackend from '../packages/ketsuite/src/modules/account_backend/index.ts'

const stopAfterRead = new Error('Collection read observed')
const request = { method: 'GET', headers: {} } as Parameters<Route>[1]

for (const [path, source, expected] of [
  ['/admin/accounting/entries', 'account.listMoves', { moveType: 'entry' }],
  [
    '/admin/accounting/customer-invoices',
    'account.listMoves',
    { moveTypes: ['out_invoice', 'out_refund', 'out_receipt'] },
  ],
  [
    '/admin/accounting/vendor-bills',
    'account.listMoves',
    { moveTypes: ['in_invoice', 'in_refund', 'in_receipt'] },
  ],
  ['/admin/accounting/payments', 'account.listPayments', {}],
] as const) {
  test(`${path} requests the complete authorized source before local filtering and paging`, async () => {
    const url = new URL(`https://ket.test${path}?page=8&lang=vi`)
    let observed: Record<string, unknown> | undefined
    const ctx = {
      call: async (
        name: string,
        args: Record<string, unknown>,
        calledUrl: URL,
        calledRequest: Parameters<Route>[1],
      ) => {
        if (name === source) {
          observed = args
          assert.equal(calledUrl, url)
          assert.equal(calledRequest, request)
          throw stopAfterRead
        }
        return []
      },
    } as unknown as ServeContext
    const route = (accountBackend.routes![path] as (ctx: ServeContext) => Route)(ctx)
    await assert.rejects(
      async () => route(url, request, {}),
      (error: unknown) => error === stopAfterRead,
    )
    assert.ok(observed)
    assert.equal('limit' in observed, false)
    assert.deepEqual(observed, expected)
  })
}

for (const [path, filter] of [
  ['/admin/purchase/rfqs', { states: ['draft', 'sent', 'to approve'] }],
  ['/admin/purchase/orders', { state: 'purchase' }],
] as const) {
  test(`${path} continues past the old 2000-row cap with search and authorization intact`, async () => {
    const { default: purchaseBackend } = await import(
      '../packages/ketsuite/src/modules/purchase_backend/index.ts'
    )
    const url = new URL(`https://ket.test${path}?q=needle&group=partnerName&lang=vi`)
    const calls: Array<Record<string, unknown>> = []
    const ctx = {
      call: async (
        name: string,
        args: Record<string, unknown>,
        calledUrl: URL,
        calledRequest: Parameters<Route>[1],
      ) => {
        if (name === 'purchase.listOrders') {
          calls.push(args)
          assert.equal(calledUrl, url)
          assert.equal(calledRequest, request)
          if (Number(args.offset) >= 2000) throw stopAfterRead
          return Array.from({ length: Number(args.limit) }, (_, index) => ({
            id: `purchase-${Number(args.offset) + index}`,
          }))
        }
        return []
      },
    } as unknown as ServeContext
    const route = (purchaseBackend.routes![path] as (ctx: ServeContext) => Route)(ctx)
    await assert.rejects(
      async () => route(url, request, {}),
      (error: unknown) => error === stopAfterRead,
    )
    assert.deepEqual(
      calls.map((call) => call.offset),
      [0, 500, 1000, 1500, 2000],
    )
    // The query narrows the collection in memory now, so the read stays whole.
    for (const call of calls) assert.deepEqual(call, { ...filter, limit: 500, offset: call.offset })
  })
}
