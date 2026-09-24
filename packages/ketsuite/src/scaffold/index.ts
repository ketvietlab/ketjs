import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VERSION = '0.1.27'
const TEMPLATES = new URL('./templates/', import.meta.url)

const LAYOUT: Array<[string, string]> = [
  ['package.json.tmpl', 'package.json'],
  ['ket.workspace.mjs.tmpl', 'ket.workspace.mjs'],
  ['README.md.tmpl', 'README.md'],
  ['gitignore.tmpl', '.gitignore'],
]

/** Products a generated app may be; `dev` composes every module and is never one. */
const PRODUCTS = ['commerce', 'hospitality', 'office'] as const

const render = (template: string, name: string, deployment: string): string =>
  readFileSync(new URL(template, TEMPLATES), 'utf8')
    .replaceAll('__NAME__', name)
    .replaceAll('__VERSION__', VERSION)
    .replaceAll('__DEPLOYMENT__', deployment)

export function scaffoldKetsuite(name: string, dir: string, deployment = 'commerce'): string[] {
  if (!/^[a-z][a-z0-9_]*$/.test(name))
    throw new Error(
      `invalid app name "${name}" — lowercase letters, digits and underscore, starting with a letter`,
    )
  if (!(PRODUCTS as readonly string[]).includes(deployment))
    throw new Error(`a generated app is one product — one of: ${PRODUCTS.join(', ')}`)
  const files = LAYOUT.map(([template, path]) => [path, render(template, name, deployment)] as const)
  const clashes = files.map(([path]) => path).filter((path) => existsSync(join(dir, path)))
  if (clashes.length)
    throw new Error(`refusing to overwrite: ${clashes.map((path) => join(dir, path)).join(', ')}`)

  const output: string[] = []
  for (const [path, contents] of files) {
    const target = join(dir, path)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, contents)
    output.push(`  wrote ${target}`)
  }
  output.push('', `  cd ${dir} && npm install && npm run dev`)
  return output
}
