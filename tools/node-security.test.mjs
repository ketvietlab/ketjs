import assert from 'node:assert/strict'
import test from 'node:test'
import { assess, NODE_ENGINES, parseRange, parseVersion, readEngines } from './node-security.mjs'

/** @param {string} version @param {string} date @param {boolean} [security] */
const release = (version, date, security = false) => ({
  version,
  date,
  security,
  lts: /** @type {false} */ (false),
})

// A trimmed copy of the real data as of 2026-11-10.
const index = [
  release('v27.0.0-alpha.0.0.0', '2026-10-29'),
  release('v26.13.0', '2026-10-28'),
  release('v26.12.1', '2026-10-21', true),
  release('v26.12.0', '2026-10-14'),
  release('v26.7.0', '2026-08-26'),
  release('v26.5.1', '2026-07-28', true),
  release('v26.0.0', '2026-05-05'),
  release('v25.9.0', '2026-03-31'),
  release('v25.8.2', '2026-03-24', true),
  release('v25.0.0', '2025-10-15'),
  release('v24.22.2', '2026-10-27'),
  release('v24.22.1', '2026-10-20', true),
  release('v24.18.1', '2026-07-28', true),
  release('v24.0.0', '2025-05-06'),
]
const schedule = {
  v24: { start: '2025-05-06', end: '2028-04-30' },
  v25: { start: '2025-10-15', end: '2026-06-01' },
  v26: { start: '2026-05-05', end: '2029-04-30' },
  v27: { start: '2027-04-22', end: '2030-04-30' },
}
const today = '2026-11-10'
const engines = { 'package.json': '>=24.0.0' }

test('a pinned version older than its line latest security release fails', () => {
  const report = assess({ index, schedule, nvmrc: '26.7.0\n', engines, today })
  assert.equal(report.errors.length, 1)
  assert.match(
    report.errors[0],
    /26\.7\.0 lacks security release\(s\) 26\.12\.1 \(2026-10-21\); move it to 26\.13\.0/,
  )
})

test('a pinned version with every security release passes, even when a newer non-security release exists', () => {
  assert.deepEqual(assess({ index, schedule, nvmrc: '26.12.1', engines, today }).errors, [])
  assert.deepEqual(assess({ index, schedule, nvmrc: 'v26.13.0', engines, today }).errors, [])
})

test('a pinned version on an unsupported line fails although it has its line security releases', () => {
  const report = assess({ index, schedule, nvmrc: '25.9.0', engines, today })
  assert.equal(report.errors.length, 1)
  assert.match(report.errors[0], /Node\.js 25, which is not a supported release line/)
})

test('a pinned range or alias is refused', () => {
  assert.match(assess({ index, schedule, nvmrc: 'lts/*', engines, today }).errors[0], /one exact version/)
})

test('an engines floor below security releases and an ended line are warnings by default', () => {
  const report = assess({ index, schedule, nvmrc: '26.13.0', engines, today })
  assert.deepEqual(report.errors, [])
  assert.equal(report.warnings.length, 3)
  assert.match(
    report.warnings[0],
    /admits 24\.0\.0, which lacks 2 security release\(s\) of 24\.x; the latest is 24\.22\.1/,
  )
  assert.match(report.warnings[1], /admits Node\.js 25, whose support ended on 2026-06-01/)
  assert.match(report.warnings[2], /admits 26\.0\.0, which lacks 2 security release\(s\) of 26\.x/)
})

test('--strict-engines turns engines findings into errors', () => {
  const report = assess({ index, schedule, nvmrc: '26.13.0', engines, today, strictEngines: true })
  assert.equal(report.errors.length, 3)
  assert.deepEqual(report.warnings, [])
})

test('a floor that follows security releases and skips the ended line is clean', () => {
  const report = assess({
    index,
    schedule,
    nvmrc: '26.13.0',
    engines: { 'package.json': '^24.22.1 || >=26.12.1' },
    today,
    strictEngines: true,
  })
  assert.deepEqual(report.errors, [])
})

test('manifests sharing a range are reported once', () => {
  const report = assess({
    index,
    schedule,
    nvmrc: '26.13.0',
    engines: { 'package.json': '>=24.0.0', 'packages/ketjs/package.json': '>=24.0.0' },
    today,
  })
  assert.equal(report.warnings.length, 3)
  assert.match(report.warnings[0], /\(2 manifests\)/)
})

test('an unsupported engines comparator is an error, not a guess', () => {
  const report = assess({ index, schedule, nvmrc: '26.13.0', engines: { 'package.json': '24.x' }, today })
  assert.match(report.errors[0], /unsupported engines comparator "24\.x"/)
})

test('ranges follow npm semantics for the supported comparators', () => {
  /** @param {string} range @param {string} version */
  const admits = (range, version) =>
    parseRange(range)(/** @type {[number, number, number]} */ (parseVersion(version)))
  assert.equal(admits('>=24.0.0', '26.1.0'), true)
  assert.equal(admits('>=24.0.0', '22.9.0'), false)
  assert.equal(admits('^24.22.1 || >=26.12.1', '24.22.1'), true)
  assert.equal(admits('^24.22.1 || >=26.12.1', '25.9.0'), false)
  assert.equal(admits('^24.22.1 || >=26.12.1', '26.12.0'), false)
  assert.equal(admits('>=24.22.1 <25', '24.30.0'), true)
  assert.equal(admits('>=24.22.1 <25', '25.0.0'), false)
  assert.equal(admits('~24.22.1', '24.23.0'), false)
  assert.equal(admits('24', '24.5.0'), true)
  assert.equal(admits('24.22', '24.22.9'), true)
  assert.equal(admits('24.22', '24.23.0'), false)
})

test('every manifest declares NODE_ENGINES, and it passes the strict check on this data', () => {
  const declared = readEngines(new URL('../', import.meta.url).href)
  assert.ok(Object.keys(declared).length >= 7)
  for (const [manifest, range] of Object.entries(declared)) assert.equal(range, NODE_ENGINES, manifest)
  const report = assess({
    index,
    schedule,
    nvmrc: '26.13.0',
    engines: { 'package.json': NODE_ENGINES },
    today,
    strictEngines: true,
  })
  assert.deepEqual(report.errors, [])
})
