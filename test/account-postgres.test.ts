import assert from 'node:assert/strict'
import { test } from 'node:test'
import { callFn, compose, migrateOne, registerFunctions } from '@ketvietlab/ketjs'
import type { Adapter, Row } from '@ketvietlab/ketjs'
import { postgresAdapter } from '@ketvietlab/ketjs-postgres'
import { account, company, partner, product, uom } from '@ketvietlab/ketsuite'
import { address } from '@ketvietlab/ketsuite'

const configured =
  process.env.KET_TEST_PG ?? process.env.DATABASE_URL ?? 'postgres://dev:devpassword@127.0.0.1:5435/ketjs_dev'
const adminUrl = new URL(configured)
adminUrl.pathname = '/postgres'

const reachable = await (async () => {
  const adapter = postgresAdapter(adminUrl.toString())
  try {
    await adapter.open()
    await adapter.all('SELECT 1')
    await adapter.close()
    return true
  } catch {
    await adapter.close().catch(() => {})
    return false
  }
})()

const live = { skip: reachable ? false : `no PostgreSQL at ${adminUrl.toString()}` }
const modules = [address, partner, company, uom, product, account]
const manifest = compose(modules, { headless: true })
const scope = { company: 'acme', branches: null }
const call = (adapter: Adapter, name: string, input: Record<string, unknown> = {}) =>
  callFn(name, input, { adapter, manifest, scope }).then((result) => result.value as Row)

async function seed(adapter: Adapter) {
  registerFunctions(modules)
  await call(adapter, 'partner.savePartner', { id: 'acme-party', kind: 'company', name: 'ACME' })
  await call(adapter, 'partner.savePartner', { id: 'customer', kind: 'company', name: 'Customer' })
  await call(adapter, 'company.saveCompany', {
    id: 'acme',
    code: 'ACME',
    partnerId: 'acme-party',
    currency: 'VND',
  })
  for (const [id, code, name, accountType] of [
    ['receivable', '131', 'Receivable', 'asset_receivable'],
    ['bank', '1121', 'Bank', 'asset_cash'],
    ['revenue', '5111', 'Revenue', 'income'],
  ])
    await call(adapter, 'account.saveAccount', { id, code, name, accountType })
  await call(adapter, 'account.saveJournal', {
    id: 'sales',
    name: 'Sales',
    code: 'SAL',
    type: 'sale',
  })
}

