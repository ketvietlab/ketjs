import assert from 'node:assert/strict'
import { test } from 'node:test'
import { errorsOf, get, put, stats, workload } from './workload.mjs'
import { counters, resetCounters } from './trace.mjs'

test('flat fixtures validate the edited field and preserve unrelated values', () => {
  const metrics = counters()
  const spec = workload('flat', 100, metrics)
  assert.equal(spec.controls.length, 100)
  assert.equal(spec.validate(spec.initial).valid, true)
  const values = { ...spec.initial, [spec.target]: spec.invalidValue }
  const result = spec.validate(values)
  assert.equal(result.valid, false)
  assert.deepEqual(
    result.issues.map((issue) => issue.field),
    [spec.target],
  )
  assert.equal(get(values, 'field0'), 'value-0')
})

test('nested fixtures preserve stable keys and metadata while normalizing decimal values', () => {
  const spec = workload('nested', 10, counters())
  assert.equal(spec.controls.length, 31)
  const valid = spec.validate(spec.initial)
  assert.equal(valid.valid, true)
  assert.equal(valid.values.variants[0].weight, '1.00')
  assert.equal(valid.values.variants[0].rowKey, 'row-0')
  assert.equal(valid.values.variants[0].id, null)
  assert.equal(valid.values.variants[0].active, true)
  const numeric = structuredClone(spec.initial)
  numeric.variants[0].weight = 1.25
  assert.equal(spec.validate(numeric).values.variants[0].weight, '1.25')
  const values = structuredClone(spec.initial)
  put(values, spec.target, spec.invalidValue)
  const invalid = spec.validate(values)
  assert.equal(invalid.valid, false)
  assert.deepEqual(
    invalid.issues.map((issue) => issue.field),
    [spec.target],
  )
  assert.equal(get(errorsOf(invalid.issues), spec.target), invalid.issues[0].code)
  assert.equal(get(errorsOf(invalid.issues, true), spec.target).message, invalid.issues[0].code)
  assert.equal(values.variants[0].weight, '1.00')
})

test('instrumentation counts successful custom rule calls separately from schema refinements', () => {
  const metrics = counters()
  const spec = workload('flat', 10, metrics)
  spec.validate(spec.initial)
  assert.equal(metrics.validationRuleCalls, 0)
  metrics.enabled = true
  spec.validate(spec.initial)
  assert.equal(metrics.validationRuleCalls, 10)
  assert.equal(metrics.schemaRefinements, 1)
  resetCounters(metrics)
  assert.equal(metrics.enabled, true)
  assert.equal(metrics.validationRuleCalls, 0)
  const nested = workload('nested', 10, metrics)
  put(nested.initial, nested.target, nested.invalidValue)
  nested.validate(nested.initial)
  assert.equal(metrics.schemaRefinements, 0)
  assert.ok(metrics.validationRuleCalls > 0)
})

test('statistics retain raw samples and use averaged median and nearest-rank p95', () => {
  const samples = [3, 1, 4, 2]
  const result = stats(samples)
  assert.equal(result.medianMs, 2.5)
  assert.equal(result.p95Ms, 4)
  assert.deepEqual(samples, [3, 1, 4, 2])
  assert.equal(result.samples, samples)
  assert.equal(stats([2]).medianMs, 2)
  assert.throws(() => stats([]))
  assert.throws(() => stats([NaN]))
  assert.throws(() => stats([-1]))
})
