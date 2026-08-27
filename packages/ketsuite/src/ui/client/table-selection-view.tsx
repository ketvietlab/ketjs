import type { IslandController, IslandProps } from '@ketvietlab/ketjs-view'

const tableSelectionMarker = Symbol.for('ket.backend.table-selection')
const dropdownDismissMarker = Symbol.for('ket.backend.dropdown-dismiss')
const globalFilterMarker = Symbol.for('ket.backend.global-filter')
const routeModalMarker = Symbol.for('ket.backend.route-modal')
const dismissibleDropdown = [
  '[data-ui="search-menu"]',
  '[data-ui="col-config"]',
  '[data-ui="bulk-actions"]',
  '[data-ui="viewer"]',
  '[data-ui="record-more"]',
].join(', ')

type KetBrowserGlobals = typeof globalThis & {
  [key: symbol]: unknown
  __ketNavigation?: { navigate?: (href: string) => unknown }
}

const browserGlobals = globalThis as KetBrowserGlobals
const eventElement = (event: Event): Element | null => (event.target instanceof Element ? event.target : null)

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

const installTableSelection = (): void => {
  if (browserGlobals[tableSelectionMarker]) return
  browserGlobals[tableSelectionMarker] = true

  document.addEventListener('change', (event) => {
    const target = eventElement(event)
    if (!(target instanceof HTMLInputElement)) return
    if (!target.matches('[data-ui="select-all"], [data-ui="row-select"]')) return
    const table = target.closest('[data-ui="table"]')
    if (!table) return
    if (target.matches('[data-ui="select-all"]'))
      for (const input of table.querySelectorAll<HTMLInputElement>('[data-ui="row-select"]:not(:disabled)'))
        input.checked = target.checked
    updateSelection(table)
  })

  document.addEventListener('click', (event) => {
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
      target?.closest('a, button, input, select, textarea, label, summary, details, [data-ui="select-cell"]')
    )
      return
    const row = target?.closest<HTMLElement>('[data-ui="row"][data-row-href]')
    const href = row?.getAttribute('data-row-href')
    if (!href) return
    event.preventDefault()
    if (browserGlobals.__ketNavigation?.navigate) void browserGlobals.__ketNavigation.navigate(href)
    else browserGlobals.location.assign(href)
  })
}

const openDropdowns = (): HTMLDetailsElement[] => [
  ...document.querySelectorAll<HTMLDetailsElement>(`${dismissibleDropdown}[open]`),
]

const installDropdownDismiss = (): void => {
  if (browserGlobals[dropdownDismissMarker]) return
  browserGlobals[dropdownDismissMarker] = true

  document.addEventListener('click', (event) => {
    const current = eventElement(event)?.closest(dismissibleDropdown)
    for (const dropdown of openDropdowns()) {
      if (dropdown !== current && !dropdown.contains(current ?? null)) dropdown.removeAttribute('open')
    }
  })

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    const dropdowns = openDropdowns()
    if (!dropdowns.length) return
    const focused = document.activeElement?.closest<HTMLDetailsElement>(dismissibleDropdown)
    const current = focused?.open ? focused : dropdowns.at(-1)
    current?.removeAttribute('open')
    current?.querySelector<HTMLElement>('summary')?.focus()
    event.preventDefault()
  })
}

const installGlobalFilter = (): void => {
  if (browserGlobals[globalFilterMarker]) return
  browserGlobals[globalFilterMarker] = true

  document.addEventListener('click', (event) => {
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
  })

  document.addEventListener(
    'cancel',
    (event) => {
      if (!eventElement(event)?.matches('[data-ui="chrome-search-modal"]')) return
      event.preventDefault()
    },
    true,
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
    true,
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

const navigateTo = (href: string): void => {
  if (browserGlobals.__ketNavigation?.navigate) void browserGlobals.__ketNavigation.navigate(href)
  else browserGlobals.location.assign(href)
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

/** Progressive keyboard behavior for URL-owned create/edit workspaces. */
const installRouteModal = (): void => {
  if (browserGlobals[routeModalMarker]) return
  browserGlobals[routeModalMarker] = true
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
  new MutationObserver(focusModal).observe(document.body, { childList: true, subtree: true })

  document.addEventListener('keydown', (event) => {
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
      navigateTo(close.getAttribute('href') ?? close.href)
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
  })
}

export const createTableSelectionView = (): IslandController => ({
  view: () => <span data-ui="table-selection-runtime" hidden />,
})

export const tableSelection = (_props: IslandProps): IslandController => {
  installTableSelection()
  installDropdownDismiss()
  installGlobalFilter()
  installRouteModal()
  return createTableSelectionView()
}
