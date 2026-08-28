import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'

const cli = fileURLToPath(new URL('../packages/ketjs/src/cli.js', import.meta.url))

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

test('migrate CLI: --all requires an explicit deployment when several tenant fleets exist', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-migrate-cli-'))
  try {
    const ketEntry = pathToFileURL(
      fileURLToPath(new URL('../packages/ketjs/src/index.js', import.meta.url)),
    ).href
    const workspace = join(dir, 'workspace.mjs')
    await writeFile(
      workspace,
      `import { defineDeployment, defineModule, sqliteAdapter } from ${JSON.stringify(ketEntry)}
const empty = defineModule({ name: 'empty' })
const fleet = (name) => defineDeployment({
  name,
  modules: [empty],
  headless: true,
  serve: {
    tenants: {
      resolve: () => null,
      list: async () => [],
      open: () => sqliteAdapter(),
    },
  },
})
export const deployments = [fleet('alpha'), fleet('beta'), defineDeployment({
  name: 'solo',
  modules: [empty],
  headless: true,
})]
`,
    )

    const dryRun = await runCli(dir, [
      'migrate',
      '--dry-run',
      '--deployment',
      'solo',
      '--workspace',
      workspace,
    ])
    assert.equal(dryRun.code, 0, dryRun.stderr)
    assert.match(dryRun.stdout, /dry run: .* schema snapshot unchanged/)
    assert.equal(existsSync(join(dir, '.ket')), false, 'dry-run must not create CLI state')

    const ambiguous = await runCli(dir, ['migrate', '--all', '--workspace', workspace])
    assert.equal(ambiguous.code, 1)
    assert.match(ambiguous.stderr, /multiple tenant-fleet deployments \(alpha, beta\)/)
    assert.match(ambiguous.stderr, /pass --deployment NAME/)

    const selected = await runCli(dir, ['migrate', '--all', '--deployment', 'beta', '--workspace', workspace])
    assert.equal(selected.code, 0, selected.stderr)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
