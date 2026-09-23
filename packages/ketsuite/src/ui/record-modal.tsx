// The record-modal contract, server half.
//
// A collection row opens its record in a modal island (design-system contract
// "Collections open records in a modal"). The server's part is small on purpose:
// it writes links that name a record, and it renders a closed host. Everything a
// reader does inside the modal — opening, switching tabs, submitting, closing —
// happens in the browser, through the runtime in `client/record-modal.tsx`.
//
// One URL shape for every module keeps deep links, the back button and the list's
// own query state working the same way everywhere:
//
//   /admin/<collection>?<list state>&record=<kind>:<id>&tab=<tab>

import type { IslandDefinition, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = ['record-modal-host'] as const

/** Query parameter naming the open record. Shared by every record modal. */
export const RECORD_PARAM = 'record'
/** Query parameter naming the open tab of the record modal. */
export const RECORD_TAB_PARAM = 'tab'
/**
 * The id a create action names: `record=<kind>:new` opens the same modal with an
 * empty record. A kind whose ids could literally be `new` must not use this.
 */
export const RECORD_NEW_ID = 'new'

export type RecordModalTarget = {
  /** Stable record kind, `<module>.<name>`; never contains a colon. */
  kind: string
  id: string
  tab?: string | null
}

const kindPattern = /^[a-z][a-z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)+$/u

export const isRecordKind = (kind: string): boolean => kindPattern.test(kind)

/**
 * The link a row, card or create action uses to open a record.
 *
 * It keeps every other query parameter, so the collection behind the modal keeps
 * its filters and page. Without scripting it is still a real URL; the server
 * renders the collection and the island opens the record once it hydrates.
 */
export const recordModalHref = (url: URL | string, target: RecordModalTarget): string => {
  if (!isRecordKind(target.kind)) throw new TypeError(`invalid record kind "${target.kind}"`)
  const next = new URL(String(url), 'http://ket.local')
  next.searchParams.set(RECORD_PARAM, `${target.kind}:${target.id}`)
  if (target.tab) next.searchParams.set(RECORD_TAB_PARAM, target.tab)
  else next.searchParams.delete(RECORD_TAB_PARAM)
  return `${next.pathname}${next.search}`
}

/**
 * The link a collection's create action uses. It opens the record modal of that
 * kind with no record yet; the create command then switches it to the new record.
 */
export const recordModalCreateHref = (
  url: URL | string,
  target: { kind: string; tab?: string | null },
): string => recordModalHref(url, { kind: target.kind, id: RECORD_NEW_ID, tab: target.tab ?? null })

/** Whether a target asks for the create form rather than an existing record. */
export const isRecordModalCreate = (target: Pick<RecordModalTarget, 'id'> | null | undefined): boolean =>
  target?.id === RECORD_NEW_ID

/** The URL with no record open, for closing and for rendering the collection. */
export const recordModalClosedHref = (url: URL | string): string => {
  const next = new URL(String(url), 'http://ket.local')
  next.searchParams.delete(RECORD_PARAM)
  next.searchParams.delete(RECORD_TAB_PARAM)
  return `${next.pathname}${next.search}`
}

/** Which record a URL asks for, or null. The id may itself contain colons. */
export const readRecordModalTarget = (url: URL | string): RecordModalTarget | null => {
  const parsed = new URL(String(url), 'http://ket.local')
  const raw = parsed.searchParams.get(RECORD_PARAM) ?? ''
  const split = raw.indexOf(':')
  if (split <= 0 || split === raw.length - 1) return null
  const kind = raw.slice(0, split)
  if (!isRecordKind(kind)) return null
  return { kind, id: raw.slice(split + 1), tab: parsed.searchParams.get(RECORD_TAB_PARAM) }
}

/** The closed host. Identical on the server and in the first client render. */
export const recordModalHost = (kind: string): TemplateResult => (
  <span data-ui="record-modal-host" data-record-kind={kind} hidden />
)

/**
 * The island declaration a module places through `backend:runtime`.
 *
 * Props are empty: the host must not carry record data into a page that does not
 * show a record, and the record it opens is read through a permission-checked
 * function once a reader asks for it.
 */
export const defineRecordModalIsland = (options: {
  kind: string
  /** Browser module, relative to the declaring module's assets directory. */
  client: string
  export: string
}): IslandDefinition => {
  if (!isRecordKind(options.kind)) throw new TypeError(`invalid record kind "${options.kind}"`)
  return {
    props: {},
    client: options.client,
    export: options.export,
    view: () => ({ view: () => recordModalHost(options.kind) }),
  }
}
