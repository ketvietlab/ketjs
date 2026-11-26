import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, watch } from 'node:fs'
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

type Compiler = {
  build(changed: ReadonlySet<string>, resolutionChanged?: boolean): Promise<ReadonlyMap<string, Uint8Array>>
  close(): Promise<void>
}
type BrowserConfig = { islands: Record<string, unknown>; browserOnly?: string[] }

const ignored = new Set(['.git', '.ket', '.build', 'dist', 'node_modules'])
const isIgnored = (name: string) => name.split(/[\\/]/u).some((segment) => ignored.has(segment))
const within = (path: string, root: string) => path === root || path.startsWith(root + sep)

function sourceFiles(root: string): Set<string> {
  const files = new Set<string>()
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (ignored.has(entry.name)) continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) visit(path)
      else files.add(path)
    }
  }
  visit(root)
  return files
}

function waitForChild(child: ChildProcess): Promise<number | null> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('exit', resolve)
  })
}

/** Own the source development loop. Compiled-artifact watch remains in the CLI. */
export async function serveSourceDev(cli: URL, command: string, args: string[]): Promise<void> {
  const root = process.cwd()
  const require = createRequire(join(root, 'package.json'))
  const typescript = require.resolve('typescript/package.json')
  const tsc = resolve(dirname(typescript), (require(typescript) as { bin: { tsc: string } }).bin.tsc)
  const tsx = pathToFileURL(require.resolve('tsx')).href
  const configFile = join(root, 'ket.dev.json')
  const knownFiles = sourceFiles(root)
  const scratchRoot = join(root, '.ket')
  await mkdir(scratchRoot, { recursive: true })
  const browserDir = await mkdtemp(join(scratchRoot, 'islands-'))

  let compiler: Compiler | undefined
  let browserOnly: string[] = []
  let configured = false
  let revisions: Record<string, string> = Object.create(null)
  let runtime = randomUUID()
  let checking: ChildProcess | undefined
  let running: { child: ChildProcess; exited: Promise<number | null> } | undefined
  let closing = false
  let queued = new Set<string>()
  let dirty = new Set<string>()
  let structural = true
  let task: Promise<void> | undefined
  let timer: NodeJS.Timeout | undefined
  let watcher: ReturnType<typeof watch> | undefined
  let finish: () => void = () => {}

  const stop = async () => {
    if (!running) return
    const { child, exited } = running
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
    await exited
    running = undefined
  }
  const start = () => {
    const child = spawn(process.execPath, ['--import', tsx, fileURLToPath(cli), command, ...args], {
      stdio: 'inherit',
      env: {
        ...process.env,
        KET_DEV: '1',
        KET_DEV_SOURCE: '1',
        KET_DEV_ISLAND_DIR: browserDir,
      },
    })
    const exited = waitForChild(child).catch((error: unknown) => {
      console.error(error)
      return null
    })
    running = { child, exited }
  }

  const rebuild = async () => {
    for (const path of queued) {
      dirty.add(path)
      if (path === root) {
        structural = true
        continue
      }
      const stat = lstatSync(path, { throwIfNoEntry: false })
      const isFile = Boolean(stat && !stat.isDirectory())
      if (isFile !== knownFiles.has(path) || stat?.isDirectory() || stat?.isSymbolicLink()) structural = true
      if (isFile) knownFiles.add(path)
      else knownFiles.delete(path)
    }
    queued = new Set()

    checking = spawn(
      process.execPath,
      [
        tsc,
        '-p',
        'tsconfig.json',
        '--noEmit',
        '--incremental',
        '--tsBuildInfoFile',
        join(browserDir, 'types.tsbuildinfo'),
      ],
      { stdio: 'inherit' },
    )
    const status = await waitForChild(checking)
    checking = undefined
    if (status !== 0 || closing) return

    const reloadConfig = !configured || dirty.has(configFile) || dirty.has(root)
    let candidate = compiler
    let clientPaths = browserOnly
    try {
      if (reloadConfig) {
        candidate = undefined
        clientPaths = []
        if (existsSync(configFile)) {
          const config = JSON.parse(await readFile(configFile, 'utf8')) as BrowserConfig
          clientPaths = (config.browserOnly ?? []).map((path) => {
            const absolute = resolve(root, path)
            if (!relative(root, absolute) || !within(absolute, root))
              throw new Error(`browserOnly path must be inside the project: ${path}`)
            return absolute
          })
          const tools = (await import(
            pathToFileURL(require.resolve('@ketvietlab/ketjs-view-tools/island-build')).href
          )) as { createIslandCompiler(root: string, config: BrowserConfig): Promise<Compiler> }
          candidate = await tools.createIslandCompiler(root, config)
        }
      }

      const resolutionChanged = structural || [...dirty].some((path) => /(?:\.json|\.lock)$/u.test(path))
      const built = await candidate?.build(dirty, resolutionChanged)
      const next: Record<string, string> = Object.assign(Object.create(null), reloadConfig ? {} : revisions)
      for (const [name, bytes] of built ?? []) {
        const hash = createHash('sha256').update(bytes).digest('hex')
        const file = join(browserDir, `${hash}.mjs`)
        if (!existsSync(file)) await writeFile(file, bytes)
        next[name] = hash
      }
      if (closing) return
      const browserEdit =
        !structural &&
        !reloadConfig &&
        Boolean(candidate) &&
        [...dirty].every((path) => browserOnly.some((directory) => within(path, directory)))
      const restart =
        !browserEdit || !running || running.child.exitCode !== null || running.child.signalCode !== null
      if (restart) {
        await stop()
        runtime = randomUUID()
      }
      if (closing) return
      await writeFile(join(browserDir, 'manifest.next'), JSON.stringify({ runtime, islands: next }))
      await rename(join(browserDir, 'manifest.next'), join(browserDir, 'manifest.json'))
      revisions = next
      if (reloadConfig) {
        await compiler?.close()
        compiler = candidate
        browserOnly = clientPaths
        configured = true
      }
      if (built?.size) console.log(`[ket dev] built islands: ${[...built.keys()].join(', ')}`)

      if (restart && !closing) start()
      dirty = new Set()
      structural = false
    } finally {
      if (candidate && candidate !== compiler) await candidate.close()
    }
  }

  const schedule = () => {
    if (task || closing || (configured && queued.size === 0)) return
    if (timer) clearTimeout(timer)
    task = rebuild()
      .catch((error: unknown) => console.error(error instanceof Error ? error.message : String(error)))
      .finally(() => {
        task = undefined
        if (queued.size) schedule()
      })
  }
  const closed = new Promise<void>((resolve) => {
    finish = resolve
  })
  const shutdown = () => {
    closing = true
    finish()
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  try {
    watcher = watch(root, { recursive: true }, (_event, name) => {
      if (name && isIgnored(name)) return
      queued.add(name ? resolve(root, name) : root)
      if (timer) clearTimeout(timer)
      timer = setTimeout(schedule, 60)
    })
    watcher.once('error', (error) => {
      console.error(error.message)
      process.exitCode = 1
      shutdown()
    })
    schedule()
    await closed
  } finally {
    closing = true
    if (timer) clearTimeout(timer)
    watcher?.close()
    process.off('SIGINT', shutdown)
    process.off('SIGTERM', shutdown)
    checking?.kill('SIGTERM')
    await task
    await stop()
    await compiler?.close()
    await rm(browserDir, { recursive: true, force: true })
  }
}
