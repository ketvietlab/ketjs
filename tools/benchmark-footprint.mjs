import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const results = []
const version = JSON.parse(readFileSync('packages/ketjs/package.json')).version
for (const name of ['ketjs-view', 'ketjs-view-tools', 'ketjs']) {
  const root = mkdtempSync(join(tmpdir(), 'ketjs-footprint-'))
  try {
    writeFileSync(
      join(root, 'package.json'),
      '{"name":"footprint-consumer","private":true,"version":"1.0.0"}',
    )
    const run = spawnSync(
      'npm',
      ['install', '--ignore-scripts', '--no-audit', '--no-fund', `@ketvietlab/${name}@${version}`],
      { cwd: root, encoding: 'utf8', timeout: 120000 },
    )
    if (run.status !== 0) throw new Error(run.stderr)
    let bytes = 0,
      packages = 0
    const size = (path) => {
      for (const entry of readdirSync(path)) {
        const file = join(path, entry),
          stat = lstatSync(file)
        if (stat.isDirectory()) size(file)
        else if (stat.isFile()) bytes += stat.size
      }
    }
    const count = (path) => {
      if (!existsSync(path)) return
      for (const entry of readdirSync(path).filter((entry) => !entry.startsWith('.'))) {
        const file = join(path, entry)
        if (entry.startsWith('@')) count(file)
        else if (existsSync(join(file, 'package.json'))) {
          packages++
          count(join(file, 'node_modules'))
        }
      }
    }
    size(join(root, 'node_modules'))
    count(join(root, 'node_modules'))
    const result = {
      name: `@ketvietlab/${name}`,
      version,
      installedPackages: packages,
      logicalBytes: bytes,
      scripts: false,
    }
    results.push(result)
    console.log(JSON.stringify(result))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}
mkdirSync('packages/docs/measurements', { recursive: true })
writeFileSync('packages/docs/measurements/footprint.json', JSON.stringify(results, null, 2) + '\n')
