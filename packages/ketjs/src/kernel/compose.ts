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
import { ambiguousRoutes, parseRoutePattern } from './routes.ts'
import type { RoutePattern } from './routes.ts'

const qualify = (mod: string, name: string) => `${mod}.${name}`
const jointKey = (mod: string, name: string) => `${mod}:${name}`

export function compose(
  modules: KetModule[],
  opts: { appRequires?: string[]; headless?: boolean } = {},
): Manifest {
  const diag = new Diagnostics()
  const order = topoSort(modules)
  const canSee = (m: KetModule, other: string) => m.name === other || m.depends.includes(other)

  const manifest: Manifest = {
    ket: '0.0.0',
    order: order.map((m) => m.name),
    modules: {},
    models: {},
    menus: {},
    joints: {},
    fills: [],
    functions: {},
    views: {},
    regions: { required: [...(opts.appRequires ?? [])], provided: {} },
    islands: {},
    sections: {},
    relations: {},
    tokens: {},
    assets: {},
    styles: [],
    routes: {},
    patches: [],
    messages: {},
  }

  for (const m of order) {
    manifest.modules[m.name] = {
      version: m.version,
      kind: m.kind,
      depends: [...m.depends],
      app: m.app,
      title: m.title,
      summary: m.summary,
      category: m.category,
      install: m.install ?? 'manual',
      removable: m.removable !== false,
    }
  }

  // --- the served surface -------------------------------------------------
  //
  // Assets, stylesheets and routes are composed for the same reason models are:
  // otherwise the app hand-assembles them, which means knowing another module's
  // file layout and going on serving it after that module is switched off.
  //
  // `order` is dependency order, so a module that extends another contributes its
  // stylesheet after it and can override it. That ordering is the point.
  for (const m of order) {
    if (m.assets) manifest.assets[m.name] = typeof m.assets === 'string' ? m.assets : m.assets.pathname
    for (const href of m.styles) {
      if (!m.assets) {
        diag.add({
          code: 'E_STYLE_WITHOUT_ASSETS',
          module: m.name,
          message: `"${m.name}" declares style "${href}" but no assets directory`,
          hint: 'styles are resolved against the module assets directory, so a module with styles needs one',
        })
        continue
      }
      manifest.styles.push({ by: m.name, href: `/_ket/asset/${m.name}/${href}` })
    }
    for (const [path, make] of Object.entries(m.routes)) {
      let pattern: RoutePattern
      try {
        pattern = parseRoutePattern(path)
      } catch (error) {
        const e = error as { code?: string; message: string; hint?: string | null }
        diag.add({ code: e.code ?? 'E_ROUTE_PATTERN', module: m.name, message: e.message, hint: e.hint })
        continue
      }
      if (path.startsWith('/_ket/')) {
        diag.add({
          code: 'E_ROUTE_RESERVED',
          module: m.name,
          message: `"${m.name}" claims "${path}", which is reserved`,
          hint: '/_ket/ belongs to the framework: health, the agent descriptor, streams and assets',
        })
        continue
      }
      const taken = manifest.routes[path]
      if (taken) {
        diag.add({
          code: 'E_ROUTE_CLASH',
          module: m.name,
          message: `both "${taken.by}" and "${m.name}" serve "${path}"`,
          hint: 'two modules cannot own one path — rename one, or have one fill a joint in the other',
        })
        continue
      }
      const ambiguous = Object.keys(manifest.routes).find((other) =>
        ambiguousRoutes(parseRoutePattern(other), pattern),
      )
      if (ambiguous) {
        const owner = manifest.routes[ambiguous]!.by
        diag.add({
          code: 'E_ROUTE_AMBIGUOUS',
          module: m.name,
          message: `routes "${ambiguous}" owned by "${owner}" and "${path}" owned by "${m.name}" can match the same path with equal priority`,
          hint: 'make one route more specific, or let one module own both paths',
        })
        continue
      }
      manifest.routes[path] =
        typeof make === 'function'
          ? { by: m.name, anonymous: false, make }
          : { by: m.name, anonymous: make.anonymous === true, make: make.handler }
    }
  }

  // --- models -------------------------------------------------------------
  for (const m of order) {
    for (const [modelName, def] of Object.entries(m.models)) {
      const key = qualify(m.name, modelName)
      if (manifest.models[key]) {
        diag.add({
          code: 'E_MODEL_DUPLICATE',
          module: m.name,
          message: `model "${key}" is already defined`,
          hint: 'rename it, or extend the existing one via `extend`',
        })
        continue
      }
      if (!def.scope) {
        diag.add({
          code: 'E_MODEL_NO_SCOPE',
          module: m.name,
          message: `model "${key}" does not declare a scope`,
          hint: "every model must say 'shared', 'company' or 'company+branch' — there is no default, because the safe-looking one is the one that leaks",
        })
        continue
      }
      if (!['shared', 'company', 'company+branch'].includes(def.scope)) {
        diag.add({
          code: 'E_MODEL_BAD_SCOPE',
          module: m.name,
          message: `model "${key}" has unknown scope "${def.scope}"`,
        })
        continue
      }

      const fields: ComposedModel['fields'] = {}
      // The scope columns are added by the composer, never by the module: a module
      // that spelled them itself could spell them differently, and the filter would
      // silently stop matching.
      if (def.scope !== 'shared') fields['companyId'] = { base: 'text', optional: false, by: '(scope)' }
      if (def.scope === 'company+branch') fields['branchId'] = { base: 'text', optional: true, by: '(scope)' }
      for (const [fname, tspec] of Object.entries(def.fields ?? {})) {
        const t = parseType(tspec)
        if (!t.ok) {
          diag.add({ code: 'E_BAD_TYPE', module: m.name, message: `${key}.${fname}: ${t.reason}` })
          continue
        }
        if (t.base === 'ref' && t.target === key && !t.optional) {
          diag.add({
            code: 'E_SELF_REF_REQUIRED',
            module: m.name,
            message: `field "${key}.${fname}" is a required reference to its own model`,
            hint: `the first row could never satisfy it — write "${tspec}?"`,
          })
          continue
        }
        fields[fname] = { base: t.base, optional: t.optional, target: t.target, by: m.name }
      }
      manifest.models[key] = { owner: m.name, scope: def.scope, fields }
    }
  }

  // --- model extension: the core of the lego pillar ------------------------
  for (const m of order) {
    for (const [target, addl] of Object.entries(m.extend)) {
      const model = manifest.models[target]
      if (!model) {
        diag.add({
          code: 'E_EXTEND_UNKNOWN_MODEL',
          module: m.name,
          message: `cannot extend "${target}" - no such model`,
          hint: `known models: ${Object.keys(manifest.models).join(', ') || '(none)'}`,
        })
        continue
      }
      if (!canSee(m, model.owner)) {
        diag.add({
          code: 'E_EXTEND_NOT_DEPENDED',
          module: m.name,
          message: `extends "${target}" but does not depend on "${model.owner}"`,
          hint: `add "${model.owner}" to ${m.name}.depends`,
        })
        continue
      }
      for (const [fname, tspec] of Object.entries(addl)) {
        // Checked ahead of the collision below so the message names the real cause:
        // these columns are the isolation boundary, not a name somebody took first.
        if (fname === 'companyId' || fname === 'branchId') {
          diag.add({
            code: 'E_SCOPE_FIELD_RESERVED',
            module: m.name,
            message: `"${target}.${fname}" is managed by the model's scope and cannot be extended`,
            hint: 'the scope columns are the company boundary — a module able to redefine them would be able to move rows across it',
          })
          continue
        }
        const existing = model.fields[fname]
        if (existing) {
          diag.add({
            code: 'E_FIELD_COLLISION',
            module: m.name,
            message: `field "${target}.${fname}" already contributed by "${existing.by}"`,
            hint: `pick a distinct name, e.g. "${m.name}_${fname}"`,
          })
          continue
        }
        const t = parseType(tspec)
        if (!t.ok) {
          diag.add({ code: 'E_BAD_TYPE', module: m.name, message: `${target}.${fname}: ${t.reason}` })
          continue
        }
        // A field added to somebody else's model must be optional: rows already
        // exist and have no value for it. This is enforced, not documented.
        if (!t.optional && t.base !== 'json') {
          diag.add({
            code: 'E_EXTEND_REQUIRES_OPTIONAL',
            module: m.name,
            message: `field "${target}.${fname}" added to another module's model must be optional`,
            hint: `write "${tspec}?" - existing rows have no value for it`,
          })
          continue
        }
        model.fields[fname] = { base: t.base, optional: t.optional, target: t.target, by: m.name }
      }
    }
  }

  // --- relations -----------------------------------------------------------
  //
  // Checked against the models that exist and the key the relation travels on, so a
  // typo is a build error rather than a query that quietly returns nothing. Reaching
  // another module follows the same rule as extending it: only what you depend on.
  for (const m of order) {
    for (const [modelKey, rels] of Object.entries(m.relations)) {
      const model = manifest.models[modelKey]
      if (!model) {
        diag.add({
          code: 'E_RELATION_UNKNOWN_MODEL',
          module: m.name,
          message: `relation declared on "${modelKey}", which is not a model`,
        })
        continue
      }
      if (!canSee(m, model.owner)) {
        diag.add({
          code: 'E_RELATION_NOT_DEPENDED',
          module: m.name,
          message: `declares a relation on "${modelKey}" but does not depend on "${model.owner}"`,
          hint: `add "${model.owner}" to ${m.name}.depends`,
        })
        continue
      }
      for (const [name, def] of Object.entries(rels)) {
        const kind = 'belongsTo' in def ? 'belongsTo' : 'hasMany'
        const target = 'belongsTo' in def ? def.belongsTo : def.hasMany
        const targetModel = manifest.models[target]
        if (!targetModel) {
          diag.add({
            code: 'E_RELATION_UNKNOWN_TARGET',
            module: m.name,
            message: `relation "${modelKey}.${name}" points at "${target}", which is not a model`,
            hint: `known models: ${Object.keys(manifest.models).join(', ')}`,
          })
          continue
        }
        if (!canSee(m, targetModel.owner)) {
          diag.add({
            code: 'E_RELATION_NOT_DEPENDED',
            module: m.name,
            message: `relation "${modelKey}.${name}" reaches "${target}" but "${m.name}" does not depend on "${targetModel.owner}"`,
          })
          continue
        }
        // The key lives on whichever side carries the foreign id: the model itself
        // for belongsTo, the far side for hasMany.
        const holderKey = kind === 'belongsTo' ? modelKey : target
        const holder = kind === 'belongsTo' ? model : targetModel
        if (!holder.fields[def.by]) {
          diag.add({
            code: 'E_RELATION_NO_KEY',
            module: m.name,
            message: `relation "${modelKey}.${name}" travels on "${holderKey}.${def.by}", which does not exist`,
            hint: `fields on ${holderKey}: ${Object.keys(holder.fields).join(', ')}`,
          })
          continue
        }
        // Crossing the company boundary through a relation would be a leak the
        // scope check never sees, because the child query is built from parent ids.
        if (model.scope !== 'shared' && targetModel.scope === 'shared') {
          /* narrowing: fine */
        } else if (model.scope === 'shared' && targetModel.scope !== 'shared') {
          diag.add({
            code: 'E_RELATION_WIDENS_SCOPE',
            module: m.name,
            message: `relation "${modelKey}.${name}" reaches company-scoped "${target}" from shared "${modelKey}"`,
            hint: 'a shared row would expose rows of every company through it — put the relation on the scoped side',
          })
          continue
        }
        ;(manifest.relations[modelKey] ??= {})[name] = { kind, target, by: def.by, declaredBy: m.name }
      }
    }
  }

  // --- navigation ----------------------------------------------------------
  //
  // Ids are global and chosen by the module, the way a joint key is: a second
  // module claiming one is a build error naming both, rather than one of them
  // quietly winning. Parenting onto somebody else's entry needs the same declared
  // dependency filling their joint would.
  for (const m of order) {
    for (const [id, def] of Object.entries(m.menus)) {
      const taken = manifest.menus[id]
      if (taken) {
        diag.add({
          code: 'E_MENU_DUPLICATE',
          module: m.name,
          message: `both "${taken.by}" and "${m.name}" declare menu "${id}"`,
          hint: 'menu ids are global — prefix yours with the module name',
        })
        continue
      }
      manifest.menus[id] = { ...def, by: m.name }
    }
  }
  for (const [id, def] of Object.entries(manifest.menus)) {
    if (def.parent !== undefined) {
      const parent = manifest.menus[def.parent]
      if (!parent) {
        diag.add({
          code: 'E_MENU_UNKNOWN_PARENT',
          module: def.by,
          message: `menu "${id}" hangs under "${def.parent}", which nothing declares`,
          hint: `declared menus: ${Object.keys(manifest.menus).join(', ') || '(none)'}`,
        })
        continue
      }
      const owner = manifest.modules[def.by]
      if (
        parent.by !== def.by &&
        !canSee({ name: def.by, depends: owner?.depends ?? [] } as never, parent.by)
      ) {
        diag.add({
          code: 'E_MENU_NOT_DEPENDED',
          module: def.by,
          message: `menu "${id}" hangs under "${def.parent}", owned by "${parent.by}", which "${def.by}" does not depend on`,
          hint: `add "${parent.by}" to ${def.by}.depends`,
        })
      }
    }
  }

  // --- joints (published extension points) and fills -----------------------
  for (const m of order) {
    for (const [name, def] of Object.entries(m.joints)) {
      manifest.joints[jointKey(m.name, name)] = {
        owner: m.name,
        props: def.props ?? {},
        multiple: def.multiple !== false,
        omittedBy: [],
      }
    }
  }
  for (const m of order) {
    for (const [key, value] of Object.entries(m.fills)) {
      const joint = manifest.joints[key]
      if (!joint) {
        const near = Object.keys(manifest.joints).filter((k) => k.split(':')[1] === key.split(':')[1])
        diag.add({
          code: 'E_FILL_UNKNOWN_JOINT',
          module: m.name,
          message: `fills joint "${key}", which no installed module publishes`,
          hint: near.length
            ? `did you mean "${near[0]}"?`
            : `published joints: ${Object.keys(manifest.joints).join(', ') || '(none)'}`,
        })
        continue
      }
      if (!canSee(m, joint.owner)) {
        diag.add({
          code: 'E_FILL_NOT_DEPENDED',
          module: m.name,
          message: `fills "${key}" but does not depend on "${joint.owner}"`,
          hint: `add "${joint.owner}" to ${m.name}.depends`,
        })
        continue
      }
      manifest.fills.push({ joint: key, by: m.name, template: value })
    }
  }
  // Omissions travel the same road as fills: a declared joint, and a declared
  // dependency on whoever published it.
  for (const m of order) {
    for (const key of m.omits) {
      const joint = manifest.joints[key]
      if (!joint) {
        diag.add({
          code: 'E_OMIT_UNKNOWN_JOINT',
          module: m.name,
          message: `omits joint "${key}", which no installed module publishes`,
          hint: `published joints: ${Object.keys(manifest.joints).join(', ') || '(none)'}`,
        })
        continue
      }
      if (!canSee(m, joint.owner)) {
        diag.add({
          code: 'E_OMIT_NOT_DEPENDED',
          module: m.name,
          message: `omits "${key}" but does not depend on "${joint.owner}"`,
          hint: `add "${joint.owner}" to ${m.name}.depends`,
        })
        continue
      }
      joint.omittedBy.push(m.name)
    }
  }
  // An omitted joint that somebody else fills is a fill nobody will ever see. It
  // is not an error — the two modules may be deliberate — but it is exactly the
  // kind of thing that gets discovered six months later, so it is recorded where
  // `ket check` and the upgrade diff will show it.
  for (const [key, joint] of Object.entries(manifest.joints)) {
    if (!joint.omittedBy.length) continue
    const fillers = manifest.fills.filter((f) => f.joint === key).map((f) => f.by)
    if (fillers.length) {
      manifest.patches.push({
        by: joint.omittedBy.join(', '),
        target: key,
        reason: `omitted, so fills from ${fillers.join(', ')} will not render`,
      })
    }
  }

  // --- server functions ----------------------------------------------------
  for (const m of order) {
    for (const [fname, def] of Object.entries(m.functions)) {
      manifest.functions[qualify(m.name, fname)] = {
        by: m.name,
        input: def.input ?? {},
        output: def.output ?? {},
        effects: [...(def.effects ?? [])],
        crossCompany: def.crossCompany === true,
        anonymous: def.anonymous === true,
        idempotent: def.idempotent === true,
        dryRun: def.dryRun !== false,
        agent: def.agent === true,
      }
    }
  }

  // A gate on a function that does not exist. Checked here rather than with the
  // rest of navigation, because the functions it names are only collected above.
  //
  // Which of two things it is depends on whether the module is here. If it is and
  // the function is not, somebody mistyped, and hiding the entry would hide the
  // mistake — that is a build error. If the module is absent, the entry is gated on
  // something this deployment simply does not ship, which is a soft dependency and
  // exactly what a gate is for: buildMenu drops it and nobody is told off.
  for (const [id, def] of Object.entries(manifest.menus)) {
    if (def.needs === undefined || manifest.functions[def.needs]) continue
    const owner = def.needs.split('.')[0]!
    if (!manifest.modules[owner]) continue
    diag.add({
      code: 'E_MENU_UNKNOWN_FUNCTION',
      module: def.by,
      message: `menu "${id}" needs "${def.needs}", which "${owner}" does not declare`,
      hint: 'the entry is hidden from anyone who may not call it, so the name has to exist',
    })
  }

  // --- view models: the only data surface a theme may read -----------------
  for (const m of order) {
    for (const [vname, def] of Object.entries(m.views)) {
      const key = qualify(m.name, vname)
      const model = manifest.models[def.of]
      if (!model) {
        diag.add({
          code: 'E_VIEW_UNKNOWN_MODEL',
          module: m.name,
          message: `view "${key}" projects unknown model "${def.of}"`,
        })
        continue
      }
      const missing = (def.fields ?? []).filter((f) => !model.fields[f])
      if (missing.length) {
        diag.add({
          code: 'E_VIEW_UNKNOWN_FIELD',
          module: m.name,
          message: `view "${key}" exposes field(s) not on ${def.of}: ${missing.join(', ')}`,
          hint: `available: ${Object.keys(model.fields).join(', ')}`,
        })
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
        diag.add({
          code: 'E_ISLAND_DUPLICATE',
          module: m.name,
          message: `island "${name}" is already provided by "${existing.by}"`,
        })
        continue
      }
      manifest.islands[name] = { by: m.name }
    }
  }

  // --- sections: placeable by data, so their settings must be declared -------
  for (const m of order) {
    for (const [name, def] of Object.entries(m.sections)) {
      const existing = manifest.sections[name]
      if (existing) {
        diag.add({
          code: 'E_SECTION_DUPLICATE',
          module: m.name,
          message: `section "${name}" is already provided by "${existing.by}"`,
        })
        continue
      }
      manifest.sections[name] = { ...def, by: m.name }
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

  // --- messages: prefixed by module, so two modules may both own a "title" ---
  for (const m of order) {
    for (const [locale, catalog] of Object.entries(m.messages)) {
      const target = (manifest.messages![locale] ??= {})
      for (const [key, message] of Object.entries(catalog)) target[`${m.name}.${key}`] = message
    }
  }

  // --- tokens: later modules layer over earlier ones ------------------------
  for (const m of order) Object.assign(manifest.tokens, m.tokens)

  diag.throwIfAny()
  manifest.diagnostics = []
  return manifest
}
