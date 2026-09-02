// What a role can actually reach.
//
// This exists because the question "can this user see products?" has no answer in
// most systems until you read every module. Here it does have one, and it is
// arithmetic rather than investigation: a function cannot touch a model it did not
// declare — not through a relation, not by calling another function, because there
// is no way to call one — so the reach of a set of functions is the union of their
// declared effects. Nothing to traverse.
//
// It is a report before it is a mechanism on purpose. Deciding how roles should be
// shaped is easier while looking at what the current functions already imply.

import { KetError } from '../kernel/errors.ts'
import type { Manifest } from '../types.ts'

export type GrantedFn = {
  key: string
  by: string
  effects: string[]
  reads: string[]
  writes: string[]
  enqueues: string[]
  crossCompany: boolean
  mutates: boolean
  /**
   * Whether the function declares the shape it returns. Undeclared means the reach
   * is known at model level but not at field level: the rows come back whole, so a
   * role that may see an order's product name may also see its cost.
   */
  projected: boolean
  /** The fields it hands back, when it says. Empty means it says nothing. */
  returns: string[]
}

export type ModelReach = {
  model: string
  read: boolean
  write: boolean
  /** The functions that grant it, so a surprise can be traced to its cause. */
  via: string[]
  /** Fields a theme may read of this model, if any module declared a view. */
  viewFields: string[] | null
}

export type Reach = {
  functions: GrantedFn[]
  models: ModelReach[]
  /** Reads that cross legal entities. Rare and worth seeing on its own. */
  crossCompany: string[]
  /** Functions whose field-level reach cannot be stated, because output is undeclared. */
  unprojected: string[]
  unknown: string[]
}

export type PermissionFunctionInventory = {
  key: string
  module: string
  exposure: 'http' | 'internal'
  anonymous: boolean
  provision: boolean
  grantable: boolean
  effects: string[]
  crossCompany: boolean
  idempotent: boolean
  dryRun: boolean
  agent: boolean
  input: Record<string, string>
  output: Record<string, string>
}

export type PermissionModuleInventory = {
  name: string
  version: string
  kind: string
  functions: PermissionFunctionInventory[]
}

export type PermissionInventory = {
  version: 1
  totals: {
    modules: number
    functions: number
    grantable: number
    anonymous: number
    internal: number
    provision: number
    unprojected: number
  }
  modules: PermissionModuleInventory[]
}

const splitEffect = (e: string): [string, string] => {
  const at = e.indexOf(':')
  return at === -1 ? ['', e] : [e.slice(0, at), e.slice(at + 1)]
}

/** Every field any module exposes to a theme for this model, if any does. */
const viewFieldsOf = (manifest: Manifest, model: string): string[] | null => {
  const fields = new Set<string>()
  let any = false
  for (const v of Object.values(manifest.views)) {
    if (v.of !== model) continue
    any = true
    for (const f of v.fields) fields.add(f)
  }
  return any ? [...fields].sort() : null
}

export function reachOf(manifest: Manifest, functions: string[]): Reach {
  const granted: GrantedFn[] = []
  const unknown: string[] = []
  const models = new Map<string, ModelReach>()

  for (const key of functions) {
    const fn = manifest.functions[key]
    if (!fn) {
      unknown.push(key)
      continue
    }
    const reads: string[] = []
    const writes: string[] = []
    const enqueues: string[] = []
    for (const e of fn.effects) {
      const [verb, model] = splitEffect(e)
      if (verb === 'enqueue') {
        enqueues.push(model)
        continue
      }
      const slot = models.get(model) ?? {
        model,
        read: false,
        write: false,
        via: [],
        viewFields: viewFieldsOf(manifest, model),
      }
      if (verb === 'read') {
        slot.read = true
        reads.push(model)
      } else {
        slot.write = true
        writes.push(model)
      }
      if (!slot.via.includes(key)) slot.via.push(key)
      models.set(model, slot)
    }
    granted.push({
      key,
      by: fn.by,
      effects: [...fn.effects],
      reads: [...new Set(reads)].sort(),
      writes: [...new Set(writes)].sort(),
      enqueues: [...new Set(enqueues)].sort(),
      crossCompany: fn.crossCompany,
      mutates: writes.length > 0 || enqueues.length > 0,
      projected: Object.keys(fn.output).length > 0,
      returns: Object.keys(fn.output).sort(),
    })
  }

  return {
    functions: granted.sort((a, b) => a.key.localeCompare(b.key)),
    models: [...models.values()].sort((a, b) => a.model.localeCompare(b.model)),
    crossCompany: granted.filter((f) => f.crossCompany).map((f) => f.key),
    unprojected: granted.filter((f) => !f.projected).map((f) => f.key),
    unknown,
  }
}

