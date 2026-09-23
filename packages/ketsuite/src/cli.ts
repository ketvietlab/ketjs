#!/usr/bin/env node

import { resolve } from 'node:path'
import { scaffoldKetsuite } from './scaffold/index.ts'
import { watchKetsuite } from './cli-watch.ts'

const VERSION = '0.1.23'
const DEFAULT_KETSUITE_DEPLOYMENT = 'commerce'
const DEPLOYMENTS = ['commerce', 'hospitality', 'office', 'dev']
const CHOICES = DEPLOYMENTS.join(' | ')
const HELP = `KetSuite ${VERSION}

Usage:
  ketsuite new NAME [--dir DIR] [--deployment NAME]
  ketsuite serve [--deployment NAME] [--dev-admin] [--demo-data] [--watch]

Commands:
  new       scaffold a standalone KetSuite application
  serve     migrate and serve KetSuite on 127.0.0.1:3000

Options:
  --deployment  commerce | hospitality | office | dev (default: commerce)
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

/** The deployment asked for, refusing a name that is not one rather than serving a default instead. */
const chosenDeployment = (): string => {
  const name = option('deployment') ?? DEFAULT_KETSUITE_DEPLOYMENT
  if (!DEPLOYMENTS.includes(name)) throw new Error(`unknown deployment "${name}" — one of: ${CHOICES}`)
  return name
}

try {
  if (!command || command === 'help' || flag('help')) {
    console.log(HELP)
  } else if (command === '--version') {
    console.log(VERSION)
  } else if (command === 'new') {
    const name = args[1]
    if (!name || name.startsWith('--'))
      throw new Error('usage: ketsuite new NAME [--dir DIR] [--deployment NAME]')
    const dir = resolve(option('dir') ?? name)
    for (const line of scaffoldKetsuite(name, dir, chosenDeployment())) console.log(line)
  } else if (command === 'serve') {
    if (flag('watch')) {
      await watchKetsuite(args)
    } else {
      // Watch mode must build before loading the deployment or touching its database.
      const { serveDeployment } = await import('@ketvietlab/ketjs')
      const { ketsuiteDeployments } = await import('./deployment.ts')
      const deployment = ketsuiteDeployments[chosenDeployment()]!
      if (flag('demo-data') && !['commerce', 'dev'].includes(chosenDeployment()))
        throw new Error('--demo-data supports commerce or dev')
      if (flag('dev-admin') || flag('demo-data')) {
        const { ensureDevelopmentAdmin } = await import('./development.ts')
        const outcome = await ensureDevelopmentAdmin(deployment)
        console.warn(
          `WARNING: insecure development account admin/admin ${
            outcome === 'created' ? 'was created' : 'is enabled'
          }; never expose this server or database.`,
        )
      }
      if (flag('demo-data')) {
        const { seedDemoData } = await import('./demo/seed.ts')
        const outcome = await seedDemoData(deployment)
        console.warn(`demo dataset ${outcome === 'seeded' ? 'was seeded' : 'is already present'}.`)
      }
      const { syncRoleTemplates } = await import('./development.ts')
      const { applied, skipped } = await syncRoleTemplates(deployment)
      if (applied.length) console.log(`applied role templates: ${applied.join(', ')}`)
      for (const { roleId, errors } of skipped)
        console.warn(`WARNING: role template ${roleId} was not applied: ${JSON.stringify(errors)}`)
      await serveDeployment(deployment)
    }
  } else {
    throw new Error(`unknown command "${command}"\n\n${HELP}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
