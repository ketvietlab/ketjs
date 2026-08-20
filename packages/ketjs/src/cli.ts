#!/usr/bin/env node
// The CLI is deliberately thin: everything it prints is read off the manifest,
// so there is no second source of truth about what an app contains.

import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { delimiter, extname, join, normalize, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { composeWorkspace, explainWorkspace } from './kernel/workspace.ts'
import type { AppSpec, WorkspaceDeclaration } from './kernel/workspace.ts'
import { resolveWorkspace } from './kernel/modules.ts'
import type { ResolvedModuleInfo } from './kernel/modules.ts'
import { diffManifests, formatDiff } from './kernel/diff.ts'
import { generateDts } from './codegen/dts.ts'
import { agentDescriptor } from './agent/capabilities.ts'
import { reachOf, functionsOf, formatReach, formatInventory, grantsOfRole } from './agent/permissions.ts'
import { readConfig, sqliteStore } from './server/config.ts'
import { schemaFromManifest, planMigration, renderSql } from './data/migrate.ts'
import { migrateFleet, formatFleet } from './data/fleet.ts'
import { createAdapterPool } from './data/pool.ts'
import { sqliteAdapter } from './data/sqlite.ts'
import { bootApp, serveApp } from './server/boot.ts'
import { bootWorker, serveWorker } from './server/worker.ts'
import { createQueue } from './server/queue.ts'
import { scaffold } from './scaffold/index.ts'
import { KetError } from './kernel/errors.ts'
import { CookieJar, createTestApp, TestClient, TestHttpError } from './testing.ts'
import type { Manifest } from './types.ts'

const [, , cmd = 'help', ...rest] = process.argv
const flag = (name: string) => rest.includes(`--${name}`)
const opt = (name: string) => {
  const i = rest.indexOf(`--${name}`)
  if (i >= 0) return rest[i + 1]
  const inline = rest.find((item) => item.startsWith(`--${name}=`))
  return inline?.slice(name.length + 3)
}
const opts = (name: string): string[] => {
  const out: string[] = []
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === `--${name}` && rest[i + 1] !== undefined) out.push(rest[++i] as string)
    else if (rest[i]?.startsWith(`--${name}=`)) out.push((rest[i] as string).slice(name.length + 3))
  }
  return out
}

const positionals = (valueOptions: readonly string[]): string[] => {
  const values = new Set(valueOptions)
  const end = rest.indexOf('--')
  const args = end < 0 ? rest : rest.slice(0, end)
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const item = args[i] as string
    if (!item.startsWith('--')) {
      out.push(item)
      continue
    }
    const name = item.slice(2).split('=')[0] as string
    if (!item.includes('=') && values.has(name)) i++
  }
  return out
}

const CANDIDATES = [
  'dist/ket.workspace.js',
  '.build/ket.workspace.js',
  'ket.workspace.js',
  'workspace.js',
  'examples/workspace.js',
]

/** Where the apps are declared. Named explicitly, or the first conventional path. */
const workspacePath = () => {
  const given = opt('workspace')
  if (given) {
    if (/\.[cm]?tsx?$/.test(given) && process.env.KET_DEV_SOURCE !== '1') {
      throw new Error(
        `refusing to execute source workspace "${given}" — build it and pass the emitted .js artifact`,
      )
    }
    return given
  }
  const found = CANDIDATES.find((p) => existsSync(p))
  if (!found)
    throw new Error(`no workspace file found (looked for ${CANDIDATES.join(', ')}); pass --workspace FILE`)
  return found
}

