// @ts-nocheck Global enhancement for selectable backend tables and linked rows.
// @ts-expect-error Browser import served by the KetJS runtime.
import { html } from '/_ket/view/index.js'
import { createTableSelectionView } from './table-selection-view.mjs'

const tableSelectionMarker = Symbol.for('ket.backend.table-selection')
const dropdownDismissMarker = Symbol.for('ket.backend.dropdown-dismiss')
const globalFilterMarker = Symbol.for('ket.backend.global-filter')
const dismissibleDropdown = [
  '[data-ui="search-menu"]',
  '[data-ui="col-config"]',
  '[data-ui="bulk-actions"]',
  '[data-ui="viewer"]',
].join(', ')

const updateSelection = (table) => {
  const rows = [...table.querySelectorAll('[data-ui="row-select"]:not(:disabled)')]
  const checked = rows.filter((input) => input.checked).length
  const all = table.querySelector('[data-ui="select-all"]')
  if (all) {
    all.checked = rows.length > 0 && checked === rows.length
    all.indeterminate = checked > 0 && checked < rows.length
  }
  if (!checked) {
    const shell = table.closest('[data-ui="shell"]')
    for (const menu of shell?.querySelectorAll('[data-ui="bulk-actions"][open]') ?? [])
      menu.removeAttribute('open')
  }
}

const installTableSelection = () => {
  if (globalThis[tableSelectionMarker]) return
  globalThis[tableSelectionMarker] = true

  document.addEventListener('change', (event) => {
    const target = event.target
    if (!target?.matches?.('[data-ui="select-all"], [data-ui="row-select"]')) return
    const table = target.closest('[data-ui="table"]')
    if (!table) return
    if (target.matches('[data-ui="select-all"]'))
      for (const input of table.querySelectorAll('[data-ui="row-select"]:not(:disabled)'))
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
    const target = event.target
    if (
      target?.closest?.(
        'a, button, input, select, textarea, label, summary, details, [data-ui="select-cell"]',
      )
    )
      return
    const row = target?.closest?.('[data-ui="row"][data-row-href]')
    const href = row?.getAttribute('data-row-href')
    if (!href) return
    event.preventDefault()
    if (globalThis.__ketNavigation?.navigate) void globalThis.__ketNavigation.navigate(href)
    else globalThis.location.assign(href)
  })
}

const openDropdowns = () => [...document.querySelectorAll(`${dismissibleDropdown}[open]`)]

const installDropdownDismiss = () => {
  if (globalThis[dropdownDismissMarker]) return
  globalThis[dropdownDismissMarker] = true

  document.addEventListener('click', (event) => {
    const current = event.target?.closest?.(dismissibleDropdown)
    for (const dropdown of openDropdowns()) {
      if (dropdown !== current && !dropdown.contains(current)) dropdown.removeAttribute('open')
    }
  })

  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return
    const dropdowns = openDropdowns()
    if (!dropdowns.length) return
    const focused = document.activeElement?.closest?.(dismissibleDropdown)
    const current = focused?.open ? focused : dropdowns.at(-1)
    current?.removeAttribute('open')
    current?.querySelector('summary')?.focus()
    event.preventDefault()
  })
}

const installGlobalFilter = () => {
  if (globalThis[globalFilterMarker]) return
  globalThis[globalFilterMarker] = true

  document.addEventListener('click', (event) => {
    const trigger = event.target?.closest?.('[data-ui="chrome-search-toggle"]')
    if (trigger) {
      const dialog = document.getElementById(trigger.getAttribute('aria-controls'))
      if (dialog?.showModal && !dialog.open) {
        dialog.showModal()
        trigger.setAttribute('aria-expanded', 'true')
        requestAnimationFrame(() =>
          dialog.querySelector('[data-presentation="modal"] [data-ui="chrome-search-input"]')?.focus(),
        )
      }
      return
    }
  })

  document.addEventListener(
    'cancel',
    (event) => {
      if (!event.target?.matches?.('[data-ui="chrome-search-modal"]')) return
      event.preventDefault()
    },
    true,
  )

  document.addEventListener(
    'close',
    (event) => {
      const dialog = event.target
      if (!dialog?.matches?.('[data-ui="chrome-search-modal"]')) return
      const trigger = document.querySelector(`[data-ui="chrome-search-toggle"][aria-controls="${dialog.id}"]`)
      trigger?.setAttribute('aria-expanded', 'false')
      trigger?.focus()
    },
    true,
  )
}

export const tableSelection = () => {
  installTableSelection()
  installDropdownDismiss()
  installGlobalFilter()
  return createTableSelectionView({ html })
}
