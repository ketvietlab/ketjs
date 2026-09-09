import { installUserWorkflow } from './user-workflow.ts'
import type { BrowserBehavior, BrowserNavigation } from '@ketvietlab/ketjs'
import { attachDesignSystemInteractions } from '@ketvietlab/design-system'

const themeStorageKey = 'ket.backend.theme'
const dismissibleDropdown = [
  '[data-ui="search-menu"]',
  '[data-ui="col-config"]',
  '[data-ui="bulk-actions"]',
  '[data-ui="viewer"]',
  '[data-ui="record-more"]',
].join(', ')

type KetBrowserGlobals = typeof globalThis & {
  confirm: (message?: string) => boolean
}

const browserGlobals = globalThis as KetBrowserGlobals
const eventElement = (event: Event): Element | null => (event.target instanceof Element ? event.target : null)

type ThemePreference = 'light' | 'dark'

const themePreference = (value: string | null | undefined): ThemePreference | null =>
  value === 'light' || value === 'dark' ? value : null

const storedTheme = (): ThemePreference | null => {
  try {
    return themePreference(localStorage.getItem(themeStorageKey))
  } catch {
    return null
  }
}

const saveTheme = (theme: ThemePreference): void => {
  try {
    localStorage.setItem(themeStorageKey, theme)
  } catch {
    // Theme selection still works for this document when storage is unavailable.
  }
}

const resolvedTheme = (): ThemePreference =>
  themePreference(document.documentElement.dataset.theme) ??
  (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')

const syncThemeToggle = (): void => {
  const pressed = String(resolvedTheme() === 'dark')
  for (const control of document.querySelectorAll<HTMLElement>(
    '[data-ui="sidebar-tools"] [data-ui="action"][name="theme"]',
  ))
    control.setAttribute('aria-pressed', pressed)
}

/** Keep the shell preference explicit only after the reader chooses one. */
const installThemeToggle = (signal: AbortSignal): void => {
  const preference = storedTheme()
  if (preference) document.documentElement.dataset.theme = preference
  syncThemeToggle()

  document.addEventListener(
    'click',
    (event) => {
      const control = eventElement(event)?.closest<HTMLButtonElement>(
        '[data-ui="sidebar-tools"] [data-ui="action"][name="theme"]',
      )
      if (!control || control.disabled) return
      const next = resolvedTheme() === 'dark' ? 'light' : 'dark'
      document.documentElement.dataset.theme = next
      saveTheme(next)
      syncThemeToggle()
    },
    { signal },
  )

  matchMedia('(prefers-color-scheme: dark)').addEventListener(
    'change',
    () => {
      if (!themePreference(document.documentElement.dataset.theme)) syncThemeToggle()
    },
    { signal },
  )

  addEventListener(
    'storage',
    (event) => {
      if (event.key !== themeStorageKey) return
      const next = themePreference(event.newValue)
      if (next) document.documentElement.dataset.theme = next
      else delete document.documentElement.dataset.theme
      syncThemeToggle()
    },
    { signal },
  )
}

const updateSelection = (table: Element): void => {
  const rows = [...table.querySelectorAll<HTMLInputElement>('[data-ui="row-select"]:not(:disabled)')]
  const checked = rows.filter((input) => input.checked).length
  const all = table.querySelector<HTMLInputElement>('[data-ui="select-all"]')
  if (all) {
    all.checked = rows.length > 0 && checked === rows.length
    all.indeterminate = checked > 0 && checked < rows.length
  }
  if (!checked) {
    const shell = table.closest('[data-ui="shell"]')
    for (const menu of shell?.querySelectorAll<HTMLDetailsElement>('[data-ui="bulk-actions"][open]') ?? [])
      menu.removeAttribute('open')
  }
}

const installTableSelection = (signal: AbortSignal, navigation: BrowserNavigation): void => {
  document.addEventListener(
    'change',
    (event) => {
      const target = eventElement(event)
      if (!(target instanceof HTMLInputElement)) return
      if (!target.matches('[data-ui="select-all"], [data-ui="row-select"]')) return
      const table = target.closest('[data-ui="table"]')
      if (!table) return
      if (target.matches('[data-ui="select-all"]'))
        for (const input of table.querySelectorAll<HTMLInputElement>('[data-ui="row-select"]:not(:disabled)'))
          input.checked = target.checked
      updateSelection(table)
    },
    { signal },
  )

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
      const target = eventElement(event)
      if (
        target?.closest(
          'a, button, input, select, textarea, label, summary, details, [data-ui="select-cell"]',
        )
      )
        return
      const row = target?.closest<HTMLElement>('[data-ui="row"][data-row-href]')
      const href = row?.getAttribute('data-row-href')
      if (!href) return
      event.preventDefault()
      void navigation.navigate(href)
    },
    { signal },
  )
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.defaultPrevented || (event.key !== 'Enter' && event.key !== ' ')) return
      const target = eventElement(event)
      const row = target?.matches('[data-ui="row"][data-row-href][tabindex="0"]') ? target : null
      const href = row?.getAttribute('data-row-href')
      if (!href) return
      event.preventDefault()
      navigateTo(href, navigation)
    },
    { signal },
  )
}

