import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, lstatSync, readdirSync, watch } from 'node:fs'
import type { Dirent } from 'node:fs'
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
const isIgnored = (name: string) => {
  const parts = name.split(sep)
  return (
    parts[0] === 'openapi' ||
    parts.some((part) => ignored.has(part)) ||
    /(?:\.md|\.mdx|\.swp|~)$/iu.test(name) ||
    /(?:^|[\\/])\.#/u.test(name)
  )
}
const testSource = (name: string) =>
  /^tests?(?:[\\/]|$)/u.test(name) || /\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(name)
const within = (path: string, root: string) => path === root || path.startsWith(root + sep)

function sourceTree(root: string) {
  const files = new Set<string>()
  const directories = new Set<string>()
  const visit = (directory: string) => {
    let entries: Dirent[]
    try {
      entries = readdirSync(directory, { withFileTypes: true })
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes((error as NodeJS.ErrnoException).code ?? '')) return
      throw error
    }
    directories.add(directory)
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (isIgnored(relative(root, path))) continue
      if (entry.isDirectory()) visit(path)
      else files.add(path)
    }
  }
  visit(root)
  return { files, directories }
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
  let knownFiles = new Set<string>()
  const watchers = new Map<string, ReturnType<typeof watch>>()
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
  const isRunning = () => running && running.child.exitCode === null && running.child.signalCode === null
  const publish = async (islands: Record<string, string>) => {
    await writeFile(join(browserDir, 'manifest.next'), JSON.stringify({ runtime, islands }))
    await rename(join(browserDir, 'manifest.next'), join(browserDir, 'manifest.json'))
  }

  const rebuild = async () => {
    let rescan = false
    for (const path of queued) {
      if (path === root) {
        dirty.add(path)
        structural = true
        rescan = true
        continue
      }
      const stat = lstatSync(path, { throwIfNoEntry: false })
      const isFile = Boolean(stat && !stat.isDirectory())
      const isDirectory = Boolean(stat?.isDirectory() || watchers.has(path))
      if (isDirectory) rescan = true
      if (!testSource(relative(root, path))) {
        dirty.add(path)
        if (isFile !== knownFiles.has(path) || isDirectory || stat?.isSymbolicLink()) structural = true
      }
      if (isFile) knownFiles.add(path)
      else knownFiles.delete(path)
    }
    queued = new Set()
    if (rescan) refreshWatchers()

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
    if (configured && dirty.size === 0 && isRunning()) return

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
      const restart = !browserEdit || !isRunning()
      if (restart) {
        await stop()
        runtime = randomUUID()
      }
      if (closing) return
      await publish(next)
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
    } catch (error) {
      if (!closing && !isRunning()) {
        await stop()
        await publish(revisions)
        if (!closing) start()
      }
      throw error
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
  function refreshWatchers() {
    const { files, directories } = sourceTree(root)
    knownFiles = files
    for (const [path, watcher] of watchers) {
      if (directories.has(path)) continue
      watcher.close()
      watchers.delete(path)
    }
    for (const path of directories) {
      if (closing || watchers.has(path)) continue
      const watcher = watch(path, (_event, name) => {
        const changed = name ? resolve(path, name) : root
        if (isIgnored(relative(root, changed))) return
        queued.add(changed)
        if (timer) clearTimeout(timer)
        timer = setTimeout(schedule, 60)
      })
      watcher.once('error', (error) => {
        console.error(error.message)
        process.exitCode = 1
        shutdown()
      })
      watchers.set(path, watcher)
    }
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  try {
    refreshWatchers()
    schedule()
    await closed
  } finally {
    closing = true
    if (timer) clearTimeout(timer)
    for (const watcher of watchers.values()) watcher.close()
    process.off('SIGINT', shutdown)
    process.off('SIGTERM', shutdown)
    checking?.kill('SIGTERM')
    await task
    await stop()
    await compiler?.close()
    await rm(browserDir, { recursive: true, force: true })
  }
}
