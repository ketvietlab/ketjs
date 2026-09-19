import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { findWatchRoot } from '../packages/ketsuite/src/cli-watch.ts'

test('KetSuite watch: installed packages fail clearly instead of ignoring --watch', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ketsuite-no-watch-'))
  try {
    assert.throws(() => findWatchRoot(root), /requires the KetJS source checkout/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('KetSuite watch builds before serving, restarts for CSS, recovers after errors and cleans up', {
  timeout: 30_000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ketsuite-watch-test-'))
  await mkdir(join(root, 'tools'))
  await mkdir(join(root, 'packages'))
  const logPath = join(root, 'events.log')
  const source = join(root, 'packages', 'input.css')
  await writeFile(source, 'initial')
  await writeFile(
    join(root, 'tools/build.mjs'),
    `
    import { appendFileSync, readFileSync } from 'node:fs';
    appendFileSync('events.log', 'build\\n');
    if (readFileSync('packages/input.css', 'utf8') === 'broken') process.exit(1);
  `,
  )
  const serverEntry = join(root, 'server.mjs')
  await writeFile(
    serverEntry,
    `
    import { appendFileSync } from 'node:fs';
    appendFileSync('events.log', 'start ' + JSON.stringify(process.argv.slice(2)) + '\\n');
    process.on('SIGTERM', () => { appendFileSync('events.log', 'stop\\n'); process.exit(0); });
    setInterval(() => {}, 1000);
  `,
  )
  const watcher = new URL('../tools/watch-build.js', import.meta.url).href
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '--eval',
      `import { runFrameworkWatch } from ${JSON.stringify(watcher)}; await runFrameworkWatch(${JSON.stringify({ root, serverEntry, serveArgs: ['serve', '--demo-data'] })});`,
    ],
    { cwd: root, env: { ...process.env, KET_WATCH_SERVE_CWD: root }, stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let output = ''
  child.stdout.on('data', (chunk) => {
    output += chunk
  })
  child.stderr.on('data', (chunk) => {
    output += chunk
  })
  const events = async () =>
    (await readFile(logPath, 'utf8').catch(() => '')).trim().split('\n').filter(Boolean)
  const until = async (predicate: (lines: string[]) => boolean) => {
    const deadline = Date.now() + 8_000
    while (!predicate(await events())) {
      if (Date.now() > deadline || child.exitCode !== null)
        throw new Error(`watcher did not reach expected state: ${output}`)
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }
  try {
    await until((lines) => lines.some((line) => line.startsWith('start')))
    assert.deepEqual(await events(), ['build', 'start ["serve","--demo-data"]'])
    await writeFile(source, 'updated')
    await until((lines) => lines.filter((line) => line.startsWith('start')).length === 2)
    assert.deepEqual((await events()).slice(-3), ['build', 'stop', 'start ["serve","--demo-data"]'])
    await writeFile(source, 'broken')
    await until((lines) => lines.filter((line) => line === 'build').length === 3)
    await new Promise((resolve) => setTimeout(resolve, 250))
    assert.equal((await events()).filter((line) => line.startsWith('start')).length, 2)
    await writeFile(source, 'fixed')
    await until((lines) => lines.filter((line) => line.startsWith('start')).length === 3)
    const exited = once(child, 'exit')
    child.kill('SIGTERM')
    await exited
    assert.equal((await events()).at(-1), 'stop')
    assert.equal(child.exitCode, 0)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill('SIGTERM')
      await exited
    }
    await rm(root, { recursive: true, force: true })
  }
})
