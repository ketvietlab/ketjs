// `ket new` — the smallest thing that is still a real deployment.
//
// A scaffold earns its place only if what it emits runs unedited, so this writes a
// module with a model and a function, a deployment that serves it, and a workspace file
// the CLI finds by convention. Nothing is a placeholder waiting to be filled in.
//
// The templates are files rather than string literals on purpose. A literal
// containing `from '@ketvietlab/ketjs'` is indistinguishable, to anything reading the source,
// from an actual import — and the dependency audit reads the source. Keeping them
// out of the .ts files makes "this is data, not code" a shape rather than an
// exception someone has to remember.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const VERSION = '0.5.0'
const SPEC_VERSION = '0.1.41'
const TEMPLATES = new URL('./templates/', import.meta.url)

/** Template file → path it is written to, relative to the new project's directory. */
const LAYOUT: Array<[string, (name: string) => string]> = [
  ['package.json.tmpl', () => 'package.json'],
  ['module.ts.tmpl', (n) => `modules/${n}.ts`],
  ['ket.workspace.ts.tmpl', () => 'ket.workspace.ts'],
  ['tsconfig.json.tmpl', () => 'tsconfig.json'],
  ['biome.json.tmpl', () => 'biome.json'],
  ['dev.mjs.tmpl', () => 'tools/dev.mjs'],
  ['openapi.ts.tmpl', () => 'tools/openapi.ts'],
  ['deployment.test.ts.tmpl', () => 'test/deployment.test.ts'],
  ['gitignore.tmpl', () => '.gitignore'],
]

const render = (template: string, name: string): string =>
  readFileSync(new URL(template, TEMPLATES), 'utf8')
    .replaceAll('__NAME__', name)
    .replaceAll('__VERSION__', VERSION)
    .replaceAll('__SPEC_VERSION__', SPEC_VERSION)

export type ScaffoldOptions = { auth?: 'none' | 'session' }

export function scaffold(name: string, dir: string, options: ScaffoldOptions = {}): string[] {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(
      `invalid deployment name "${name}" — lowercase letters, digits and underscore, starting with a letter`,
    )
  }
  const auth = options.auth ?? 'none'
  if (auth !== 'none' && auth !== 'session') throw new Error('auth must be "none" or "session"')
  if (auth === 'session' && name === 'auth')
    throw new Error('"auth" is reserved by the session starter; choose another application name')
  const layout = LAYOUT.map(([tpl, to]): [string, (name: string) => string] => [
    auth === 'session' &&
    ['module.ts.tmpl', 'ket.workspace.ts.tmpl', 'deployment.test.ts.tmpl', 'openapi.ts.tmpl'].includes(tpl)
      ? `auth-${tpl}`
      : tpl,
    to,
  ])
  if (auth === 'session')
    layout.push(
      ['auth.ts.tmpl', () => 'modules/auth.ts'],
      ['auth-provision.mjs.tmpl', () => 'tools/provision.mjs'],
      ['auth-README.md.tmpl', () => 'README.md'],
    )
  const written = layout.map(([tpl, to]) => {
    let body = render(tpl, name)
    if (auth === 'session' && tpl === 'package.json.tmpl') {
      const pkg = JSON.parse(body)
      pkg.scripts['user:add'] = 'npm run build --silent && node tools/provision.mjs'
      body = JSON.stringify(pkg, null, 2) + '\n'
    }
    return [to(name), body] as const
  })

  // Refuse rather than overwrite: a scaffold that can eat work is not a scaffold.
  const clashes = written.map(([p]) => p).filter((p) => existsSync(join(dir, p)))
  if (clashes.length) throw new Error(`refusing to overwrite: ${clashes.map((p) => join(dir, p)).join(', ')}`)

  const out: string[] = []
  for (const [path, body] of written) {
    const full = join(dir, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body)
    out.push(`  wrote ${full}`)
  }
  out.push(
    '',
    `  cd ${dir} && npm install && npm run dev`,
    `  npm run openapi  # writes openapi/${name}.json`,
    '  npm run api:docs  # builds the API reference in .ket/api-docs',
  )
  if (auth === 'session')
    out.push(
      '  npm run user:add  # prompts for credentials without putting them in argv',
      '  POST /auth/login, GET /auth/me, POST /auth/logout',
      '  See README.md for the cookie-authenticated API example.',
    )
  return out
}
