import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  callFn,
  compose,
  defineFn,
  defineModule,
  migrateOne,
  registerFunctions,
  sqliteAdapter,
} from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { account, address, company, partner, product, uom } from '@ketvietlab/ketsuite'

const probe = defineModule({
  name: 'account_wave3_probe',
  depends: ['account'],
  functions: {
    rows: defineFn({
      input: { model: 'text', id: 'id?' },
      effects: [
        'read:account.Asset',
        'read:account.AssetEvent',
        'read:account.AssetScheduleLine',
        'read:account.AssetBatchRun',
        'read:account.CostRun',
        'read:account.CostInput',
        'read:account.CostVariance',
        'read:account.CostAdjustmentProposal',
        'read:account.Move',
        'read:account.MoveLine',
      ],
      handler: (ctx, args) => ctx.db.select(String(args.model), args.id ? { id: args.id } : {}),
    }),
  },
})
const modules = [address, partner, company, uom, product, account, probe]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }
const call = (name: string, args: Record<string, unknown>, adapter: Adapter) =>
  callFn(name, args, { adapter, manifest, scope }).then((result) => result.value as Row)

async function boot() {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions(modules)
  await call('partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' }, adapter)
  await call('company.saveCompany', { id: 'acme', partnerId: 'acme-party', currency: 'USD' }, adapter)
  for (const [id, code, name, accountType] of [
    ['asset', 'FA', 'Fixed assets', 'asset_fixed'],
    ['accumulated', 'FA.ACC', 'Accumulated depreciation', 'asset_fixed'],
    ['expense', 'DEP', 'Depreciation expense', 'expense_depreciation'],
    ['inventory', 'INV', 'Inventory', 'asset_current'],
    ['variance', 'VAR', 'Cost variance', 'expense_direct_cost'],
  ])
    await call('account.saveAccount', { id, code, name, accountType }, adapter)
  await call('account.saveJournal', { id: 'general', name: 'General', code: 'GEN', type: 'general' }, adapter)
  await call(
    'account.saveAssetCategory',
    {
      id: 'fixed-assets',
      name: 'Fixed assets',
      kind: 'fixed_asset',
      acquisitionAccountId: 'asset',
      accumulatedAccountId: 'accumulated',
      expenseAccountId: 'expense',
      disposalLossAccountId: 'variance',
      journalId: 'general',
      usefulLifePeriods: 12,
    },
    adapter,
  )
  return adapter
}

