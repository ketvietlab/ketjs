// `ket new` — the smallest thing that is still a real app.
//
// A scaffold earns its place only if what it emits runs unedited, so this writes a
// module with a model and a function, an app that serves it, and a workspace file
// the CLI finds by convention. Nothing is a placeholder waiting to be filled in.
//
// The templates are files rather than string literals on purpose. A literal
// containing `from 'ketjs'` is indistinguishable, to anything reading the source,
// from an actual import — and the dependency audit reads the source. Keeping them
// out of the .ts files makes "this is data, not code" a shape rather than an
// exception someone has to remember.

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const VERSION = '0.1.0'
const TEMPLATES = new URL('./templates/', import.meta.url)

/** Template file → path it is written to, relative to the new app's directory. */
const LAYOUT: Array<[string, (name: string) => string]> = [
  ['package.json.tmpl', () => 'package.json'],
  ['module.ts.tmpl', (n) => `modules/${n}.ts`],
  ['ket.workspace.ts.tmpl', () => 'ket.workspace.ts'],
  ['gitignore.tmpl', () => '.gitignore'],
]

const render = (template: string, name: string): string =>
  readFileSync(new URL(template, TEMPLATES), 'utf8')
    .replaceAll('__NAME__', name)
    .replaceAll('__VERSION__', VERSION)

export function scaffold(name: string, dir: string): string[] {
  if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    throw new Error(`invalid app name "${name}" — lowercase letters, digits and underscore, starting with a letter`)
  }
  const written = LAYOUT.map(([tpl, to]) => [to(name), render(tpl, name)] as const)

  // Refuse rather than overwrite: a scaffold that can eat work is not a scaffold.
  const clashes = written.map(([p]) => p).filter(p => existsSync(join(dir, p)))
  if (clashes.length) throw new Error(`refusing to overwrite: ${clashes.map(p => join(dir, p)).join(', ')}`)

  const out: string[] = []
  for (const [path, body] of written) {
    const full = join(dir, path)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, body)
    out.push(`  wrote ${full}`)
  }
  out.push('', `  cd ${dir} && npm install && npm run dev`)
  return out
}
