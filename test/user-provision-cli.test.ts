import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'

const cli = fileURLToPath(new URL('../packages/ketjs/src/cli.js', import.meta.url))

const runCli = async (
  args: string[],
  input: Record<string, unknown>,
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const child = spawn(process.execPath, [cli, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    // DATABASE_URL wins over KET_SQLITE, so inheriting one would send a test that
    // built itself a private SQLite file into whatever server the suite was
    // pointed at — and provisioning is exactly the command that refuses to run
    // twice against the same database.
    env: { ...process.env, DATABASE_URL: undefined, NODE_NO_WARNINGS: '1', ...env },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
    stderr += chunk
  })
  child.stdin.end(JSON.stringify(input))
  const code = await new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (status) => resolve(status ?? 1))
  })
  return { code, stdout, stderr }
}

test('provision CLI: a tenant datastore requires an explicit tenant selection', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-tenant-provision-'))
  try {
    const ketEntry = pathToFileURL(
      fileURLToPath(new URL('../packages/ketjs/src/index.js', import.meta.url)),
    ).href
    const database = join(dir, 'tenant.db')
    const workspace = join(dir, 'workspace.mjs')
    await writeFile(
      workspace,
      `import { defineDeployment, defineFn, defineModule, sqliteAdapter } from ${JSON.stringify(ketEntry)}
const bootstrap = defineModule({
  name: 'tenant_bootstrap',
  functions: {
    run: defineFn({
      exposure: 'internal',
      provision: true,
      input: { password: 'text' },
      output: { ok: 'bool' },
      effects: [],
      handler: () => ({ ok: true }),
    }),
  },
})
export const deployments = [defineDeployment({
  name: 'tenant_app',
  modules: [bootstrap],
  headless: true,
  serve: {
    tenants: { open: () => sqliteAdapter(${JSON.stringify(database)}) },
  },
})]
`,
    )
    const baseArgs = ['provision', 'tenant_bootstrap.run', '--workspace', workspace, '--input', '-']
    const input = { password: 'stdin-only-password' }
    const missing = await runCli(baseArgs, input, {})
    assert.equal(missing.code, 1)
    assert.match(missing.stderr, /pass --tenant NAME/)
    assert.ok(!`${missing.stdout}${missing.stderr}`.includes(input.password))

    const selected = await runCli([...baseArgs, '--tenant', 'tenant-a'], input, {})
    assert.equal(selected.code, 0, selected.stderr)
    assert.deepEqual(JSON.parse(selected.stdout), { ok: true })
    assert.ok(!`${selected.stdout}${selected.stderr}`.includes(input.password))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