/** Every function a module owns — what granting the whole module would mean. */
export function functionsOf(manifest: Manifest, module: string): string[] {
  const keys = Object.entries(manifest.functions)
    .filter(([, f]) => f.by === module)
    .map(([k]) => k)
  if (!keys.length && !manifest.modules[module]) {
    throw new KetError({
      code: 'E_UNKNOWN_MODULE',
      message: `no module "${module}"`,
      hint: `installed: ${Object.keys(manifest.modules).sort().join(', ')}`,
    })
  }
  return keys.sort()
}

const sortedRecord = (value: Record<string, string>): Record<string, string> =>
  Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))

/**
 * The complete permission-relevant composition surface in a deterministic, machine-readable shape.
 *
 * Modules with no functions remain present: absence is meaningful for coverage gates and must not be
 * confused with a module missing from the deployment. Handlers are deliberately excluded so this value
 * can be serialized without executing application code or exposing runtime state.
 */
export function permissionInventory(manifest: Manifest): PermissionInventory {
  const functions = Object.entries(manifest.functions)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([key, fn]): PermissionFunctionInventory => ({
        key,
        module: fn.by,
        exposure: fn.exposure,
        anonymous: fn.anonymous,
        provision: fn.provision,
        grantable: fn.exposure === 'http' && !fn.anonymous && !fn.provision,
        effects: [...fn.effects].sort(),
        crossCompany: fn.crossCompany,
        idempotent: fn.idempotent,
        dryRun: fn.dryRun,
        agent: fn.agent,
        input: sortedRecord(fn.input),
        output: sortedRecord(fn.output),
      }),
    )
  const modules = Object.entries(manifest.modules)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(
      ([name, module]): PermissionModuleInventory => ({
        name,
        version: module.version,
        kind: module.kind,
        functions: functions.filter((fn) => fn.module === name),
      }),
    )

  return {
    version: 1,
    totals: {
      modules: modules.length,
      functions: functions.length,
      grantable: functions.filter((fn) => fn.grantable).length,
      anonymous: functions.filter((fn) => fn.anonymous).length,
      internal: functions.filter((fn) => fn.exposure === 'internal').length,
      provision: functions.filter((fn) => fn.provision).length,
      unprojected: functions.filter((fn) => !Object.keys(fn.output).length).length,
    },
    modules,
  }
}

const pad = (s: string, n: number) => s.padEnd(n)

