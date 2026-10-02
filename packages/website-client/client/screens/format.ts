// Display helpers shared by core screens. Pure: identical output on server and client.
import type { Tone, Translate } from '../types.ts'

export type StatusView = { label: string; tone: Tone }

const time = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Asia/Ho_Chi_Minh',
})

const date = new Intl.DateTimeFormat('vi-VN', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  timeZone: 'Asia/Ho_Chi_Minh',
})

/** DataTable and DescriptionList render nothing for a missing value; a dash keeps the column readable. */
export const EMPTY_VALUE = '—'
export const formatTime = (iso: string | number | Date | null | undefined) =>
  iso ? time.format(new Date(iso)) : EMPTY_VALUE
export const formatDate = (iso: string | number | Date | null | undefined) =>
  iso ? date.format(new Date(iso)) : EMPTY_VALUE

const ENTRY_TONES: Record<string, Tone> = {
  scheduled: 'info',
  published: 'positive',
  changed: 'warning',
  draft: 'neutral',
  trash: 'danger',
}
export const entryStatus = (tr: Translate, state: string): StatusView => ({
  label: tr(`website.entry.state.${state}`),
  tone: ENTRY_TONES[state] ?? 'neutral',
})

const PUBLICATION_TONES: Record<string, Tone> = {
  active: 'positive',
  prepared: 'info',
  stale: 'warning',
  superseded: 'neutral',
  blocked: 'danger',
}
export const publicationStatus = (tr: Translate, state: string): StatusView => ({
  label: tr(`website.publication.state.${state}`),
  tone: PUBLICATION_TONES[state] ?? 'neutral',
})

const SUBMISSION_TONES: Record<string, Tone> = { new: 'info', read: 'neutral', held: 'warning' }
export const submissionStatus = (tr: Translate, state: string): StatusView => ({
  label: tr(`website.submission.state.${state}`),
  tone: SUBMISSION_TONES[state] ?? 'neutral',
})

/**
 * Where a routed submission stands in the module it was handed to: waiting, failed, or the
 * receiver's own word for the stage while its record is open, and the outcome once it closes.
 */
export const destinationStatus = (
  tr: Translate,
  state: string,
  outcome?: string | null,
  stage?: string | null,
): StatusView =>
  state === 'delivered'
    ? outcome && outcome !== 'open'
      ? {
          label: tr(`website.destination.outcome.${outcome}`),
          tone: outcome === 'won' ? 'positive' : 'neutral',
        }
      : { label: stage || tr('website.destination.delivered'), tone: 'info' }
    : { label: tr(`website.destination.${state}`), tone: state === 'failed' ? 'danger' : 'neutral' }

/** Client-minted identity for a create: the retry of one intent must reach the server as one request. */
export const newId = (prefix: string) =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`}`

export function localDateTime(iso: string | null | undefined, timeZone = 'Asia/Ho_Chi_Minh'): string {
  if (!iso) return ''
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(iso))
      .map((p) => [p.type, p.value]),
  )
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}
export function zonedDateTime(local: string, timeZone = 'Asia/Ho_Chi_Minh'): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null
  const desired = Date.parse(`${local}:00Z`)
  if (!Number.isFinite(desired)) return null
  let utc = desired
  for (let i = 0; i < 3; i++)
    utc += desired - Date.parse(`${localDateTime(new Date(utc).toISOString(), timeZone)}:00Z`)
  return localDateTime(new Date(utc).toISOString(), timeZone) === local ? new Date(utc).toISOString() : null
}
