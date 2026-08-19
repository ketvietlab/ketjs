// Installing and removing apps, without giving up the thing that makes fleet
// upgrades survivable.
//
// Odoo lets each database install a different set of modules. That is why an Odoo
// fleet upgrade is N unknown migrations rather than one known one, and it is the
// root of the failures rather than a detail of them (D16).
//
// So the split here is deliberate: a deployment decides at BUILD time which modules
// exist, and every database it serves gets the same schema. A database then decides
// at RUN time which of them are ON. Installing changes behaviour — which functions
// answer, which sections may be placed, which fills appear — and never the shape of
// the database.
//
// The consequence worth stating plainly: uninstalling does NOT delete anything. The
// columns stay, the rows stay, and re-installing finds the data where it was. Odoo
// drops columns on uninstall and people lose data to a misclick; refusing to do that
// is the whole point of D7.

import { KetError } from './errors.ts'
import type { Adapter, Manifest } from '../types.ts'

export const APP_DDL = `
CREATE TABLE IF NOT EXISTS ket_app (
  name         TEXT PRIMARY KEY,
  installed_at TEXT NOT NULL
);
`
export const APP_DDL_PG = APP_DDL.replace('installed_at TEXT NOT NULL', 'installed_at TIMESTAMPTZ NOT NULL')

export type AppState = 'installed' | 'available'
export type AppInfo = {
  name: string
  title: string
  summary: string
  category: string
  version: string
  state: AppState
  depends: string[]
  /** Installed modules that would break if this one went away. */
  dependents: string[]
  autoInstall: boolean
}

export type AppRegistry = {
  enabled(): Promise<Set<string>>
  list(): Promise<AppInfo[]>
  /** Installs the app and everything it needs. Returns what actually changed. */
  install(name: string): Promise<string[]>
  /** Removes the app. Refuses if an installed app depends on it. Deletes no data. */
  uninstall(name: string): Promise<string[]>
}

const dependentsOf = (manifest: Manifest, name: string): string[] =>
  Object.entries(manifest.modules).filter(([, m]) => m.depends.includes(name)).map(([n]) => n)

export async function createAppRegistry(
  manifest: Manifest,
  adapter: Adapter,
  o: { now?: () => string } = {},
): Promise<AppRegistry> {
  const now = o.now ?? (() => new Date().toISOString())
  const pg = adapter.name === 'postgres'
  const p = (n: number) => (pg ? `$${n}` : '?')
  await adapter.exec(pg ? APP_DDL_PG : APP_DDL)

  const known = (name: string) => {
    const m = manifest.modules[name]
    if (!m) {
      throw new KetError({
        code: 'E_UNKNOWN_APP',
        message: `this deployment does not ship an app called "${name}"`,
        hint: `shipped: ${Object.keys(manifest.modules).join(', ')}. An app has to be built in before it can be installed.`,
      })
    }
    return m
  }

  const enabled = async (): Promise<Set<string>> =>
    new Set((await adapter.all(`SELECT name FROM ket_app`)).map(r => String(r.name)))

  const write = async (names: string[]): Promise<void> => {
    for (const n of names) {
      await adapter.run(`INSERT INTO ket_app (name, installed_at) VALUES (${p(1)}, ${p(2)}) ON CONFLICT DO NOTHING`, [n, now()])
    }
  }

  // Anything whose dependencies are all installed and which asked to come along.
  const settle = async (): Promise<string[]> => {
    const added: string[] = []
    for (;;) {
      const on = await enabled()
      const next = Object.entries(manifest.modules)
        .filter(([n, m]) => m.autoInstall && !on.has(n) && m.depends.every(d => on.has(d)))
        .map(([n]) => n)
      if (!next.length) return added
      await write(next)
      added.push(...next)
    }
  }

  return {
    enabled,

    async list() {
      const on = await enabled()
      return Object.entries(manifest.modules)
        .filter(([, m]) => m.app === true)
        .map(([name, m]) => ({
          name,
          title: m.title ?? name,
          summary: m.summary ?? '',
          category: m.category ?? 'Khác',
          version: m.version,
          state: (on.has(name) ? 'installed' : 'available') as AppState,
          depends: [...m.depends],
          dependents: dependentsOf(manifest, name).filter(d => on.has(d)),
          autoInstall: m.autoInstall === true,
        }))
        .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title))
    },

    async install(name) {
      known(name)
      const on = await enabled()
      // Dependencies come along; an app whose dependency is off would be broken.
      const wanted: string[] = []
      const visit = (n: string) => {
        if (on.has(n) || wanted.includes(n)) return
        for (const dep of known(n).depends) visit(dep)
        wanted.push(n)
      }
      visit(name)
      await write(wanted)
      return [...wanted, ...(await settle())]
    },

    async uninstall(name) {
      known(name)
      const on = await enabled()
      if (!on.has(name)) return []

      const blocking = dependentsOf(manifest, name).filter(d => on.has(d))
      if (blocking.length) {
        throw new KetError({
          code: 'E_APP_IN_USE',
          message: `"${name}" cannot be removed while ${blocking.join(', ')} ${blocking.length > 1 ? 'are' : 'is'} installed`,
          hint: `remove ${blocking.join(', ')} first, or leave "${name}" installed`,
        })
      }
      await adapter.run(`DELETE FROM ket_app WHERE name = ${p(1)}`, [name])
      return [name]
    },
  }
}

/**
 * The manifest as an app with only some modules turned on sees it.
 *
 * Behaviour is filtered — functions, sections, joints, fills, views, templates.
 * Models are NOT: the columns exist in every database by construction, and the rows
 * of an uninstalled app are still its rows. Turning an app off must never be a way
 * to lose data.
 */
export function restrictManifest(manifest: Manifest, enabled: Set<string>): Manifest {
  const keep = (by: string) => enabled.has(by)
  const pick = <T extends { by: string }>(rec: Record<string, T>): Record<string, T> =>
    Object.fromEntries(Object.entries(rec).filter(([, v]) => keep(v.by)))

  const joints = Object.fromEntries(Object.entries(manifest.joints).filter(([, j]) => keep(j.owner)))
  const provided: Record<string, string[]> = {}
  for (const [region, by] of Object.entries(manifest.regions.provided)) {
    const live = by.filter(keep)
    if (live.length) provided[region] = live
  }

  return {
    ...manifest,
    disabledModules: Object.keys(manifest.modules).filter(n => !enabled.has(n)),
    order: manifest.order.filter(keep),
    functions: pick(manifest.functions),
    sections: pick(manifest.sections),
    islands: pick(manifest.islands),
    views: pick(manifest.views),
    joints,
    fills: manifest.fills.filter(f => keep(f.by) && joints[f.joint] !== undefined),
    regions: { required: manifest.regions.required, provided },
  }
}
