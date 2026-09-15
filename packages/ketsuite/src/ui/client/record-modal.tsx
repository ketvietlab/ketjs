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
import { LoadingState, ModalSheet, Notice, Tabs, Button } from '@ketvietlab/design-system'
import {
  RECORD_PARAM,
  RECORD_TAB_PARAM,
  readRecordModalTarget,
  recordModalClosedHref,
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
  tab: string
  data: Data
  /** Translate a key the context shipped, interpolating `{name}` params. */
  t: (key: string, params?: Record<string, unknown>) => string
  /** The refusal for one field of the last submit, translated. */
  fieldError: (name: string) => string | null
  /** What was typed into a field before a refused submit, or the fallback. */
  draft: (name: string, fallback?: string) => string
  /** A submit is in flight. */
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
   */
  after?: 'close' | 'reload' | 'refresh' | 'stay' | { tab: string } | { dialog: string | null }
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
  /** A permission-checked read returning `{ data, messages }`. */
  context: { fn: string; input?: (id: string) => Record<string, unknown> }
  title: (context: RecordModalContext<Data>) => string
  description?: (context: RecordModalContext<Data>) => string | null
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
}

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
    const drafts = signal<Record<string, string>>({})
    const busy = signal(false)
    const dialog = signal<{ name: string; params: Record<string, string> } | null>(null)
    const version = signal(0)
    const viewState = signal<Record<string, string>>({})

    let root: HTMLElement | null = null
    let request: AbortController | null = null
    let pushed = false
    let returnFocus: HTMLElement | null = null
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

    const contextFor = (current: { id: string; tab: string }, data: Data): RecordModalContext<Data> => {
      const base: RecordModalContext<Data> = {
        kind: definition.kind,
        id: current.id,
        tab: current.tab,
        data,
        t,
        fieldError: (name) => {
          const hit = issues().find((issue) => issue.field === name)
          return hit ? (hit.message ?? t(hit.code, hit.params)) : null
        },
        draft: (name, fallback = '') => drafts()[name] ?? fallback,
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
      if (!quiet) status.set('loading')
      failure.set(null)
      try {
        const input = definition.context.input ? definition.context.input(id) : { id }
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
        envelope.set(result.value)
        status.set('ready')
      } catch (caught) {
        if (controller.signal.aborted || (caught as Error)?.name === 'AbortError') return
        failure.set('recordModal.loadFailed')
        status.set('error')
      }
    }

    const layer = (): HTMLElement | null =>
      root?.querySelector<HTMLElement>('[data-ui="modal-layer"][data-client-modal="true"]') ?? null

    const keepDrafts = (): void => {
      const current = layer()
      if (!current || !recordLayerHasDraft(current)) return
      const kept: Record<string, string> = {}
      for (const form of current.querySelectorAll('form'))
        for (const [key, value] of new FormData(form))
          if (typeof value === 'string' && key !== RECORD_COMMAND_FIELD) kept[key] = value
      drafts.set({ ...drafts(), ...kept })
    }

    const mayDiscard = (): boolean => {
      const current = layer()
      if (!current || !recordLayerHasDraft(current)) return true
      return globalThis.confirm(t('recordModal.unsaved'))
    }

    const afterRender = (): void => {
      requestAnimationFrame(() => {
        const layers = root?.querySelectorAll<HTMLElement>(
          '[data-ui="modal-layer"][data-client-modal="true"]',
        )
        const top = layers?.[layers.length - 1]
        if (!top) return
        if (top.contains(document.activeElement)) return
        const sheet = top.querySelector<HTMLElement>('[data-ui="modal-sheet"]')
        const first = focusablesIn(top).find((item) => !item.matches('[data-ui="modal-close"]'))
        ;(first ?? sheet)?.focus()
      })
    }

    const show = (id: string, tab: string | null, how: 'push' | 'replace' | 'none'): void => {
      const current = open()
      const sameRecord = current?.id === id
      const nextTab = tab ?? (sameRecord ? current.tab : '')
      if (!sameRecord) {
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        issues.set([])
        drafts.set({})
        viewState.set({})
        dialog.set(null)
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
      afterRender()
    }

    const hide = (how: 'history' | 'replace' | 'none'): void => {
      request?.abort()
      open.set(null)
      dialog.set(null)
      issues.set([])
      drafts.set({})
      viewState.set({})
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
      if (target?.isConnected) requestAnimationFrame(() => target.focus())
    }

    const close = (): void => {
      if (dialog()) {
        if (!mayDiscard()) return
        dialog.set(null)
        issues.set([])
        afterRender()
        return
      }
      if (!mayDiscard()) return
      hide('history')
    }

    const run = async (name: string, form: HTMLFormElement, submitter: HTMLElement | null): Promise<void> => {
      const command = definition.commands?.[name]
      const current = open()
      const data = envelope()?.data
      if (!command || !current || data === undefined || busy()) return
      const formData = new FormData(form, submitter instanceof HTMLButtonElement ? submitter : null)
      const context = contextFor(current, data)
      busy.set(true)
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
          // Keep what was typed: the view reads it back through `draft`.
          const kept: Record<string, string> = {}
          for (const [key, value] of formData) if (typeof value === 'string') kept[key] = value
          drafts.set({ ...drafts(), ...kept })
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
        drafts.set({})
        form.reset()
        document.dispatchEvent(
          new CustomEvent('ket:records-changed', { detail: { kind: definition.kind, ids: [current.id] } }),
        )
        const after = command.after ?? 'close'
        if (after === 'close') hide('history')
        else if (after === 'reload') {
          dialog.set(null)
          await load(current.id)
        } else if (after === 'refresh') await load(current.id, true)
        else if (after === 'stay') version.set(version() + 1)
        else if ('tab' in after) {
          dialog.set(null)
          show(current.id, after.tab, 'replace')
          await load(current.id)
        } else {
          dialog.set(after.dialog ? { name: after.dialog, params: {} } : null)
          await load(current.id, true)
        }
      } catch {
        issues.set([{ field: null, code: 'recordModal.saveFailed', message: null, params: {} }])
      } finally {
        busy.set(false)
      }
    }

    const formIssues = (context: RecordModalContext<Data>): JSXChild => {
      const general = issues().filter((issue) => !issue.field)
      const fieldless = issues().filter(
        (issue) => issue.field && !root?.querySelector(`[name="${CSS.escape(issue.field)}"]`),
      )
      const all = [...general, ...fieldless]
      if (!all.length) return ''
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
      return (
        <>
          {definition.header?.(context) ?? ''}
          {formIssues(context)}
          {tabs.length
            ? Tabs({
                label: definition.title(context),
                items: tabs.map((tab) => ({
                  id: tab.id,
                  label: tab.label(context),
                  href: context.href(tab.id),
                  active: tab.id === context.tab,
                })),
              })
            : ''}
          {active ? active.view(context) : (definition.body?.(context) ?? '')}
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
      const context = contextFor(current, data)
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
              title: context ? definition.title(context) : t('recordModal.loading'),
              description: context ? (definition.description?.(context) ?? null) : null,
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
                const params: Record<string, string> = {}
                for (const [key, value] of Object.entries(opener.dataset))
                  if (key.startsWith('recordParam') && value !== undefined)
                    params[key.slice('recordParam'.length).replace(/^./u, (c) => c.toLowerCase())] = value
                issues.set([])
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
            const anchor = element?.closest<HTMLAnchorElement>('a[href]')
            if (!anchor || (anchor.target && anchor.target !== '_self')) return
            const url = new URL(anchor.href, location.href)
            if (url.origin !== location.origin || url.pathname !== location.pathname) return
            const target = readRecordModalTarget(url)
            if (!target || target.kind !== definition.kind) return
            event.preventDefault()
            const current = open()
            if (current?.id === target.id) {
              if ((target.tab ?? '') === current.tab) return
              // Switching tab is not discarding: what was typed rides along as drafts,
              // which the views read back, so no prompt stands between two tabs.
              keepDrafts()
              issues.set([])
              show(target.id, target.tab ?? null, 'replace')
              return
            }
            show(target.id, target.tab ?? null, 'push')
          },
          // Capture: the navigation layer listens on the document too, and was
          // installed first, so a bubbling listener would see the page fetched.
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
            if (
              (control instanceof HTMLSelectElement || control instanceof HTMLInputElement) &&
              control.hasAttribute('data-record-state')
            ) {
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

export { RECORD_PARAM, RECORD_TAB_PARAM, recordModalHref, recordModalClosedHref, readRecordModalTarget }
