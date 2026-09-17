#!/usr/bin/env node

import { resolve } from 'node:path'
import { serveDeployment } from '@ketvietlab/ketjs'
import { DEFAULT_KETSUITE_DEPLOYMENT, ketsuiteDeployments } from './deployment.ts'
import { ensureDevelopmentAdmin, syncRoleTemplates } from './development.ts'
import { scaffoldKetsuite } from './scaffold/index.ts'

const VERSION = '0.1.23'
const CHOICES = Object.keys(ketsuiteDeployments).join(' | ')
const HELP = `KetSuite ${VERSION}

Usage:
  ketsuite new NAME [--dir DIR] [--deployment NAME]
  ketsuite serve [--deployment NAME] [--dev-admin]

Commands:
  new       scaffold a standalone KetSuite application
  serve     migrate and serve KetSuite on 127.0.0.1:3000

Options:
  --deployment  ${CHOICES} (default: ${DEFAULT_KETSUITE_DEPLOYMENT}); dev composes every module and is not a product
  --dev-admin   create admin/admin only when the database is empty (development only)
  --help        show this help
  --version     show the CLI version`

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
  if (!ketsuiteDeployments[name]) throw new Error(`unknown deployment "${name}" — one of: ${CHOICES}`)
  return name
}

try {
  if (!command || command === 'help' || command === '--help') {
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
    const deployment = ketsuiteDeployments[chosenDeployment()]!
    if (flag('dev-admin')) {
      const outcome = await ensureDevelopmentAdmin(deployment)
      console.warn(
        `WARNING: insecure development account admin/admin ${
          outcome === 'created' ? 'was created' : 'is enabled'
        }; never expose this server or database.`,
      )
    }
    // Job roles are part of a working install: without them nobody can be given access.
    const { applied, skipped } = await syncRoleTemplates(deployment)
    if (applied.length) console.log(`applied role templates: ${applied.join(', ')}`)
    for (const { roleId, errors } of skipped)
      console.warn(`WARNING: role template ${roleId} was not applied: ${JSON.stringify(errors)}`)
    await serveDeployment(deployment)
  } else {
    throw new Error(`unknown command "${command}"\n\n${HELP}`)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
