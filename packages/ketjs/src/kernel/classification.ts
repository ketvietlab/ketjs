// What the deployment's data actually is, read off the manifest.
//
// An obligation to export or erase somebody's data cannot be met against a schema
// nobody has classified, and neither can a question as simple as "which columns
// would leak if this table went out the door". Both are answered here, from the
// same composed manifest the migration and the agent descriptor read, so the answer
// cannot drift from what the deployment actually runs.
//
// The inventory deliberately reports what is *not* classified as well. An inventory
// of only the fields somebody remembered to tag is the one thing worse than no
// inventory: it looks complete.

import type { Manifest } from '../types.ts'

export type ClassifiedField = {
  model: string
  field: string
  /** The module that contributed the field, so an owner can be found. */
  by: string
  type: string
  personal: boolean
  sensitive: boolean
}

export type ClassificationInventory = {
  personal: ClassifiedField[]
  sensitive: ClassifiedField[]
  /** Models where no field carries either flag — the work still to do, not a clean bill. */
  unclassified: string[]
  counts: { models: number; fields: number; personal: number; sensitive: number; unclassified: number }
}

const typeOf = (field: { base: string; optional: boolean; target?: string }): string =>
  `${field.base === 'ref' ? `ref:${field.target}` : field.base}${field.optional ? '?' : ''}`

export function classificationInventory(manifest: Manifest): ClassificationInventory {
  const personal: ClassifiedField[] = []
  const sensitive: ClassifiedField[] = []
  const unclassified: string[] = []
  let fields = 0

  for (const [model, def] of Object.entries(manifest.models).sort(([a], [b]) => a.localeCompare(b))) {
    let classified = false
    for (const [field, spec] of Object.entries(def.fields).sort(([a], [b]) => a.localeCompare(b))) {
      fields += 1
      if (!spec.personal && !spec.sensitive) continue
      classified = true
      const entry: ClassifiedField = {
        model,
        field,
        by: spec.by,
        type: typeOf(spec),
        personal: Boolean(spec.personal),
        sensitive: Boolean(spec.sensitive),
      }
      if (entry.personal) personal.push(entry)
      if (entry.sensitive) sensitive.push(entry)
    }
    if (!classified) unclassified.push(model)
  }

  return {
    personal,
    sensitive,
    unclassified,
    counts: {
      models: Object.keys(manifest.models).length,
      fields,
      personal: personal.length,
      sensitive: sensitive.length,
      unclassified: unclassified.length,
    },
  }
}

const row = (entry: ClassifiedField, width: number): string =>
  `  ${`${entry.model}.${entry.field}`.padEnd(width)}  ${entry.type.padEnd(18)} by ${entry.by}`

export function formatClassification(inventory: ClassificationInventory): string {
  const all = [...inventory.personal, ...inventory.sensitive]
  const width = Math.max(24, ...all.map((entry) => `${entry.model}.${entry.field}`.length))
  const lines: string[] = []

  lines.push(`personal data (${inventory.counts.personal} field(s))`)
  lines.push(...(inventory.personal.length ? inventory.personal.map((e) => row(e, width)) : ['  none']))
  lines.push('')
  lines.push(`sensitive (${inventory.counts.sensitive} field(s)) — never leaves the system`)
  lines.push(...(inventory.sensitive.length ? inventory.sensitive.map((e) => row(e, width)) : ['  none']))
  lines.push('')
  lines.push(
    `${inventory.counts.unclassified} of ${inventory.counts.models} model(s) classify no field at all`,
  )
  // Named rather than counted, because the list is the work queue.
  if (inventory.unclassified.length) {
    for (const model of inventory.unclassified) lines.push(`  ${model}`)
  }
  return lines.join('\n')
}