const loadWorkspace = async () => {
  const configuredPath = workspacePath()
  const absolutePath = resolve(configuredPath)
  const mod = (await import(pathToFileURL(absolutePath).href)) as {
    default?: WorkspaceDeclaration
    apps?: WorkspaceDeclaration['apps']
    modulePaths?: WorkspaceDeclaration['modulePaths']
  }
  const declaration =
    mod.default && typeof mod.default === 'object' && Array.isArray(mod.default.apps)
      ? mod.default
      : { apps: mod.apps, modulePaths: mod.modulePaths }
  if (!Array.isArray(declaration.apps))
    throw new Error(
      `${configuredPath} must default-export defineWorkspace(...) or export \`apps\`, an array of defineApp(...)`,
    )
  const fromEnv = (process.env.KET_MODULE_PATH ?? '')
    .split(delimiter)
    .map((path) => path.trim())
    .filter(Boolean)
  const resolved = await resolveWorkspace(declaration as WorkspaceDeclaration, {
    baseUrl: pathToFileURL(absolutePath),
    extraModulePaths: [...fromEnv, ...opts('module-path')],
    allowSource: process.env.KET_DEV_SOURCE === '1',
  })
  return { ws: composeWorkspace(resolved.apps), apps: resolved.apps, resolved }
}

const formatModules = (paths: readonly string[], modules: readonly ResolvedModuleInfo[]): string => {
  const lines = ['module paths:']
  for (const path of paths) lines.push(`  ${path}`)
  if (!paths.length) lines.push('  (none)')
  lines.push('modules:')
  for (const module of modules) {
    lines.push(
      `  ${module.name.padEnd(24)} ${module.version.padEnd(10)} ${module.kind.padEnd(6)} apps=${module.apps.join(',')}  ${module.source}`,
    )
  }
  if (!modules.length) lines.push('  (none)')
  return lines.join('\n')
}

/** The AppSpec, not the composed manifest — serving needs what the app declared. */
const pickSpec = (specs: AppSpec[]): AppSpec => {
  const name = opt('app')
  if (!name) {
    const servable = specs.filter((s) => s.serve)
    const one = servable[0] ?? specs[0]
    if (!one) throw new Error('the workspace declares no apps')
    return one
  }
  const found = specs.find((s) => s.name === name)
  if (!found) throw new Error(`unknown app "${name}" (have: ${specs.map((s) => s.name).join(', ')})`)
  return found
}

const pickApp = (ws: { apps: Record<string, Manifest> }): [string, Manifest] => {
  const name = opt('app') ?? (Object.keys(ws.apps)[0] as string)
  const m = ws.apps[name]
  if (!m) throw new Error(`unknown app "${name}" (have: ${Object.keys(ws.apps).join(', ')})`)
  return [name, m]
}

const HELP = `ket — zero-dependency fullstack framework

  ket check                 compose every app and report contract violations
  ket manifest [--app X]    print the composed manifest
  ket workspace             show apps, datastores and shared modules
  ket modules               show resolved modules and their source paths
  ket types [--app X]       generate .ket/types.d.ts from the manifest
  ket agent [--app X]       print the agent capability descriptor
  ket permissions           every function that exists to be granted
    --grant a,b,c           …or what a role granted exactly these can reach
    --module NAME           …or what granting one module's whole surface reaches
    --role NAME             …or what a role in the database actually grants
  ket migrate [--app X]     plan migrations (add --allow-destructive to permit data loss)
    --all                   …or apply them to every tenant database (add --dry-run)
  ket diff --against FILE   compare the current manifest with a stored one
  ket snapshot [--app X]    write .ket/manifest.<app>.json for a later diff

  ket serve [--app X]       boot the app and serve it
  ket worker [--app X]      run declared queues for the same app and manifest
  ket call FUNCTION         exercise a function through its real HTTP endpoint
    --against URL           call an already-running development server
    --input JSON|@FILE|-    function input (default: {})
    --company ID            request company; also --companies and --branches
    --tenant KEY            conventional x-tenant header (or use --header)
    --cookie-file FILE      load and update an isolated JSON cookie jar
    --login JSON|@FILE      POST credentials before the call (default: /login)
    --login-path PATH       override the application's login route
    --dry-run               report declared writes without applying them
    --idempotency-key KEY   exercise idempotent retry handling
    --isolated              boot a temporary app/database for this call
  ket test [FILES...]       run emitted headless tests with Node's test runner
    --watch                 rerun when the selected JavaScript artifacts change
    --test-name-pattern P   select tests by name; --coverage enables coverage
  ket jobs list             inspect durable jobs (--tenant is required for tenant apps)
  ket jobs retry ID         make a retryable/discarded job available now
  ket jobs cancel ID        cancel a pending or executing job
  ket jobs prune            apply the 7/30-day retention policy
  ket dev [--app X]         serve compiled output, restarting when an artifact changes
    --all                   run HTTP and worker together under this one watcher
                            (--no-auto-install holds back modules that install themselves)
  ket new NAME [--dir D]    scaffold an app that runs

Options: --workspace FILE (default: dist/ket.workspace.js, ket.workspace.js, workspace.js)
         --module-path DIR (repeatable; KET_MODULE_PATH uses the platform path separator)
         --app NAME, --port N, --header "Name: value" (repeatable)
`

