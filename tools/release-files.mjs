import { chmodSync, cpSync, readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'

// A host umask must not change release integrity between macOS and GitHub's Linux runner.
// Stage files instead of changing permissions in a developer's checkout.
/** @param {string} source @param {string} destination */
export function stagePackage(source, destination) {
  cpSync(source, destination, {
    recursive: true,
    filter: (path) => !['node_modules', '.git', '.build', '.artifacts'].includes(basename(path)),
  })
  const manifest = JSON.parse(readFileSync(join(destination, 'package.json'), 'utf8'))
  const binaries = new Set(
    Object.values(typeof manifest.bin === 'string' ? { bin: manifest.bin } : (manifest.bin ?? {})).map(
      (path) => path.replace(/^\.\//, ''),
    ),
  )
  /** @param {string} directory */
  const visit = (directory) => {
    chmodSync(directory, 0o755)
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) throw new Error(`Release package contains a symlink: ${entry.name}`)
      if (entry.isDirectory()) visit(path)
      else chmodSync(path, binaries.has(relative(destination, path).replaceAll('\\', '/')) ? 0o755 : 0o644)
    }
  }
  visit(destination)
}
