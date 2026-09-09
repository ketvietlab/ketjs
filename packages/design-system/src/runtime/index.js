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
      element instanceof HTMLElement &&
      !element.hidden &&
      element.getAttribute('aria-hidden') !== 'true' &&
      (typeof element.checkVisibility !== 'function' || element.checkVisibility()),
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

  const navigationMedia = window.matchMedia('(max-width: 48rem)')
  const navigationRoot = document.documentElement
  const priorNavigationOpen = navigationRoot.dataset.kvNavigationOpen
  const navigations = /** @type {HTMLDetailsElement[]} */ (
    [...root.querySelectorAll('[data-ui="app-navigation"]')].filter(
      (navigation) => navigation instanceof HTMLDetailsElement,
    )
  )
  const navigationStates = new Map()

  /** @param {HTMLDetailsElement} navigation */
  const restoreNavigationTargets = (navigation) => {
    const state = navigationStates.get(navigation)
    if (!state?.targets) return
    for (const { element, inert } of state.targets) element.inert = inert
    state.targets = null
  }

  const syncNavigationLock = () => {
    const hasOpenNavigation = navigationMedia.matches && navigations.some((navigation) => navigation.open)
    if (hasOpenNavigation) navigationRoot.dataset.kvNavigationOpen = 'true'
    else if (priorNavigationOpen === undefined) delete navigationRoot.dataset.kvNavigationOpen
    else navigationRoot.dataset.kvNavigationOpen = priorNavigationOpen
  }

  /** @param {HTMLDetailsElement} navigation */
  const syncNavigation = (navigation) => {
    const trigger = navigation.querySelector('[data-ui="navigation-trigger"]')
    const drawer = navigation.querySelector('[data-ui="navigation-drawer"]')
    if (!(trigger instanceof HTMLElement) || !(drawer instanceof HTMLElement)) return
    const mobile = navigationMedia.matches
    trigger.dataset.open = String(mobile && navigation.open)
    if (!mobile) {
      drawer.removeAttribute('role')
      drawer.removeAttribute('aria-modal')
      drawer.removeAttribute('aria-label')
      restoreNavigationTargets(navigation)
      syncNavigationLock()
      return
    }
    drawer.setAttribute('role', 'dialog')
    drawer.setAttribute('aria-modal', 'true')
    drawer.setAttribute('aria-label', drawer.dataset.navigationLabel ?? 'Navigation')
    if (!navigation.open) {
      restoreNavigationTargets(navigation)
      syncNavigationLock()
      return
    }
    const state = navigationStates.get(navigation) ?? {}
    if (!state.targets) {
      const shell = navigation.closest('[data-ui="app-shell"]')
      const targets = shell
        ? [...shell.querySelectorAll(':scope > [data-ui="app-main"], :scope > [data-ui="app-right-rail"]')]
            .filter((element) => element instanceof HTMLElement)
            .map((element) => ({ element, inert: element.inert }))
        : []
      for (const { element } of targets) element.inert = true
      state.targets = targets
      state.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : trigger
      navigationStates.set(navigation, state)
      queueMicrotask(() => {
        if (!navigation.open || !navigationMedia.matches) return
        const activeItem = drawer.querySelector('[data-ui="navigation-item"][aria-current="page"]')
        const first = focusables(drawer)[0]
        const focusTarget = activeItem instanceof HTMLElement ? activeItem : first
        ;(focusTarget instanceof HTMLElement ? focusTarget : drawer).focus()
      })
    }
    syncNavigationLock()
  }

  /** @param {HTMLDetailsElement} navigation @param {boolean} [returnFocus] */
  const closeNavigation = (navigation, returnFocus = true) => {
    const state = navigationStates.get(navigation)
    navigation.open = false
    syncNavigation(navigation)
    if (returnFocus && state?.returnFocus instanceof HTMLElement && state.returnFocus.isConnected)
      state.returnFocus.focus()
    navigationStates.delete(navigation)
  }

  const navigationCleanups = navigations.map((navigation) => {
    const onToggle = () => syncNavigation(navigation)
    /** @param {MouseEvent} event */
    const onClick = (event) => {
      if (!navigationMedia.matches || !navigation.open) return
      const target = event.target
      if (!(target instanceof Element)) return
      if (
        target.closest('[data-ui="navigation-close"]') ||
        target.closest('[data-ui="navigation-backdrop"]') ||
        target.closest('[data-ui="navigation-item"]')
      )
        closeNavigation(navigation)
    }
    navigation.addEventListener('toggle', onToggle)
    navigation.addEventListener('click', onClick)
    syncNavigation(navigation)
    return () => {
      navigation.removeEventListener('toggle', onToggle)
      navigation.removeEventListener('click', onClick)
      restoreNavigationTargets(navigation)
    }
  })
  const onNavigationMediaChange = () => {
    for (const navigation of navigations) {
      if (navigation.open) closeNavigation(navigation, false)
      else syncNavigation(navigation)
    }
  }
  navigationMedia.addEventListener('change', onNavigationMediaChange)

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
    const openNavigation = navigations.find((navigation) => navigationMedia.matches && navigation.open)
    if (openNavigation instanceof HTMLDetailsElement) {
      const drawer = openNavigation.querySelector('[data-ui="navigation-drawer"]')
      if (event.key === 'Escape') {
        closeNavigation(openNavigation)
        event.preventDefault()
        return
      }
      if (event.key === 'Tab' && drawer instanceof HTMLElement) {
        const items = focusables(drawer)
        const first = items[0]
        const last = items.at(-1)
        if (!items.length) {
          event.preventDefault()
          drawer.focus()
          return
        }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === drawer)) {
          event.preventDefault()
          if (last instanceof HTMLElement) last.focus()
          return
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          if (first instanceof HTMLElement) first.focus()
          return
        }
      }
    }
    const treeItem = document.activeElement?.closest('[data-ui="tree"] [role="treeitem"]')
    if (treeItem instanceof HTMLElement) {
      const tree = treeItem.closest('[data-ui="tree"]')
      const items = /** @type {HTMLElement[]} */ (
        tree
          ? [...tree.querySelectorAll('[role="treeitem"]')].filter((item) => item instanceof HTMLElement)
          : []
      )
      const activeIndex = items.indexOf(treeItem)
      let nextIndex = -1
      if (event.key === 'ArrowDown') nextIndex = Math.min(items.length - 1, activeIndex + 1)
      else if (event.key === 'ArrowUp') nextIndex = Math.max(0, activeIndex - 1)
      else if (event.key === 'Home') nextIndex = 0
      else if (event.key === 'End') nextIndex = items.length - 1
      else if (event.key === 'ArrowRight') {
        const level = Number(treeItem.getAttribute('aria-level'))
        if (
          treeItem.getAttribute('aria-expanded') === 'true' &&
          Number(items[activeIndex + 1]?.getAttribute('aria-level')) > level
        )
          nextIndex = activeIndex + 1
      } else if (event.key === 'ArrowLeft') {
        const level = Number(treeItem.getAttribute('aria-level'))
        if (level > 1)
          nextIndex = items.findLastIndex(
            (item, index) => index < activeIndex && Number(item.getAttribute('aria-level')) < level,
          )
      }
      if (nextIndex >= 0 && items[nextIndex]) {
        for (const item of items) item.tabIndex = -1
        items[nextIndex].tabIndex = 0
        items[nextIndex].focus()
        event.preventDefault()
        return
      }
    }
    const treeGridRow = document.activeElement?.closest('[data-ui="tree-grid-row"]')
    if (treeGridRow instanceof HTMLElement) {
      const grid = treeGridRow.closest('[data-ui="tree-grid"]')
      const rows = /** @type {HTMLElement[]} */ (
        grid
          ? [...grid.querySelectorAll('[data-ui="tree-grid-row"]')].filter(
              (row) => row instanceof HTMLElement,
            )
          : []
      )
      const activeIndex = rows.indexOf(treeGridRow)
      const nextIndex =
        event.key === 'ArrowDown'
          ? Math.min(rows.length - 1, activeIndex + 1)
          : event.key === 'ArrowUp'
            ? Math.max(0, activeIndex - 1)
            : event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? rows.length - 1
                : -1
      if (nextIndex >= 0 && rows[nextIndex]) {
        for (const row of rows) row.tabIndex = -1
        rows[nextIndex].tabIndex = 0
        rows[nextIndex].focus()
        event.preventDefault()
        return
      }
    }
    const openMenu = document.activeElement?.closest('[data-ui="menu"][open]')
    if (openMenu instanceof HTMLDetailsElement) {
      const trigger = openMenu.querySelector('[data-ui="menu-trigger"]')
      const items = /** @type {HTMLElement[]} */ (
        [...openMenu.querySelectorAll('[role="menuitem"]')].filter(
          (item) => item instanceof HTMLElement && item.getAttribute('aria-disabled') !== 'true',
        )
      )
      const active = document.activeElement
      const activeIndex = active instanceof HTMLElement ? items.indexOf(active) : -1
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
  /** @param {MouseEvent} event */
  const onDocumentClick = (event) => {
    const target = event.target
    if (!(target instanceof Node)) return
    for (const menu of root.querySelectorAll('[data-ui="menu"][open]')) {
      if (menu instanceof HTMLDetailsElement && !menu.contains(target)) menu.open = false
    }
  }
  document.addEventListener('keydown', onKeydown)
  document.addEventListener('click', onDocumentClick)

  return () => {
    document.removeEventListener('keydown', onKeydown)
    document.removeEventListener('click', onDocumentClick)
    navigationMedia.removeEventListener('change', onNavigationMediaChange)
    for (const cleanup of navigationCleanups) cleanup()
    if (priorNavigationOpen === undefined) delete navigationRoot.dataset.kvNavigationOpen
    else navigationRoot.dataset.kvNavigationOpen = priorNavigationOpen
    if (appShell instanceof HTMLElement) appShell.inert = priorInert
    if (activeBeforeOpen?.isConnected) activeBeforeOpen.focus()
  }
}