const TEST_VALUE_OPTIONS = ['test-name-pattern', 'test-concurrency', 'reporter', 'out-dir'] as const

const collectTests = (path: string): string[] => {
  if (!existsSync(path)) throw new Error(`test path does not exist: ${path}`)
  if (!statSync(path).isDirectory()) return [path]
  const files: string[] = []
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = join(dir, entry.name)
      if (entry.isDirectory()) visit(child)
      else if (/\.(?:test|spec)\.[cm]?js$/.test(entry.name)) files.push(child)
    }
  }
  visit(path)
  return files.sort()
}

const emittedTestPath = (input: string): string => {
  const source = normalize(input).replace(/^\.\//, '')
  const extension = extname(source)
  if (extension !== '.ts' && extension !== '.tsx') return source
  const emitted = source.slice(0, -extension.length) + '.js'
  const candidates = [...(opt('out-dir') ? [opt('out-dir') as string] : []), '.build', 'dist'].map((dir) =>
    join(dir, emitted),
  )
  const found = candidates.find((candidate) => existsSync(candidate))
  if (!found)
    throw new Error(`no emitted test for ${input}; build first (looked for ${candidates.join(', ')})`)
  return found
}

const runTests = async (): Promise<never> => {
  const selected = positionals(TEST_VALUE_OPTIONS).flatMap((path) => collectTests(emittedTestPath(path)))
  const defaultDir = [opt('out-dir'), '.build/test', 'dist/test'].find((candidate): candidate is string =>
    Boolean(candidate && existsSync(candidate)),
  )
  const defaults = selected.length ? selected : defaultDir ? collectTests(defaultDir) : []
  const nodeArgs = ['--test']
  if (flag('watch')) nodeArgs.push('--watch')
  if (flag('coverage')) nodeArgs.push('--experimental-test-coverage')
  if (flag('test-only')) nodeArgs.push('--test-only')
  for (const [option, nodeOption] of [
    ['test-name-pattern', '--test-name-pattern'],
    ['test-concurrency', '--test-concurrency'],
    ['reporter', '--test-reporter'],
  ] as const) {
    const value = opt(option)
    if (value) nodeArgs.push(`${nodeOption}=${value}`)
  }
  const separator = rest.indexOf('--')
  if (separator >= 0) nodeArgs.push(...rest.slice(separator + 1))
  nodeArgs.push(...defaults)
  const child = spawn(process.execPath, nodeArgs, { stdio: 'inherit', env: process.env })
  const code = await new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', (status, signal) => resolve(status ?? (signal ? 1 : 0)))
  })
  process.exit(code)
}

const callHeaders = (): Headers => {
  const headers = new Headers()
  for (const raw of opts('header')) {
    const separator = raw.indexOf(':')
    if (separator <= 0) throw new Error(`invalid --header "${raw}" (expected "Name: value")`)
    headers.append(raw.slice(0, separator).trim(), raw.slice(separator + 1).trim())
  }
  const cookie = opt('cookie')
  if (cookie) headers.set('cookie', cookie)
  return headers
}

const jsonObject = (value: string | undefined, label: string): Record<string, unknown> => {
  const raw =
    value === undefined
      ? '{}'
      : value === '-'
        ? readFileSync(0, 'utf8')
        : value.startsWith('@')
          ? readFileSync(value.slice(1), 'utf8')
          : value
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    throw new Error(`${label} must be a JSON object`)
  return parsed as Record<string, unknown>
}

const callInput = (): Record<string, unknown> => jsonObject(opt('input'), '--input')

