// Small pieces every Flow screen reaches for: the empty state, the badges,
// and the two formatters. Here rather than repeated, and here rather than in
// the kit, because each one carries a Flow message key.
import type { Translator } from '@ketvietlab/ketjs'
import type { TemplateResult } from '@ketvietlab/ketjs-view'
import { badge, emptyState } from '../../../ui/index.ts'

/** A row as a screen sees it: whatever the domain sent, read by key. */
export type AnyRow = Record<string, unknown>

export const empty = (_: Translator) =>
  emptyState(_('flow_backend.empty.title'), _('flow_backend.empty.hint'))

export const priorityLabel = (_: Translator, value: unknown): string => {
  const key = `flow.priority.${String(value ?? 'normal')}`
  return _.resolves(key) ? _(key) : String(value ?? '—')
}
export const priorityBadge = (_: Translator, value: unknown): TemplateResult => {
  const raw = String(value ?? 'normal')
  return badge(
    priorityLabel(_, value),
    raw === 'urgent' ? 'danger' : raw === 'high' ? 'warning' : 'neutral',
    raw,
  )
}
export const sprintStateBadge = (_: Translator, value: unknown): TemplateResult => {
  const raw = String(value ?? 'planned')
  const key = `flow.sprint.${raw}`
  return badge(
    _.resolves(key) ? _(key) : raw,
    raw === 'active' ? 'positive' : raw === 'closed' ? 'neutral' : 'warning',
    raw,
  )
}
/**
 * A timeline entry's words.
 *
 * A person's comment is stored as the text they typed; an entry the system
 * wrote stores a message key instead, so it can be read in whichever language
 * the reader chose. Rendering it raw printed `flow.timeline.assigned` on the
 * screen — the same trap crm_backend's `entryBody` already answers.
 */
export const entryBody = (_: Translator, row: AnyRow): string => {
  const body = String(row.body ?? '')
  if (body && _.resolves(body)) return _(body)
  return body || '\u2014'
}

export const when = (value: unknown): string => {
  const raw = String(value ?? '')
  if (!raw) return '—'
  return raw.length > 10 ? raw.slice(0, 16).replace('T', ' ') : raw
}
