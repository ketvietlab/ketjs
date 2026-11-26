import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

test('CLI: serve and worker expose emitted-artifact watch mode without recursive --watch forwarding', async () => {
  const source = await readFile('packages/ketjs/src/cli.ts', 'utf8')

  assert.match(source, /ket serve \[--deployment X\] \[--watch\]/)
  assert.match(source, /ket worker \[--deployment X\] \[--watch\]/)
  assert.match(source, /args\.filter\(\(item\) => item !== '--watch'\)/)
  assert.match(source, /cmd === 'serve' \|\| cmd === 'worker'\) && flag\('watch'\)/)
})

test('CLI: serve and worker reuse the workspace composition', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'ket-cli-runtime-'))
  t.after(() => rm(cwd, { recursive: true, force: true }))
  const cli = fileURLToPath(new URL('../packages/ketjs/src/cli.js', import.meta.url))
  const entry = new URL('../packages/ketjs/src/index.js', import.meta.url).href
  const workspace = join(cwd, 'workspace.mjs')
  await writeFile(
    workspace,
    `import { defineDeployment, defineModule } from ${JSON.stringify(entry)}
const orders = {
  ...defineModule({ name: 'orders' }),
  get styles() {
    console.log('composing orders')
    return []
  },
}
export const deployments = [defineDeployment({
  name: 'shop',
  modules: [orders],
  headless: true,
  serve: { defaults: { host: '127.0.0.1', port: 0 } },
  worker: { queues: { default: 1 } },
})]
`,
  )

  for (const role of ['serve', 'worker']) {
    await t.test(role, { timeout: 10_000 }, async (roleTest) => {
      const child = spawn(process.execPath, [cli, role, '--workspace', workspace], {
        cwd,
        env: { ...process.env, DATABASE_URL: undefined, PORT: '0', HOST: '127.0.0.1' },
        signal: roleTest.signal,
      })
      const exited = once(child, 'exit')
      let stdout = ''
      let stderr = ''
      const ready = role === 'serve' ? /http:\/\/127\.0\.0\.1:\d+\/_ket\/health/u : /worker .* is running/u
      try {
        child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
          stderr += chunk
        })
        for await (const chunk of child.stdout.setEncoding('utf8')) {
          roleTest.signal.throwIfAborted()
          stdout += chunk
          if (ready.test(stdout)) break
        }
        assert.match(stdout, ready, stderr)
        assert.equal(stdout.match(/^composing orders$/gmu)?.length, 1, stdout)
      } finally {
        child.kill('SIGTERM')
        await exited
      }
    })
  }
})
