import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** @param {string} root @param {string[]} packageNames */
export function buildArtifactsExist(root, packageNames) {
  if (!existsSync(join(root, '.build/ket.workspace.js')) || !existsSync(join(root, '.types'))) return false
  return packageNames.every((name) => {
    if (name === 'website-client')
      return ['client/index.js', 'server/extensions.js'].every(
        (entry) =>
          existsSync(join(root, '.build/packages', name, entry)) &&
          existsSync(join(root, 'packages', name, 'dist', entry)) &&
          existsSync(join(root, 'packages', name, 'dist', entry.replace(/\.js$/, '.d.ts'))),
      )
    return ['index.js', 'index.mjs'].some(
      (entry) =>
        existsSync(join(root, '.build/packages', name, 'src', entry)) &&
        existsSync(join(root, 'packages', name, 'dist', entry)),
    )
  })
}
