#!/usr/bin/env node

import { resolve } from 'node:path'
import { serveDeployment } from '@ketvietlab/ketjs'
import { ketsuite } from './deployment.ts'
import { ensureDevelopmentAdmin } from './development.ts'
import { scaffoldKetsuite } from './scaffold/index.ts'

const VERSION = '0.1.3'
const HELP = `KetSuite ${VERSION}

Usage:
  ketsuite new NAME [--dir DIR]
  ketsuite serve [--dev-admin]

Commands:
  new       scaffold a standalone KetSuite application
  serve     migrate and serve KetSuite on 127.0.0.1:3000

Options:
  --dev-admin  create admin/admin only when the database is empty (development only)
  --help       show this help
  --version    show the CLI version`

const args = process.argv.slice(2)
const command = args[0]
const option = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`)
  return index < 0 ? undefined : args[index + 1]
}
const flag = (name: string): boolean => args.includes(`--${name}`)

try {
  if (!command || command === 'help' || command === '--help') {
    console.log(HELP)
  } else if (command === '--version') {
    console.log(VERSION)
  } else if (command === 'new') {
    const name = args[1]
    if (!name || name.startsWith('--')) throw new Error('usage: ketsuite new NAME [--dir DIR]')
    const dir = resolve(option('dir') ?? name)
    for (const line of scaffoldKetsuite(name, dir)) console.log(line)
  } else if (command === 'serve') {
    if (flag('dev-admin')) {
      const outcome = await ensureDevelopmentAdmin()
      console.warn(
        `WARNING: insecure development account admin/admin ${
          outcome === 'created' ? 'was created' : 'is enabled'
        }; never expose this server or database.`,
      )
    }
    await serveDeployment(ketsuite)
  } else {
    throw new Error(`unknown command "${command}"\n\n${HELP}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
