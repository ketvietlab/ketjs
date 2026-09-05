import type { Row } from '@ketvietlab/ketjs'

/**
 * What a submission is, after the answers are gone.
 *
 * The row stays. Deleting it would take the consent record with it — the one
 * thing that says this person was asked and agreed — and would free the dedupe
 * key, so a client replaying a months-old request would be accepted a second
 * time as new. What the visitor is owed is that their answers stop existing,
 * not that the fact they wrote to us is forgotten.
 */
export const PURGED_STATUS = 'purged'

/** The largest retention window we will accept, so a typo cannot mean "never". */
export const MAX_RETENTION_DAYS = 3_650

/** One pass erases at most this many rows, so a first run cannot stall a worker. */
export const PURGE_BATCH = 500

/** An export is a file someone downloads, not a query — it has to end. */
export const MAX_EXPORT_ROWS = 5_000

const DAY_MS = 24 * 60 * 60 * 1000

export type FormFieldName = string

/** The field names a form declares, in declaration order. */
export const schemaFieldNames = (schema: unknown): FormFieldName[] => {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return []
  const fields = (schema as { fields?: unknown }).fields
  if (!Array.isArray(fields)) return []
  return fields
    .map((field) => (field && typeof field === 'object' ? (field as { name?: unknown }).name : undefined))
    .filter((name): name is string => typeof name === 'string')
}

/**
 * The answers a list may show, as names.
 *
 * Unknown names are dropped rather than rejected: a field removed from the
 * schema leaves its name behind in this list, and the right reading of a name
 * with no field is "show nothing", not "fail the screen".
 */
export const summaryFieldsOf = (form: Row | null | undefined): FormFieldName[] => {
  const declared = form?.summaryFields
  const raw = typeof declared === 'string' ? safeParse(declared) : declared
  if (!Array.isArray(raw)) return []
  const known = new Set(schemaFieldNames(form?.schema))
  const seen = new Set<string>()
  const names: FormFieldName[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string' || !known.has(entry) || seen.has(entry)) continue
    seen.add(entry)
    names.push(entry)
  }
  return names
}

const safeParse = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const payloadOf = (payload: unknown): Record<string, unknown> => {
  const raw = typeof payload === 'string' ? safeParse(payload) : payload
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
}

/**
 * The part of a submission a worklist is allowed to render.
 *
 * Empty by default, and empty is a usable answer: a queue that shows when
 * something arrived and whether it has been dealt with is workable without
 * showing what anyone wrote. Opening one record is a separate, recorded act.
 */
export const summaryOf = (payload: unknown, allowed: FormFieldName[]): Record<string, unknown> => {
  if (!allowed.length) return {}
  const value = payloadOf(payload)
  const summary: Record<string, unknown> = {}
  for (const name of allowed) if (name in value) summary[name] = value[name]
  return summary
}

/** The answers an export may carry, narrowed to what the form actually asks. */
export const exportRow = (payload: unknown, fields: FormFieldName[]): Record<string, unknown> => {
  const value = payloadOf(payload)
  const row: Record<string, unknown> = {}
  for (const name of fields) row[name] = name in value ? value[name] : null
  return row
}

/** Rows created at or before this instant are past their retention window. */
export const retentionCutoff = (retentionDays: unknown, now: Date): Date | null => {
  const days = Number(retentionDays)
  if (!Number.isInteger(days) || days < 1 || days > MAX_RETENTION_DAYS) return null
  return new Date(now.getTime() - days * DAY_MS)
}

/** A hold is a reason someone wrote down; an empty one is not a hold. */
export const isHeld = (row: Row | null | undefined): boolean =>
  typeof row?.holdReason === 'string' && row.holdReason.trim().length > 0

export const isPurged = (row: Row | null | undefined): boolean => row?.purgedAt != null

/**
 * Everything on a submission that describes the person who sent it.
 *
 * `fingerprint` and `source` go with the answers: one is derived from an
 * address and a browser, the other is the page they came from, which routinely
 * carries a query string. `dedupeKey` stays — it is a hash of a key the client
 * chose, and it is what stops a replay being accepted twice.
 */
export const purgePatch = (now: Date): Record<string, unknown> => ({
  payload: {},
  source: null,
  fingerprint: null,
  status: PURGED_STATUS,
  purgedAt: now.toISOString(),
})

export type Parsed<T> = { ok: true; value: T } | { ok: false }

/**
 * What an editor may declare as safe to preview.
 *
 * A malformed list is refused rather than coerced: the alternative is an
 * editor who mistyped a field name being shown an empty preview column and
 * concluding the feature is broken, when what happened is that we silently
 * dropped their input.
 */
export const parseSummaryFields = (value: unknown): Parsed<string[] | null> => {
  if (value == null) return { ok: true, value: null }
  if (!Array.isArray(value)) return { ok: false }
  const names: string[] = []
  for (const entry of value) {
    if (typeof entry !== 'string' || !entry.trim()) return { ok: false }
    if (!names.includes(entry)) names.push(entry)
  }
  return { ok: true, value: names.length ? names : null }
}

/** A retention window is a whole number of days inside a decade, or nothing. */
export const parseRetentionDays = (value: unknown): Parsed<number | null> => {
  if (value == null) return { ok: true, value: null }
  const days = Number(value)
  if (!Number.isInteger(days) || days < 1 || days > MAX_RETENTION_DAYS) return { ok: false }
  return { ok: true, value: days }
}