const callWithClient = async (baseUrl: string): Promise<number> => {
  const fnKey = positionals([
    'against',
    'input',
    'company',
    'companies',
    'branches',
    'tenant',
    'tenant-header',
    'locale',
    'cookie',
    'cookie-file',
    'login',
    'login-path',
    'idempotency-key',
    'header',
    'app',
    'workspace',
    'module-path',
  ])[0]
  if (!fnKey) throw new Error('usage: ket call FUNCTION [--against URL] [--input JSON|@FILE|-]')
  const cookieFile = opt('cookie-file')
  const jar = cookieFile ? await CookieJar.load(cookieFile) : new CookieJar()
  const list = (name: string) =>
    opt(name)
      ?.split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  const client = new TestClient(baseUrl, {
    jar,
    company: opt('company'),
    companies: list('companies'),
    branches: list('branches'),
    tenant: opt('tenant'),
    tenantHeader: opt('tenant-header'),
    locale: opt('locale'),
    headers: callHeaders(),
  })
  try {
    if (opt('login')) await client.login(jsonObject(opt('login'), '--login'), opt('login-path') ?? '/login')
    const result = await client.call(fnKey, callInput(), {
      dryRun: flag('dry-run'),
      ...(opt('idempotency-key') ? { idempotencyKey: opt('idempotency-key') as string } : {}),
    })
    if (cookieFile) await jar.save(cookieFile)
    const output = flag('value') ? result.value : result
    console.log(JSON.stringify(output, null, flag('compact') ? 0 : 2))
    return 0
  } catch (error) {
    if (cookieFile) await jar.save(cookieFile)
    if (!(error instanceof TestHttpError)) throw error
    console.error(JSON.stringify(error.body, null, 2))
    return 1
  }
}

