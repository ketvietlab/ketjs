import { test } from 'node:test'
import assert from 'node:assert/strict'
import { callFn, compose, migrateOne, registerFunctions, sqliteAdapter } from 'ketjs'
import type { Row } from 'ketjs'
import { compareQty, convertQty, isZero, product, roundTo, uom } from 'ketsuite'

const manifest = compose([uom, product], { headless: true })

async function boot() {
  const adapter = sqliteAdapter()
  await adapter.open()
  await migrateOne(adapter, manifest)
  registerFunctions([uom, product])
  return adapter
}

async function save(
  adapter: Awaited<ReturnType<typeof boot>>,
  id: string,
  relativeFactor: string,
  relativeUomId?: string,
) {
  return callFn(
    'uom.saveUnit',
    { id, name: id, relativeFactor, ...(relativeUomId ? { relativeUomId } : {}) },
    { adapter, manifest },
  )
}

test('uom 19: conversion follows the absolute factor and shared root', () => {
  const kg = { id: 'kg', parentPath: 'kg/', absoluteFactor: 1, rounding: 0.01 }
  const g = { id: 'g', parentPath: 'kg/g/', absoluteFactor: 0.001, rounding: 0.01 }
  assert.equal(convertQty(2.5, kg, g), 2500)
  assert.equal(convertQty(2500, g, kg), 2.5)
  assert.throws(
    () => convertQty(1, kg, { id: 'l', parentPath: 'l/', absoluteFactor: 1, rounding: 0.01 }),
    (error: unknown) => (error as { code: string }).code === 'E_UOM_ROOT_MISMATCH',
  )
})

test('uom 19: roots have factor one, descendants derive factor and parent path', async () => {
  const adapter = await boot()
  try {
    assert.deepEqual((await save(adapter, 'kg', '1')).value, { ok: true, id: 'kg' })
    assert.deepEqual((await save(adapter, 'g', '0.001', 'kg')).value, { ok: true, id: 'g' })
    assert.deepEqual((await save(adapter, 'mg', '0.001', 'g')).value, { ok: true, id: 'mg' })
    const rows = (await callFn('uom.listUnits', { rootId: 'kg' }, { adapter, manifest })).value as Row[]
    assert.equal(rows.length, 3)
    const mg = rows.find((row) => row.id === 'mg')!
    assert.equal(mg.absoluteFactor, 0.000001)
    assert.equal(mg.parentPath, 'kg/g/mg/')
    assert.equal(mg.rounding, 0.01)
  } finally {
    await adapter.close()
  }
})

test('uom 19: invalid roots, missing parents and cycles are refused', async () => {
  const adapter = await boot()
  try {
    const root = await save(adapter, 'bad', '2')
    assert.equal((root.value as { ok: boolean }).ok, false)
    const orphan = await save(adapter, 'g', '0.001', 'missing')
    assert.equal((orphan.value as { ok: boolean }).ok, false)
    await save(adapter, 'kg', '1')
    await save(adapter, 'g', '0.001', 'kg')
    const cycle = await save(adapter, 'kg', '1000', 'g')
    assert.equal((cycle.value as { ok: boolean }).ok, false)
  } finally {
    await adapter.close()
  }
})

test('uom 19: changing an ancestor recomputes all descendant factors', async () => {
  const adapter = await boot()
  try {
    await save(adapter, 'kg', '1')
    await save(adapter, 'box', '10', 'kg')
    await save(adapter, 'pallet', '5', 'box')
    await save(adapter, 'box', '12', 'kg')
    const pallet = (await adapter.all('SELECT "absoluteFactor" FROM uom_unit WHERE id = ?', ['pallet']))[0]!
    assert.equal(pallet.absoluteFactor, '60')
  } finally {
    await adapter.close()
  }
})

test('uom 19: Product Unit precision is singleton and immutable after units exist', async () => {
  const adapter = await boot()
  try {
    assert.deepEqual((await callFn('uom.savePrecision', { digits: 3 }, { adapter, manifest })).value, {
      ok: true,
      digits: 3,
    })
    await save(adapter, 'unit', '1')
    const units = (await callFn('uom.listUnits', {}, { adapter, manifest })).value as Row[]
    assert.equal(units[0]!.rounding, 0.001)
    assert.equal((await adapter.all('SELECT COUNT(*) AS n FROM uom_precision'))[0]!.n, 1)
    const changed = await callFn('uom.savePrecision', { digits: 4 }, { adapter, manifest })
    assert.equal((changed.value as Row).ok, false)
    assert.equal((await adapter.all('SELECT digits FROM uom_precision'))[0]!.digits, 3)
  } finally {
    await adapter.close()
  }
})

test('uom 19: an ancestor cannot change after a descendant conversion identity is used', async () => {
  const adapter = await boot()
  try {
    await save(adapter, 'unit', '1')
    await save(adapter, 'box', '10', 'unit')
    await save(adapter, 'pallet', '5', 'box')
    await callFn('uom.lockUnit', { id: 'pallet' }, { adapter, manifest })
    const changed = await save(adapter, 'box', '12', 'unit')
    assert.equal((changed.value as Row).ok, false)
    const rows = (await callFn('uom.listUnits', {}, { adapter, manifest })).value as Row[]
    assert.equal(rows.find((row) => row.id === 'pallet')!.absoluteFactor, 50)
  } finally {
    await adapter.close()
  }
})

test('uom: rounding and comparison remain symmetric at the configured precision', () => {
  assert.equal(roundTo(0.30000000000000004, 0.1), 0.3)
  assert.equal(compareQty(1.0005, 1, 0.001), 1)
  assert.equal(compareQty(0.9995, 1, 0.001), -1)
  assert.equal(isZero(-0.0004, 0.001), true)
})
