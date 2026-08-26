// Build is the only path from authored TypeScript/TSX to executable code.
//
// TypeScript emits the complete workspace to .build so tests and local apps run
// JavaScript. Package artifacts are then copied to each package's dist directory,
// which is the only target exposed by package.json at runtime.

import {
  cpSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildBackendClients } from './build-backend-client.mjs'
import { buildChartClient } from './build-chart-client.mjs'
import { buildFlowClient } from './build-flow-client.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUILD = join(ROOT, '.build')
const TYPES = join(ROOT, '.types')
const PACKAGES = join(ROOT, 'packages')
const LOCK = join(ROOT, '.ket-build.lock')
const FINGERPRINT = '.ket-build-fingerprint'
const packageNames = readdirSync(PACKAGES, { withFileTypes: true })
  .filter(
    (entry) =>
      entry.isDirectory() &&
      existsSync(join(PACKAGES, entry.name, 'package.json')) &&
      existsSync(join(PACKAGES, entry.name, 'src')),
  )
  .map((entry) => entry.name)

const tsc = join(ROOT, 'node_modules', '.bin', 'tsc')
const codeExtension = new Set(['.ts', '.tsx', '.mts', '.cts'])
const buildInputs = new Set(['.ts', '.tsx', '.mts', '.cts', '.mjs', '.json', '.css', '.ktl', '.tmpl'])

/** @param {number} milliseconds */
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

/** @param {number} pid */
const processExists = (pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const acquireLock = async () => {
  const started = Date.now()
  while (true) {
    try {
      mkdirSync(LOCK)
      writeFileSync(join(LOCK, 'owner'), String(process.pid))
      return
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'EEXIST') throw error
      let owner = 0
      try {
        owner = Number(readFileSync(join(LOCK, 'owner'), 'utf8'))
      } catch {
        // mkdir and owner creation are separate filesystem operations. Another
        // builder may observe the directory in that tiny interval.
        await delay(20)
        continue
      }
      if (!Number.isInteger(owner) || !processExists(owner)) {
        rmSync(LOCK, { recursive: true, force: true })
        continue
      }
      if (Date.now() - started > 120_000) throw new Error(`timed out waiting for build process ${owner}`)
      await delay(100)
    }
  }
}

const sourceFingerprint = () => {
  const hash = createHash('sha256')
  const roots = ['packages', 'apps', 'examples', 'test', 'tools', 'bench']
  const files = [
    'ket.workspace.ts',
    'package.json',
    'package-lock.json',
    'tsconfig.base.json',
    'tsconfig.build.json',
    'tsconfig.types.json',
  ]
  /** @param {string} dir */
  const visit = (dir) => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'dist') visit(path)
      } else if (buildInputs.has(extname(entry.name))) {
        files.push(path)
      }
    }
  }
  for (const root of roots) visit(root)
  for (const file of files.sort()) {
    hash.update(file)
    hash.update('\0')
    hash.update(readFileSync(join(ROOT, file)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

const artifactsExist = () =>
  existsSync(join(BUILD, 'ket.workspace.js')) &&
  existsSync(
    join(BUILD, 'packages', 'ketsuite', 'src', 'modules', 'backend', 'design', 'design-system', 'styles.css'),
  ) &&
  packageNames.every(
    (name) =>
      existsSync(join(BUILD, 'packages', name, 'src', 'index.js')) &&
      existsSync(join(PACKAGES, name, 'dist', 'index.js')),
  )

/**
 * @param {string} source
 * @param {string[]} destinations
 */
function copyAssets(source, destinations) {
  if (!existsSync(source)) return
  /** @param {string} dir */
  const visit = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const from = join(dir, entry.name)
      if (entry.isDirectory()) {
        visit(from)
        continue
      }
      if (codeExtension.has(extname(entry.name))) continue
      const suffix = relative(source, from)
      for (const destination of destinations) {
        const to = join(destination, suffix)
        mkdirSync(dirname(to), { recursive: true })
        cpSync(from, to)
      }
    }
  }
  visit(source)
}

await acquireLock()
try {
  // Regenerated before the fingerprint hash runs, so the bundle it produces is
  // itself part of what the fingerprint covers — a fresh checkout and a
  // no-op rebuild both land on a self-consistent state.
  await buildBackendClients()
  await buildChartClient()
  await buildFlowClient()
  const fingerprint = sourceFingerprint()
  const current = existsSync(join(BUILD, FINGERPRINT)) ? readFileSync(join(BUILD, FINGERPRINT), 'utf8') : null
  if (current === fingerprint && artifactsExist()) {
    console.log('build artifacts already match this source revision')
  } else {
    const stage = join(ROOT, `.ket-build-stage-${process.pid}`)
    const stageBuild = join(stage, 'build')
    const stageTypes = join(stage, 'types')
    const stageDist = join(stage, 'dist')
    rmSync(stage, { recursive: true, force: true })
    mkdirSync(stage, { recursive: true })
    try {
      for (const [project, outDir] of [
        ['tsconfig.build.json', stageBuild],
        ['tsconfig.types.json', stageTypes],
      ]) {
        const result = spawnSync(tsc, ['-p', project, '--outDir', outDir], {
          cwd: ROOT,
          stdio: 'inherit',
        })
        if (result.error) throw result.error
        if (result.status !== 0) throw new Error(`TypeScript build failed for ${project}`)
      }

      for (const name of packageNames) {
        const emitted = join(stageBuild, 'packages', name, 'src')
        const dist = join(stageDist, name)
        if (!existsSync(emitted)) throw new Error(`TypeScript emitted no package artifact for ${name}`)
        cpSync(emitted, dist, { recursive: true })
        const declarations = join(stageTypes, name, 'src')
        if (!existsSync(declarations)) throw new Error(`TypeScript emitted no declarations for ${name}`)
        cpSync(declarations, dist, { recursive: true })
        copyAssets(join(PACKAGES, name, 'src'), [emitted, dist])
      }
      // The public design system is the canonical visual foundation. Backend
      // assets are self-contained at runtime, so copy its CSS beside the legacy
      // compatibility styles instead of relying on a workspace filesystem path.
      copyAssets(join(PACKAGES, 'design-system', 'src'), [
        join(stageBuild, 'packages', 'ketsuite', 'src', 'modules', 'backend', 'design', 'design-system'),
        join(stageDist, 'ketsuite', 'modules', 'backend', 'design', 'design-system'),
      ])
      writeFileSync(join(stageBuild, FINGERPRINT), fingerprint)

      // Only a complete staged build may replace the current good artifacts.
      // The lock makes this short commit section exclusive across processes.
      rmSync(BUILD, { recursive: true, force: true })
      rmSync(TYPES, { recursive: true, force: true })
      cpSync(stageBuild, BUILD, { recursive: true })
      cpSync(stageTypes, TYPES, { recursive: true })
      for (const name of packageNames) {
        const dist = join(PACKAGES, name, 'dist')
        rmSync(dist, { recursive: true, force: true })
        cpSync(join(stageDist, name), dist, { recursive: true })
      }

      for (const name of ['ketjs', 'ketsuite']) {
        const cli = join(PACKAGES, name, 'dist', 'cli.js')
        if (existsSync(cli)) chmodSync(cli, 0o755)
      }
      console.log(`built ${packageNames.length} packages and workspace runtime into .build`)
    } finally {
      rmSync(stage, { recursive: true, force: true })
    }
  }
} finally {
  rmSync(LOCK, { recursive: true, force: true })
}