test('account assets: source retries, schedules, batch drafts, posting and audit stay aligned', async () => {
  const adapter = await boot()
  try {
    const created = await call(
      'account.createAsset',
      {
        id: 'asset-1',
        name: 'Production machine',
        categoryId: 'fixed-assets',
        sourceType: 'invoice',
        sourceId: 'vendor-bill-1',
        sourceLineId: 'line-1',
        originalCost: '1200.00',
        accumulatedAmount: '0',
        residualValue: '0',
        startDate: '2026-01-31',
        actorId: 'accountant',
      },
      adapter,
    )
    assert.equal(created.ok, true)
    const retried = await call(
      'account.createAsset',
      {
        id: 'asset-duplicate',
        name: 'Production machine',
        categoryId: 'fixed-assets',
        sourceType: 'invoice',
        sourceId: 'vendor-bill-1',
        sourceLineId: 'line-1',
        originalCost: '1200.00',
        startDate: '2026-01-31',
      },
      adapter,
    )
    assert.equal(retried.id, 'asset-1')
    assert.equal(retried.duplicate, true)

    const activated = await call(
      'account.transitionAsset',
      { id: 'asset-1', action: 'activate', expectedRevision: 0, actorId: 'accountant' },
      adapter,
    )
    assert.equal(activated.state, 'running')
    const schedule = (await call(
      'account.listAssetSchedule',
      { assetId: 'asset-1' },
      adapter,
    )) as unknown as Row[]
    assert.equal(schedule.length, 12)
    assert.equal(
      schedule.reduce((sum, row) => sum + Number(row.amount), 0),
      1200,
    )
    assert.equal(schedule[1]?.accountingDate, '2026-02-28')

    const [first, retry] = await Promise.all([
      call(
        'account.runAssetBatch',
        { id: 'asset-run-1', idempotencyKey: 'asset-run:2026-01', cutoffDate: '2026-01-31' },
        adapter,
      ),
      call(
        'account.runAssetBatch',
        { id: 'asset-run-2', idempotencyKey: 'asset-run:2026-01', cutoffDate: '2026-01-31' },
        adapter,
      ),
    ])
    assert.equal(first.ok, true)
    assert.equal(retry.ok, true)
    const moves = (await call(
      'account_wave3_probe.rows',
      { model: 'account.Move' },
      adapter,
    )) as unknown as Row[]
    assert.equal(moves.filter((row) => String(row.id).startsWith('asset:')).length, 1)
    const lines = (await call(
      'account_wave3_probe.rows',
      { model: 'account.AssetScheduleLine' },
      adapter,
    )) as unknown as Row[]
    const draft = lines.find((row) => row.state === 'draft')!
    const posted = await Promise.all([
      call('account.postAssetScheduleLine', { id: draft.id }, adapter),
      call('account.postAssetScheduleLine', { id: draft.id }, adapter),
    ])
    assert.equal(
      posted.every((result) => result.ok === true),
      true,
    )
    assert.equal(posted.filter((result) => result.existing === true).length, 1)
    const asset = (
      (await call(
        'account_wave3_probe.rows',
        { model: 'account.Asset', id: 'asset-1' },
        adapter,
      )) as unknown as Row[]
    )[0]!
    assert.equal(asset.accumulatedAmount, '100.00')
    assert.equal(asset.carryingValue, '1100.00')

    const transfers = await Promise.all(
      ['operations', 'maintenance'].map((custodianId) =>
        call(
          'account.transitionAsset',
          {
            id: 'asset-1',
            action: 'transfer',
            expectedRevision: 2,
            custodianId,
            dimension: { department: 'factory' },
            reason: 'Move to production',
            actorId: 'controller',
          },
          adapter,
        ),
      ),
    )
    assert.equal(transfers.filter((result) => result.ok === true).length, 1)
    assert.equal(transfers.filter((result) => result.ok === false).length, 1)
    const events = (await call(
      'account.listAssetEvents',
      { assetId: 'asset-1' },
      adapter,
    )) as unknown as Row[]
    assert.deepEqual(
      events.map((row) => row.action),
      ['created', 'activate', 'schedule_posted', 'transfer'],
    )

    const disposal = await call(
      'account.proposeAssetChange',
      {
        id: 'dispose-asset-1',
        assetId: 'asset-1',
        action: 'dispose',
        accountingDate: '2026-03-31',
        reason: 'Retired after damage',
        actorId: 'controller',
      },
      adapter,
    )
    assert.equal(disposal.ok, true)
    const disposalMove = (
      (await call(
        'account_wave3_probe.rows',
        { model: 'account.Move', id: disposal.moveId },
        adapter,
      )) as unknown as Row[]
    )[0]!
    assert.equal(disposalMove.state, 'draft')
    const completed = await call('account.completeAssetChange', { id: 'dispose-asset-1' }, adapter)
    assert.equal(completed.ok, true)
    const disposed = (
      (await call(
        'account_wave3_probe.rows',
        { model: 'account.Asset', id: 'asset-1' },
        adapter,
      )) as unknown as Row[]
    )[0]!
    assert.equal(disposed.state, 'disposed')
    assert.equal(disposed.carryingValue, '0.00')
    const finalSchedule = (await call(
      'account.listAssetSchedule',
      { assetId: 'asset-1' },
      adapter,
    )) as unknown as Row[]
    assert.equal(finalSchedule.filter((row) => row.state === 'planned').length, 0)
  } finally {
    await adapter.close()
  }
})

