#!/usr/bin/env node
// The CLI is deliberately thin: everything it prints is read off the manifest,
// so there is no second source of truth about what an app contains.

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs'
import { composeWorkspace, explainWorkspace } from './kernel/workspace.ts'
import type { AppSpec } from './kernel/workspace.ts'
import { diffManifests, formatDiff } from './kernel/diff.ts'
import { generateDts } from './codegen/dts.ts'
import { agentDescriptor } from './agent/capabilities.ts'
import { schemaFromManifest, planMigration, renderSql } from './data/migrate.ts'
import { sqliteAdapter } from './data/sqlite.ts'
import { KetError } from './kernel/errors.ts'
import type { Manifest } from './types.ts'

const [, , cmd = 'help', ...rest] = process.argv
const flag = (name: string) => rest.includes(`--${name}`)
const opt = (name: string) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : undefined }

const loadWorkspace = async () => {
  const entry = opt('workspace') ?? 'examples/workspace.ts'
  const mod = await import(`${process.cwd()}/${entry}`) as { apps: AppSpec[] }
  return { ws: composeWorkspace(mod.apps), apps: mod.apps }
}

const pickApp = (ws: { apps: Record<string, Manifest> }): [string, Manifest] => {
  const name = opt('app') ?? Object.keys(ws.apps)[0] as string
  const m = ws.apps[name]
  if (!m) throw new Error(`unknown app "${name}" (have: ${Object.keys(ws.apps).join(', ')})`)
  return [name, m]
}

const HELP = `ket — zero-dependency fullstack framework

  ket check                 compose every app and report contract violations
  ket manifest [--app X]    print the composed manifest
  ket workspace             show apps, datastores and shared modules
  ket types [--app X]       generate .ket/types.d.ts from the manifest
  ket agent [--app X]       print the agent capability descriptor
  ket migrate [--app X]     plan migrations (add --allow-destructive to permit data loss)
  ket diff --against FILE   compare the current manifest with a stored one
  ket snapshot [--app X]    write .ket/manifest.<app>.json for a later diff

Options: --workspace FILE (default examples/workspace.ts), --app NAME
`

try {
  if (cmd === 'help' || cmd === '--help') { console.log(HELP); process.exit(0) }

  const { ws } = await loadWorkspace()
  mkdirSync('.ket', { recursive: true })

  if (cmd === 'check') {
    console.log(explainWorkspace(ws))
    console.log('\nall contracts hold')
  } else if (cmd === 'workspace') {
    console.log(explainWorkspace(ws))
  } else if (cmd === 'manifest') {
    const [, m] = pickApp(ws)
    console.log(JSON.stringify(m, null, 2))
  } else if (cmd === 'types') {
    const [name, m] = pickApp(ws)
    const out = `.ket/types.${name}.d.ts`
    writeFileSync(out, generateDts(m))
    console.log(`wrote ${out}`)
  } else if (cmd === 'agent') {
    const [, m] = pickApp(ws)
    console.log(JSON.stringify(agentDescriptor(m), null, 2))
  } else if (cmd === 'snapshot') {
    const [name, m] = pickApp(ws)
    const out = `.ket/manifest.${name}.json`
    writeFileSync(out, JSON.stringify(m, null, 2))
    console.log(`wrote ${out}`)
  } else if (cmd === 'diff') {
    const against = opt('against')
    if (!against || !existsSync(against)) throw new Error('pass --against <manifest.json> (make one with `ket snapshot`)')
    const [, m] = pickApp(ws)
    const before = JSON.parse(readFileSync(against, 'utf8')) as Manifest
    const items = diffManifests(before, m)
    console.log(formatDiff(items))
    process.exit(items.some(i => i.severity === 'breaking') ? 1 : 0)
  } else if (cmd === 'migrate') {
    const [name, m] = pickApp(ws)
    const adapter = sqliteAdapter()
    adapter.open()
    const snapPath = `.ket/schema.${name}.json`
    const prev = existsSync(snapPath) ? JSON.parse(readFileSync(snapPath, 'utf8')) : null
    const next = schemaFromManifest(m)
    const ops = planMigration(prev, next, { allowDestructive: flag('allow-destructive') })
    for (const sql of renderSql(ops, adapter)) console.log(sql + ';')
    writeFileSync(snapPath, JSON.stringify(next, null, 2))
    console.log(`\n-- ${ops.length} operation(s); schema snapshot written to ${snapPath}`)
    adapter.close()
  } else {
    console.error(`unknown command "${cmd}"\n\n${HELP}`)
    process.exit(1)
  }
} catch (e) {
  if (e instanceof KetError) { console.error(JSON.stringify(e.toJSON(), null, 2)); process.exit(1) }
  console.error((e as Error).message)
  process.exit(1)
}
