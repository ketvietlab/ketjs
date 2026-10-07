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
//
// A record kind may instead own a full page (`defineRecordPageIsland`): the same
// definition renders client-side inside a RecordPage at its own path,
//
//   /admin/<collection>/<id>?tab=<tab>      (and /admin/<collection>/new)
//
// and the server renders only the page's loading state.

import type { IslandDefinition, JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Breadcrumbs, LoadingState, RecordPage } from '@ketvietlab/design-system'

export const HOOKS = ['record-modal-host'] as const

/** Query parameter naming the open record. Shared by every record modal. */
export const RECORD_PARAM = 'record'
/** Query parameter naming the open tab of the record modal. */
export const RECORD_TAB_PARAM = 'tab'
/** Optional entry dialog, for a pending action such as a kanban move. */
export const RECORD_DIALOG_PARAM = 'recordDialog'
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
  dialog?: string | null
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
  if (target.dialog) next.searchParams.set(RECORD_DIALOG_PARAM, target.dialog)
  else next.searchParams.delete(RECORD_DIALOG_PARAM)
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
  next.searchParams.delete(RECORD_DIALOG_PARAM)
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
  return {
    kind,
    id: raw.slice(split + 1),
    tab: parsed.searchParams.get(RECORD_TAB_PARAM),
    ...(parsed.searchParams.get(RECORD_DIALOG_PARAM)
      ? { dialog: parsed.searchParams.get(RECORD_DIALOG_PARAM) }
      : {}),
  }
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

// ── Record pages ──────────────────────────────────────────────────────────────
//
// An administrative profile (a person, a role, an assignment rule) is read as a
// page of its own rather than over its collection: one bounded column, no tabs,
// the questions an administrator asks answered top to bottom. The same runtime
// drives it, so its dialogs and commands are the modal's.

/** One step of the way back from a record page to its collection. */
export type RecordPageTrailItem = { label: string; href?: string | null }

/** What the route hands a record page island. */
export type RecordPageIslandProps = {
  id: string
  /** The record's name, shown while the browser takes over. */
  title: string
  /** Translated text of the loading state. */
  loadingLabel?: string
  /** Client-read page loading label and navigation context. */
  loading?: string
  back?: string
  tab?: string
  width?: string
  /** From the collection to the record itself. */
  trail?: readonly RecordPageTrailItem[] | null
  /** Accessible name of the trail. */
  trailLabel?: string | null
  /**
   * The record context as the route read it, so the browser renders it without a
   * second request. Null reads it in the browser.
   */
  envelope?: unknown
}

/** The location strip above a record page, the same markup as other pages'. */
export const recordPageTrail = (
  trail: readonly RecordPageTrailItem[] | null | undefined,
  label: string,
): TemplateResult | undefined =>
  trail?.length ? (
    <div data-ui="page-context">
      <div data-ui="page-context-trail">
        {Breadcrumbs({
          label,
          items: trail.map((item, index) => ({
            id: `${index}:${item.label}`,
            label: item.label,
            ...(item.href ? { href: item.href } : {}),
          })),
        })}
      </div>
    </div>
  ) : undefined

/** A record page's frame around any body; the runtime marks it as its record layer. */
export const recordPageFrame = (o: {
  title: string
  trail?: readonly RecordPageTrailItem[] | null
  trailLabel?: string | null
  meta?: JSXChild
  status?: JSXChild
  actions?: JSXChild
  body: JSXChild
}): TemplateResult => (
  <div data-record-layer="page">
    {RecordPage({
      title: o.title,
      variant: 'operational',
      width: 'default',
      context: recordPageTrail(o.trail, o.trailLabel ?? o.title),
      meta: o.meta,
      status: o.status,
      actions: o.actions,
      body: o.body,
    })}
  </div>
)

/**
 * What the server writes and the browser adopts before it renders the record:
 * the page frame, titled, with the loading state for a body. Both sides render
 * exactly this, so hydration never depends on clocks, zones or locale data.
 */
export const recordPageShell = (props: RecordPageIslandProps): TemplateResult =>
  recordPageFrame({
    title: props.title,
    trail: props.trail,
    trailLabel: props.trailLabel,
    body: LoadingState({ label: props.loadingLabel ?? props.loading ?? props.title }),
  })

/** Loading frame for a page whose context is read entirely in the client. */
export const recordPageLoading = (props: RecordPageIslandProps): TemplateResult =>
  RecordPage({
    variant: 'operational',
    width: props.width === 'wide' ? 'wide' : 'default',
    title: props.title,
    body: LoadingState({ label: props.loading ?? props.loadingLabel ?? props.title }),
  })

/**
 * The island declaration of a record page. The route places it through a joint
 * whose props match `RecordPageIslandProps`, after reading the record with the same
 * permission-checked context the browser would use.
 */
export const defineRecordPageIsland = (options: {
  kind: string
  /** Browser module, relative to the declaring module's assets directory. */
  client: string
  export: string
}): IslandDefinition<RecordPageIslandProps> => {
  if (!isRecordKind(options.kind)) throw new TypeError(`invalid record kind "${options.kind}"`)
  return {
    props: {
      id: 'id',
      title: 'text',
      loadingLabel: 'text?',
      loading: 'text?',
      back: 'text?',
      tab: 'text?',
      width: 'text?',
      trail: 'json?',
      trailLabel: 'text?',
      envelope: 'json?',
    },
    key: ['id'],
    client: options.client,
    export: options.export,
    view: (props) => ({ view: () => (props.back ? recordPageLoading(props) : recordPageShell(props)) }),
  }
}
