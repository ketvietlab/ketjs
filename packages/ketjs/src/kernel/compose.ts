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
import { tableNameFor } from '../data/migrate.ts'

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
    jobs: {},
    views: {},
    reports: {},
    regions: { required: [...(opts.appRequires ?? [])], provided: {} },
    islands: {},
    sections: {},
    contentTypes: {},
    taxonomies: {},
    relations: {},
    tokens: {},
    assets: {},
    styles: [],
    routes: {},
    routePrefixes: {},
    patches: [],
    messages: {},
  }

  for (const m of order) {
    for (const raw of m.reserves ?? []) {
      const prefix = raw.trim()
      if (!prefix.startsWith('/') || !prefix.endsWith('/') || prefix.includes('{')) {
        diag.add({
          code: 'E_ROUTE_PREFIX',
          module: m.name,
          message: `"${m.name}" reserves invalid route prefix "${raw}"`,
          hint: 'a reserved prefix is an absolute static path ending in /',
        })
        continue
      }
      const conflict = Object.entries(manifest.routePrefixes).find(
        ([other]) => prefix.startsWith(other) || other.startsWith(prefix),
      )
      if (conflict) {
        diag.add({
          code: 'E_ROUTE_PREFIX_CLASH',
          module: m.name,
          message: `"${m.name}" and "${conflict[1]}" reserve overlapping prefixes "${prefix}" and "${conflict[0]}"`,
          hint: 'one module must own the whole public namespace',
        })
        continue
      }
      manifest.routePrefixes[prefix] = m.name
    }
  }

  const major = (version: string): number | null => {
    const match = /^(?:\^)?(\d+)(?:\.|$)/.exec(version.trim())
    return match ? Number(match[1]) : null
  }
  for (const m of order) {
    for (const [dependency, range] of Object.entries(m.compatible ?? {})) {
      if (!m.depends.includes(dependency)) {
        diag.add({
          code: 'E_MODULE_COMPATIBILITY_DEPENDENCY',
          module: m.name,
          message: `"${m.name}" declares compatibility with "${dependency}" without depending on it`,
          hint: `add "${dependency}" to depends`,
        })
        continue
      }
      const actual = order.find((candidate) => candidate.name === dependency)?.version
      const wantedMajor = major(range)
      const actualMajor = actual ? major(actual) : null
      const matches = range.startsWith('^')
        ? wantedMajor != null && actualMajor === wantedMajor
        : actual === range
      if (!matches) {
        diag.add({
          code: 'E_MODULE_VERSION_SKEW',
          module: m.name,
          message: `"${m.name}" requires "${dependency}" ${range}, but the deployment has ${actual ?? 'nothing'}`,
          hint: 'upgrade the extension and its contract owner together',
        })
      }
    }
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
      const reservation = Object.entries(manifest.routePrefixes).find(([prefix]) => path.startsWith(prefix))
      if (reservation) {
        const [prefix, owner] = reservation
        const contribution = typeof make === 'function' ? null : make.through
        const allowed = m.name === owner || (contribution === owner && m.depends.includes(owner))
        if (!allowed) {
          diag.add({
            code: 'E_ROUTE_RESERVED',
            module: m.name,
            message: `"${m.name}" claims "${path}", inside the prefix reserved by "${owner}"`,
            hint: `depend on "${owner}" and use its published route factory for "${prefix}"`,
          })
          continue
        }
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
          : {
              by: m.name,
              anonymous: make.anonymous === true,
              ...(make.through ? { through: make.through } : {}),
              ...(make.contract ? { contract: make.contract } : {}),
              make: make.handler,
            }
    }
  }

  // --- models -------------------------------------------------------------
  const physicalTables = new Map<string, string>()
  for (const m of order) {
    for (const [modelName, def] of Object.entries(m.models)) {
      const key = qualify(m.name, modelName)
      const physicalTable = tableNameFor(key)
      const existingPhysicalModel = physicalTables.get(physicalTable)
      if (existingPhysicalModel && existingPhysicalModel !== key) {
        diag.add({
          code: 'E_TABLE_NAME_COLLISION',
          module: m.name,
          message: `models "${existingPhysicalModel}" and "${key}" both map to table "${physicalTable}"`,
          hint: 'rename one model or module so every composed model has a unique physical table',
        })
      } else {
        physicalTables.set(physicalTable, key)
      }
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
      if (def.scope === 'company+branch')
        fields['branchId'] = { base: 'text', optional: false, by: '(scope)' }
      if (def.timestamps) {
        fields['createdAt'] = { base: 'datetime', optional: true, by: '(timestamps)' }
        fields['updatedAt'] = { base: 'datetime', optional: true, by: '(timestamps)' }
      }
      for (const [fname, tspec] of Object.entries(def.fields ?? {})) {
        if (def.timestamps && (fname === 'createdAt' || fname === 'updatedAt')) {
          diag.add({
            code: 'E_TIMESTAMP_FIELD_RESERVED',
            module: m.name,
            message: `${key}.${fname} is supplied by timestamps: true`,
            hint: `remove the explicit field or disable timestamps`,
          })
          continue
        }
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
      const indexes: ComposedModel['indexes'] = {}
      for (const [indexName, index] of Object.entries(def.indexes ?? {})) {
        if (!/^[a-z][a-z0-9_]*$/.test(indexName)) {
          diag.add({
            code: 'E_INDEX_NAME',
            module: m.name,
            message: `${key} index name ${JSON.stringify(indexName)} must be lowercase snake_case`,
          })
          continue
        }
        if (!index.fields.length) {
          diag.add({ code: 'E_INDEX_EMPTY', module: m.name, message: `${key}.${indexName} has no fields` })
          continue
        }
        const unknown = index.fields.filter((field) => !fields[field])
        if (unknown.length) {
          diag.add({
            code: 'E_INDEX_UNKNOWN_FIELD',
            module: m.name,
            message: `${key}.${indexName} references unknown field(s): ${unknown.join(', ')}`,
          })
          continue
        }
        if (new Set(index.fields).size !== index.fields.length) {
          diag.add({
            code: 'E_INDEX_DUPLICATE_FIELD',
            module: m.name,
            message: `${key}.${indexName} repeats a field`,
          })
          continue
        }
        indexes[indexName] = { fields: [...index.fields], unique: index.unique === true, by: m.name }
      }
      manifest.models[key] = {
        owner: m.name,
        scope: def.scope,
        timestamps: def.timestamps === true,
        fields,
        indexes,
      }
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
  for (const [key, joint] of Object.entries(manifest.joints)) {
    if (joint.multiple) continue
    const fillers = manifest.fills.filter((fill) => fill.joint === key).map((fill) => fill.by)
    if (fillers.length > 1) {
      diag.add({
        code: 'E_JOINT_CARDINALITY',
        module: joint.owner,
        message: `joint "${key}" accepts one fill but ${fillers.length} modules fill it`,
        hint: `fillers: ${fillers.join(', ')}; set multiple:true or keep one contributor`,
      })
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
      if (def.exposure !== undefined && def.exposure !== 'http' && def.exposure !== 'internal') {
        diag.add({
          code: 'E_FUNCTION_EXPOSURE',
          module: m.name,
          message: `function "${qualify(m.name, fname)}" has unknown exposure "${String(def.exposure)}"`,
          hint: 'use "http" or "internal"',
        })
      }
      if (def.provision === true && def.exposure !== 'internal') {
        diag.add({
          code: 'E_PROVISION_EXPOSED',
          module: m.name,
          message: `provision function "${qualify(m.name, fname)}" must be internal`,
          hint: 'set exposure: "internal" so bootstrap credentials never have a generic endpoint',
        })
      }
      manifest.functions[qualify(m.name, fname)] = {
        by: m.name,
        input: def.input ?? {},
        output: def.output ?? {},
        effects: [...(def.effects ?? [])],
        crossCompany: def.crossCompany === true,
        anonymous: def.anonymous === true,
        exposure: def.exposure ?? 'http',
        provision: def.provision === true,
        idempotent: def.idempotent === true,
        dryRun: def.dryRun !== false,
        agent: def.agent === true,
      }
    }
  }

  // --- printable reports ---------------------------------------------------
  for (const m of order) {
    for (const [name, def] of Object.entries(m.reports ?? {})) {
      const id = qualify(m.name, name)
      if (!/^[a-z][a-zA-Z0-9_]*$/.test(name)) {
        diag.add({ code: 'E_REPORT_NAME', module: m.name, message: `invalid report name "${name}"` })
        continue
      }
      if (!manifest.models[def.target]) {
        diag.add({
          code: 'E_REPORT_UNKNOWN_MODEL',
          module: m.name,
          message: `report "${id}" targets unknown model "${def.target}"`,
        })
        continue
      }
      const source = manifest.functions[def.source]
      if (!source) {
        diag.add({
          code: 'E_REPORT_UNKNOWN_SOURCE',
          module: m.name,
          message: `report "${id}" uses unknown function "${def.source}"`,
        })
        continue
      }
      if (source.effects.some((effect) => effect.startsWith('write:') || effect.startsWith('enqueue:'))) {
        diag.add({
          code: 'E_REPORT_SOURCE_WRITES',
          module: m.name,
          message: `report "${id}" source "${def.source}" is not read-only`,
        })
        continue
      }
      if (!def.template.trim()) {
        diag.add({
          code: 'E_REPORT_TEMPLATE_EMPTY',
          module: m.name,
          message: `report "${id}" has no template`,
        })
        continue
      }
      manifest.reports[id] = { ...def, by: m.name, id }
    }
  }

  // --- background jobs -----------------------------------------------------
  //
  // Jobs run later and often on another process, but they touch the same data.
  // Their contract is therefore composed and checked as strictly as a function's
  // rather than being left as an import-time registry only the worker can see.
  for (const m of order) {
    for (const [name, def] of Object.entries(m.jobs)) {
      const key = qualify(m.name, name)
      if (!/^[a-z][a-zA-Z0-9_]*$/.test(name)) {
        diag.add({ code: 'E_JOB_NAME', module: m.name, message: `invalid job name "${name}"` })
        continue
      }
      const queue = def.queue ?? 'default'
      if (!/^[a-z][a-z0-9_-]*$/.test(queue)) {
        diag.add({
          code: 'E_JOB_QUEUE',
          module: m.name,
          message: `job "${key}" has invalid queue "${queue}"`,
          hint: 'use lowercase letters, digits, underscore or dash',
        })
        continue
      }
      if (def.idempotent !== true) {
        diag.add({
          code: 'E_JOB_NOT_IDEMPOTENT',
          module: m.name,
          message: `job "${key}" must declare idempotent: true`,
          hint: 'workers provide at-least-once delivery, so a crashed job may run again',
        })
        continue
      }
      const maxAttempts = def.maxAttempts ?? 20
      const timeoutMs = def.timeoutMs ?? 300_000
      if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
        diag.add({ code: 'E_JOB_ATTEMPTS', module: m.name, message: `job "${key}" needs maxAttempts >= 1` })
        continue
      }
      if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
        diag.add({ code: 'E_JOB_TIMEOUT', module: m.name, message: `job "${key}" needs timeoutMs >= 1` })
        continue
      }
      for (const [input, spec] of Object.entries(def.input ?? {})) {
        const parsed = parseType(spec)
        if (!parsed.ok)
          diag.add({ code: 'E_BAD_TYPE', module: m.name, message: `${key} input ${input}: ${parsed.reason}` })
      }
      for (const effect of def.effects ?? []) {
        // Enqueue targets are validated after every job has been collected, so a
        // producer may refer to a job contributed later in dependency order.
        if (effect.startsWith('enqueue')) continue
        if (
          effect === 'storage:read' ||
          effect === 'storage:write' ||
          effect === 'storage:remove' ||
          effect === 'transport:send'
        )
          continue
        const match = /^(read|write):(.+)$/.exec(effect)
        const model = match ? manifest.models[match[2] as string] : null
        if (!match || !model) {
          diag.add({
            code: 'E_JOB_EFFECT',
            module: m.name,
            message: `job "${key}" declares unknown effect "${effect}"`,
          })
          continue
        }
        if (!canSee(m, model.owner)) {
          diag.add({
            code: 'E_JOB_EFFECT_NOT_DEPENDED',
            module: m.name,
            message: `job "${key}" touches ${match[2]} but does not depend on "${model.owner}"`,
          })
        }
      }
      manifest.jobs[key] = {
        by: m.name,
        queue,
        input: { ...(def.input ?? {}) },
        effects: [...(def.effects ?? [])],
        crossCompany: def.crossCompany === true,
        idempotent: true,
        maxAttempts,
        timeoutMs,
      }
    }
  }

  // Enqueue is a first-class effect. Moving a write to another process must not
  // let the producer bypass the operation boundary: both functions and jobs must
  // name the exact background operation they are allowed to schedule.
  for (const m of order) {
    const producers: Array<{ kind: 'function' | 'job'; key: string; effects: string[] }> = [
      ...Object.entries(m.functions).map(([name, def]) => ({
        kind: 'function' as const,
        key: qualify(m.name, name),
        effects: def.effects ?? [],
      })),
      ...Object.entries(m.jobs).map(([name, def]) => ({
        kind: 'job' as const,
        key: qualify(m.name, name),
        effects: def.effects ?? [],
      })),
    ]
    for (const producer of producers) {
      for (const effect of producer.effects) {
        if (!effect.startsWith('enqueue')) continue
        const match = /^enqueue:(.+)$/.exec(effect)
        const target = match ? manifest.jobs[match[1] as string] : null
        if (!match || !target) {
          diag.add({
            code: producer.kind === 'job' ? 'E_JOB_EFFECT' : 'E_FN_EFFECT',
            module: m.name,
            message: `${producer.kind} "${producer.key}" declares unknown effect "${effect}"`,
          })
          continue
        }
        if (!canSee(m, target.by)) {
          diag.add({
            code: producer.kind === 'job' ? 'E_JOB_EFFECT_NOT_DEPENDED' : 'E_FN_EFFECT_NOT_DEPENDED',
            module: m.name,
            message: `${producer.kind} "${producer.key}" enqueues ${match[1]} but does not depend on "${target.by}"`,
          })
        }
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

  // Joint and island props use the scalar vocabulary or a declared view-model key.
  // Views are composed first so a contract may name one regardless of module order.
  const validContractType = (spec: unknown): spec is string => {
    if (typeof spec !== 'string') return false
    if (parseType(spec).ok) return true
    const view = spec.endsWith('?') ? spec.slice(0, -1) : spec
    return manifest.views[view] !== undefined
  }
  for (const [key, joint] of Object.entries(manifest.joints)) {
    for (const [name, spec] of Object.entries(joint.props)) {
      if (!validContractType(spec)) {
        diag.add({
          code: 'E_JOINT_PROP_TYPE',
          module: joint.owner,
          message: `joint "${key}" prop "${name}" has unknown type "${spec}"`,
          hint: 'use a scalar type or a composed view-model key',
        })
      }
    }
  }

  // --- islands -------------------------------------------------------------
  for (const m of order) {
    for (const [name, def] of Object.entries(m.islands)) {
      const existing = manifest.islands[name]
      if (existing) {
        diag.add({
          code: 'E_ISLAND_DUPLICATE',
          module: m.name,
          message: `island "${name}" is already provided by "${existing.by}"`,
        })
        continue
      }
      if (!def || typeof def !== 'object' || typeof def.view !== 'function') {
        diag.add({
          code: 'E_ISLAND_SHAPE',
          module: m.name,
          message: `island "${name}" needs a view factory`,
          hint: 'declare { view: props => () => html`...`, props, client? }',
        })
        continue
      }
      for (const [prop, spec] of Object.entries(def.props ?? {})) {
        if (!validContractType(spec)) {
          diag.add({
            code: 'E_ISLAND_PROP_TYPE',
            module: m.name,
            message: `island "${name}" prop "${prop}" has unknown type "${spec}"`,
            hint: 'use a scalar type or a composed view-model key',
          })
        }
      }
      if (def.key !== undefined && !Array.isArray(def.key)) {
        diag.add({
          code: 'E_ISLAND_KEY',
          module: m.name,
          message: `island "${name}" key must be an array of required scalar prop names`,
        })
      } else if (Array.isArray(def.key)) {
        if (new Set(def.key).size !== def.key.length) {
          diag.add({ code: 'E_ISLAND_KEY', module: m.name, message: `island "${name}" repeats a key prop` })
        }
        for (const field of def.key) {
          const spec = def.props?.[field]
          const parsed = spec === undefined ? null : parseType(spec)
          if (!parsed?.ok || parsed.optional || parsed.base === 'json') {
            diag.add({
              code: 'E_ISLAND_KEY',
              module: m.name,
              message: `island "${name}" key prop "${field}" must be a declared, required scalar`,
            })
          }
        }
      }
      const client = def.client
      if (client !== undefined && (typeof client !== 'string' || client.length === 0)) {
        diag.add({
          code: 'E_ISLAND_CLIENT',
          module: m.name,
          message: `island "${name}" client must be a non-empty relative path`,
        })
      }
      if (typeof client === 'string' && client && !m.assets) {
        diag.add({
          code: 'E_ISLAND_CLIENT_WITHOUT_ASSETS',
          module: m.name,
          message: `island "${name}" declares client module "${client}" but "${m.name}" has no assets directory`,
          hint: 'declare module assets and place the prebuilt browser module inside it',
        })
      }
      if (
        typeof client === 'string' &&
        client &&
        (client.startsWith('/') ||
          client.includes('\\') ||
          client.includes('?') ||
          client.includes('#') ||
          client.split('/').includes('..'))
      ) {
        diag.add({
          code: 'E_ISLAND_CLIENT_PATH',
          module: m.name,
          message: `island "${name}" client path must stay inside the module assets directory`,
        })
      }
      manifest.islands[name] = {
        by: m.name,
        props: { ...(def.props ?? {}) },
        ...(def.key === undefined ? {} : { key: [...def.key] }),
        ...(typeof client === 'string' && client
          ? {
              client: {
                src: `/_ket/asset/${m.name}/${client}`,
                export: def.export ?? 'default',
              },
            }
          : {}),
      }
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

  // --- CMS content registry --------------------------------------------------
  // Local names are qualified exactly like models and views. A module may point
  // at another module's type or taxonomy only when it depends on that module.
  const registryRef = (m: KetModule, name: string): string =>
    name.includes('.') ? name : qualify(m.name, name)
  for (const m of order) {
    for (const [name, def] of Object.entries(m.contentTypes ?? {})) {
      const key = qualify(m.name, name)
      const fields: Record<string, string> = {}
      for (const [field, type] of Object.entries(def.fields ?? {})) {
        const parsed = parseType(type)
        if (!parsed.ok) {
          diag.add({
            code: 'E_CONTENT_FIELD_TYPE',
            module: m.name,
            message: `${key}.${field}: ${parsed.reason}`,
          })
          continue
        }
        fields[field] = type
      }
      if (def.detailPath && !def.detailPath.includes('{slug}')) {
        diag.add({
          code: 'E_CONTENT_DETAIL_PATH',
          module: m.name,
          message: `content type "${key}" detailPath must contain {slug}`,
        })
      }
      manifest.contentTypes[key] = {
        ...def,
        by: m.name,
        fields,
        taxonomies: (def.taxonomies ?? []).map((ref) => registryRef(m, ref)),
      }
    }
    for (const [name, def] of Object.entries(m.taxonomies ?? {})) {
      const key = qualify(m.name, name)
      manifest.taxonomies[key] = {
        ...def,
        by: m.name,
        hierarchical: def.hierarchical === true,
        contentTypes: def.contentTypes.map((ref) => registryRef(m, ref)),
      }
    }
  }
  for (const [key, type] of Object.entries(manifest.contentTypes)) {
    for (const taxonomy of type.taxonomies) {
      const target = manifest.taxonomies[taxonomy]
      if (!target) {
        diag.add({
          code: 'E_CONTENT_TAXONOMY_MISSING',
          module: type.by,
          message: `content type "${key}" references unknown taxonomy "${taxonomy}"`,
        })
        continue
      }
      if (!canSee(order.find((m) => m.name === type.by)!, target.by))
        diag.add({
          code: 'E_CONTENT_TAXONOMY_DEPENDENCY',
          module: type.by,
          message: `content type "${key}" reaches taxonomy "${taxonomy}" without depending on "${target.by}"`,
        })
    }
  }
  for (const [key, taxonomy] of Object.entries(manifest.taxonomies)) {
    for (const contentType of taxonomy.contentTypes) {
      const target = manifest.contentTypes[contentType]
      if (!target) {
        diag.add({
          code: 'E_TAXONOMY_CONTENT_MISSING',
          module: taxonomy.by,
          message: `taxonomy "${key}" references unknown content type "${contentType}"`,
        })
        continue
      }
      if (!canSee(order.find((m) => m.name === taxonomy.by)!, target.by))
        diag.add({
          code: 'E_TAXONOMY_CONTENT_DEPENDENCY',
          module: taxonomy.by,
          message: `taxonomy "${key}" reaches content type "${contentType}" without depending on "${target.by}"`,
        })
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
