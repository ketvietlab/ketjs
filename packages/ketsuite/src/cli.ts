#!/usr/bin/env node

import { resolve } from 'node:path'
import { scaffoldKetsuite } from './scaffold/index.ts'
import { watchKetsuite } from './cli-watch.ts'

const VERSION = '0.1.23'
const HELP = `KetSuite ${VERSION}

Usage:
  ketsuite new NAME [--dir DIR]
  ketsuite serve [--dev-admin] [--demo-data] [--watch]

Commands:
  new       scaffold a standalone KetSuite application
  serve     migrate and serve KetSuite on 127.0.0.1:3000

Options:
  --dev-admin  create admin/admin only when the database is empty (development only)
  --demo-data  also seed a demo dataset (partners, catalog, CRM, orders); implies --dev-admin
  --watch      rebuild source/assets and restart after successful builds (repository checkout only)
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
  if (!command || command === 'help' || flag('help')) {
    console.log(HELP)
  } else if (command === '--version') {
    console.log(VERSION)
  } else if (command === 'new') {
    const name = args[1]
    if (!name || name.startsWith('--')) throw new Error('usage: ketsuite new NAME [--dir DIR]')
    const dir = resolve(option('dir') ?? name)
    for (const line of scaffoldKetsuite(name, dir)) console.log(line)
  } else if (command === 'serve') {
    if (flag('watch')) {
      await watchKetsuite(args)
    } else {
      // Watch mode must build before loading the deployment or touching its database.
      const { serveDeployment } = await import('@ketvietlab/ketjs')
      const { ketsuite } = await import('./deployment.ts')
      if (flag('dev-admin') || flag('demo-data')) {
        const { ensureDevelopmentAdmin } = await import('./development.ts')
        const outcome = await ensureDevelopmentAdmin()
        console.warn(
          `WARNING: insecure development account admin/admin ${
            outcome === 'created' ? 'was created' : 'is enabled'
          }; never expose this server or database.`,
        )
      }
      if (flag('demo-data')) {
        const { seedDemoData } = await import('./demo/seed.ts')
        const outcome = await seedDemoData()
        console.warn(`demo dataset ${outcome === 'seeded' ? 'was seeded' : 'is already present'}.`)
      }
      await serveDeployment(ketsuite)
    }
  } else {
    throw new Error(`unknown command "${command}"\n\n${HELP}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
