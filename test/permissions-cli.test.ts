import { spawn } from 'node:child_process'
import assert from 'node:assert/strict'
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

test('permissions CLI: JSON inventory is deterministic across every deployment', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ket-permission-inventory-cli-'))
  try {
    const ketEntry = pathToFileURL(
      fileURLToPath(new URL('../packages/ketjs/src/index.js', import.meta.url)),
    ).href
    const workspace = join(dir, 'workspace.mjs')
    await writeFile(
      workspace,
      `import { defineDeployment, defineModule } from ${JSON.stringify(ketEntry)}
const empty = defineModule({ name: 'empty' })
const secured = defineModule({
  name: 'secured',
  functions: {
    list: { effects: [], output: { id: 'id' }, handler: () => [] },
    login: { anonymous: true, effects: [], handler: () => null },
    rotate: { exposure: 'internal', effects: [], handler: () => null },
  },
})
export const deployments = [
  defineDeployment({ name: 'zeta', modules: [empty, secured], headless: true }),
  defineDeployment({ name: 'alpha', modules: [empty], headless: true }),
]
`,
    )

    const all = await runCli(dir, ['permissions', '--json', '--all', '--workspace', workspace])
    assert.equal(all.code, 0, all.stderr)
    const report = JSON.parse(all.stdout) as {
      version: number
      deployments: Array<{
        name: string
        inventory: { totals: { modules: number; functions: number; grantable: number } }
      }>
    }
    assert.equal(report.version, 1)
    assert.deepEqual(
      report.deployments.map((deployment) => deployment.name),
      ['alpha', 'zeta'],
    )
    assert.deepEqual(report.deployments[1]?.inventory.totals, {
      modules: 2,
      functions: 3,
      grantable: 1,
      anonymous: 1,
      internal: 1,
      provision: 0,
      unprojected: 2,
    })

    const one = await runCli(dir, [
      'permissions',
      '--json',
      '--deployment',
      'alpha',
      '--workspace',
      workspace,
    ])
    assert.equal(one.code, 0, one.stderr)
    assert.equal((JSON.parse(one.stdout) as { name: string }).name, 'alpha')

    const invalid = await runCli(dir, [
      'permissions',
      '--json',
      '--all',
      '--deployment',
      'alpha',
      '--workspace',
      workspace,
    ])
    assert.equal(invalid.code, 1)
    assert.match(invalid.stderr, /either --deployment NAME or --all/)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
