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
    const placement = popover.getAttribute('data-placement') ?? 'bottom-start'
    const prefersTop = placement.startsWith('top')
    const prefersEnd = placement.endsWith('end')
    const topPosition = box.top - panel.offsetHeight - gap
    const bottomPosition = box.bottom + gap
    const topFits = topPosition >= 8
    const bottomFits = bottomPosition + panel.offsetHeight <= window.innerHeight - 8
    const useTop = prefersTop ? topFits || !bottomFits : !bottomFits && topFits
    const requestedLeft = prefersEnd ? box.right - panel.offsetWidth : box.left
    const left = Math.max(8, Math.min(requestedLeft, window.innerWidth - panel.offsetWidth - 8))
    const top = Math.max(
      8,
      Math.min(useTop ? topPosition : bottomPosition, window.innerHeight - panel.offsetHeight - 8),
    )
    panel.dataset.runtimePositioned = 'true'
    panel.dataset.runtimePlacement = `${useTop ? 'top' : 'bottom'}-${prefersEnd ? 'end' : 'start'}`
    panel.style.left = `${Math.round(left)}px`
    panel.style.top = `${Math.round(top)}px`
    panel.style.right = 'auto'
    panel.style.bottom = 'auto'
  }

  /** @param {KeyboardEvent} event */
  const onKeydown = (event) => {
    const openMenu = document.activeElement?.closest('[data-ui="menu"][open]')
    if (openMenu instanceof HTMLDetailsElement) {
      const trigger = openMenu.querySelector('[data-ui="menu-trigger"]')
      const items = /** @type {HTMLElement[]} */ (
        [...openMenu.querySelectorAll('[role="menuitem"]')].filter(
          (item) => item instanceof HTMLElement && item.getAttribute('aria-disabled') !== 'true',
        )
      )
      const activeIndex = items.findIndex((item) => item === document.activeElement)
      let nextIndex = -1
      if (event.key === 'ArrowDown') nextIndex = activeIndex < 0 ? 0 : (activeIndex + 1) % items.length
      else if (event.key === 'ArrowUp')
        nextIndex = activeIndex < 0 ? items.length - 1 : (activeIndex - 1 + items.length) % items.length
      else if (event.key === 'Home') nextIndex = 0
      else if (event.key === 'End') nextIndex = items.length - 1
      if (nextIndex >= 0 && items[nextIndex] instanceof HTMLElement) {
        items[nextIndex].focus()
        event.preventDefault()
        return
      }
      if ((event.key === 'Enter' || event.key === ' ') && document.activeElement === trigger) {
        if (items[0] instanceof HTMLElement) items[0].focus()
        event.preventDefault()
        return
      }
    }
    if (event.key === 'Escape' && openMenu instanceof HTMLDetailsElement) {
      openMenu.open = false
      const trigger = openMenu.querySelector('[data-ui="menu-trigger"]')
      if (trigger instanceof HTMLElement) trigger.focus()
      event.preventDefault()
      return
    }
    const openPopover = document.activeElement?.closest('[data-ui="popover"][data-open="true"]')
    if (event.key === 'Escape' && openPopover instanceof HTMLElement) {
      const close = openPopover.querySelector('[data-ui="popover-close"]')
      if (close instanceof HTMLElement) close.click()
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
