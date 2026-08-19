import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from 'ketjs'
import type { Adapter, Row } from 'ketjs'
import { uom, product, convertQty, roundTo, compareQty, isZero, UomError } from 'ketsuite'
import type { Unit } from 'ketsuite'

const SCOPE = { company: 'acme', branches: null }
const manifest = compose([uom, product], { headless: true })
const call = (fn: string, args: Record<string, unknown>, db: Adapter) =>
  callFn(fn, args, { adapter: db, manifest, scope: SCOPE })

const unit = (id: string, categoryId: string, factor: number, rounding: number): Unit =>
  ({ id, categoryId, factor, rounding })

// A kilogram reference, as Odoo would have it: factor is how many of THIS unit
// make one reference unit.
const KG = unit('kg', 'weight', 1, 0.001)
const GRAM = unit('g', 'weight', 1000, 1)
const TONNE = unit('t', 'weight', 0.001, 0.001)
const PIECE = unit('pc', 'count', 1, 1)

async function boot(): Promise<Adapter> {
  const db = sqliteAdapter()
  await db.open()
  await migrateOne(db, manifest)
  registerFunctions([uom, product])
  await db.run('INSERT INTO uom_category (id, name) VALUES (?, ?)', ['weight', 'Khối lượng'])
  await db.run('INSERT INTO uom_category (id, name) VALUES (?, ?)', ['count', 'Số lượng'])
  return db
}

test('uom: conversion goes through the reference, both directions', () => {
  assert.equal(convertQty(2, KG, GRAM), 2000)
  assert.equal(convertQty(2500, GRAM, KG), 2.5)
  assert.equal(convertQty(1500, KG, TONNE), 1.5)
  assert.equal(convertQty(1.5, TONNE, GRAM), 1_500_000)
  assert.equal(convertQty(7, KG, KG), 7, 'the same unit is not a special case that drifts')
})

test('uom: crossing categories is refused, not approximated', () => {
  const e = (() => { try { convertQty(1, KG, PIECE) } catch (err) { return err as UomError } })()!
  assert.equal(e.code, 'E_UOM_CATEGORY_MISMATCH')
  assert.match(e.hint!, /weight to weight, count to count/)
})

test('uom: every result is rounded to the target precision, not carried at full float', () => {
  // 1 gram is the smallest meaningful amount of a unit rounded to 1
  assert.equal(convertQty(0.0004, KG, GRAM), 0, 'below the precision of the target, it is nothing')
  assert.equal(convertQty(0.0006, KG, GRAM), 1)
  // pieces are whole
  assert.equal(roundTo(2.4, 1), 2)
  assert.equal(roundTo(2.5, 1), 3)
})

test('uom: the rounding helper survives the cases plain arithmetic gets wrong', () => {
  // 0.29999999999999993 in floating point; naive Math.round(x / 0.1) gives 2
  assert.equal(roundTo(0.1 + 0.2, 0.1), 0.3)
  assert.equal(roundTo(2.675, 0.01), 2.68, 'the classic case that rounds down without the precision pass')
  assert.equal(roundTo(1.005, 0.01), 1.01)
})

test('uom: quantities compare at a precision, because === on floats is a bug waiting', () => {
  const drifted = Array.from({ length: 10 }, () => 0.1).reduce((a, b) => a + b, 0)
  assert.notEqual(drifted, 1, 'ten tenths is not one, in floating point')
  assert.equal(compareQty(drifted, 1, 0.001), 0, 'but it is one to the precision anybody cares about')
  assert.equal(isZero(drifted - 1, 0.001), true)
  assert.equal(compareQty(1.0005, 1, 0.001), 1)
  assert.equal(compareQty(0.9995, 1, 0.001), -1)
})

test('uom: a round trip through a coarser unit loses what the coarser unit cannot hold', () => {
  // This is not a bug to fix, it is the point of a precision — but it has to be
  // visible, because stock built on the assumption of reversibility will drift.
  const there = convertQty(1234, GRAM, TONNE)
  assert.equal(there, 0.001)
  assert.equal(convertQty(there, TONNE, GRAM), 1000, 'the 234 grams were never representable in tonnes')
})

test('uom: a category has exactly one reference unit', async () => {
  const db = await boot()
  const first = await call('uom.saveUnit', { id: 'kg', name: 'kg', categoryId: 'weight', type: 'reference', factor: 1, rounding: 0.001 }, db)
  assert.equal((first.value as { ok: boolean }).ok, true)

  const second = await call('uom.saveUnit', { id: 'lb', name: 'lb', categoryId: 'weight', type: 'reference', factor: 1, rounding: 0.001 }, db)
  const v = second.value as { ok: boolean; errors: Array<{ message: string }> }
  assert.equal(v.ok, false)
  assert.match(v.errors[0]!.message, /đã có đơn vị gốc/)
  await db.close()
})

