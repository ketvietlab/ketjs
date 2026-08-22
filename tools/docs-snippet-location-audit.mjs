import { readFileSync, readdirSync } from 'node:fs'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../docs/', import.meta.url))
const supported = new Set(['.md', '.mdx'])
const ignoredDirectories = new Set(['.astro', '.cache', '.git', 'dist', 'node_modules'])
/** @type {string[]} */
const files = []

/** @param {string} directory */
const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) visit(path)
    else if (supported.has(extname(entry.name))) files.push(path)
  }
}

visit(root)

/** @type {Record<string, RegExp>} */
const locationPatterns = {
  bash: /^# Run from: \S/,
  sh: /^# Run from: \S/,
  mermaid: /^%% File: \S/,
  liquid: /^\{% comment %\} File: \S.*\{% endcomment %\}$/,
  md: /^<!-- File: \S.*-->$/,
  html: /^<!-- File: \S.*-->$/,
  ts: /^\/\/ File: \S/,
  tsx: /^\/\/ File: \S/,
  js: /^\/\/ File: \S/,
  jsx: /^\/\/ File: \S/,
  mjs: /^\/\/ File: \S/,
  cjs: /^\/\/ File: \S/,
  jsonc: /^\/\/ File: \S/,
  default: /^# File: \S/,
}

const failures = []
let snippetCount = 0

for (const file of files.sort()) {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/)
  let fence = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    if (fence) {
      const tick = String.fromCharCode(96)
      const closing = new RegExp(`^\\s*${tick}{${fence.length},}\\s*$`)
      if (closing.test(line)) fence = null
      continue
    }

    const opening = /^\s*(\`{3,})([^\`]*)$/.exec(line)
    if (!opening) continue

    snippetCount += 1
    const language = opening[2].trim().split(/\s+/)[0].toLowerCase()
    const first = lines[index + 1] ?? ''
    const pattern = locationPatterns[language] ?? locationPatterns.default
    if (!pattern.test(first)) {
      failures.push(
        `${relative(process.cwd(), file)}:${index + 1} ${language || 'plain'} block needs a location comment`,
      )
    }
    fence = { length: opening[1].length }
  }
}

if (failures.length) {
  console.error(failures.join('\n'))
  process.exit(1)
}

console.log(`verified locations for ${snippetCount} snippets in ${files.length} documentation files`)
