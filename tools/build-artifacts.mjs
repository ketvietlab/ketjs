import { existsSync } from 'node:fs'
import { join } from 'node:path'

/** @param {string} root @param {string[]} packageNames */
export function buildArtifactsExist(root, packageNames) {
  if (!existsSync(join(root, '.build/packages')) || !existsSync(join(root, '.types'))) return false
  return packageNames.every((name) => {
    return ['index.js', 'index.mjs'].some(
      (entry) =>
        existsSync(join(root, '.build/packages', name, 'src', entry)) &&
        existsSync(join(root, 'packages', name, 'dist', entry)),
    )
  })
}
