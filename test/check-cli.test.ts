import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'

const cli = fileURLToPath(new URL('../packages/ketjs/src/cli.js', import.meta.url))
const ketEntry = pathToFileURL(fileURLToPath(new URL('../packages/ketjs/src/index.js', import.meta.url))).href

const runCli = async (
  cwd: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, DATABASE_URL: undefined, NODE_NO_WARNINGS: '1' },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk
  })
  const code = await new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (status) => resolve(status ?? 1))
  })
  return { code, stdout, stderr }
}

/** Two unrelated modules giving one token different values compose with an E_TOKEN_CONFLICT warning. */
const workspaceSource = (
  conflicting: boolean,
) => `import { defineDeployment, defineModule } from ${JSON.stringify(ketEntry)}
const brand = defineModule({ name: 'brand', tokens: { accent: 'teal' } })
const promo = defineModule({ name: 'promo', tokens: { accent: ${conflicting ? "'orange'" : "'teal'"} } })
export const deployments = [defineDeployment({ name: 'shop', modules: [brand, promo], headless: true })]
`

test('ket check passes with warnings, says so, and --strict fails on them', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-check-cli-'))
  try {
    const workspace = join(dir, 'workspace.mjs')
    await writeFile(workspace, workspaceSource(true))

    const lenient = await runCli(dir, ['check', '--workspace', workspace])
    assert.equal(lenient.code, 0, lenient.stderr)
    assert.match(lenient.stdout, /1 contract warning\(s\):\n {2}\[E_TOKEN_CONFLICT\] shop: /u)
    assert.match(lenient.stdout, /no contract errors; pass --strict to fail on the warnings above/u)
    assert.doesNotMatch(lenient.stdout, /all contracts hold/u)

    const strict = await runCli(dir, ['check', '--strict', '--workspace', workspace])
    assert.equal(strict.code, 1, strict.stderr)
    assert.match(strict.stdout, /\[E_TOKEN_CONFLICT\] shop: /u)
    assert.match(strict.stdout, /--strict: contract warnings fail the check/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('ket check --strict passes a workspace without warnings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-check-cli-'))
  try {
    const workspace = join(dir, 'workspace.mjs')
    await writeFile(workspace, workspaceSource(false))
    const strict = await runCli(dir, ['check', '--strict', '--workspace', workspace])
    assert.equal(strict.code, 0, strict.stderr)
    assert.match(strict.stdout, /all contracts hold/u)
    assert.doesNotMatch(strict.stdout, /contract warning/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
