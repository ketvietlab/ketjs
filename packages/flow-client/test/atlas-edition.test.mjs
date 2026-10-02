import test from 'node:test'
import assert from 'node:assert/strict'
import { cp, mkdir, mkdtemp, rm, symlink, unlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createOrganizationSession } from '../atlas/organization-store.mjs'

test('core Atlas completes and creates tasks without pro data, commands or handover rules', () => {
  for (const profile of ['compact', 'realistic']) {
    const session = createOrganizationSession('baseline', 'my-work', { profile, edition: 'core' })
    const boot = () => session.call('flow.workspace.bootstrap').value
    const data = boot(),
      task = data.tasks.find((t) => t.id === 'KV-131')
    assert.equal(data.quality, undefined)
    assert.equal(data.workHours, undefined)
    const args = {
      id: task.id,
      columnId: 'done',
      expectedVersion: task.version,
      idempotencyKey: 'core-finish',
    }
    assert.equal(session.call('flow.issue.move', args).value.ok, true)
    assert.equal(session.call('flow.issue.move', args).value.ok, true)
    assert.equal(boot().tasks.find((t) => t.id === task.id).status, 'done')
    const created = session.call('flow.issue.save', {
      title: 'Core task',
      projectId: task.projectId,
      status: 'todo',
      idempotencyKey: 'core-create',
    }).value
    assert.notEqual(created.ok, false)
    assert.ok(boot().tasks.some((t) => t.id === created.id))
    assert.ok(!boot().inbox.some((n) => n.route?.startsWith('quality-')))
    for (const name of ['flow.hours.command', 'flow.quality.command'])
      assert.equal(
        session.call(name, { id: task.id, action: 'submit', idempotencyKey: name }).value.errors[0].code,
        'not_found',
      )
  }
})

test('a fresh Atlas renderer builds browser assets before ready and survives a missing asset', {
  timeout: 20000,
}, async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'flow-atlas-test-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const packages = fileURLToPath(new URL('../../', import.meta.url))
  // Isolate generated assets; never remove vendor files used by a running developer renderer.
  for (const name of ['flow-client']) {
    const target = join(temp, name),
      source = join(packages, name)
    await cp(source, target, {
      recursive: true,
      filter: (path) => !['node_modules', 'vendor'].includes(path.split('/').at(-1)),
    })
    await mkdir(join(target, 'node_modules'))
    const { createRequire } = await import('node:module')
    const require = createRequire(new URL('../package.json', import.meta.url))
    const manifest = JSON.parse(
      await (await import('node:fs/promises')).readFile(join(source, 'package.json'), 'utf8'),
    )
    for (const name of [...Object.keys(manifest.dependencies), ...Object.keys(manifest.devDependencies)]) {
      const { dirname } = await import('node:path')
      let base = dirname(require.resolve(name))
      const fs = await import('node:fs')
      while (!fs.existsSync(join(base, 'package.json'))) base = dirname(base)
      if (name.startsWith('@'))
        await mkdir(join(target, 'node_modules', name.split('/')[0]), { recursive: true })
      await symlink(base, join(target, 'node_modules', name))
    }
  }
  const port = 45000 + Math.floor(Math.random() * 10000)
  const child = spawn(
    process.execPath,
    [join(temp, 'flow-client/atlas/server.mjs'), '--port', String(port)],
    {
      cwd: temp,
      env: { ...process.env, FLOW_EDITION: 'core' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  )
  let errors = ''
  child.stderr.on('data', (chunk) => {
    errors += chunk
  })
  t.after(async () => {
    if (child.exitCode === null) {
      const closed = once(child, 'close')
      child.kill()
      await closed
    }
  })
  await new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      if (String(chunk).includes('Flow renderer')) resolve()
    })
    child.once('error', reject)
    child.once('exit', (code) => reject(new Error(`Atlas exited ${code}: ${errors}`)))
  })
  const base = `http://127.0.0.1:${port}`
  for (const path of ['/__atlas/ready', '/flow/my-work', '/flow-ketjs-i18n.mjs', '/flow-live-doc.mjs']) {
    const response = await fetch(base + path)
    assert.equal(response.status, 200, path)
    assert.ok((await response.text()).length > 0, path)
  }
  assert.equal((await fetch(base + '/flow/workload')).status, 404)
  for (const route of ['goals', 'goal', 'goal-new', 'goal-edit'])
    assert.equal((await fetch(base + '/flow/' + route)).status, 404, route)
  const page = await (await fetch(base + '/flow/my-work')).text()
  assert.doesNotMatch(page, /flow-pro|ketatlas/)
  for (const path of ['/flow-pro-client/index.mjs', '/flow-pro-ui/styles.css', '/atlas/store.mjs'])
    assert.equal((await fetch(base + path)).status, 404)
  const session = JSON.parse(page.match(/id="flow-environment">(.*?)<\/script>/)[1]).session
  const call = async (name, input) =>
    (
      await fetch(`${base}/_ket/fn/${name}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-flow-fixture': session },
        body: JSON.stringify(input),
      })
    ).json()
  const data = (await call('flow.workspace.bootstrap', {})).value
  assert.equal(data.quality, undefined)
  const task = data.tasks.find((t) => t.id === 'KV-131')
  assert.equal(
    (
      await call('flow.issue.move', {
        id: task.id,
        columnId: 'done',
        expectedVersion: task.version,
        idempotencyKey: 'http-core-finish',
      })
    ).value.ok,
    true,
  )
  await unlink(join(temp, 'flow-client/atlas/vendor/ketjs-i18n.mjs'))
  assert.equal((await fetch(base + '/flow-ketjs-i18n.mjs')).status, 404)
  assert.equal((await fetch(base + '/__atlas/ready')).status, 200)
})
