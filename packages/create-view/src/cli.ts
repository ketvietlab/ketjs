#!/usr/bin/env node

import { resolve } from 'node:path'
import { scaffoldView } from './index.ts'

const VERSION = '0.1.5'
const HELP = `Create Ket view ${VERSION}

Usage:
  npm create @ketvietlab/view@latest PROJECT [-- --dir DIR]

Creates a static HTML project with TypeScript, CSS and explicit client islands.`

const args = process.argv.slice(2)
const option = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`)
  return index < 0 ? undefined : args[index + 1]
}

try {
  if (args.includes('--version')) {
    console.log(VERSION)
    process.exit(0)
  }
  if (args.includes('--help')) {
    console.log(HELP)
    process.exit(0)
  }
  const name = args.find((arg) => !arg.startsWith('--'))
  if (!name || name === 'help') {
    console.log(HELP)
  } else if (name === 'version') {
    console.log(VERSION)
  } else {
    const dir = resolve(option('dir') ?? name)
    for (const line of scaffoldView(name, dir)) console.log(line)
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
}
