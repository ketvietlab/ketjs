import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'

const cli = fileURLToPath(new URL('../packages/ketjs/src/cli.js', import.meta.url))
const ketsuiteWorkspace = fileURLToPath(new URL('../ket.workspace.js', import.meta.url))

const runCli = async (
  args: string[],
  input: Record<string, unknown>,
  env: Record<string, string>,
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const child = spawn(process.execPath, [cli, ...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NODE_NO_WARNINGS: '1', ...env },
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

test('provision CLI: KetSuite reads the admin password only from stdin and refuses a second run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-user-provision-'))
  try {
    const secret = 'correct horse battery staple'
    const args = ['provision', 'user.provisionAdmin', '--workspace', ketsuiteWorkspace, '--input', '-']
    assert.equal(
      args.some((arg) => arg.includes(secret)),
      false,
    )
    const input = {
      companyName: 'Kết Việt',
      companyCode: 'KET',
      currency: 'VND',
      adminLogin: 'admin@example.com',
      adminName: 'Administrator',
      adminEmail: 'admin@example.com',
      adminPassword: secret,
    }
    const env = { KET_SQLITE: join(dir, 'ketsuite.db') }
    const first = await runCli(args, input, env)
    assert.equal(first.code, 0, first.stderr)
    assert.equal((JSON.parse(first.stdout) as { ok: boolean }).ok, true)
    assert.ok(!`${first.stdout}${first.stderr}`.includes(secret))

    const second = await runCli(args, input, env)
    assert.equal(second.code, 1, second.stderr)
    const refused = JSON.parse(second.stdout) as { ok: boolean; errors: Array<{ code: string }> }
    assert.equal(refused.ok, false)
    assert.equal(refused.errors[0]?.code, 'user.error.provisionExists')
    assert.ok(!`${second.stdout}${second.stderr}`.includes(secret))
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

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
      `import { defineApp, defineFn, defineModule, sqliteAdapter } from ${JSON.stringify(ketEntry)}
const bootstrap = defineModule({
  name: 'tenant_bootstrap',
  app: true,
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
export const apps = [defineApp({
  name: 'tenant_app',
  modules: [bootstrap],
  headless: true,
  serve: {
    bootstrap: ['tenant_bootstrap'],
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
