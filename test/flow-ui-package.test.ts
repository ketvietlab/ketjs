import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

// @ketvietlab/flow-ui is authored in .mjs with its own node:test suite; run it as one root test.
test('flow-ui package tests pass', () => {
  const dir = join(process.cwd(), 'packages/flow-ui/test')
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.test.mjs'))
    .map((name) => join(dir, name))
  assert.ok(files.length > 0, 'flow-ui has no tests')
  // Without this the child sees the parent's test context and reports into it instead of failing.
  const { NODE_TEST_CONTEXT: _context, ...env } = process.env
  const run = spawnSync(process.execPath, ['--test', ...files], { encoding: 'utf8', env })
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`)
})