export function formatReach(r: Reach): string {
  const out: string[] = []
  if (r.unknown.length) out.push(`unknown functions: ${r.unknown.join(', ')}\n`)

  const w = Math.max(20, ...r.functions.map((f) => f.key.length))
  out.push('functions granted:')
  for (const f of r.functions) {
    const marks = [f.mutates ? 'writes' : 'reads', ...(f.crossCompany ? ['cross-company'] : [])]
    out.push(`  ${pad(f.key, w)}  ${marks.join(' · ')}`)
    // The field-level answer, which is the one that was missing: what a caller
    // actually receives, rather than which tables were touched to build it.
    out.push(
      `  ${pad('', w)}  returns ${f.projected ? f.returns.join(', ') : 'WHOLE ROWS — output undeclared'}`,
    )
  }

  out.push('\nmodels reachable:')
  const mw = Math.max(20, ...r.models.map((m) => m.model.length))
  for (const m of r.models) {
    const access = [m.read ? 'read' : null, m.write ? 'write' : null].filter(Boolean).join('+')
    out.push(`  ${pad(m.model, mw)}  ${pad(access, 10)}  via ${m.via.join(', ')}`)
  }
  if (!r.models.length) out.push('  (none)')

  if (r.crossCompany.length) {
    out.push('\nreads across legal entities:')
    for (const k of r.crossCompany) out.push(`  ${k}`)
  }

  if (r.unprojected.length) {
    out.push('\nfield-level reach not stated — these return whole rows:')
    for (const k of r.unprojected) out.push(`  ${k}`)
    out.push('  (declare `output` to say what a caller actually receives)')
  }
  return out.join('\n')
}

/** The whole surface, grouped by module: what exists to be granted at all. */
export function formatInventory(manifest: Manifest): string {
  const byModule = new Map<string, string[]>()
  for (const [key, fn] of Object.entries(manifest.functions)) {
    const list = byModule.get(fn.by) ?? []
    list.push(key)
    byModule.set(fn.by, list)
  }
  const out: string[] = []
  let total = 0
  let unprojected = 0
  for (const [module, keys] of [...byModule].sort()) {
    out.push(`${module}:`)
    const w = Math.max(...keys.map((k) => k.length))
    for (const key of keys.sort()) {
      const fn = manifest.functions[key]!
      total++
      if (!Object.keys(fn.output).length) unprojected++
      const marks = [
        fn.effects.length ? fn.effects.join(' ') : 'no effects',
        ...(fn.crossCompany ? ['cross-company'] : []),
        ...(Object.keys(fn.output).length ? [] : ['unprojected']),
      ]
      out.push(`  ${pad(key, w)}  ${marks.join(' · ')}`)
    }
  }
  out.push(`\n${total} function(s); ${unprojected} return an undeclared shape`)
  return out.join('\n')
}

/**
 * The function keys a role grants, read from the database.
 *
 * The only part of this file that touches one. A role is data — what it grants is
 * a fact about a deployment, not about the code — so answering "what can the
 * warehouse role do here" has to look at the same rows the server enforces from.
 *
 * The table name is a convention rather than an import: the framework does not
 * ship a role model, because roles are the deployment's to shape. If a deployment names them
 * differently this command has nothing to read, and says so.
 */
export async function grantsOfRole(adapter: import('../types.ts').Adapter, role: string): Promise<string[]> {
  const pg = adapter.name === 'postgres'
  const p = (n: number) => (pg ? `$${n}` : '?')
  const q = (s: string) => adapter.quoteIdent(s)
  try {
    const roles = await adapter.all(`SELECT id FROM user_role WHERE ${q('name')} = ${p(1)} OR id = ${p(2)}`, [
      role,
      role,
    ])
    if (!roles.length) {
      throw new KetError({
        code: 'E_UNKNOWN_ROLE',
        message: `no role named "${role}" in this database`,
        hint: 'roles are rows, so this reads what is actually there — check the name, or the datastore',
      })
    }
    const ids = roles.map((r) => String(r.id))
    const rows = await adapter.all(
      `SELECT ${q('fnKey')} FROM user_grant WHERE ${q('roleId')} IN (${ids.map((_, i) => p(i + 1)).join(', ')})`,
      ids,
    )
    return [...new Set(rows.map((r) => String(r.fnKey)))].sort()
  } catch (e) {
    if (e instanceof KetError) throw e
    throw new KetError({
      code: 'E_NO_ROLE_TABLE',
      message: `this database has no role tables to read`,
      hint: 'roles are a deployment model, not a framework one — this command expects user_role and user_grant',
    })
  }
}
