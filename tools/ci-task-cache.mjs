import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Only deterministic, output-free checks belong here. DB/browser/release checks
// depend on external state and must never be added to this allowlist.
export const tasks = {
  format: ['node_modules/@biomejs/biome/bin/biome', 'format'],
  lint: ['node_modules/@biomejs/biome/bin/biome', 'lint'],
  types: ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'],
  'unit-cache': ['--test', 'tools/ci-build-cache-key.test.mjs', 'tools/ci-task-cache.test.mjs'],
}

/** @param {string} task */
function command(task) {
  if (!Object.hasOwn(tasks, task)) throw new Error(`Task is not cacheable: ${task}`)
  return tasks[/** @type {keyof typeof tasks} */ (task)]
}

/** The same controlled environment is used locally and in CI.
 * @param {NodeJS.ProcessEnv} [source]
 */
export function taskEnvironment(source = process.env) {
  /** @type {NodeJS.ProcessEnv} */
  const env = { CI: 'true', TZ: 'UTC', LANG: 'C.UTF-8', NO_COLOR: '1' }
  for (const name of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'TMPDIR', 'TMP', 'TEMP'])
    if (source[name] !== undefined) env[name] = source[name]
  return env
}

/** @param {string} root @param {string} task
 * @param {{node: string, platform: string, arch: string}} [runtime]
 */
export function taskKey(
  root,
  task,
  runtime = { node: process.version, platform: process.platform, arch: process.arch },
) {
  const args = command(task)
  const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(Boolean)
  // TypeScript can resolve generated declarations and JS. Include ignored
  // outputs too, while excluding installed third-party dependency trees.
  if (task === 'types') {
    files.push(
      ...execFileSync(
        'git',
        [
          'ls-files',
          '-z',
          '--others',
          '--ignored',
          '--exclude-standard',
          '--',
          'packages',
          'apps',
          'examples',
          'test',
          'tools',
          'bench',
          '.types',
          ':(glob,exclude)**/node_modules/**',
        ],
        { cwd: root, encoding: 'utf8' },
      )
        .split('\0')
        .filter(Boolean),
    )
  }
  const hash = createHash('sha256')
  /** @param {string | Buffer} value */
  const add = (value) => {
    const bytes = Buffer.from(value)
    hash.update(`${bytes.length}:`).update(bytes)
  }
  add(
    JSON.stringify({
      schema: 1,
      task,
      args,
      runtime,
      env: { CI: 'true', TZ: 'UTC', LANG: 'C.UTF-8', NO_COLOR: '1' },
    }),
  )
  // Hash content, not commit IDs or mtimes; include dirty and untracked inputs.
  // Broad input coverage is intentional until dependency closures are proven.
  for (const file of [...new Set(files)].sort()) {
    if (file.startsWith('.task-cache/')) continue
    add(file)
    const path = join(root, file)
    if (existsSync(path)) {
      add('file')
      add(readFileSync(path))
    } else add('deleted')
  }
  // A locally changed installed tool version must not reuse an older result.
  for (const file of [
    'node_modules/.package-lock.json',
    'node_modules/typescript/package.json',
    'node_modules/@biomejs/biome/package.json',
  ]) {
    add(file)
    add(existsSync(join(root, file)) ? readFileSync(join(root, file)) : 'missing')
  }
  return `ketjs-task-v1-${task}-${hash.digest('hex')}`
}

/** @param {string} root @param {string} task
 * @param {{force?: boolean, execute?: (args: string[], env: NodeJS.ProcessEnv) => number}} [options]
 */
export function runTask(root, task, options = {}) {
  const args = command(task)
  const key = taskKey(root, task)
  const directory = join(root, '.task-cache', task)
  const receipt = join(directory, `${key}.json`)
  if (!options.force) {
    try {
      const saved = JSON.parse(readFileSync(receipt, 'utf8'))
      if (saved.key === key && saved.task === task && saved.exitCode === 0) {
        console.log(`[task-cache] HIT ${task} ${key}`)
        return { key, hit: true, status: 0 }
      }
    } catch {
      /* Missing/corrupt cache is an ordinary miss. */
    }
  }
  // A forced failed rerun must not leave an earlier success eligible for reuse.
  rmSync(receipt, { force: true })
  console.log(`[task-cache] ${options.force ? 'FORCE' : 'MISS'} ${task} ${key}`)
  const env = taskEnvironment()
  const result = options.execute
    ? options.execute(args, env)
    : (spawnSync(process.execPath, args, { cwd: root, env, stdio: 'inherit' }).status ?? 1)
  if (result !== 0) return { key, hit: false, status: result }
  if (taskKey(root, task) !== key) {
    console.error('[task-cache] Inputs changed during execution; result was not cached. Run again.')
    return { key, hit: false, status: 1 }
  }
  mkdirSync(directory, { recursive: true })
  const temporary = `${receipt}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify({ key, task, exitCode: 0 }))
  renameSync(temporary, receipt)
  return { key, hit: false, status: 0 }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, task, ...flags] = process.argv.slice(2)
  if (!task || !['key', 'run'].includes(mode) || flags.some((flag) => flag !== '--force'))
    throw new Error('Usage: node tools/ci-task-cache.mjs <key|run> <format|lint|types|unit-cache> [--force]')
  if (mode === 'key') console.log(`key=${taskKey(process.cwd(), task)}`)
  else process.exitCode = runTask(process.cwd(), task, { force: flags.includes('--force') }).status
}
