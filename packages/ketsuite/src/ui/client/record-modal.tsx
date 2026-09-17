// The record-modal contract, browser half.
//
// A module describes a record — how to read it, its tabs, dialogs and commands —
// and this runtime owns everything that must behave the same in every module:
// opening from a link or deep link, history, focus, Escape, the inert background,
// loading and failure states, submitting through `/_ket/fn`, showing a refusal on
// the field that caused it without losing what was typed, the unsaved-input guard,
// and telling the collection behind the modal that its records changed.
//
// Views are render-pure: they read the context and return design-system markup.
// They never fetch, never touch history and never query the document.

import { signal } from '@ketvietlab/ketjs-view'
import type { IslandController, JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { Button, LoadingState, ModalSheet, Notice, TabbedView } from '@ketvietlab/design-system'
import {
  RECORD_NEW_ID,
  RECORD_PARAM,
  RECORD_TAB_PARAM,
  readRecordModalTarget,
  recordModalClosedHref,
  recordModalCreateHref,
  recordModalHost,
  recordModalHref,
} from '../record-modal.tsx'

// ── Function calls ────────────────────────────────────────────────────────────

export type RecordIssue = {
  field: string | null
  code: string
  message: string | null
  params: Record<string, unknown>
}

export type RecordCallResult<Value = unknown> =
  | { ok: true; value: Value }
  | { ok: false; issues: RecordIssue[]; message: string | null; status: number }

const issuesOf = (source: unknown): RecordIssue[] => {
  const holder = (source ?? {}) as { errors?: unknown; issues?: unknown }
  const list = Array.isArray(holder.errors)
    ? holder.errors
    : Array.isArray(holder.issues)
      ? holder.issues
      : []
  return list.map((raw) => {
    const item = (raw ?? {}) as Record<string, unknown>
    const path = Array.isArray(item.path) ? item.path.join('.') : null
    return {
      field: typeof item.field === 'string' ? item.field : path,
      code: String(item.code ?? 'invalid'),
      message: typeof item.message === 'string' ? item.message : null,
      params: (item.params && typeof item.params === 'object' ? item.params : {}) as Record<string, unknown>,
    }
  })
}

/**
 * Call a server function as the signed-in viewer.
 *
 * A domain refusal (`{ ok: false, errors }` inside the value) and a transport or
 * permission refusal (`ok: false` on the envelope) come back in one shape, so a
 * view never has to know which layer said no.
 */
export const callRecordFunction = async <Value = unknown>(
  name: string,
  input: Record<string, unknown>,
  options: { signal?: AbortSignal; idempotencyKey?: string } = {},
): Promise<RecordCallResult<Value>> => {
  const response = await fetch(`/_ket/fn/${encodeURIComponent(name)}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      ...(options.idempotencyKey ? { 'idempotency-key': options.idempotencyKey } : {}),
    },
    body: JSON.stringify(input),
    signal: options.signal,
  })
  const payload = (await response.json().catch(() => ({}))) as {
    ok?: boolean
    value?: unknown
    error?: { message?: string; issues?: unknown }
    message?: string
  }
  if (!response.ok || payload.ok === false)
    return {
      ok: false,
      issues: issuesOf(payload.error ?? payload),
      message: payload.error?.message ?? payload.message ?? null,
      status: response.status,
    }
  const value = payload.value as { ok?: boolean } | undefined
  if (value && typeof value === 'object' && value.ok === false)
    return { ok: false, issues: issuesOf(value), message: null, status: response.status }
  return { ok: true, value: payload.value as Value }
}

// ── Definition ────────────────────────────────────────────────────────────────

/** What every record context read must return next to its data. */
export type RecordContextEnvelope<Data> = {
  data: Data
  /** Translated strings this record's views use, including `recordModal.*` runtime labels. */
  messages: Record<string, string>
}

export type RecordModalContext<Data> = {
  kind: string
  id: string
  /** The modal was opened by a create action (`record=<kind>:new`); there is no record yet. */
  creating: boolean
  tab: string
  data: Data
  /** Translate a key the context shipped, interpolating `{name}` params. */
  t: (key: string, params?: Record<string, unknown>) => string
  /** The refusal for one field of the last submit, translated. */
  fieldError: (name: string) => string | null
  /** What was typed into a field before a refused submit, or the fallback. */
  draft: (name: string, fallback?: string) => string
  /** Whether a checkbox/radio value was selected before the view re-rendered. */
  draftChecked: (name: string, value?: string, fallback?: boolean) => boolean
  /**
   * What a preview command answered, for the view to render. Null until that
   * command has run in this layer, and again as soon as anything moves.
   */
  outcome: <T>(command: string) => T | null
  /**
   * A submit has been in flight long enough to be worth saying so. A command the
   * server answers at once never sets it, so a button bound to it does not flash
   * its spinner; the runtime stops a second submit either way.
   */
  busy: boolean
  dialog: { name: string; params: Record<string, string> } | null
  href: (tab: string) => string
  /** View-local state, set by `data-record-state` controls (click, or change for inputs). */
  state: (key: string, fallback?: string) => string
}

/** Attachments a command uploaded before its function ran, by form field. */
export type RecordUploads = Record<string, { id: string; name: string | null }>

export type RecordModalCommand<Data> = {
  fn: string
  /** Map the submitted form to the function's input. */
  input: (
    form: FormData,
    context: RecordModalContext<Data>,
    uploads: RecordUploads,
  ) => Record<string, unknown>
  /**
   * File fields stored through `/files` before the function runs, each mapped to
   * the attachment's metadata (`resModel`, `resId`, `resField`, `public`). The
   * stored attachment ids reach `input` as its third argument.
   */
  upload?: Record<string, (form: FormData, context: RecordModalContext<Data>) => Record<string, string>>
  /**
   * What happens after success. Defaults to `close`. `reload` reads the record
   * again behind a loading state and closes a dialog; `refresh` reads it again in
   * place, keeping the tab, the open dialog and any islands mounted in them.
   * `open` is for a create command: the modal switches to the record it created
   * (the id from `created`, else the function value's `id`) on the tab named by
   * `openTab`, replacing the `:new` history entry.
   */
  after?: 'close' | 'reload' | 'refresh' | 'stay' | 'open' | { tab: string } | { dialog: string | null }
  /**
   * The command asks what would happen instead of making it happen: its function
   * writes nothing, so the record is not re-read, the collection is not told and
   * what was typed stays on screen. The answer reaches the view through
   * `context.outcome`, beside the very form that asked for it, so the person can
   * read the consequence and then submit the command that commits it. `after` is
   * not consulted — a preview always stays in its layer.
   */
  preview?: boolean
  /** The id of the record a create command made, read from the function's value. */
  created?: (value: unknown) => string | null
  /** Tab to open on the created record when `after` is `open`. */
  openTab?: string
}

export type RecordModalTab<Data> = {
  id: string
  label: (context: RecordModalContext<Data>) => string
  visible?: (context: RecordModalContext<Data>) => boolean
  view: (context: RecordModalContext<Data>) => JSXChild
}

export type RecordModalDialog<Data> = {
  title: (context: RecordModalContext<Data>) => string
  size?: 'default' | 'large'
  view: (context: RecordModalContext<Data>) => JSXChild
}

export type RecordModalDefinition<Data> = {
  kind: string
  size?: 'default' | 'large'
  /**
   * A permission-checked read returning `{ data, messages }`. For a create action
   * the default input is `{}` (no id): the read returns the empty record's defaults,
   * the choices its form needs and the viewer's permissions.
   */
  context: { fn: string; input?: (id: string, creating: boolean) => Record<string, unknown> }
  title: (context: RecordModalContext<Data>) => string
  description?: (context: RecordModalContext<Data>) => string | null
  /**
   * What state this record is in, beside the modal's title: a badge, not a
   * strip. It stays put while the body scrolls, and a reader looking at the
   * title learns the state without reading down into the form.
   */
  status?: (context: RecordModalContext<Data>) => JSXChild
  /** A strip above the body — a customer, a summary — for what a badge cannot hold. */
  header?: (context: RecordModalContext<Data>) => JSXChild
  tabs?: readonly RecordModalTab<Data>[]
  /** The body of a record without tabs. */
  body?: (context: RecordModalContext<Data>) => JSXChild
  dialogs?: Record<string, RecordModalDialog<Data>>
  commands?: Record<string, RecordModalCommand<Data>>
  /**
   * Runtime labels (`recordModal.*`) in the page's language, available before the
   * record's context has loaded. Without them the loading state has only the
   * built-in English defaults, because `messages` arrive with the context.
   */
  labels?: Record<string, string> | (() => Record<string, string>)
  /**
   * Keep read contexts in memory so reopening a record shows at once and is read
   * again quietly (stale-while-revalidate). On by default; set `false` for a kind
   * whose context must never be shown before a fresh read.
   */
  cache?: boolean
}

/** How many record contexts one island keeps for instant reopening. */
export const RECORD_MODAL_CACHE_SIZE = 30

/**
 * English defaults for every label the runtime itself shows. A module passes its
 * own language through `labels`; these only guarantee a reader never sees a key.
 */
export const RECORD_MODAL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'recordModal.close': 'Close',
  'recordModal.loading': 'Loading…',
  'recordModal.loadFailed': 'The record could not be read.',
  'recordModal.notFound': 'The record is gone or you cannot see it.',
  'recordModal.retry': 'Retry',
  'recordModal.errorTitle': 'Not saved',
  'recordModal.saveFailed': 'That did not work. Try again.',
  'recordModal.savedTitle': 'Saved',
  'recordModal.saved': 'The change is in.',
  'recordModal.unsaved': 'Discard what you typed?',
  'recordModal.uploadFailed': 'The file could not be uploaded. Try again.',
})

/**
 * The text for a key: the loaded context's messages, then the messages of the
 * last record this modal opened, then the module's labels, then the defaults.
 * Only an unknown key falls through to itself.
 */
export const resolveRecordModalLabel = (
  key: string,
  sources: {
    messages?: Record<string, string> | null
    previous?: Record<string, string> | null
    labels?: Record<string, string> | null
  },
): string =>
  sources.messages?.[key] ??
  sources.previous?.[key] ??
  sources.labels?.[key] ??
  RECORD_MODAL_LABELS[key] ??
  key

/** Field a form (or its submitter) uses to name the command it runs. */
export const RECORD_COMMAND_FIELD = '__command'
/** Field a link or button uses to open a dialog of the same record. */
export const RECORD_DIALOG_ATTRIBUTE = 'data-record-dialog'

// ── Runtime helpers ───────────────────────────────────────────────────────────

const interpolate = (text: string, params: Record<string, unknown> = {}): string =>
  text.replace(/\{([a-zA-Z0-9_]+)\}/gu, (whole, name: string) =>
    name in params ? String(params[name] ?? '') : whole,
  )

const focusable = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

const focusablesIn = (element: HTMLElement): HTMLElement[] =>
  [...element.querySelectorAll<HTMLElement>(focusable)].filter(
    (item) =>
      !item.hidden &&
      item.getAttribute('aria-hidden') !== 'true' &&
      !item.matches('[data-ui="modal-backdrop"]'),
  )

/** Whether anything in a layer was typed into since it rendered. Same rule as route modals. */
export const recordLayerHasDraft = (layer: HTMLElement): boolean => {
  for (const field of layer.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])')) {
    if (field.disabled) continue
    if (field.type === 'checkbox' || field.type === 'radio') {
      if (field.checked !== field.defaultChecked) return true
    } else if (field.value !== field.defaultValue) return true
  }
  for (const area of layer.querySelectorAll<HTMLTextAreaElement>('textarea'))
    if (!area.disabled && area.value !== area.defaultValue) return true
  for (const select of layer.querySelectorAll<HTMLSelectElement>('select')) {
    if (select.disabled) continue
    for (const option of select.options) if (option.selected !== option.defaultSelected) return true
  }
  return false
}

/** Make everything outside `keep` inert, walking up to the body; returns the undo. */
const inertOutside = (keep: HTMLElement): (() => void) => {
  const changed: Array<{ element: HTMLElement; inert: boolean }> = []
  let node: HTMLElement | null = keep
  while (node && node !== document.body) {
    const parent: HTMLElement | null = node.parentElement
    if (!parent) break
    for (const sibling of parent.children)
      if (sibling instanceof HTMLElement && sibling !== node && !sibling.matches('script, style, template')) {
        changed.push({ element: sibling, inert: sibling.inert })
        sibling.inert = true
      }
    node = parent
  }
  return () => {
    for (const { element, inert } of changed) element.inert = inert
  }
}

const uuid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

type Status = 'idle' | 'loading' | 'ready' | 'error'

type DraftState = {
  values: Record<string, string>
  checks: Record<string, boolean>
}

type DraftScope = 'record' | 'dialog'

const emptyDraftState = (): DraftState => ({ values: {}, checks: {} })
const draftCheckKey = (name: string, value: string): string => `${name}\u0000${value}`

/** Name prefix of a checkbox that ticks every checkbox of its form sharing the rest of its name. */
export const CHECK_ALL = '__all:'

const after_ = <Data,>(command: RecordModalCommand<Data>) => command.after ?? 'close'

/**
 * How long a command may run before its button says so. Below this the answer
 * arrives while the reader is still lifting their finger, and a spinner shown
 * and withdrawn inside that window is noise; above it, silence would read as a
 * click that did nothing.
 */
export const BUSY_AFTER_MS = 400

/**
 * A flag that turns on late and off at once. Work that finishes inside the
 * window never raises it, so a progress indicator bound to it appears only when
 * there is progress to report, and never flashes on its way back out.
 */
export const delayedFlag = (
  show: (value: boolean) => void,
  after: number = BUSY_AFTER_MS,
): { set: (running: boolean) => void; stop: () => void } => {
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = (): void => {
    clearTimeout(timer)
    timer = undefined
  }
  return {
    set: (running) => {
      stop()
      if (!running) {
        show(false)
        return
      }
      timer = setTimeout(() => show(true), after)
    },
    stop,
  }
}

/** Controls inside a row do their own thing; the row's destination is for the rest of it. */
const rowControl = 'a, button, input, select, textarea, label, summary, details, [data-ui="select-cell"]'

/**
 * Where a click is asking to go: the link it landed on, or the row it landed
 * in. A table row carries its destination on the row itself (`rowLink: false`),
 * so the whole row is one target rather than a link around the first cell. The
 * shell would navigate such a row through the navigation layer, which fetches
 * the collection again and leaves the modal unopened, so this reads it first.
 */
export const openerHref = (element: Element | null): string | null => {
  const anchor = element?.closest<HTMLAnchorElement>('a[href]')
  if (anchor) return anchor.target && anchor.target !== '_self' ? null : anchor.href
  if (element?.closest(rowControl)) return null
  return element?.closest<HTMLElement>('[data-row-href]')?.getAttribute('data-row-href') ?? null
}

/**
 * Create the island controller for one record kind.
 *
 * The returned factory is what a module exports as its island client:
 * `export const followupModal = createRecordModal(definition)`.
 */
export const createRecordModal =
  <Data,>(definition: RecordModalDefinition<Data>) =>
  (): IslandController => {
    const open = signal<{ id: string; tab: string } | null>(null)
    const status = signal<Status>('idle')
    const envelope = signal<RecordContextEnvelope<Data> | null>(null)
    const failure = signal<string | null>(null)
    const issues = signal<RecordIssue[]>([])
    const recordDrafts = signal<DraftState>(emptyDraftState())
    const dialogDrafts = signal<DraftState>(emptyDraftState())
    // `running` is the guard — one command at a time — and `busy` is what the
    // views show. They are not the same thing: a save the server answers in
    // twenty milliseconds would otherwise flash the button through its spinner
    // and back, which reads as a glitch rather than as progress. The spinner
    // waits; the guard does not.
    const running = signal(false)
    const busy = signal(false)
    const showBusy = delayedFlag((value) => busy.set(value))
    // A command that succeeded while the modal stayed open. Saving is usually
    // answered before the button could say anything, and a record that looks
    // the same afterwards leaves the reader unsure anything happened, so the
    // form says so where it would have said the opposite.
    const saved = signal(false)
    const setRunning = (value: boolean): void => {
      running.set(value)
      showBusy.set(value)
      if (value) saved.set(false)
    }
    const dialog = signal<{ name: string; params: Record<string, string> } | null>(null)
    const version = signal(0)
    const viewState = signal<Record<string, string>>({})
    // What the last preview command answered. One at a time: a second preview
    // replaces the first, and anything that moves the layer clears it, so a
    // consequence is never read beside a selection it was not computed from.
    const outcome = signal<{ command: string; value: unknown } | null>(null)

    // Contexts this island has read, newest last: reopening a record (or the create
    // form) renders immediately and revalidates in place. Bounded and page-scoped;
    // a successful command or `ket:records-changed` for this kind drops the entries.
    const cache = new Map<string, RecordContextEnvelope<Data>>()
    const remember = (id: string, value: RecordContextEnvelope<Data>): void => {
      cache.delete(id)
      cache.set(id, value)
      while (cache.size > RECORD_MODAL_CACHE_SIZE) cache.delete(cache.keys().next().value as string)
    }

    let root: HTMLElement | null = null
    let request: AbortController | null = null
    let pushed = false
    let returnFocus: HTMLElement | null = null
    let dialogReturnFocus: HTMLElement | null = null
    let releaseInert: (() => void) | null = null

    // Messages of the last record this modal loaded: opening the next record clears
    // the envelope, and its loading state still needs words rather than keys.
    let previousMessages: Record<string, string> | null = null
    const labels = (): Record<string, string> =>
      typeof definition.labels === 'function' ? definition.labels() : (definition.labels ?? {})
    const t = (key: string, params?: Record<string, unknown>): string =>
      interpolate(
        resolveRecordModalLabel(key, {
          messages: envelope()?.messages,
          previous: previousMessages,
          labels: labels(),
        }),
        params,
      )
    const visibleTabs = (context: RecordModalContext<Data>) =>
      (definition.tabs ?? []).filter((tab) => tab.visible?.(context) ?? true)

    const contextFor = (
      current: { id: string; tab: string },
      data: Data,
      scope: DraftScope = 'record',
    ): RecordModalContext<Data> => {
      const draftState = (): DraftState => (scope === 'dialog' ? dialogDrafts() : recordDrafts())
      const base: RecordModalContext<Data> = {
        kind: definition.kind,
        id: current.id,
        creating: current.id === RECORD_NEW_ID,
        tab: current.tab,
        data,
        t,
        fieldError: (name) => {
          const hit = issues().find((issue) => issue.field === name)
          return hit ? (hit.message ?? t(hit.code, hit.params)) : null
        },
        draft: (name, fallback = '') => draftState().values[name] ?? fallback,
        draftChecked: (name, value = '1', fallback = false) =>
          draftState().checks[draftCheckKey(name, value)] ?? fallback,
        outcome: <T,>(command: string) => {
          const held = outcome()
          return held?.command === command ? (held.value as T) : null
        },
        busy: busy(),
        dialog: dialog(),
        href: (tab) => recordModalHref(location.href, { kind: definition.kind, id: current.id, tab }),
        state: (key, fallback = '') => viewState()[key] ?? fallback,
      }
      const tabs = visibleTabs(base)
      if (tabs.length && !tabs.some((tab) => tab.id === current.tab)) base.tab = tabs[0]!.id
      return base
    }

    const load = async (id: string, quiet = false): Promise<void> => {
      request?.abort()
      const controller = new AbortController()
      request = controller
      // A record opened before shows at once from the in-memory cache and is read
      // again quietly behind it; the reader never waits on a frame they have seen.
      const cached = definition.cache === false ? undefined : cache.get(id)
      if (cached) {
        previousMessages = cached.messages ?? previousMessages
        envelope.set(cached)
        status.set('ready')
        quiet = true
      }
      if (!quiet) status.set('loading')
      failure.set(null)
      try {
        const creating = id === RECORD_NEW_ID
        const input = definition.context.input
          ? definition.context.input(id, creating)
          : creating
            ? {}
            : { id }
        const result = await callRecordFunction<RecordContextEnvelope<Data> | null>(
          definition.context.fn,
          input,
          {
            signal: controller.signal,
          },
        )
        if (controller.signal.aborted) return
        if (!result.ok || !result.value) {
          failure.set(result.ok ? 'recordModal.notFound' : (result.message ?? 'recordModal.loadFailed'))
          status.set('error')
          return
        }
        previousMessages = result.value.messages ?? previousMessages
        if (definition.cache !== false) remember(id, result.value)
        envelope.set(result.value)
        status.set('ready')
        // The record replaced the loading state: measure what it actually needs.
        requestAnimationFrame(holdHeight)
      } catch (caught) {
        if (controller.signal.aborted || (caught as Error)?.name === 'AbortError') return
        failure.set('recordModal.loadFailed')
        status.set('error')
      }
    }

    const layers = (): HTMLElement[] =>
      root ? [...root.querySelectorAll<HTMLElement>('[data-ui="modal-layer"][data-client-modal="true"]')] : []
    const recordLayer = (): HTMLElement | null => layers()[0] ?? null
    const topLayer = (): HTMLElement | null => layers().at(-1) ?? null

    const keepDrafts = (current: HTMLElement | null, scope: DraftScope): void => {
      if (!current) return
      const previous = scope === 'dialog' ? dialogDrafts() : recordDrafts()
      const kept: DraftState = {
        values: { ...previous.values },
        checks: { ...previous.checks },
      }
      for (const control of current.querySelectorAll<
        HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
      >('input[name], select[name], textarea[name]')) {
        if (control.disabled || control.name === RECORD_COMMAND_FIELD) continue
        if (control instanceof HTMLInputElement) {
          if (control.type === 'file' || control.type === 'hidden') continue
          if (control.type === 'checkbox' || control.type === 'radio') {
            kept.checks[draftCheckKey(control.name, control.value)] = control.checked
            if (control.type === 'checkbox') kept.values[control.name] = control.checked ? control.value : ''
            else if (control.checked) kept.values[control.name] = control.value
            continue
          }
        }
        kept.values[control.name] = control.value
      }
      if (scope === 'dialog') dialogDrafts.set(kept)
      else recordDrafts.set(kept)
    }

    const keepAllDrafts = (): void => {
      const currentLayers = layers()
      keepDrafts(currentLayers[0] ?? null, 'record')
      if (currentLayers.length > 1) keepDrafts(currentLayers.at(-1) ?? null, 'dialog')
    }

    const mayDiscard = (current: HTMLElement | null): boolean => {
      if (!current || !recordLayerHasDraft(current)) return true
      return globalThis.confirm(t('recordModal.unsaved'))
    }

    // The tallest this record's dialog has been. A tabbed dialog holds it as a
    // min-height so moving between tabs never resizes it, while a record whose
    // tabs are all short still gets a dialog the size of what is in it. It is the
    // record that owns the number: opening another one starts again.
    let tallest = 0
    const holdHeight = (): void => {
      if ((definition.tabs?.length ?? 0) <= 1) return
      const sheet = root?.querySelector<HTMLElement>(
        '[data-ui="modal-layer"][data-client-modal="true"] [data-ui="modal-sheet"][data-height="fixed"]',
      )
      if (!sheet) return
      // Measured with the hold released, so a dialog that has grown is not read
      // back as its own floor for ever.
      sheet.style.minHeight = ''
      tallest = Math.max(tallest, sheet.offsetHeight)
      sheet.style.minHeight = `${tallest}px`
    }

    const afterRender = (preferred?: () => HTMLElement | null): void => {
      requestAnimationFrame(holdHeight)
      requestAnimationFrame(() => {
        const currentLayers = layers()
        const record = currentLayers[0]
        const top = currentLayers.at(-1)
        if (!top) return
        if (record) record.inert = currentLayers.length > 1
        const target = preferred?.()
        if (target?.isConnected && top.contains(target)) {
          target.focus()
          return
        }
        if (top.contains(document.activeElement)) return
        const sheet = top.querySelector<HTMLElement>('[data-ui="modal-sheet"]')
        const first = focusablesIn(top).find((item) => !item.matches('[data-ui="modal-close"]'))
        ;(first ?? sheet)?.focus()
      })
    }

    const show = (
      id: string,
      tab: string | null,
      how: 'push' | 'replace' | 'none',
      preferredFocus?: () => HTMLElement | null,
    ): void => {
      const current = open()
      const sameRecord = current?.id === id
      const nextTab = tab ?? (sameRecord ? current.tab : '')
      if (!sameRecord) {
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        issues.set([])
        saved.set(false)
        recordDrafts.set(emptyDraftState())
        dialogDrafts.set(emptyDraftState())
        viewState.set({})
        outcome.set(null)
        tallest = 0
        dialog.set(null)
        dialogReturnFocus = null
        envelope.set(null)
        void load(id)
      }
      open.set({ id, tab: nextTab })
      const href = recordModalHref(location.href, { kind: definition.kind, id, tab: nextTab || null })
      if (how === 'push') {
        history.pushState({ ...(history.state ?? {}), __ketRecordModal: definition.kind }, '', href)
        pushed = true
      } else if (how === 'replace') history.replaceState(history.state ?? {}, '', href)
      if (root && !releaseInert) releaseInert = inertOutside(root)
      afterRender(preferredFocus)
    }

    const hide = (how: 'history' | 'replace' | 'none'): void => {
      request?.abort()
      open.set(null)
      dialog.set(null)
      issues.set([])
      saved.set(false)
      recordDrafts.set(emptyDraftState())
      dialogDrafts.set(emptyDraftState())
      viewState.set({})
      outcome.set(null)
      tallest = 0
      status.set('idle')
      envelope.set(null)
      releaseInert?.()
      releaseInert = null
      if (how === 'history' && pushed) {
        pushed = false
        history.back()
      } else if (how !== 'none') {
        pushed = false
        history.replaceState(history.state ?? {}, '', recordModalClosedHref(location.href))
      }
      const target = returnFocus
      returnFocus = null
      dialogReturnFocus = null
      if (target?.isConnected) requestAnimationFrame(() => target.focus())
    }

    const close = (): void => {
      if (dialog()) {
        if (!mayDiscard(topLayer())) return
        const target = dialogReturnFocus
        dialogReturnFocus = null
        dialog.set(null)
        dialogDrafts.set(emptyDraftState())
        issues.set([])
        outcome.set(null)
        afterRender(() => (target?.isConnected ? target : null))
        return
      }
      if (!mayDiscard(recordLayer())) return
      hide('history')
    }

    const run = async (name: string, form: HTMLFormElement, submitter: HTMLElement | null): Promise<void> => {
      const command = definition.commands?.[name]
      const current = open()
      const data = envelope()?.data
      if (!command || !current || data === undefined || running()) return
      const formData = new FormData(form, submitter instanceof HTMLButtonElement ? submitter : null)
      const currentLayer = form.closest<HTMLElement>('[data-ui="modal-layer"][data-client-modal="true"]')
      const scope: DraftScope = dialog() && currentLayer === topLayer() ? 'dialog' : 'record'
      keepDrafts(currentLayer, scope)
      const context = contextFor(current, data, scope)
      setRunning(true)
      issues.set([])
      try {
        const uploads: RecordUploads = {}
        for (const [field, target] of Object.entries(command.upload ?? {})) {
          const file = formData.get(field)
          if (!(file instanceof File) || file.size === 0) continue
          const body = new FormData()
          for (const [key, value] of Object.entries(target(formData, context))) body.append(key, value)
          body.append('file', file, file.name)
          const response = await fetch('/files', { method: 'POST', credentials: 'same-origin', body })
          const stored = (await response.json().catch(() => null)) as {
            id?: unknown
            name?: unknown
            message?: unknown
          } | null
          if (!response.ok || !stored?.id) {
            issues.set([
              {
                field: null,
                code: 'recordModal.uploadFailed',
                message: typeof stored?.message === 'string' ? stored.message : null,
                params: {},
              },
            ])
            return
          }
          uploads[field] = {
            id: String(stored.id),
            name: typeof stored.name === 'string' ? stored.name : null,
          }
        }
        const result = await callRecordFunction(command.fn, command.input(formData, context, uploads), {
          idempotencyKey: uuid(),
        })
        if (!result.ok) {
          // The layer was snapshotted before the busy state rendered, including unchecked controls.
          // A refused submit leaves an answer that was computed from something else.
          outcome.set(null)
          issues.set(
            result.issues.length
              ? result.issues
              : [
                  {
                    field: null,
                    code: result.message ?? 'recordModal.saveFailed',
                    message: result.message,
                    params: {},
                  },
                ],
          )
          return
        }
        if (command.preview) {
          // Nothing changed, so nothing is dropped, re-read or announced — and the
          // drafts snapshotted before this submit stay, so the selection is still on
          // screen beside the answer it produced.
          outcome.set({ command: name, value: result.value })
          version.set(version() + 1)
          return
        }
        if (scope === 'dialog') dialogDrafts.set(emptyDraftState())
        else recordDrafts.set(emptyDraftState())
        // A command that stays in its layer leaves its answer for the view, which is
        // how something the server can only say once — a one-time credential — reaches
        // the reader. Every other `after` replaces the layer, so the answer goes.
        outcome.set(after_(command) === 'stay' ? { command: name, value: result.value } : null)
        form.reset()
        const value = result.value as { id?: unknown } | null | undefined
        const createdId =
          after_(command) === 'open'
            ? (command.created?.(result.value) ??
              (value && typeof value === 'object' && value.id != null ? String(value.id) : null))
            : null
        // What the command changed is no longer what the cache holds.
        cache.delete(current.id)
        if (createdId) cache.delete(createdId)
        const announce = (): void => {
          document.dispatchEvent(
            new CustomEvent('ket:records-changed', {
              detail: { kind: definition.kind, ids: [createdId ?? current.id] },
            }),
          )
        }
        const after = after_(command)
        // A modal that closes says so by closing; one that stays owes an answer.
        if (after !== 'close') saved.set(true)
        if (after === 'open') {
          dialog.set(null)
          dialogDrafts.set(emptyDraftState())
          // Replace `:new` in the address bar before the collection refreshes: the
          // shell re-fetches `location.href`, which must already name the new record.
          if (createdId) show(createdId, command.openTab ?? null, 'replace')
          else hide('history')
          announce()
          return
        }
        announce()
        if (after === 'close') hide('history')
        else if (after === 'reload') {
          const target = dialogReturnFocus
          dialogReturnFocus = null
          dialog.set(null)
          dialogDrafts.set(emptyDraftState())
          await load(current.id)
          afterRender(() => (target?.isConnected ? target : null))
        } else if (after === 'refresh') await load(current.id, true)
        else if (after === 'stay') version.set(version() + 1)
        else if ('tab' in after) {
          dialogReturnFocus = null
          dialog.set(null)
          dialogDrafts.set(emptyDraftState())
          show(current.id, after.tab, 'replace')
          await load(current.id)
        } else {
          const target = after.dialog ? null : dialogReturnFocus
          dialogReturnFocus = after.dialog && submitter instanceof HTMLElement ? submitter : null
          dialog.set(after.dialog ? { name: after.dialog, params: {} } : null)
          dialogDrafts.set(emptyDraftState())
          await load(current.id, true)
          afterRender(() => (target?.isConnected ? target : null))
        }
      } catch {
        issues.set([{ field: null, code: 'recordModal.saveFailed', message: null, params: {} }])
      } finally {
        setRunning(false)
      }
    }

    const formIssues = (context: RecordModalContext<Data>): JSXChild => {
      const general = issues().filter((issue) => !issue.field)
      const fieldless = issues().filter(
        (issue) => issue.field && !root?.querySelector(`[name="${CSS.escape(issue.field)}"]`),
      )
      const all = [...general, ...fieldless]
      if (!all.length)
        return saved()
          ? Notice({
              title: context.t('recordModal.savedTitle'),
              message: context.t('recordModal.saved'),
              tone: 'positive',
            })
          : ''
      return Notice({
        title: context.t('recordModal.errorTitle'),
        message: all.map((issue) => issue.message ?? context.t(issue.code, issue.params)).join(' · '),
        tone: 'danger',
      })
    }

    const recordBody = (): TemplateResult | string => {
      const current = open()
      if (!current) return ''
      if (status() === 'error')
        return (
          <>
            {Notice({
              title: t('recordModal.errorTitle'),
              message: t(failure() ?? 'recordModal.loadFailed'),
              tone: 'danger',
            })}
            {Button({ label: t('recordModal.retry'), variant: 'secondary', name: 'intent', value: 'retry' })}
          </>
        )
      const data = envelope()?.data
      if (status() !== 'ready' || data === undefined) return LoadingState({ label: t('recordModal.loading') })
      const context = contextFor(current, data)
      const tabs = visibleTabs(context)
      const active = tabs.find((tab) => tab.id === context.tab)
      const header = definition.header?.(context) ?? ''
      const issueNotice = formIssues(context)
      const body = active ? active.view(context) : (definition.body?.(context) ?? '')
      if (tabs.length)
        return TabbedView({
          id: `record-view-${definition.kind.replaceAll('.', '-')}`,
          label: definition.title(context),
          items: tabs.map((tab) => ({
            id: tab.id,
            label: tab.label(context),
            href: context.href(tab.id),
            active: tab.id === context.tab,
          })),
          context:
            header !== '' || issueNotice !== '' ? (
              <>
                {header}
                {issueNotice}
              </>
            ) : undefined,
          body,
        })
      return (
        <>
          {header}
          {issueNotice}
          {body}
        </>
      )
    }

    const dialogLayer = (): TemplateResult | string => {
      const current = open()
      const opened = dialog()
      const data = envelope()?.data
      if (!current || !opened || data === undefined) return ''
      const spec = definition.dialogs?.[opened.name]
      if (!spec) return ''
      const context = contextFor(current, data, 'dialog')
      return ModalSheet({
        id: `record-dialog-${definition.kind.replaceAll('.', '-')}-${opened.name}`,
        mode: 'client',
        presentation: 'dialog',
        size: spec.size ?? 'default',
        title: spec.title(context),
        closeLabel: t('recordModal.close'),
        body: (
          <>
            {formIssues(context)}
            {spec.view(context)}
          </>
        ),
      })
    }

    return {
      view: () => {
        version()
        const current = open()
        if (!current) return recordModalHost(definition.kind)
        const data = envelope()?.data
        const context = data === undefined ? null : contextFor(current, data)
        return (
          <>
            {recordModalHost(definition.kind)}
            {ModalSheet({
              id: `record-modal-${definition.kind.replaceAll('.', '-')}`,
              mode: 'client',
              presentation: 'dialog',
              size: definition.size ?? 'default',
              // Tabs have different heights; a fixed dialog does not jump when the reader switches
              // tabs, nor when the loading state gives way to the record.
              height: (definition.tabs?.length ?? 0) > 1 ? 'fixed' : 'content',
              title: context ? definition.title(context) : t('recordModal.loading'),
              description: context ? (definition.description?.(context) ?? null) : null,
              status: context ? definition.status?.(context) : undefined,
              closeLabel: t('recordModal.close'),
              body: recordBody(),
            })}
            {dialogLayer()}
          </>
        )
      },
      mount: ({ root: host, lifetime }) => {
        root = host as unknown as HTMLElement

        // Links anywhere on the page that name this kind open it; a link naming the
        // record already open switches its tab. Runs before the navigation layer.
        document.addEventListener(
          'click',
          (event) => {
            if (
              event.defaultPrevented ||
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            )
              return
            const element = event.target instanceof Element ? event.target : null
            const inModal = element?.closest('[data-ui="modal-layer"][data-client-modal="true"]')
            if (inModal && root?.contains(inModal)) {
              if (element?.closest('[data-ui="modal-close"], [data-ui="modal-backdrop"]')) {
                event.preventDefault()
                close()
                return
              }
              const stateControl = element?.closest<HTMLElement>(
                'button[data-record-state], a[data-record-state]',
              )
              if (stateControl) {
                event.preventDefault()
                keepAllDrafts()
                viewState.set({
                  ...viewState(),
                  [stateControl.getAttribute('data-record-state') ?? '']:
                    stateControl.getAttribute('data-record-value') ?? '',
                })
                return
              }
              const opener = element?.closest<HTMLElement>(`[${RECORD_DIALOG_ATTRIBUTE}]`)
              if (opener) {
                event.preventDefault()
                const focused = document.activeElement
                dialogReturnFocus =
                  focused instanceof HTMLElement && opener.contains(focused)
                    ? focused
                    : opener.querySelector<HTMLElement>(focusable)
                dialogDrafts.set(emptyDraftState())
                const params: Record<string, string> = {}
                for (const [key, value] of Object.entries(opener.dataset))
                  if (key.startsWith('recordParam') && value !== undefined)
                    params[key.slice('recordParam'.length).replace(/^./u, (c) => c.toLowerCase())] = value
                issues.set([])
                outcome.set(null)
                dialog.set({ name: opener.getAttribute(RECORD_DIALOG_ATTRIBUTE) ?? '', params })
                afterRender()
                return
              }
              if (element?.closest('button[name="intent"][value="retry"]')) {
                event.preventDefault()
                const current = open()
                if (current) void load(current.id)
                return
              }
            }
            const href = openerHref(element)
            if (!href) return
            const url = new URL(href, location.href)
            if (url.origin !== location.origin || url.pathname !== location.pathname) return
            const target = readRecordModalTarget(url)
            if (!target || target.kind !== definition.kind) return
            event.preventDefault()
            const current = open()
            if (current?.id === target.id) {
              if ((target.tab ?? '') === current.tab) return
              // Switching tab is not discarding: what was typed rides along as drafts,
              // which the views read back, so no prompt stands between two tabs.
              keepDrafts(recordLayer(), 'record')
              issues.set([])
              // The answer belonged to the tab that asked for it.
              outcome.set(null)
              show(
                target.id,
                target.tab ?? null,
                'replace',
                () =>
                  recordLayer()?.querySelector<HTMLElement>('[data-ui="tab"][data-active="true"]') ?? null,
              )
              return
            }
            show(target.id, target.tab ?? null, 'push')
          },
          // Capture: the navigation layer listens on the document too, and was
          // installed first, so a bubbling listener would see the page fetched.
          { signal: lifetime, capture: true },
        )

        // A row is reached by keyboard, not by pointer alone: Enter and Space on
        // the focused row open what clicking it opens.
        document.addEventListener(
          'keydown',
          (event) => {
            if (event.defaultPrevented || (event.key !== 'Enter' && event.key !== ' ')) return
            const element = event.target instanceof Element ? event.target : null
            if (!element?.matches('[data-row-href][tabindex="0"]')) return
            const href = element.getAttribute('data-row-href')
            const url = href ? new URL(href, location.href) : null
            if (!url || url.origin !== location.origin || url.pathname !== location.pathname) return
            const target = readRecordModalTarget(url)
            if (!target || target.kind !== definition.kind) return
            event.preventDefault()
            show(target.id, target.tab ?? null, 'push')
          },
          { signal: lifetime, capture: true },
        )

        document.addEventListener(
          'submit',
          (event) => {
            const form = event.target instanceof HTMLFormElement ? event.target : null
            if (!form || !root?.contains(form)) return
            event.preventDefault()
            const submitter = (event as SubmitEvent).submitter ?? null
            const name =
              (submitter instanceof HTMLButtonElement && submitter.name === RECORD_COMMAND_FIELD
                ? submitter.value
                : null) ?? String(new FormData(form).get(RECORD_COMMAND_FIELD) ?? '')
            void run(name, form, submitter)
          },
          { signal: lifetime },
        )

        document.addEventListener(
          'keydown',
          (event) => {
            if (!open()) return
            const layers = root?.querySelectorAll<HTMLElement>(
              '[data-ui="modal-layer"][data-client-modal="true"]',
            )
            const top = layers?.[layers.length - 1]
            if (!top) return
            if (event.key === 'Escape') {
              event.preventDefault()
              close()
              return
            }
            if (event.key !== 'Tab') return
            const items = focusablesIn(top)
            if (!items.length) {
              event.preventDefault()
              top.querySelector<HTMLElement>('[data-ui="modal-sheet"]')?.focus()
              return
            }
            const first = items[0]!
            const last = items.at(-1)!
            if (
              event.shiftKey &&
              (document.activeElement === first || !top.contains(document.activeElement))
            ) {
              event.preventDefault()
              last.focus()
            } else if (
              !event.shiftKey &&
              (document.activeElement === last || !top.contains(document.activeElement))
            ) {
              event.preventDefault()
              first.focus()
            }
          },
          { signal: lifetime },
        )

        // An input or select carrying `data-record-state` feeds view state as it
        // changes; a file chosen in a `data-record-submit` input submits its form.
        document.addEventListener(
          'change',
          (event) => {
            const control = event.target instanceof Element ? event.target : null
            if (!control || !root?.contains(control)) return
            // A checkbox named `__all:<prefix>` ticks or clears every checkbox of its
            // form whose name starts with that prefix, so one control stands for a
            // row or a whole section. Any tick in such a form is kept as a draft, so
            // the view re-renders and each "all" box reads whether it is now full.
            if (control instanceof HTMLInputElement && control.type === 'checkbox' && control.form) {
              const form = control.form
              if (form.querySelector(`input[type="checkbox"][name^="${CHECK_ALL}"]`)) {
                if (control.name.startsWith(CHECK_ALL)) {
                  const prefix = control.name.slice(CHECK_ALL.length)
                  for (const target of form.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
                    if (
                      !target.disabled &&
                      !target.name.startsWith(CHECK_ALL) &&
                      target.name.startsWith(prefix)
                    )
                      target.checked = control.checked
                }
                keepAllDrafts()
                return
              }
            }
            if (
              (control instanceof HTMLSelectElement || control instanceof HTMLInputElement) &&
              control.hasAttribute('data-record-state')
            ) {
              keepAllDrafts()
              viewState.set({
                ...viewState(),
                [control.getAttribute('data-record-state') ?? '']: control.value,
              })
              return
            }
            if (
              control instanceof HTMLInputElement &&
              control.type === 'file' &&
              control.hasAttribute('data-record-submit') &&
              control.files?.length
            )
              control.form?.requestSubmit()
          },
          { signal: lifetime },
        )

        // A form marked `data-record-dropzone` takes a dropped file into its file
        // input and submits, so dragging a photo in is the same command as choosing it.
        const dropzoneOf = (event: Event): HTMLFormElement | null => {
          const element = event.target instanceof Element ? event.target : null
          const zone = element?.closest<HTMLFormElement>('form[data-record-dropzone]') ?? null
          return zone && root?.contains(zone) ? zone : null
        }
        document.addEventListener(
          'dragover',
          (event) => {
            const zone = dropzoneOf(event)
            if (!zone) return
            event.preventDefault()
            zone.dataset.drag = '1'
          },
          { signal: lifetime },
        )
        document.addEventListener(
          'dragleave',
          (event) => {
            const zone = dropzoneOf(event)
            if (!zone) return
            const related = (event as DragEvent).relatedTarget
            if (related instanceof Node && zone.contains(related)) return
            delete zone.dataset.drag
          },
          { signal: lifetime },
        )
        document.addEventListener(
          'drop',
          (event) => {
            const zone = dropzoneOf(event)
            if (!zone) return
            event.preventDefault()
            delete zone.dataset.drag
            const files = (event as DragEvent).dataTransfer?.files
            const input = zone.querySelector<HTMLInputElement>('input[type="file"]')
            if (!input || !files?.length) return
            const transfer = new DataTransfer()
            transfer.items.add(files[0]!)
            input.files = transfer.files
            zone.requestSubmit()
          },
          { signal: lifetime },
        )

        // Islands a view places with `recordIsland` start when their host appears
        // and stop when it leaves, through the page's own island manager.
        const islandSelector = 'ket-island, div[data-ket-island]'
        const holdsIsland = (node: Node): node is Element =>
          node instanceof Element &&
          (node.matches(islandSelector) || node.querySelector(islandSelector) !== null)
        const observer = new MutationObserver((records) => {
          for (const record of records) {
            for (const node of record.removedNodes)
              if (holdsIsland(node))
                document.dispatchEvent(new CustomEvent('ket:islands-detach', { detail: { root: node } }))
            for (const node of record.addedNodes)
              if (holdsIsland(node) && node.isConnected)
                document.dispatchEvent(new CustomEvent('ket:islands-attach', { detail: { root: node } }))
          }
        })
        observer.observe(root, { childList: true, subtree: true })
        lifetime.addEventListener('abort', () => observer.disconnect())

        // Another island (or this one) changed records of this kind: drop them so the
        // next opening reads fresh data first.
        document.addEventListener(
          'ket:records-changed',
          (event) => {
            const detail = (event as CustomEvent<{ kind?: string; ids?: unknown[] }>).detail
            if (detail?.kind !== definition.kind) return
            if (!Array.isArray(detail.ids) || !detail.ids.length) cache.clear()
            else for (const id of detail.ids) cache.delete(String(id))
          },
          { signal: lifetime },
        )

        // Back and forward over entries this modal created change only the modal.
        document.addEventListener(
          'ket:popstate',
          (event) => {
            const target = readRecordModalTarget(location.href)
            const mine = target?.kind === definition.kind
            if (!mine && !open()) return
            event.preventDefault()
            if (mine && target) show(target.id, target.tab ?? null, 'none')
            else hide('none')
          },
          { signal: lifetime },
        )

        const initial = readRecordModalTarget(location.href)
        if (initial?.kind === definition.kind) show(initial.id, initial.tab ?? null, 'none')

        lifetime.addEventListener('abort', () => {
          request?.abort()
          showBusy.stop()
          releaseInert?.()
          releaseInert = null
          root = null
        })
      },
    }
  }

/**
 * Place an island inside a record view. The runtime starts it when the host
 * appears and disposes it when the host leaves; props must be JSON.
 */
export const recordIsland = (name: string, props: Record<string, unknown>): TemplateResult => (
  <ket-island data-island={name} data-props={JSON.stringify(props)} />
)

export {
  RECORD_NEW_ID,
  RECORD_PARAM,
  RECORD_TAB_PARAM,
  recordModalHref,
  recordModalCreateHref,
  recordModalClosedHref,
  readRecordModalTarget,
}
