// Validating a page layout against the sections that exist.
//
// This is the payoff for making sections data rather than code: what an agent
// writes can be checked before it is stored, against the same declaration the
// theme renders from. A bad section type, a missing required setting, or a setting
// of the wrong shape are all caught here — as a list, not as an exception, because
// a list is what an agent can act on.

import { isDateText, parseType } from './types.ts'
import type { Manifest } from '../types.ts'

export type Placement = { type: string; settings?: Record<string, unknown> }
export type LayoutError = { at: number; type: string; field?: string; message: string }

const JS_OF: Record<string, string> = {
  id: 'string',
  text: 'string',
  ref: 'string',
  int: 'number',
  float: 'number',
  bool: 'boolean',
  date: 'string',
  datetime: 'string',
  json: 'object',
}

export function validateLayout(manifest: Manifest, layout: unknown): { ok: boolean; errors: LayoutError[] } {
  const errors: LayoutError[] = []
  if (!Array.isArray(layout)) {
    return {
      ok: false,
      errors: [{ at: -1, type: '(layout)', message: 'a layout must be an array of section placements' }],
    }
  }

  layout.forEach((raw, at) => {
    const placement = raw as Placement
    if (!placement || typeof placement.type !== 'string') {
      errors.push({ at, type: '(unknown)', message: 'each placement needs a "type"' })
      return
    }
    const section = manifest.sections[placement.type]
    if (!section) {
      errors.push({
        at,
        type: placement.type,
        message: `no installed module provides this section (available: ${Object.keys(manifest.sections).join(', ') || 'none'})`,
      })
      return
    }
    const schema = section.settings ?? {}
    const settings = placement.settings ?? {}

    for (const [field, spec] of Object.entries(schema)) {
      const t = parseType(spec)
      const value = settings[field]
      if (value == null) {
        if (t.ok && !t.optional)
          errors.push({ at, type: placement.type, field, message: `is required (${spec})` })
        continue
      }
      if (!t.ok) continue
      const want = JS_OF[t.base]
      if (want && typeof value !== want) {
        errors.push({ at, type: placement.type, field, message: `expects ${t.base}, got ${typeof value}` })
      } else if (t.base === 'date' && !isDateText(value)) {
        errors.push({ at, type: placement.type, field, message: 'expects date in YYYY-MM-DD format' })
      }
    }
    for (const field of Object.keys(settings)) {
      if (!(field in schema)) {
        errors.push({
          at,
          type: placement.type,
          field,
          message: `is not a setting of this section (accepted: ${Object.keys(schema).join(', ') || 'none'})`,
        })
      }
    }
  })

  return { ok: errors.length === 0, errors }
}

export const formatLayoutErrors = (errors: LayoutError[]): string =>
  errors.map((e) => `  [${e.at}] ${e.type}${e.field ? '.' + e.field : ''} ${e.message}`).join('\n')