const openDropdowns = (): HTMLDetailsElement[] => [
  ...document.querySelectorAll<HTMLDetailsElement>(`${dismissibleDropdown}[open]`),
]

const installDropdownDismiss = (signal: AbortSignal): void => {
  document.addEventListener(
    'click',
    (event) => {
      const current = eventElement(event)?.closest(dismissibleDropdown)
      for (const dropdown of openDropdowns()) {
        if (dropdown !== current && !dropdown.contains(current ?? null)) dropdown.removeAttribute('open')
      }
    },
    { signal },
  )

  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Escape') return
      const dropdowns = openDropdowns()
      if (!dropdowns.length) return
      const focused = document.activeElement?.closest<HTMLDetailsElement>(dismissibleDropdown)
      const current = focused?.open ? focused : dropdowns.at(-1)
      current?.removeAttribute('open')
      current?.querySelector<HTMLElement>('summary')?.focus()
      event.preventDefault()
    },
    { signal },
  )
}

const installGlobalFilter = (signal: AbortSignal): void => {
  document.addEventListener(
    'click',
    (event) => {
      const trigger = eventElement(event)?.closest<HTMLElement>('[data-ui="chrome-search-toggle"]')
      const controls = trigger?.getAttribute('aria-controls')
      if (!trigger || !controls) return
      const dialog = document.getElementById(controls)
      if (!(dialog instanceof HTMLDialogElement) || dialog.open) return
      dialog.showModal()
      trigger.setAttribute('aria-expanded', 'true')
      requestAnimationFrame(() =>
        dialog
          .querySelector<HTMLElement>('[data-presentation="modal"] [data-ui="chrome-search-input"]')
          ?.focus(),
      )
    },
    { signal },
  )

  document.addEventListener(
    'cancel',
    (event) => {
      if (!eventElement(event)?.matches('[data-ui="chrome-search-modal"]')) return
      event.preventDefault()
    },
    { capture: true, signal },
  )

  document.addEventListener(
    'close',
    (event) => {
      const dialog = eventElement(event)
      if (!(dialog instanceof HTMLDialogElement)) return
      if (!dialog.matches('[data-ui="chrome-search-modal"]')) return
      const trigger = document.querySelector<HTMLElement>(
        `[data-ui="chrome-search-toggle"][aria-controls="${CSS.escape(dialog.id)}"]`,
      )
      trigger?.setAttribute('aria-expanded', 'false')
      trigger?.focus()
    },
    { capture: true, signal },
  )
}

