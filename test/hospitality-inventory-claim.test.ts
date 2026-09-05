import assert from 'node:assert/strict'
import { test } from 'node:test'
import { defineDeployment, defineFn, defineModule } from '@ketvietlab/ketjs'
import type { Ctx, Row, Scope } from '@ketvietlab/ketjs'
import { createTestDeployment } from '@ketvietlab/ketjs/testing'
import * as suite from '@ketvietlab/ketsuite'
import backend from '@ketvietlab/ketsuite/backend'
import { InventoryConflict, replaceInventoryClaim } from '@ketvietlab/ketsuite'
import type { InventoryHold } from '@ketvietlab/ketsuite'

const scope: Scope = { company: 'default', companies: ['default'], branches: null }

/**
 * A channel adapter reaches the ledger exactly this way: inside the caller's
 * own transaction, so a claim and the rows it was taken for commit or roll back
 * together. The bridge below is the shape the export exists for.
 */
const bridge = defineModule({
  name: 'hospitality_inventory_claim_test',
  depends: ['hospitality_core'],
  functions: {
    replace: defineFn({
      input: { propertyId: 'id', previous: 'json', next: 'json' },
      output: { ok: 'bool', refused: 'text?' },
      effects: [
        'read:hospitality_core.Room',
        'read:hospitality_core.AvailabilityLedger',
        'write:hospitality_core.AvailabilityLedger',
      ],
      agent: true,
      handler: async (ctx: Ctx, args) => {
        try {
          await ctx.tx((tx) =>
            replaceInventoryClaim(
              tx,
              args.propertyId,
              args.previous as InventoryHold[],
              args.next as InventoryHold[],
            ),
          )
          return { ok: true }
        } catch (error) {
          if (error instanceof InventoryConflict) return { ok: false, refused: error.problem.code }
          throw error
        }
      },
    }),
  },
})

const app = defineDeployment({
  name: 'hospitality_inventory_claim_test',
  modules: [
    suite.website,
    suite.address,
    suite.partner,
    suite.company,
    suite.storage,
    suite.uom,
    suite.product,
    suite.user,
    backend,
    suite.hospitalityCore,
    bridge,
  ],
  theme: suite.paperTheme,
  serve: { defaults: { defaultCompany: 'default', defaultLocale: 'vi', fallbackLocale: 'vi' } },
})

test('a room-night claim moves as one net change, never as a release and a retake', async (t) => {
  const e2e = await createTestDeployment(app)
  t.after(() => e2e.close())
  const call = <T>(name: string, input: Record<string, unknown> = {}) =>
    e2e.fixture.call<T>(name, input, { scope })

  await call('hospitality_core.saveProperty', {
    id: 'hotel',
    code: 'HT',
    name: 'Synthetic Hotel',
    accommodationType: 'hotel',
    timezone: 'Asia/Ho_Chi_Minh',
    defaultCheckIn: '14:00',
    defaultCheckOut: '12:00',
  })
  await call('hospitality_core.saveRoomType', {
    id: 'deluxe',
    propertyId: 'hotel',
    code: 'DLX',
    name: 'Deluxe',
    baseRate: '100',
  })
  // Two rooms, so the ledger's own total is two without setting it by hand.
  for (const code of ['201', '202'])
    await call('hospitality_core.saveRoom', {
      id: `room-${code}`,
      propertyId: 'hotel',
      roomTypeId: 'deluxe',
      code,
      name: `Room ${code}`,
      capacity: 2,
      status: 'available',
    })

  const replace = (previous: InventoryHold[], next: InventoryHold[]) =>
    call<{ ok: boolean; refused?: string }>('hospitality_inventory_claim_test.replace', {
      propertyId: 'hotel',
      previous,
      next,
    })
  const ledger = () =>
    e2e.fixture.withTenant('', async ({ adapter }) =>
      (
        await adapter.all(
          'SELECT date, total, sold, available FROM hospitality_core_availability_ledger ORDER BY date',
        )
      ).map((row: Row) => `${row.date}:${row.sold}/${row.total}`),
    )

  const first: InventoryHold = { roomTypeId: 'deluxe', dates: ['2026-10-01'] }
  const second: InventoryHold = { roomTypeId: 'deluxe', dates: ['2026-10-01'] }

  assert.equal((await replace([], [first, second])).value.ok, true)
  assert.deepEqual(await ledger(), ['2026-10-01:2/2'], 'both rooms are taken for that night')

  // A third room on a night that has two is refused, and the ledger is untouched.
  const third = await replace([], [{ roomTypeId: 'deluxe', dates: ['2026-10-01'] }])
  assert.deepEqual(
    { ok: third.value.ok, refused: third.value.refused },
    { ok: false, refused: 'no_availability' },
  )
  assert.deepEqual(await ledger(), ['2026-10-01:2/2'], 'a refused claim leaves the ledger alone')

  // Restating the same claim nets to nothing. Taking without giving back first
  // would ask for four rooms out of two and be refused; giving back first would
  // open a window another booking could take. Neither happens.
  assert.equal((await replace([first, second], [first, second])).value.ok, true)
  assert.deepEqual(await ledger(), ['2026-10-01:2/2'], 'a restated claim holds exactly what it held')

  // One room moves to the next night while the other stays. The night that is
  // kept nets to zero, so this fits in a two-room hotel — the case a single-swap
  // helper cannot express.
  const moved: InventoryHold = { roomTypeId: 'deluxe', dates: ['2026-10-02'] }
  assert.equal((await replace([first, second], [first, moved])).value.ok, true)
  assert.deepEqual(await ledger(), ['2026-10-01:1/2', '2026-10-02:1/2'])

  // And giving the whole claim back leaves the hotel empty rather than negative.
  assert.equal((await replace([first, moved], [])).value.ok, true)
  assert.deepEqual(await ledger(), ['2026-10-01:0/2', '2026-10-02:0/2'])
})
