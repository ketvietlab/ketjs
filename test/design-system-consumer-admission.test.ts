import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  addedCompatibilityConsumers,
  auditCompatibilityConsumers,
} from '../tools/design-system-consumer-admission.mjs'

test('compatibility admission ignores import formatting and render-site line wrapping', () => {
  assert.deepEqual(
    addedCompatibilityConsumers(
      "import { FormPage } from './ui'; const view = <FormPage title='a' />",
      "import {\n FormPage, Other\n} from './ui'; const view = <FormPage\n title='b' />",
    ),
    [],
  )
  assert.deepEqual(
    addedCompatibilityConsumers(
      '',
      "import { FormPage } from './ui'\n// <FormPage />\nconst text = '<FormPage />'",
    ),
    [],
  )
})

test('compatibility admission detects JSX, aliases, qualified JSX, and calls per component', () => {
  assert.deepEqual(
    addedCompatibilityConsumers(
      '',
      'import { FormPage as Legacy } from "ui"; <Legacy />; <UI.BoardPage />; DashboardPage({})',
    ),
    ['FormPage: +1', 'DashboardPage: +1', 'BoardPage: +1'],
  )
  assert.deepEqual(addedCompatibilityConsumers('<FormPage />', '<BoardPage />'), ['BoardPage: +1'])
})

test('Git admission checks each file, committed changes, working edits and untracked consumers', () => {
  const root = mkdtempSync(join(tmpdir(), 'ket-admission-'))
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  const path = 'packages/ketsuite/src/modules/example'
  const write = (name: string, value: string) => writeFileSync(join(root, path, name), value)
  try {
    git('init')
    git('config', 'user.email', 'test@example.invalid')
    git('config', 'user.name', 'Test')
    mkdirSync(join(root, path), { recursive: true })
    write('old.tsx', '<FormPage />')
    git('add', '.')
    git('commit', '-m', 'baseline')
    const base = git('rev-parse', 'HEAD').trim()
    write('old.tsx', '')
    write('new.tsx', '<FormPage />')
    git('add', '.')
    git('commit', '-m', 'move consumer')
    write('new.tsx', '')
    write('untracked.tsx', '<BoardPage />')
    const violations = auditCompatibilityConsumers(root, base)
    assert.ok(violations.includes(`HEAD: ${path}/new.tsx: FormPage: +1`))
    assert.ok(violations.includes(`working tree: ${path}/untracked.tsx: BoardPage: +1`))
    write('old.tsx', '<FormPage /><FormPage />')
    assert.ok(auditCompatibilityConsumers(root, base).includes(`working tree: ${path}/old.tsx: FormPage: +1`))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
