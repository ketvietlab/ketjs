#!/usr/bin/env node
import { createHash } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  cpSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const source = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
const marker = '.ket-skill.json'
const digest = (content) => createHash('sha256').update(content).digest('hex')

const walk = (directory, prefix = '') =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isSymbolicLink()) throw new Error(`Refusing symbolic link: ${join(directory, entry.name)}`)
    const name = prefix ? `${prefix}/${entry.name}` : entry.name
    return entry.isDirectory() ? walk(join(directory, entry.name), name) : [name]
  })

function main() {
  const args = process.argv.slice(2)
  if (args[0] === 'install') args.shift()
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Két Design System ${manifest.version}

Usage: npx ${manifest.name} [install] [--global | --dir <skills-directory>] [--force]

Default: install into .agents/skills/ket-design-system in the current project.
--global   Install into ~/.agents/skills/ket-design-system.
--dir      Use another skills directory, e.g. .claude/skills or .cursor/skills.
--force    Replace an edited/unmanaged skill after preserving a sibling backup.
--version  Print the package version.

Installs the skill only. Does not edit AGENTS.md, delete other rules, or install UI dependencies.
Invoke the installed skill as $ket-design-system (display name: Két Design System).`)
    return
  }
  if (args.length === 1 && args[0] === '--version') {
    console.log(manifest.version)
    return
  }
  let directory
  let global = false
  let force = false
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === '--global') global = true
    else if (arg === '--force') force = true
    else if (arg === '--dir' && args[index + 1] && !args[index + 1].startsWith('--'))
      directory = args[++index]
    else throw new Error(`Unknown or incomplete option: ${arg}. Use --help.`)
  }
  if (global && directory) throw new Error('Choose --global or --dir, not both.')
  const parent = resolve(directory ?? (global ? join(homedir(), '.agents/skills') : '.agents/skills'))
  const destination = join(parent, 'ket-design-system')
  if (destination === source)
    throw new Error('The destination is the package source; choose another directory.')
  const files = [
    'SKILL.md',
    'LICENSE',
    ...walk(join(source, 'references'), 'references'),
    ...walk(join(source, 'agents'), 'agents'),
  ]
  const contents = new Map(files.map((name) => [name, readFileSync(join(source, name))]))
  const hashes = Object.fromEntries([...contents].map(([name, content]) => [name, digest(content)]))
  let previous
  if (existsSync(destination)) {
    if (!lstatSync(destination).isDirectory() || lstatSync(destination).isSymbolicLink())
      throw new Error(`Destination must be a real directory: ${destination}`)
    walk(destination)
    try {
      previous = JSON.parse(readFileSync(join(destination, marker), 'utf8'))
    } catch {
      /* unmanaged */
    }
    const managed =
      previous?.package === manifest.name && previous.files && typeof previous.files === 'object'
    const changed =
      !managed ||
      Object.entries(previous.files).some(
        ([name, hash]) =>
          !files.includes(name) ||
          !existsSync(join(destination, name)) ||
          digest(readFileSync(join(destination, name))) !== hash,
      )
    const collision = files.some((name) => existsSync(join(destination, name)) && !previous?.files?.[name])
    if ((changed || collision) && !force)
      throw new Error('The installed skill is edited or unmanaged. Use --force to replace it with a backup.')
    if (
      managed &&
      !changed &&
      !collision &&
      previous.version === manifest.version &&
      files.every(
        (name) =>
          existsSync(join(destination, name)) &&
          digest(readFileSync(join(destination, name))) === hashes[name],
      )
    ) {
      console.log(`Két Design System ${manifest.version} is already installed: ${destination}`)
      return
    }
  }
  mkdirSync(parent, { recursive: true })
  const staging = mkdtempSync(join(parent, '.ket-design-system-stage-'))
  let backup
  try {
    // Preserve unrelated files in an existing skill; only owned payload files change.
    if (existsSync(destination)) cpSync(destination, staging, { recursive: true })
    for (const [name, content] of contents) {
      mkdirSync(dirname(join(staging, name)), { recursive: true })
      writeFileSync(join(staging, name), content)
    }
    writeFileSync(
      join(staging, marker),
      `${JSON.stringify({ package: manifest.name, version: manifest.version, files: hashes }, null, 2)}\n`,
    )
    if (existsSync(destination)) {
      backup = `${destination}.backup-${Date.now()}`
      renameSync(destination, backup)
    }
    try {
      renameSync(staging, destination)
    } catch (error) {
      if (backup) renameSync(backup, destination)
      throw error
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  console.log(`Installed Két Design System ${manifest.version}: ${destination}`)
  if (backup) console.log(`Previous version preserved: ${backup}`)
  console.log('Use $ket-design-system in your agent. Reload skill discovery if needed.')
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
