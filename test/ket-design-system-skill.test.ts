import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const installer = resolve('skills/ket-design-system/bin/install.mjs')
const run = (cwd: string, args: string[] = []) =>
  spawnSync(process.execPath, [installer, ...args], { cwd, encoding: 'utf8' })

test('Két skill installs independently, is idempotent, and protects edits and unrelated repository rules', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ket-skill-'))
  try {
    writeFileSync(join(cwd, 'AGENTS.md'), 'Repository engineering rules\n')
    const first = run(cwd)
    assert.equal(first.status, 0, first.stderr)
    const parent = join(cwd, '.agents/skills')
    const target = join(parent, 'ket-design-system')
    assert.ok(existsSync(join(target, 'references/visual-contract.md')))
    assert.ok(existsSync(join(target, 'agents/openai.yaml')))
    assert.equal(existsSync(join(target, 'bin')), false)
    assert.equal(run(cwd).status, 0)
    assert.equal(readdirSync(parent).length, 1)
    writeFileSync(join(target, 'SKILL.md'), 'Local edited skill\n')
    writeFileSync(join(target, 'notes.txt'), 'Keep me\n')
    const refused = run(cwd)
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /edited or unmanaged/)
    assert.equal(readFileSync(join(target, 'SKILL.md'), 'utf8'), 'Local edited skill\n')
    const forced = run(cwd, ['--force'])
    assert.equal(forced.status, 0, forced.stderr)
    const backup = readdirSync(parent).find((name) => name.startsWith('ket-design-system.backup-'))!
    assert.equal(readFileSync(join(parent, backup, 'SKILL.md'), 'utf8'), 'Local edited skill\n')
    assert.equal(readFileSync(join(target, 'notes.txt'), 'utf8'), 'Keep me\n')
    assert.equal(readFileSync(join(cwd, 'AGENTS.md'), 'utf8'), 'Repository engineering rules\n')
    assert.match(
      readFileSync(join(target, 'SKILL.md'), 'utf8'),
      /highest-priority repository design authority/,
    )
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})

test('Két skill supports custom agent directories and refuses unsafe or ambiguous destinations', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'ket-skill-'))
  try {
    assert.equal(run(cwd, ['install', '--dir', '.claude/skills']).status, 0)
    const target = join(cwd, '.claude/skills/ket-design-system')
    const protectedFile = join(cwd, 'protected.md')
    writeFileSync(protectedFile, 'Do not overwrite')
    rmSync(join(target, 'SKILL.md'))
    symlinkSync(protectedFile, join(target, 'SKILL.md'))
    const refused = run(cwd, ['--dir', '.claude/skills', '--force'])
    assert.equal(refused.status, 1)
    assert.match(refused.stderr, /symbolic link/)
    assert.equal(readFileSync(protectedFile, 'utf8'), 'Do not overwrite')
    assert.equal(run(cwd, ['--global', '--dir', 'skills']).status, 1)
    assert.equal(run(cwd, ['--dir']).status, 1)
    assert.equal(run(cwd, ['--dir', resolve('skills')]).status, 1)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
})
