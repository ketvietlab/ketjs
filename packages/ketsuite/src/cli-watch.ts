import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Locate authored build tooling, never assume the user's working directory is the checkout. */
export function findWatchRoot(start = dirname(fileURLToPath(import.meta.url))): string {
  let directory = start
  while (true) {
    const manifest = join(directory, 'package.json')
    if (
      existsSync(manifest) &&
      existsSync(join(directory, 'tools/watch-build.ts')) &&
      JSON.parse(readFileSync(manifest, 'utf8')).name === 'ketjs-monorepo'
    )
      return directory
    const parent = dirname(directory)
    if (parent === directory)
      throw new Error(
        'ketsuite serve --watch requires the KetJS source checkout and its development dependencies; installed packages do not contain the source build tools.',
      )
    directory = parent
  }
}

export async function watchKetsuite(args: readonly string[]): Promise<void> {
  const root = findWatchRoot()
  const child = spawn(
    process.execPath,
    [
      '--import',
      'tsx',
      join(root, 'tools/watch-build.ts'),
      '--serve-ketsuite',
      ...args.filter((arg) => arg !== '--watch'),
    ],
    {
      cwd: root,
      stdio: 'inherit',
      // Preserve relative database/storage paths when invoked outside the repository root.
      env: { ...process.env, KET_WATCH_SERVE_CWD: process.cwd() },
    },
  )
  const interrupt = () => child.kill('SIGINT')
  const terminate = () => child.kill('SIGTERM')
  process.on('SIGINT', interrupt)
  process.on('SIGTERM', terminate)
  try {
    await new Promise<void>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code, signal) => {
        process.exitCode = code ?? (signal === 'SIGINT' ? 130 : signal ? 143 : 0)
        resolve()
      })
    })
  } finally {
    process.off('SIGINT', interrupt)
    process.off('SIGTERM', terminate)
  }
}