const focusable = [
  'a[href]',
  'button:not(:disabled)',
  'input:not(:disabled):not([type="hidden"])',
  'select:not(:disabled)',
  'textarea:not(:disabled)',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

const activeRouteModal = (): HTMLElement | null =>
  document.querySelector<HTMLElement>('[data-ui="modal-layer"][data-route-modal="true"]')

const modalFocusables = (modal: HTMLElement): HTMLElement[] =>
  [...modal.querySelectorAll<HTMLElement>(focusable)].filter(
    (item) =>
      !item.hidden &&
      item.getAttribute('aria-hidden') !== 'true' &&
      !item.matches('[data-ui="modal-backdrop"]'),
  )

const navigateTo = (href: string, navigation: BrowserNavigation): void => {
  void navigation.navigate(href)
}

const eventStartedInNestedModal = (event: KeyboardEvent, routeModal: HTMLElement): boolean =>
  event
    .composedPath()
    .some(
      (target) =>
        target instanceof HTMLElement &&
        target !== routeModal &&
        target.matches('[data-ui="modal-layer"][data-presentation="dialog"]'),
    )

/**
 * Whether anything in the modal has been typed into since the server rendered it.
 *
 * Comparing each control against its own default is what makes this work without
 * any bookkeeping: the page is server-rendered, so the default *is* the state the
 * reader was given. A modal with no form — a reader, an inspector — has nothing
 * to compare and is never dirty, so the guard costs those screens nothing.
 */
const modalHasDraft = (modal: HTMLElement): boolean => {
  for (const field of modal.querySelectorAll<HTMLInputElement>('input:not([type="hidden"])')) {
    if (field.disabled) continue
    if (field.type === 'checkbox' || field.type === 'radio') {
      if (field.checked !== field.defaultChecked) return true
    } else if (field.value !== field.defaultValue) return true
  }
  for (const area of modal.querySelectorAll<HTMLTextAreaElement>('textarea'))
    if (!area.disabled && area.value !== area.defaultValue) return true
  for (const select of modal.querySelectorAll<HTMLSelectElement>('select')) {
    if (select.disabled) continue
    for (const option of select.options) if (option.selected !== option.defaultSelected) return true
  }
  return false
}

/**
 * The guard, and what it is not.
 *
 * Leaving a modal is a link, and a link still works with scripting off — that is
 * the point of building it as one. So this catches the stray backdrop click, the
 * reflexive Escape and the tab clicked without thinking about the note already
 * typed; it is not a lock, and nothing here should be read as one. The wording
 * comes from the server because this file cannot translate.
 */
const mayLeaveModal = (modal: HTMLElement): boolean => {
  if (!modalHasDraft(modal)) return true
  const message = modal.getAttribute('data-unsaved-prompt')
  // No prompt declared means the screen did not ask to be guarded.
  if (!message) return true
  return browserGlobals.confirm(message)
}

/** Progressive keyboard behavior for URL-owned create/edit workspaces. */
/**
 * Hear when the thing a screen is waiting for actually changed.
 *
 * The screens this replaces reloaded the whole document on a timer, which threw
 * away scroll, focus and anything typed, on a schedule unrelated to when the
 * work finished. Here the server says so, and the page asks for the fragment it
 * already knows how to swap — so the reader keeps their place.
 *
 * The connection belongs to the element. A fragment swap replaces it, and the
 * observer opens the new one and closes the old; a screen with nothing to wait
 * for renders no element and opens nothing.
 */
const installLiveRegion = (signal: AbortSignal, navigation: BrowserNavigation): (() => void) | undefined => {
  if (typeof EventSource !== 'function') return

  let watched: Element | null = null
  let source: EventSource | null = null
  const close = () => {
    source?.close()
    source = null
    watched = null
  }

  const sync = (): void => {
    const region = document.querySelector('[data-ui="live-region"][data-stream]')
    if (region === watched) return
    close()
    const id = region instanceof HTMLElement ? (region.dataset.stream ?? '') : ''
    if (!id) return
    watched = region
    source = new EventSource(`/_ket/stream/${encodeURIComponent(id)}`)
    // What the chunk says is the deployment's business. That something was said
    // is the whole signal: the screen is server-rendered, so the way to find out
    // what changed is to ask for it.
    const refresh = () => navigateTo(location.href, navigation)
    source.onmessage = refresh
    source.addEventListener('done', () => {
      close()
      refresh()
    })
    // EventSource reconnects on its own, and a stream that has ended answers 404
    // rather than reopening. Leaving the error alone would retry that forever.
    source.onerror = () => {
      if (source?.readyState === EventSource.CLOSED) close()
    }
  }

  sync()
  const observer = new MutationObserver(sync)
  observer.observe(document.body, { childList: true, subtree: true })
  addEventListener('pagehide', close, { signal })
  return () => {
    observer.disconnect()
    close()
  }
}

const installRouteModal = (signal: AbortSignal, navigation: BrowserNavigation): (() => void) => {
  const focused = new WeakSet<HTMLElement>()
  const focusModal = (): void => {
    const modal = activeRouteModal()
    if (!modal || focused.has(modal)) return
    focused.add(modal)
    requestAnimationFrame(() => {
      const sheet = modal.querySelector<HTMLElement>('[data-ui="modal-sheet"]')
      const target = modalFocusables(modal).find((item) => !item.matches('[data-ui="modal-close"]'))
      ;(target ?? sheet)?.focus()
    })
  }
  focusModal()
  const observer = new MutationObserver(focusModal)
  observer.observe(document.body, { childList: true, subtree: true })

  // The backdrop and the X are ordinary links, so the guard has to run before
  // the navigation layer sees the click rather than inside it.
  document.addEventListener(
    'click',
    (event) => {
      const modal = activeRouteModal()
      if (!modal) return
      // A tab inside a modal is a third way out of it. It looks like a control
      // that stays on the screen, which is exactly why losing a half-written
      // note to one went unnoticed: the reader never meant to leave. It is a
      // link like the other two, and it leaves the same way.
      const leaving = event
        .composedPath()
        .find(
          (target) =>
            target instanceof HTMLElement &&
            (target.matches('[data-ui="modal-close"], [data-ui="modal-backdrop"], a[data-ui="tab"]') ||
              target.matches('a[data-ui="action"][href]')),
        )
      if (!leaving || !modal.contains(leaving as HTMLElement)) return
      if (!mayLeaveModal(modal)) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    { capture: true, signal },
  )

  document.addEventListener(
    'click',
    (event) => {
      const container = document.querySelector<HTMLElement>('[data-save-before-navigation]')
      const form =
        container instanceof HTMLFormElement ? container : container?.querySelector<HTMLFormElement>('form')
      const anchor = eventElement(event)?.closest<HTMLAnchorElement>('a[href]')
      if (!container || !form || !anchor || activeRouteModal() || !modalHasDraft(container)) return
      event.preventDefault()
      event.stopPropagation()
      if (!browserGlobals.confirm(container.dataset.saveBeforeNavigation)) return
      let destination = form.querySelector<HTMLInputElement>('input[name="returnTo"]')
      if (!destination) {
        destination = document.createElement('input')
        destination.type = 'hidden'
        destination.name = 'returnTo'
        form.append(destination)
      }
      destination.value = anchor.href
      form.requestSubmit()
    },
    { capture: true, signal },
  )
  document.addEventListener(
    'keydown',
    (event) => {
      const modal = activeRouteModal()
      if (!modal) return
      // Relation-select removes its dialog synchronously on Escape. The event's
      // composed path is stable even after that DOM subtree disappears, so the
      // route layer must use it instead of querying the now-removed target.
      if (eventStartedInNestedModal(event, modal)) return
      if (event.key === 'Escape') {
        const close = modal.querySelector<HTMLAnchorElement>('[data-ui="modal-close"]')
        if (!close) return
        event.preventDefault()
        if (!mayLeaveModal(modal)) return
        navigateTo(close.getAttribute('href') ?? close.href, navigation)
        return
      }
      if (event.key !== 'Tab') return
      const items = modalFocusables(modal)
      if (!items.length) return
      const first = items[0]
      const last = items.at(-1)!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    },
    { signal },
  )
  return () => observer.disconnect()
}

export const backendShell: BrowserBehavior = ({ navigation, lifetime }) => {
  const cleanupDesignSystem = attachDesignSystemInteractions(document)
  const cleanupUserWorkflow = installUserWorkflow(lifetime)
  installThemeToggle(lifetime)
  installTableSelection(lifetime, navigation)
  installDropdownDismiss(lifetime)
  installGlobalFilter(lifetime)
  const cleanupRouteModal = installRouteModal(lifetime, navigation)
  const cleanupLiveRegion = installLiveRegion(lifetime, navigation)
  return () => {
    cleanupDesignSystem()
    cleanupLiveRegion?.()
    cleanupRouteModal()
    cleanupUserWorkflow()
  }
}
