// @ts-check

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

/** @param {ParentNode} root */
const focusables = (root) =>
  [...root.querySelectorAll(focusableSelector)].filter(
    (element) =>
      element instanceof HTMLElement && !element.hidden && element.getAttribute('aria-hidden') !== 'true',
  )

/**
 * Attach the small browser contract shared by server-rendered overlays.
 * The returned function restores inert state and removes every listener.
 *
 * @param {ParentNode} [root]
 * @returns {() => void}
 */
export const attachDesignSystemInteractions = (root = document) => {
  const activeBeforeOpen = document.activeElement instanceof HTMLElement ? document.activeElement : null
  const modal = root.querySelector('[data-ui="modal-layer"][data-route-modal="true"] [role="dialog"]')
  const appShell = root.querySelector('[data-ui="app-shell"]')
  const priorInert = appShell instanceof HTMLElement ? appShell.inert : false
  if (modal instanceof HTMLElement) {
    if (appShell instanceof HTMLElement && !appShell.contains(modal)) appShell.inert = true
    const first = focusables(modal)[0]
    ;(first instanceof HTMLElement ? first : modal).focus()
  }

  for (const popover of root.querySelectorAll('[data-ui="popover"][data-open="true"]')) {
    const trigger = popover.querySelector('[data-ui="popover-trigger"]')
    const panel = popover.querySelector('[data-ui="popover-panel"]')
    if (!(trigger instanceof HTMLElement) || !(panel instanceof HTMLElement)) continue
    const box = trigger.getBoundingClientRect()
    const gap = 8
    const left = Math.max(8, Math.min(box.left, window.innerWidth - panel.offsetWidth - 8))
    const below = box.bottom + gap
    const top =
      below + panel.offsetHeight <= window.innerHeight
        ? below
        : Math.max(8, box.top - panel.offsetHeight - gap)
    panel.dataset.runtimePositioned = 'true'
    panel.style.left = `${Math.round(left)}px`
    panel.style.top = `${Math.round(top)}px`
    panel.style.right = 'auto'
    panel.style.bottom = 'auto'
  }

  /** @param {KeyboardEvent} event */
  const onKeydown = (event) => {
    const openMenu = document.activeElement?.closest('[data-ui="menu"][open]')
    if (event.key === 'Escape' && openMenu instanceof HTMLDetailsElement) {
      openMenu.open = false
      const trigger = openMenu.querySelector('[data-ui="menu-trigger"]')
      if (trigger instanceof HTMLElement) trigger.focus()
      event.preventDefault()
      return
    }
    if (!(modal instanceof HTMLElement)) return
    if (event.key === 'Escape') {
      const close = modal.querySelector('[data-ui="modal-close"]')
      if (close instanceof HTMLElement) close.click()
      event.preventDefault()
      return
    }
    if (event.key !== 'Tab') return
    const items = focusables(modal)
    if (!items.length) {
      event.preventDefault()
      modal.focus()
      return
    }
    const first = items[0]
    const last = items.at(-1)
    if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
      event.preventDefault()
      if (last instanceof HTMLElement) last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      if (first instanceof HTMLElement) first.focus()
    }
  }
  document.addEventListener('keydown', onKeydown)

  return () => {
    document.removeEventListener('keydown', onKeydown)
    if (appShell instanceof HTMLElement) appShell.inert = priorInert
    if (activeBeforeOpen?.isConnected) activeBeforeOpen.focus()
  }
}
