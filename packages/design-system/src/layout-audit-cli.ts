#!/usr/bin/env node

// Runs the LAYOUT.md audit over an application's stylesheets.
//
//   ket-design-system-layout-audit --config design-system-layout.json
//   ket-design-system-layout-audit path/to/a.css path/to/b.css
//
// The config lists the stylesheets that already follow the rules:
//   { "enforce": ["modules/customer_care/**/*.css"] }
// Globs resolve from the config's directory. An application adopts the rules one
// area at a time by adding that area here once it is clean. Every glob must match
// at least one file, so a typo or a moved directory fails instead of passing empty.

import { globSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { auditLayoutCss } from './contract/layout-audit.ts'

/** Exit code 0 when clean, 1 on a violation or config problem, 2 on a usage error. */
export const runLayoutAudit = (
  argv: readonly string[],
  cwd = process.cwd(),
): { code: number; lines: string[] } => {
  const args = [...argv]
  const lines: string[] = []
  const files = new Set<string>()
  const problems: string[] = []
  const configIndex = args.indexOf('--config')
  if (configIndex >= 0) {
    const configPath = resolve(cwd, args[configIndex + 1] ?? '')
    const base = dirname(configPath)
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as { enforce?: unknown }
    if (!Array.isArray(config.enforce) || !config.enforce.every((entry) => typeof entry === 'string'))
      return { code: 2, lines: [`${configPath}: "enforce" must be an array of globs`] }
    for (const pattern of config.enforce as string[]) {
      const matches = globSync(pattern, { cwd: base }).filter((file) => file.endsWith('.css'))
      if (matches.length === 0) problems.push(`${pattern}: matches no stylesheet (stale or mistyped entry)`)
      for (const file of matches) files.add(resolve(base, file))
    }
    args.splice(configIndex, 2)
  }
  for (const file of args) files.add(resolve(cwd, file))
  if (files.size === 0 && problems.length === 0)
    return { code: 2, lines: ['usage: ket-design-system-layout-audit [--config <file>] [stylesheet ...]'] }

  let violations = 0
  for (const file of [...files].sort()) {
    for (const violation of auditLayoutCss(readFileSync(file, 'utf8'))) {
      violations++
      lines.push(
        `${relative(cwd, file)}:${violation.line}  ${violation.rule}  ${violation.selector} { ${violation.property} }`,
        `    ${violation.message}`,
      )
    }
  }
  lines.push(...problems)
  lines.push(
    `layout audit: ${files.size} stylesheet(s), ${violations} violation(s), ${problems.length} config problem(s)`,
  )
  if (violations === 0 && problems.length === 0) return { code: 0, lines }
  lines.push('See LAYOUT.md in @ketvietlab/design-system for the rules and how to fix each one.')
  return { code: 1, lines }
}

// realpath: an npm bin is a symlink to this file.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  const result = runLayoutAudit(process.argv.slice(2))
  for (const line of result.lines) console.log(line)
  process.exit(result.code)
}