test('account costing: immutable snapshots reproduce and only propose draft adjustments', async () => {
  const adapter = await boot()
  try {
    await call(
      'account.saveCostPolicy',
      {
        id: 'actual-cost',
        name: 'Actual production cost',
        method: 'actual_pool',
        pools: [{ id: 'factory' }],
        drivers: [{ id: 'output_quantity' }],
        tolerance: '1.00',
        version: 1,
      },
      adapter,
    )
    const inputs = [
      {
        source: 'stock',
        sourceId: 'stock-period-2026-08',
        facts: { kind: 'material', expected: '700.00', actual: '702.00', ownerId: 'warehouse' },
      },
      {
        source: 'manufacturing',
        sourceId: 'mrp-period-2026-08',
        facts: { kind: 'labor', expected: '200.00', actual: '200.00', ownerId: 'production' },
      },
      {
        source: 'accounting',
        sourceId: 'ledger-period-2026-08',
        facts: { kind: 'overhead', expected: '100.00', actual: '98.00', ownerId: 'controller' },
      },
    ]
    const started = await call(
      'account.startCostRun',
      { id: 'cost-run-1', policyId: 'actual-cost', periodKey: '2026-08', inputs },
      adapter,
    )
    assert.equal(started.ok, true)
    const finalized = await call('account.finalizeCostRun', { id: 'cost-run-1' }, adapter)
    assert.equal(finalized.ok, true)
    assert.match(String(finalized.outputChecksum), /^[0-9a-f]{64}$/)
    const repeated = await call('account.finalizeCostRun', { id: 'cost-run-1' }, adapter)
    assert.equal(repeated.outputChecksum, finalized.outputChecksum)
    assert.equal(repeated.duplicate, true)
    const sameInput = await call(
      'account.startCostRun',
      { id: 'cost-run-retry', policyId: 'actual-cost', periodKey: '2026-08', inputs },
      adapter,
    )
    assert.equal(sameInput.id, 'cost-run-1')
    assert.equal(sameInput.duplicate, true)

    const variances = (await call(
      'account.listCostVariances',
      { runId: 'cost-run-1' },
      adapter,
    )) as unknown as Row[]
    assert.deepEqual(
      variances.map((row) => [row.kind, row.variance, row.severity]),
      [
        ['material', '2.00', 'action_required'],
        ['labor', '0.00', 'within_tolerance'],
        ['overhead', '-2.00', 'action_required'],
      ],
    )
    await call(
      'account.createCostAdjustmentProposal',
      {
        id: 'proposal-1',
        runId: 'cost-run-1',
        varianceId: variances[0]!.id,
        journalId: 'general',
        debitAccountId: 'variance',
        creditAccountId: 'inventory',
        amount: '2.00',
        accountingDate: '2026-08-31',
      },
      adapter,
    )
    const approved = await call(
      'account.approveCostAdjustmentProposal',
      { id: 'proposal-1', actorId: 'controller' },
      adapter,
    )
    assert.equal(approved.ok, true)
    const draftMove = (
      (await call(
        'account_wave3_probe.rows',
        { model: 'account.Move', id: approved.moveId },
        adapter,
      )) as unknown as Row[]
    )[0]!
    assert.equal(draftMove.state, 'draft')
    const frozenInputs = (await call(
      'account_wave3_probe.rows',
      { model: 'account.CostInput' },
      adapter,
    )) as unknown as Row[]
    assert.equal(frozenInputs.length, 3)
  } finally {
    await adapter.close()
  }
})

test('account assets: schedule posting respects the shared period lock', async () => {
  const adapter = await boot()
  try {
    await call(
      'account.createAsset',
      {
        id: 'locked-asset',
        name: 'Locked asset',
        categoryId: 'fixed-assets',
        sourceType: 'manual',
        sourceId: 'locked-source',
        originalCost: '1200.00',
        startDate: '2026-01-31',
      },
      adapter,
    )
    await call('account.transitionAsset', { id: 'locked-asset', action: 'activate' }, adapter)
    await call(
      'account.runAssetBatch',
      { id: 'locked-run', idempotencyKey: 'locked-run', cutoffDate: '2026-01-31' },
      adapter,
    )
    await call(
      'account.changePeriodLock',
      { id: 'all-lock-jan', scope: 'all', through: '2026-01-31', reason: 'Close January' },
      adapter,
    )
    const schedule = (await call(
      'account.listAssetSchedule',
      { assetId: 'locked-asset' },
      adapter,
    )) as unknown as Row[]
    const refused = await call(
      'account.postAssetScheduleLine',
      { id: schedule.find((row) => row.state === 'draft')?.id },
      adapter,
    )
    assert.equal(refused.ok, false)
    assert.equal((refused.errors as Row[])[0]?.code, 'account.error.periodLocked')
  } finally {
    await adapter.close()
  }
})

test('account FX: the conditional gate stays disabled without owner approval evidence', async () => {
  const adapter = await boot()
  try {
    const initial = await call('account.getFxPolicy', {}, adapter)
    assert.equal(initial.state, 'disabled')
    const refused = await call(
      'account.configureFxPolicy',
      { state: 'approved', rateSource: 'central-bank' },
      adapter,
    )
    assert.equal(refused.ok, false)
    const disabled = await call('account.getFxPolicy', {}, adapter)
    assert.equal(disabled.state, 'disabled')
  } finally {
    await adapter.close()
  }
})
