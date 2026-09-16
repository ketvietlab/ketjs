import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const VERSION = '0.1.5'
const TEMPLATES = new URL('./templates/', import.meta.url)

const LAYOUT: Array<[string, string]> = [
  ['package.json.tmpl', 'package.json'],
  ['tsconfig.json.tmpl', 'tsconfig.json'],
  ['ket-view.config.ts.tmpl', 'ket-view.config.ts'],
  ['README.md.tmpl', 'README.md'],
  ['gitignore.tmpl', '.gitignore'],
  ['index.ts.tmpl', 'src/pages/index.ts'],
  ['about.ts.tmpl', 'src/pages/about.ts'],
  ['counter.ts.tmpl', 'src/islands/counter.ts'],
  ['main.css.tmpl', 'src/styles/main.css'],
  ['favicon.svg.tmpl', 'public/favicon.svg'],
]

const render = (template: string, name: string): string =>
  readFileSync(new URL(template, TEMPLATES), 'utf8')
    .replaceAll('__NAME__', name)
    .replaceAll('__VERSION__', VERSION)

export function scaffoldView(name: string, dir: string): string[] {
  if (!/^[a-z][a-z0-9-]*$/.test(name))
    throw new Error(
      `invalid project name "${name}" — use lowercase letters, digits and hyphens, starting with a letter`,
    )
  const files = LAYOUT.map(([template, path]) => [path, render(template, name)] as const)
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
  output.push('', `  cd ${dir}`, '  npm install', '  npm run dev')
  return output
}
