import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function buildCacheKey(
  root,
  runtime = { node: process.version, platform: process.platform, arch: process.arch },
) {
  const files = execFileSync('git', ['ls-files', '-z', '--cached'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean)
    .filter(
      (file) =>
        /^(packages|apps|examples|test|tools|bench)\//.test(file) ||
        /^(package(?:-lock)?\.json|tsconfig[^/]*\.json|ket\.workspace\.ts|\.npmrc)$/.test(file) ||
        file === '.github/actions/build/action.yml',
    )
  const hash = createHash('sha256').update('ketjs-build-v1\0').update(JSON.stringify(runtime))
  for (const file of [...new Set(files)].sort()) {
    hash
      .update('\0')
      .update(file)
      .update('\0')
      .update(readFileSync(resolve(root, file)))
  }
  return `ketjs-build-v1-${hash.digest('hex')}`
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  console.log(`key=${buildCacheKey(process.cwd())}`)
