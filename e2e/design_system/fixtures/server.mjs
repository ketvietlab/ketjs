import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)))
const child = spawn(process.execPath, ['.build/apps/design-system/serve.js'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, PORT: '4173' },
})

let stopping = false
const stop = (signal) => {
  if (stopping) return
  stopping = true
  child.kill(signal)
}

process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
child.on('exit', (code) => process.exit(code ?? 0))
