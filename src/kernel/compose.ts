// Composition: turn a set of modules into one manifest.
//
// The manifest is the single artifact the whole framework reads. It is the module
// contract, the database schema, the theme contract and the agent capability
// descriptor at once. Every field records which module contributed it — that
// provenance is what makes upgrade diffs and non-destructive migrations possible.

import { topoSort } from './graph.ts'
import { Diagnostics } from './errors.ts'
import { parseType } from './types.ts'
import type { KetModule, Manifest, ComposedModel } from '../types.ts'

const qualify = (mod: string, name: string) => `${mod}.${name}`
const jointKey = (mod: string, name: string) => `${mod}:${name}`

export function compose(modules: KetModule[], opts: { appRequires?: string[]; headless?: boolean } = {}): Manifest {
  const diag = new Diagnostics()
  const order = topoSort(modules)
  const canSee = (m: KetModule, other: string) => m.name === other || m.depends.includes(other)

  const manifest: Manifest = {
    ket: '0.0.0',
    order: order.map(m => m.name),
    modules: {}, models: {}, joints: {}, fills: [],
    functions: {}, views: {},
    regions: { required: [...(opts.appRequires ?? [])], provided: {} },
    islands: {},
    tokens: {}, patches: [],
  }

  for (const m of order) manifest.modules[m.name] = { version: m.version, kind: m.kind, depends: [...m.depends] }

  // --- models -------------------------------------------------------------
  for (const m of order) {
    for (const [modelName, def] of Object.entries(m.models)) {
      const key = qualify(m.name, modelName)
      if (manifest.models[key]) {
        diag.add({ code: 'E_MODEL_DUPLICATE', module: m.name, message: `model "${key}" is already defined`, hint: 'rename it, or extend the existing one via `extend`' })
        continue
      }
      const fields: ComposedModel['fields'] = {}
      for (const [fname, tspec] of Object.entries(def.fields ?? {})) {
        const t = parseType(tspec)
        if (!t.ok) { diag.add({ code: 'E_BAD_TYPE', module: m.name, message: `${key}.${fname}: ${t.reason}` }); continue }
        fields[fname] = { base: t.base, optional: t.optional, target: t.target, by: m.name }
      }
      manifest.models[key] = { owner: m.name, fields }
    }
  }

  // --- model extension: the core of the lego pillar ------------------------
  for (const m of order) {
    for (const [target, addl] of Object.entries(m.extend)) {
      const model = manifest.models[target]
      if (!model) {
        diag.add({ code: 'E_EXTEND_UNKNOWN_MODEL', module: m.name, message: `cannot extend "${target}" - no such model`, hint: `known models: ${Object.keys(manifest.models).join(', ') || '(none)'}` })
        continue
      }
      if (!canSee(m, model.owner)) {
        diag.add({ code: 'E_EXTEND_NOT_DEPENDED', module: m.name, message: `extends "${target}" but does not depend on "${model.owner}"`, hint: `add "${model.owner}" to ${m.name}.depends` })
        continue
      }
      for (const [fname, tspec] of Object.entries(addl)) {
        const existing = model.fields[fname]
        if (existing) {
          diag.add({ code: 'E_FIELD_COLLISION', module: m.name, message: `field "${target}.${fname}" already contributed by "${existing.by}"`, hint: `pick a distinct name, e.g. "${m.name}_${fname}"` })
          continue
        }
        const t = parseType(tspec)
        if (!t.ok) { diag.add({ code: 'E_BAD_TYPE', module: m.name, message: `${target}.${fname}: ${t.reason}` }); continue }
        // A field added to somebody else's model must be optional: rows already
        // exist and have no value for it. This is enforced, not documented.
        if (!t.optional && t.base !== 'json') {
          diag.add({ code: 'E_EXTEND_REQUIRES_OPTIONAL', module: m.name, message: `field "${target}.${fname}" added to another module's model must be optional`, hint: `write "${tspec}?" - existing rows have no value for it` })
          continue
        }
        model.fields[fname] = { base: t.base, optional: t.optional, target: t.target, by: m.name }
      }
    }
  }

  // --- joints (published extension points) and fills -----------------------
  for (const m of order) {
    for (const [name, def] of Object.entries(m.joints)) {
      manifest.joints[jointKey(m.name, name)] = { owner: m.name, props: def.props ?? {}, multiple: def.multiple !== false }
    }
  }
  for (const m of order) {
    for (const [key, value] of Object.entries(m.fills)) {
      const joint = manifest.joints[key]
      if (!joint) {
        const near = Object.keys(manifest.joints).filter(k => k.split(':')[1] === key.split(':')[1])
        diag.add({
          code: 'E_FILL_UNKNOWN_JOINT', module: m.name,
          message: `fills joint "${key}", which no installed module publishes`,
          hint: near.length ? `did you mean "${near[0]}"?` : `published joints: ${Object.keys(manifest.joints).join(', ') || '(none)'}`,
        })
        continue
      }
      if (!canSee(m, joint.owner)) {
        diag.add({ code: 'E_FILL_NOT_DEPENDED', module: m.name, message: `fills "${key}" but does not depend on "${joint.owner}"`, hint: `add "${joint.owner}" to ${m.name}.depends` })
        continue
      }
      manifest.fills.push({ joint: key, by: m.name, template: value })
    }
  }

  // --- server functions ----------------------------------------------------
  for (const m of order) {
    for (const [fname, def] of Object.entries(m.functions)) {
      manifest.functions[qualify(m.name, fname)] = {
        by: m.name,
        input: def.input ?? {}, output: def.output ?? {},
        effects: [...(def.effects ?? [])],
        idempotent: def.idempotent === true,
        dryRun: def.dryRun !== false,
        agent: def.agent === true,
      }
    }
  }

  // --- view models: the only data surface a theme may read -----------------
  for (const m of order) {
    for (const [vname, def] of Object.entries(m.views)) {
      const key = qualify(m.name, vname)
      const model = manifest.models[def.of]
      if (!model) { diag.add({ code: 'E_VIEW_UNKNOWN_MODEL', module: m.name, message: `view "${key}" projects unknown model "${def.of}"` }); continue }
      const missing = (def.fields ?? []).filter(f => !model.fields[f])
      if (missing.length) {
        diag.add({ code: 'E_VIEW_UNKNOWN_FIELD', module: m.name, message: `view "${key}" exposes field(s) not on ${def.of}: ${missing.join(', ')}`, hint: `available: ${Object.keys(model.fields).join(', ')}` })
        continue
      }
      manifest.views[key] = { of: def.of, fields: [...(def.fields ?? [])], by: m.name }
    }
  }

  // --- islands -------------------------------------------------------------
  for (const m of order) {
    for (const name of Object.keys(m.islands)) {
      const existing = manifest.islands[name]
      if (existing) {
        diag.add({ code: 'E_ISLAND_DUPLICATE', module: m.name, message: `island "${name}" is already provided by "${existing.by}"` })
        continue
      }
      manifest.islands[name] = { by: m.name }
    }
  }

  // --- theme <-> app region contract ---------------------------------------
  for (const m of order) {
    for (const r of m.provides) (manifest.regions.provided[r] ??= []).push(m.name)
    for (const name of Object.keys(m.templates)) {
      const list = (manifest.regions.provided[name] ??= [])
      if (!list.includes(m.name)) list.push(m.name)
    }
    for (const r of m.requires) if (!manifest.regions.required.includes(r)) manifest.regions.required.push(r)
  }
  // A headless app renders nothing, so the region contract does not apply to it.
  // Requirements are still recorded, so adding a theme later checks them.
  for (const r of opts.headless ? [] : manifest.regions.required) {
    if (!manifest.regions.provided[r]) {
      diag.add({
        code: 'E_REGION_MISSING',
        message: `region "${r}" is required but no installed theme provides it`,
        hint: `add a template named "${r}" to your theme, or drop the requirement`,
      })
    }
  }

  // --- tokens: later modules layer over earlier ones ------------------------
  for (const m of order) Object.assign(manifest.tokens, m.tokens)

  diag.throwIfAny()
  manifest.diagnostics = []
  return manifest
}