test('account PostgreSQL: line/post and reversal races preserve one exact ledger history', live, async () => {
  const database = `ket_account_${process.pid}_${Date.now()}`
  const databaseUrl = new URL(adminUrl)
  databaseUrl.pathname = `/${database}`
  const admin = postgresAdapter(adminUrl.toString(), { max: 1 })
  const first = postgresAdapter(databaseUrl.toString(), { max: 3 })
  const second = postgresAdapter(databaseUrl.toString(), { max: 3 })
  await admin.open()
  await admin.exec(`CREATE DATABASE "${database}"`)
  try {
    await Promise.all([first.open(), second.open()])
    await migrateOne(first, manifest)
    await seed(first)

    await call(first, 'account.createMove', {
      id: 'posting-race',
      journalId: 'sales',
      moveType: 'entry',
      accountingDate: '2026-08-28',
    })
    await call(first, 'account.addMoveLine', {
      id: 'posting-race:debit',
      moveId: 'posting-race',
      name: 'Debit',
      accountId: 'bank',
      debit: '10',
      expectedRevision: 0,
    })
    await call(first, 'account.addMoveLine', {
      id: 'posting-race:credit',
      moveId: 'posting-race',
      name: 'Credit',
      accountId: 'revenue',
      credit: '10',
      expectedRevision: 1,
    })

    const [postedRace, addedRace] = await Promise.all([
      call(first, 'account.postMove', { id: 'posting-race', expectedRevision: 2 }),
      call(second, 'account.addMoveLine', {
        id: 'posting-race:late',
        moveId: 'posting-race',
        name: 'Late debit',
        accountId: 'bank',
        debit: '1',
        expectedRevision: 2,
      }),
    ])
    assert.equal([postedRace, addedRace].filter((result) => result.ok === true).length, 1)
    const racedMove = await call(first, 'account.getMove', { id: 'posting-race' })
    const racedLines = racedMove.lines as Row[]
    if (racedMove.state === 'posted') {
      assert.equal(racedLines.length, 2)
    } else {
      assert.equal(racedMove.state, 'draft')
      assert.equal(racedLines.length, 3)
      await call(first, 'account.addMoveLine', {
        id: 'posting-race:late-counterpart',
        moveId: 'posting-race',
        name: 'Late credit',
        accountId: 'revenue',
        credit: '1',
        expectedRevision: 3,
      })
      assert.equal(
        (await call(first, 'account.postMove', { id: 'posting-race', expectedRevision: 4 })).ok,
        true,
      )
    }

    await call(first, 'account.createMove', {
      id: 'period-lock-race',
      journalId: 'sales',
      moveType: 'entry',
      accountingDate: '2026-07-31',
    })
    await call(first, 'account.addMoveLine', {
      id: 'period-lock-race:debit',
      moveId: 'period-lock-race',
      name: 'Debit',
      accountId: 'bank',
      debit: '10',
    })
    await call(first, 'account.addMoveLine', {
      id: 'period-lock-race:credit',
      moveId: 'period-lock-race',
      name: 'Credit',
      accountId: 'revenue',
      credit: '10',
    })
    const [lockResult, lockRacePost] = await Promise.all([
      call(first, 'account.changePeriodLock', {
        id: 'lock-july-sales',
        scope: 'sales',
        through: '2026-07-31',
        reason: 'Concurrent July close',
      }),
      call(second, 'account.postMove', { id: 'period-lock-race' }),
    ])
    assert.equal(lockResult.ok, true)
    const lockRacedMove = await call(first, 'account.getMove', { id: 'period-lock-race' })
    if (lockRacePost.ok === true) assert.equal(lockRacedMove.state, 'posted')
    else {
      assert.equal(lockRacedMove.state, 'draft')
      assert.match(JSON.stringify(lockRacePost.errors), /periodLocked|periodConcurrent/u)
      assert.equal((await call(first, 'account.postMove', { id: 'period-lock-race' })).ok, false)
    }

    const invoiceId = 'exact-invoice'
    const amount = '9007199254740993'
    assert.equal(
      (
        await call(first, 'account.createInvoice', {
          id: invoiceId,
          journalId: 'sales',
          moveType: 'out_invoice',
          partnerId: 'customer',
          accountingDate: '2026-08-28',
          description: 'Exact amount',
          quantity: '1',
          priceUnit: amount,
          lineAccountId: 'revenue',
          counterpartAccountId: 'receivable',
        })
      ).amountTotal,
      amount,
    )
    assert.equal((await call(first, 'account.postMove', { id: invoiceId })).ok, true)
    const beforeReversal = (await call(first, 'account.trialBalance')) as unknown as Row[]
    assert.equal(beforeReversal.find((row) => row.accountId === 'receivable')?.debit, amount)
    assert.equal(beforeReversal.find((row) => row.accountId === 'revenue')?.credit, '9007199254741003')

    const reversalIds = ['exact-reversal-a', 'exact-reversal-b']
    const results = await Promise.all([
      call(first, 'account.reverseMove', { id: invoiceId, reversalId: reversalIds[0] }),
      call(second, 'account.reverseMove', { id: invoiceId, reversalId: reversalIds[1] }),
    ])
    assert.equal(results.filter((result) => result.ok === true).length, 1)
    assert.equal(results.filter((result) => result.ok === false).length, 1)
    const winner = String(results.find((result) => result.ok === true)?.reversalId)
    assert.ok(reversalIds.includes(winner))

    const source = await call(first, 'account.getMove', { id: invoiceId })
    const reversal = await call(first, 'account.getMove', { id: winner })
    assert.equal(source.reversedById, winner)
    assert.equal(source.paymentState, 'reversed')
    assert.equal(reversal.reversalOfId, invoiceId)
    assert.equal(reversal.reversalStatus, 'completed')
    assert.equal(
      Number(
        (await first.all('SELECT COUNT(*) AS n FROM account_move WHERE "reversalOfId" = $1', [invoiceId]))[0]
          ?.n,
      ),
      1,
    )
    const afterReversal = (await call(first, 'account.trialBalance')) as unknown as Row[]
    assert.equal(afterReversal.find((row) => row.accountId === 'receivable')?.balance, '0')
  } finally {
    await Promise.all([first.close().catch(() => {}), second.close().catch(() => {})])
    await admin.exec(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`).catch(() => {})
    await admin.close()
  }
})
