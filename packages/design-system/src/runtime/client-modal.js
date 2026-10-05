/**
 * Layers inside the sheet that Escape closes first. The design-system runtime
 * dismisses them on the bubbling keydown; the sheet must not close underneath.
 */
const INNER_LAYERS_OPEN = [
  '[data-ui="menu"][open]',
  '[data-ui="timeframe-menu"][open]',
  '[data-ui="view-settings"][open]',
  '[data-ui="popover"][data-open="true"]',
  '[data-ui="tooltip"]:not([data-dismissed="true"]):is(:hover, :focus-within)',
].join(', ')

/**
 * Focus lifetime for a server-rendered client ModalSheet. The application owns
 * opening/closing and calls the disposer before replacing the active layer.
 * Native close buttons retain the application's event handler; no navigation is
 * invented for a client modal. Embedded sheets and native dialog owners are ignored.
 * @param {Document | HTMLElement} [root]
 * @returns {() => void}
 */
export const attachClientModalInteractions = (root = document) => {
  const layer = root.querySelector('[data-ui="modal-layer"][data-client-modal="true"]')
  const modal = layer?.querySelector('[data-ui="modal-sheet"][role="dialog"]')
  if (!(layer instanceof HTMLElement) || !(modal instanceof HTMLElement)) return () => {}
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
  /** @type {{element: HTMLElement, inert: boolean}[]} */
  const siblings = []
  for (let current = layer; current !== root && current.parentElement; current = current.parentElement) {
    for (const sibling of current.parentElement.children) {
      if (sibling instanceof HTMLElement && sibling !== current) {
        siblings.push({ element: sibling, inert: sibling.inert })
        sibling.inert = true
      }
    }
  }
  const focusables = () =>
    [...modal.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter(
      (element) =>
        element instanceof HTMLElement &&
        !element.matches(':disabled, [tabindex="-1"]') &&
        !element.closest('[hidden], [inert]') &&
        element.getClientRects().length > 0,
    )
  const first = focusables()[0]
  ;(first instanceof HTMLElement ? first : modal).focus()
  /** @param {KeyboardEvent} event */
  const keydown = (event) => {
    if (event.key === 'Escape') {
      if (modal.querySelector(INNER_LAYERS_OPEN)) return
      const close = modal.querySelector('[data-ui="modal-close"]')
      if (close instanceof HTMLElement) close.click()
      event.preventDefault()
      event.stopPropagation()
    } else if (event.key === 'Tab') {
      const items = focusables(),
        first = items[0],
        last = items.at(-1)
      if (!items.length) {
        event.preventDefault()
        modal.focus()
      } else if (event.shiftKey && (document.activeElement === first || document.activeElement === modal)) {
        event.preventDefault()
        if (last instanceof HTMLElement) last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        if (first instanceof HTMLElement) first.focus()
      }
    }
  }
  // Capture Escape before an application's generic window shortcut can also close it.
  document.addEventListener('keydown', keydown, true)
  return () => {
    document.removeEventListener('keydown', keydown, true)
    for (const { element, inert } of siblings) element.inert = inert
    if (previous?.isConnected) previous.focus()
  }
}
