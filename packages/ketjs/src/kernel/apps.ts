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
import type { Adapter, InstallPolicy, Manifest } from '../types.ts'

// The row records a DECISION, not a fact: 'removed' is how an explicit uninstall
// survives the next auto-install sweep. Deleting the row instead would let an
// autoInstall app walk straight back in the moment anything else was installed —
// which it did, until a probe caught it.
export const APP_DDL = `
CREATE TABLE IF NOT EXISTS ket_app (
  name       TEXT PRIMARY KEY,
  state      TEXT NOT NULL,
  changed_at TEXT NOT NULL
);
`
export const APP_DDL_PG = APP_DDL.replace('changed_at TEXT NOT NULL', 'changed_at TIMESTAMPTZ NOT NULL')

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
  install: InstallPolicy
  /** False means an operator may not remove it — see AppMeta.removable. */
  removable: boolean
}

export type AppRegistry = {
  enabled(): Promise<Set<string>>
  list(): Promise<AppInfo[]>
  /** Names this database has a record for that the deployment no longer ships. */
  orphans(): Promise<string[]>
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
  o: { now?: () => string; autoInstall?: boolean } = {},
): Promise<AppRegistry> {
  const now = o.now ?? (() => new Date().toISOString())
  // A module declares that it *may* arrive on its own; the deployment decides
  // whether it does. Off is what a developer wants when they are watching one
  // module at a time and an app that installs itself is a surprise, not a service.
  const autoInstallEnabled = o.autoInstall !== false
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
    new Set((await adapter.all(`SELECT name FROM ket_app WHERE state = 'installed'`)).map(r => String(r.name)))

  /** Every name this database has an opinion about, installed or explicitly removed. */
  const decided = async (): Promise<Set<string>> =>
    new Set((await adapter.all(`SELECT name FROM ket_app`)).map(r => String(r.name)))

  const setState = async (names: string[], state: 'installed' | 'removed'): Promise<void> => {
    for (const n of names) {
      const upd = await adapter.run(`UPDATE ket_app SET state = ${p(1)}, changed_at = ${p(2)} WHERE name = ${p(3)}`, [state, now(), n])
      if (upd.changes === 0) {
        await adapter.run(`INSERT INTO ket_app (name, state, changed_at) VALUES (${p(1)}, ${p(2)}, ${p(3)}) ON CONFLICT DO NOTHING`, [n, state, now()])
      }
    }
  }

  // Anything whose dependencies are all installed and which asked to come along.
  const settle = async (): Promise<string[]> => {
    if (!autoInstallEnabled) return []
    const added: string[] = []
    for (;;) {
      const on = await enabled()
      const seen = await decided()
      const next = Object.entries(manifest.modules)
        // `!seen.has(n)` is the fix: an app the user removed is not a candidate
        // again, however many times its dependencies are reinstalled.
        .filter(([n, m]) => m.install === 'auto' && !seen.has(n) && m.depends.every(d => on.has(d)))
        .map(([n]) => n)
      if (!next.length) return added
      await setState(next, 'installed')
      added.push(...next)
    }
  }

  return {
    enabled,

    async orphans() {
      const shipped = new Set(Object.keys(manifest.modules))
      return [...(await decided())].filter(n => !shipped.has(n)).sort()
    },

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
          install: m.install,
          removable: m.removable,
        }))
        .sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title))
    },

    async install(name) {
      const target = known(name)
      // 'never' is a boundary the module drew, not a preference: it is machinery,
      // and the only honest way in is for something that needs it to ask.
      if (target.install === 'never') {
        throw new KetError({
          code: 'E_APP_NOT_INSTALLABLE',
          module: name,
          message: `"${name}" declares install: 'never', so it cannot be installed on its own`,
          hint: `install a module that depends on "${name}" — it will come along as a dependency`,
        })
      }
      const on = await enabled()
      // Dependencies come along; an app whose dependency is off would be broken.
      const wanted: string[] = []
      const visit = (n: string) => {
        if (on.has(n) || wanted.includes(n)) return
        for (const dep of known(n).depends) visit(dep)
        wanted.push(n)
      }
      visit(name)
      await setState(wanted, 'installed')
      return [...wanted, ...(await settle())]
    },

    async uninstall(name) {
      const target = known(name)
      const on = await enabled()
      if (!on.has(name)) return []
      // Removing this would remove the way back: the boundary is the module's,
      // drawn once, rather than a rule the UI is trusted to remember.
      if (!target.removable) {
        throw new KetError({
          code: 'E_APP_NOT_REMOVABLE',
          module: name,
          message: `"${name}" declares removable: false, so it cannot be uninstalled`,
          hint: 'it is part of what this deployment is, not a choice made on this database',
        })
      }

      const blocking = dependentsOf(manifest, name).filter(d => on.has(d))
      if (blocking.length) {
        throw new KetError({
          code: 'E_APP_IN_USE',
          message: `"${name}" cannot be removed while ${blocking.join(', ')} ${blocking.length > 1 ? 'are' : 'is'} installed`,
          hint: `remove ${blocking.join(', ')} first, or leave "${name}" installed`,
        })
      }
      await setState([name], 'removed')
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
    // What was removed by the restriction, so a renderer can skip a section from a
    // switched-off app quietly while still complaining about one that never existed.
    disabledSections: Object.entries(manifest.sections).filter(([, s]) => !keep(s.by)).map(([n]) => n),
    disabledIslands: Object.entries(manifest.islands).filter(([, s]) => !keep(s.by)).map(([n]) => n),
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