try {
  if (cmd === 'help' || cmd === '--help') {
    console.log(HELP)
    process.exit(0)
  }

  if (cmd === 'new') {
    const name = rest.find((a) => !a.startsWith('--'))
    if (!name) throw new Error('usage: ket new NAME [--dir DIR]')
    for (const line of scaffold(name, opt('dir') ?? name)) console.log(line)
    process.exit(0)
  }

  if (cmd === 'test') await runTests()

  // Remote smoke calls need no workspace and do not boot a second app.
  if (cmd === 'call' && opt('against')) {
    const against = new URL(opt('against') as string)
    if (against.protocol !== 'http:' && against.protocol !== 'https:')
      throw new Error('--against must be an http(s) URL')
    process.exit(await callWithClient(against.toString()))
  }

  if (cmd === 'dev') {
    // This watches emitted JavaScript only. The project owns the compiler watcher;
    // `ket new` wires both sides together without handing source files to Node.
    const childCommand = flag('all') ? 'all' : 'serve'
    const argv = [
      '--watch',
      new URL(import.meta.url).pathname,
      childCommand,
      ...rest.filter((item) => item !== '--all'),
    ]
    const child = spawn(process.execPath, argv, { stdio: 'inherit', env: { ...process.env, KET_DEV: '1' } })
    child.on('exit', (code) => process.exit(code ?? 0))
    for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => child.kill(sig))
    await new Promise(() => {})
  }

  const { ws, apps: specs, resolved } = await loadWorkspace()
  mkdirSync('.ket', { recursive: true })

  if (cmd === 'serve') {
    const spec = pickSpec(specs)
    if (!spec.serve) throw new Error(`app "${spec.name}" declares no serve block, so there is nothing to run`)
    const port = opt('port')
    const env = flag('no-auto-install') ? { ...process.env, KET_AUTO_INSTALL: '0' } : process.env
    await serveApp(spec, { env, ...(port ? { port: Number(port) } : {}) })
  } else if (cmd === 'worker') {
    const spec = pickSpec(specs)
    const worker = await serveWorker(spec, { env: process.env })
    console.log(`worker ${worker.workerId} is running (${Object.keys(spec.worker?.queues ?? {}).join(', ')})`)
  } else if (cmd === 'call') {
    const spec = pickSpec(specs)
    if (!spec.serve) throw new Error(`app "${spec.name}" declares no serve block`)
    if (flag('isolated')) {
      const testApp = await createTestApp(spec, { worker: false })
      try {
        process.exitCode = await callWithClient(testApp.baseUrl)
      } finally {
        await testApp.close()
      }
    } else {
      const env = {
        ...process.env,
        ...(flag('no-migrate') ? { KET_MIGRATE: '0' } : {}),
        ...(flag('no-auto-install') ? { KET_AUTO_INSTALL: '0' } : {}),
      }
      const app = await bootApp(spec, {
        env,
        port: 0,
        log: flag('verbose') ? (line) => console.error(line) : () => {},
      })
      try {
        process.exitCode = await callWithClient(`http://127.0.0.1:${app.port}`)
      } finally {
        await app.close()
      }
    }
  } else if (cmd === 'all') {
    const spec = pickSpec(specs)
    if (!spec.serve) throw new Error(`app "${spec.name}" declares no serve block`)
    if (!spec.worker) throw new Error(`app "${spec.name}" declares no worker block`)
    const app = await bootApp(spec, {
      env: process.env,
      ...(opt('port') ? { port: Number(opt('port')) } : {}),
    })
    const worker = await bootWorker(spec, { env: process.env })
    worker.start()
    console.log(await app.banner())
    console.log(`  worker ${worker.workerId} is running in this development process\n`)
    const close = async () => {
      await worker.close()
      await app.close()
      process.exit(0)
    }
    for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => void close())
    await new Promise(() => {})
  } else if (cmd === 'jobs') {
    const action = rest.find((item) => !item.startsWith('--'))
    const positional = rest.filter((item, index) => {
      if (item.startsWith('--')) return false
      const previous = rest[index - 1]
      return !previous?.startsWith('--')
    })
    const id = positional[1]
    const spec = pickSpec(specs)
    const config = readConfig(process.env, {
      sqliteFile: `.ket/${spec.name}.db`,
      ...spec.serve?.defaults,
    })
    const tenant = opt('tenant')
    if (spec.serve?.tenants && !tenant)
      throw new Error(`app "${spec.name}" has tenant databases; pass --tenant NAME`)
    const adapter = spec.serve?.tenants
      ? await spec.serve.tenants.open(tenant as string, config)
      : await (spec.serve?.openStore ?? sqliteStore)(config)
    if (spec.serve?.tenants) await adapter.open()
    try {
      const queue = await createQueue(adapter)
      if (action === 'list') {
        const state = opt('state') as import('./server/queue.ts').JobState | undefined
        if (
          state &&
          ![
            'available',
            'scheduled',
            'executing',
            'retryable',
            'completed',
            'discarded',
            'cancelled',
          ].includes(state)
        )
          throw new Error(`unknown job state "${state}"`)
        const limit = opt('limit') === undefined ? undefined : Number(opt('limit'))
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1))
          throw new Error('--limit must be a positive integer')
        const rows = await queue.list({
          ...(state ? { state } : {}),
          ...(opt('queue') ? { queue: opt('queue') as string } : {}),
          ...(limit === undefined ? {} : { limit }),
        })
        console.log(JSON.stringify(rows, null, 2))
      } else if (action === 'retry') {
        if (!id) throw new Error('usage: ket jobs retry ID [--tenant NAME]')
        if (!(await queue.retryNow(id))) throw new Error(`job "${id}" is not retryable or discarded`)
        console.log(`job ${id} is available`)
      } else if (action === 'cancel') {
        if (!id) throw new Error('usage: ket jobs cancel ID [--tenant NAME]')
        if (!(await queue.cancel(id))) throw new Error(`job "${id}" cannot be cancelled`)
        console.log(`job ${id} is cancelled`)
      } else if (action === 'prune') {
        console.log(`pruned ${await queue.prune()} job(s)`)
      } else {
        throw new Error('usage: ket jobs list|retry ID|cancel ID|prune [--tenant NAME]')
      }
    } finally {
      await adapter.close()
    }
  } else if (cmd === 'check') {
    console.log(explainWorkspace(ws))
    console.log('\nall contracts hold')
  } else if (cmd === 'workspace') {
    console.log(explainWorkspace(ws))
  } else if (cmd === 'modules') {
    console.log(formatModules(resolved.modulePaths, resolved.modules))
  } else if (cmd === 'manifest') {
    const [, m] = pickApp(ws)
    console.log(JSON.stringify(m, null, 2))
  } else if (cmd === 'types') {
    const [name, m] = pickApp(ws)
    const out = `.ket/types.${name}.d.ts`
    writeFileSync(out, generateDts(m))
    console.log(`wrote ${out}`)
  } else if (cmd === 'permissions') {
    const [, m] = pickApp(ws)
    const module = opt('module')
    const grant = opt('grant')
    const role = opt('role')
    if (role) {
      // The one form that reads the database: a role is data, and what it grants is
      // a fact about a deployment rather than about the code.
      const spec = pickSpec(specs)
      const config = readConfig(process.env, spec.serve?.defaults ?? {})
      const adapter = await (spec.serve?.openStore ?? sqliteStore)(config)
      try {
        const keys = await grantsOfRole(adapter, role)
        console.log(`role "${role}" grants ${keys.length} function(s)\n`)
        console.log(formatReach(reachOf(m, keys)))
      } finally {
        await adapter.close()
      }
    } else if (module) console.log(formatReach(reachOf(m, functionsOf(m, module))))
    else if (grant)
      console.log(
        formatReach(
          reachOf(
            m,
            grant
              .split(',')
              .map((s) => s.trim())
              .filter(Boolean),
          ),
        ),
      )
    else console.log(formatInventory(m))
  } else if (cmd === 'agent') {
    const [, m] = pickApp(ws)
    console.log(JSON.stringify(agentDescriptor(m), null, 2))
  } else if (cmd === 'snapshot') {
    const [name, m] = pickApp(ws)
    const out = `.ket/manifest.${name}.json`
    writeFileSync(out, JSON.stringify(m, null, 2))
    console.log(`wrote ${out}`)
  } else if (cmd === 'diff') {
    const against = opt('against')
    if (!against || !existsSync(against))
      throw new Error('pass --against <manifest.json> (make one with `ket snapshot`)')
    const [, m] = pickApp(ws)
    const before = JSON.parse(readFileSync(against, 'utf8')) as Manifest
    const items = diffManifests(before, m)
    console.log(formatDiff(items))
    process.exit(items.some((i) => i.severity === 'breaking') ? 1 : 0)
  } else if (cmd === 'migrate') {
    const spec = pickSpec(specs)
    if (flag('all')) {
      // The fleet. A deployment that ships a new module has to reach every tenant
      // database, and one that cannot be opened must not stop the others — a
      // half-migrated fleet you cannot see is worse than one you can.
      const tenants = spec.serve?.tenants
      if (!tenants) throw new Error(`app "${spec.name}" serves a single datastore; drop --all`)
      const config = readConfig(process.env, spec.serve?.defaults ?? {})
      const pool = createAdapterPool({ create: (key) => tenants.open(key, config) as never })
      try {
        const keys = await tenants.list()
        const m = ws.apps[spec.name] as Manifest
        const results = await migrateFleet(pool, keys, m, {
          allowDestructive: flag('allow-destructive'),
          dryRun: flag('dry-run'),
        })
        console.log(formatFleet(results))
        process.exit(results.some((r) => r.error) ? 1 : 0)
      } finally {
        await pool.close()
      }
    }
    const [name, m] = pickApp(ws)
    const adapter = sqliteAdapter()
    adapter.open()
    const snapPath = `.ket/schema.${name}.json`
    const prev = existsSync(snapPath) ? JSON.parse(readFileSync(snapPath, 'utf8')) : null
    const next = schemaFromManifest(m)
    const ops = planMigration(prev, next, { allowDestructive: flag('allow-destructive') })
    for (const sql of renderSql(ops, adapter)) console.log(sql + ';')
    writeFileSync(snapPath, JSON.stringify(next, null, 2))
    console.log(`\n-- ${ops.length} operation(s); schema snapshot written to ${snapPath}`)
    adapter.close()
  } else {
    console.error(`unknown command "${cmd}"\n\n${HELP}`)
    process.exit(1)
  }
} catch (e) {
  if (e instanceof KetError) {
    console.error(JSON.stringify(e.toJSON(), null, 2))
    process.exit(1)
  }
  console.error((e as Error).message)
  process.exit(1)
}