test('uom: a reference unit with a factor other than 1 is refused', async () => {
  const db = await boot()
  const r = await call('uom.saveUnit', { id: 'kg', name: 'kg', categoryId: 'weight', type: 'reference', factor: 2, rounding: 0.001 }, db)
  const v = r.value as { ok: boolean; errors: Array<{ field: string; message: string }> }
  assert.equal(v.ok, false)
  assert.equal(v.errors[0]!.field, 'factor')
  assert.match(v.errors[0]!.message, /đơn vị gốc luôn có hệ số 1/)
  await db.close()
})

test('uom: a zero or negative factor is refused, since it would divide by zero', async () => {
  const db = await boot()
  for (const factor of [0, -3]) {
    const r = await call('uom.saveUnit', { id: `x${factor}`, name: 'x', categoryId: 'weight', type: 'smaller', factor, rounding: 1 }, db)
    assert.equal((r.value as { ok: boolean }).ok, false)
  }
  await db.close()
})

test('uom: converting through the database matches converting in memory', async () => {
  const db = await boot()
  await call('uom.saveUnit', { id: 'kg', name: 'kg', categoryId: 'weight', type: 'reference', factor: 1, rounding: 0.001 }, db)
  await call('uom.saveUnit', { id: 'g', name: 'g', categoryId: 'weight', type: 'smaller', factor: 1000, rounding: 1 }, db)

  const r = await call('uom.convert', { qty: 2.5, fromId: 'kg', toId: 'g' }, db)
  assert.deepEqual(r.value, { ok: true, qty: 2500 })
  assert.equal((r.value as { qty: number }).qty, convertQty(2.5, KG, GRAM))
  await db.close()
})

test('uom: converting across categories through the database reports, not throws', async () => {
  const db = await boot()
  await call('uom.saveUnit', { id: 'kg', name: 'kg', categoryId: 'weight', type: 'reference', factor: 1, rounding: 0.001 }, db)
  await call('uom.saveUnit', { id: 'pc', name: 'cái', categoryId: 'count', type: 'reference', factor: 1, rounding: 1 }, db)

  const r = await call('uom.convert', { qty: 1, fromId: 'kg', toId: 'pc' }, db)
  const v = r.value as { ok: boolean; code: string }
  assert.equal(v.ok, false)
  assert.equal(v.code, 'E_UOM_CATEGORY_MISMATCH')
  await db.close()
})

test('uom: a template counts in a unit, and a service needs none', async () => {
  const db = await boot()
  await call('uom.saveUnit', { id: 'kg', name: 'kg', categoryId: 'weight', type: 'reference', factor: 1, rounding: 0.001 }, db)
  await call('product.saveTemplate', { id: 'coffee', name: 'Cà phê', type: 'goods', uomId: 'kg' }, db)
  await call('product.saveTemplate', { id: 'advice', name: 'Tư vấn', type: 'service' }, db)

  const goods = (await call('product.getTemplate', { id: 'coffee' }, db)).value as Row
  assert.equal((goods.uom as Row).name, 'kg')
  const service = (await call('product.getTemplate', { id: 'advice' }, db)).value as Row
  assert.equal(service.uom, null, 'a service is not counted in kilograms')
  await db.close()
})

test('uom: rounding is symmetric about zero, which Math.round is not', () => {
  // Math.round sends .5 toward positive infinity, so -0.5 becomes -0. Left alone,
  // that made a quantity half a unit BELOW a threshold compare equal to it while
  // half a unit above compared greater — an asymmetry in one direction only, which
  // is exactly the kind that hides for months in a stock ledger.
  assert.equal(roundTo(0.0005, 0.001), 0.001)
  assert.equal(roundTo(-0.0005, 0.001), -0.001)
  assert.equal(compareQty(1.0005, 1, 0.001), 1)
  assert.equal(compareQty(0.9995, 1, 0.001), -1)
})

test('uom: a rounded value is a multiple of its own precision', () => {
  // Three times 0.1 is 0.30000000000000004. A rounding function that returns a
  // value it would not consider rounded is not a rounding function.
  for (const [value, precision] of [[0.1 + 0.2, 0.1], [2.675, 0.01], [1 / 3, 0.001], [-7.77, 0.05]] as const) {
    const r = roundTo(value, precision)
    assert.equal(roundTo(r, precision), r, `roundTo(${value}, ${precision}) = ${r} is not stable`)
  }
})
