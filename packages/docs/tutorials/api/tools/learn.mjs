#!/usr/bin/env node
// Local learning companion. All backend execution stays on the learner's machine.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const course = JSON.parse(readFileSync(join(root, 'course.json'), 'utf8'))
const checkpoints = {
  api: 'dist/test/deployment.test.js',
  isolation: 'dist/test/isolation.test.js',
  jobs: 'dist/test/jobs.test.js',
}
const [command = 'help', argument] = process.argv.slice(2)
const run = (args, env = {}) => {
  const child = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  })
  if (child.error) throw child.error
  if (child.status !== 0) process.exit(child.status ?? 1)
}
const build = () => run(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json'])
const ket = 'node_modules/@ketvietlab/ketjs/dist/cli.js'
const fingerprint = () => {
  const digest = createHash('sha256')
  for (const path of [
    'package-lock.json',
    'ket.workspace.ts',
    'body.ts',
    'modules/learn_api.ts',
    'test/deployment.test.ts',
    'test/isolation.test.ts',
    'test/jobs.test.ts',
  ])
    digest.update(readFileSync(join(root, path)))
  return digest.digest('hex')
}
try {
  if (command === 'help') {
    console.log(
      'KetJS learning lab · 0.3.0 preview\n\nCommands:\n  doctor                 Check Node, SQLite and local dependencies\n  list                   List lessons and their execution environment\n  lesson <slug>          Read a bundled lesson\n  check <api|isolation|jobs>  Build and run one behavioral checkpoint\n  status                 Show checkpoint results and detect changed source\n  serve                  Start the local development API at 127.0.0.1:3711\n  worker                 Run the learning queue against the same lab database\n\nRun with: npm run learn -- <command>\nLessons without an automated checkpoint have a manual acceptance checklist.\nThe dev identity is for local learning; this lab is not a production auth setup.',
    )
  } else if (command === 'doctor') {
    if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 or newer is required.')
    for (const path of [ket, 'node_modules/typescript/bin/tsc'])
      if (!existsSync(join(root, path))) throw new Error('Run npm ci in the lab directory first.')
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(':memory:')
    try {
      if (db.prepare('SELECT 1 AS ok').get().ok !== 1) throw new Error('SQLite self-check failed')
    } finally {
      db.close()
    }
    console.log(
      `Ready: Node ${process.versions.node}, native SQLite, local KetJS dependencies.\nProject: ${root}`,
    )
  } else if (command === 'list') {
    for (const lesson of course)
      console.log(
        `${String(lesson.order).padStart(2, '0')}  ${lesson.slug.padEnd(22)} ${lesson.title}\n    ${lesson.lab} · ${lesson.url}`,
      )
  } else if (command === 'lesson') {
    const lesson = course.find((item) => item.slug === argument)
    if (!lesson) throw new Error('Unknown lesson. Use "list" to find a lesson slug.')
    console.log(readFileSync(join(root, 'lessons', `${lesson.slug}.md`), 'utf8'))
    console.log(`\nRead with diagrams and navigation: ${lesson.url}`)
  } else if (command === 'check') {
    const test = Object.hasOwn(checkpoints, argument ?? '') ? checkpoints[argument] : undefined
    if (!test) throw new Error('Choose one checkpoint: api, isolation, jobs.')
    build()
    run([ket, 'test', test])
    const directory = join(root, '.learn')
    const file = join(directory, 'progress.json')
    let progress = {}
    try {
      progress = JSON.parse(readFileSync(file, 'utf8'))
    } catch {
      /* First run or invalid local progress. */
    }
    if (!progress || typeof progress !== 'object' || Array.isArray(progress)) progress = {}
    progress[argument] = { passedAt: new Date().toISOString(), fingerprint: fingerprint() }
    mkdirSync(directory, { recursive: true })
    writeFileSync(file, JSON.stringify(progress, null, 2) + '\n')
    console.log(`\nCheckpoint passed: ${argument}. This result covers only its named behavior.`)
  } else if (command === 'status') {
    let progress = {}
    try {
      progress = JSON.parse(readFileSync(join(root, '.learn/progress.json'), 'utf8'))
    } catch {
      /* No results yet. */
    }
    const current = fingerprint()
    for (const key of Object.keys(checkpoints)) {
      const result = progress?.[key]
      console.log(
        `${key}: ${!result ? 'not run' : result.fingerprint === current ? `passed ${result.passedAt}` : 'source changed; run checkpoint again'}`,
      )
    }
  } else if (command === 'serve' || command === 'worker') {
    const env = { HOST: '127.0.0.1', PORT: '3711', KET_SQLITE: join(root, '.ket/learn.db') }
    mkdirSync(join(root, '.ket'), { recursive: true })
    if (command === 'serve')
      run(
        [
          'node_modules/tsx/dist/cli.mjs',
          'watch',
          '--clear-screen=false',
          'tools/dev.mjs',
          'serve',
          '--workspace',
          'ket.workspace.ts',
        ],
        env,
      )
    else {
      build()
      run([ket, 'worker', '--workspace', 'dist/ket.workspace.js', '--deployment', 'learn_api'], env)
    }
  } else throw new Error('Unknown command. Run "npm run learn -- help".')
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
