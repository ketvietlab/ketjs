// The agent surface.
//
// Two things make an agent trustworthy against a real database: it writes through
// a declared, schema-checked surface rather than by editing code, and every
// mutation can be dry-run before it commits. Both fall out of the manifest, so
// there is no second definition to keep in sync.

import type { Manifest } from '../types.ts'

export type AgentTool = {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; format?: string; description?: string }>
    required: string[]
  }
  effects: string[]
  idempotent: boolean
  dryRunnable: boolean
  mutates: boolean
  /** Reads past the company boundary. Rare, and worth an agent knowing about. */
  crossCompany: boolean
}

const JSON_TYPE: Record<string, string> = {
  id: 'string',
  text: 'string',
  ref: 'string',
  int: 'integer',
  float: 'number',
  bool: 'boolean',
  date: 'string',
  datetime: 'string',
  json: 'object',
}

export function agentTools(manifest: Manifest): AgentTool[] {
  const tools: AgentTool[] = []
  for (const [key, fn] of Object.entries(manifest.functions)) {
    if (!fn.agent || fn.exposure === 'internal') continue
    const properties: AgentTool['inputSchema']['properties'] = {}
    const required: string[] = []
    for (const [name, spec] of Object.entries(fn.input)) {
      const optional = spec.endsWith('?')
      const base = optional ? spec.slice(0, -1) : spec
      properties[name] = {
        type: JSON_TYPE[base.startsWith('ref:') ? 'ref' : base] ?? 'string',
        ...(base === 'date' || base === 'datetime' ? { format: base === 'date' ? 'date' : 'date-time' } : {}),
      }
      if (!optional) required.push(name)
    }
    const mutates = fn.effects.some((e) => e.startsWith('write:') || e.startsWith('enqueue:'))
    tools.push({
      name: key.replace('.', '__'),
      description:
        `${key} — declared effects: ${fn.effects.join(', ') || 'none'}` +
        (fn.crossCompany ? ' · reads across companies' : ''),
      inputSchema: { type: 'object', properties, required },
      effects: fn.effects,
      idempotent: fn.idempotent,
      dryRunnable: fn.dryRun,
      mutates,
      crossCompany: fn.crossCompany,
    })
  }
  return tools
}

// The safest write surface an agent has: schema-validated composition data, not code.
export type CompositionSchema = {
  /** What a page may be composed of, and what each part accepts. */
  sections: Record<string, { by: string; title: string; settings: Record<string, string> }>
  regions: Record<string, { providedBy: string[] }>
  joints: Record<string, { owner: string; props: Record<string, string>; filledBy: string[] }>
  tokens: string[]
  contentTypes: Manifest['contentTypes']
  taxonomies: Manifest['taxonomies']
}

export function compositionSchema(manifest: Manifest): CompositionSchema {
  const joints: CompositionSchema['joints'] = {}
  for (const [key, j] of Object.entries(manifest.joints)) {
    joints[key] = {
      owner: j.owner,
      props: j.props,
      filledBy: manifest.fills.filter((f) => f.joint === key).map((f) => f.by),
    }
  }
  const sections: CompositionSchema['sections'] = {}
  for (const [name, s] of Object.entries(manifest.sections)) {
    sections[name] = { by: s.by, title: s.title ?? name, settings: s.settings ?? {} }
  }
  const regions: CompositionSchema['regions'] = {}
  for (const [name, by] of Object.entries(manifest.regions.provided)) regions[name] = { providedBy: by }
  return {
    sections,
    regions,
    joints,
    tokens: Object.keys(manifest.tokens),
    contentTypes: manifest.contentTypes,
    taxonomies: manifest.taxonomies,
  }
}

// What an agent is allowed to read to orient itself, in one call.
export function agentDescriptor(manifest: Manifest) {
  return {
    ket: manifest.ket,
    modules: manifest.modules,
    tools: agentTools(manifest),
    composition: compositionSchema(manifest),
    models: Object.fromEntries(
      Object.entries(manifest.models).map(([k, m]) => [
        k,
        Object.fromEntries(
          Object.entries(m.fields)
            // A sensitive field is withheld rather than annotated. The descriptor is
            // the agent's map of what it may do, and a value it must never write does
            // not belong on that map; an insert that omits one fails loudly at
            // validation, which is the right way to find out.
            .filter(([, d]) => !d.sensitive)
            .map(([f, d]) => [
              f,
              `${d.base}${d.optional ? '?' : ''} (by ${d.by})${d.personal ? ' [personal]' : ''}`,
            ]),
        ),
      ]),
    ),
    views: manifest.views,
  }
}
