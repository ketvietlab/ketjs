import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ROOT } from './version.mjs'

export function auditDocuments(root = ROOT) {
  const files = [
    'README.md',
    'AGENTS.md',
    'packages/docs/README.md',
    'packages/docs/tutorials/api/README.md',
    'packages/docs/tutorials/view/README.md',
  ]
  /** @param {string} directory */
  const visit = (directory) => {
    for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = `${directory}/${entry.name}`
      if (entry.isDirectory()) visit(path)
      else if (entry.name.endsWith('.md')) files.push(path)
    }
  }
  visit('packages/docs/content')
  let fences = 0
  for (const file of files) {
    const source = readFileSync(join(root, file), 'utf8')
    for (const [, language, body] of source.matchAll(/^```([^\n]*)\n([\s\S]*?)^```\s*$/gm)) {
      fences++
      const first = body.split('\n')[0]
      const expression = /^(?:ts|typescript|tsx|js|javascript|jsonc)$/.test(language)
        ? /^\/\/ File: \S+/
        : /^(?:bash|sh|shell)$/.test(language)
          ? /^# Run from: \S+/
          : language === 'mermaid'
            ? /^%% File: \S+/
            : /^(?:liquid|ktl)$/.test(language)
              ? /^\{% comment %\} File: \S+ \{% endcomment %\}$/
              : /^(?:markdown|md|html)$/.test(language)
                ? /^<!-- File: \S+ -->$/
                : /^# File: \S+/
      if (!expression.test(first))
        throw new Error(`${file}: ${language || 'text'} fence lacks a location comment: ${first}`)
    }
  }
  return {
    files: files.sort(),
    fences,
    contract:
      'Location-commented examples; version expansion, metadata and rendered local links are verified by docs tests and build.',
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = auditDocuments()
  console.log(`Audited ${result.files.length} documents and ${result.fences} located examples`)
}
