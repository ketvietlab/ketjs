#!/usr/bin/env node

import { buildProject, checkProject } from './project.ts'
import { serveProject } from './server.ts'

const VERSION = '0.1.5'
const HELP = `Ket view tools ${VERSION}

Usage:
  ket-view dev [--host HOST] [--port PORT]
  ket-view build
  ket-view preview [--host HOST] [--port PORT]
  ket-view check

Commands:
  dev       build, watch and live-reload the static site
  build     write deployable HTML, CSS and JavaScript to dist
  preview   serve the current dist directory
  check     validate routes, pages and browser bundles without writing dist`

const args = process.argv.slice(2)
const command = args[0]
const option = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`)
  return index < 0 ? undefined : args[index + 1]
}
const portOption = (): number | undefined => {
  const raw = option('port')
  if (!raw) return undefined
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error(`invalid port "${raw}"`)
  return port
}

try {
  if (!command || command === 'help' || command === '--help') {
    console.log(HELP)
  } else if (command === '--version') {
    console.log(VERSION)
  } else if (command === 'build') {
    const result = await buildProject()
    console.log(`built ${result.pages.length} page(s) in ${result.outDir}`)
  } else if (command === 'check') {
    const result = await checkProject()
    console.log(`checked ${result.pages.length} page(s)`)
  } else if (command === 'dev' || command === 'preview') {
    const running = await serveProject(process.cwd(), {
      dev: command === 'dev',
      host: option('host'),
      port: portOption(),
    })
    console.log(`${command === 'dev' ? 'development server' : 'preview'} at ${running.url}`)
    const stop = async (): Promise<void> => {
      await running.close()
      process.exit(0)
    }
    process.once('SIGINT', () => void stop())
    process.once('SIGTERM', () => void stop())
  } else {
    throw new Error(`unknown command "${command}"\n\n${HELP}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
