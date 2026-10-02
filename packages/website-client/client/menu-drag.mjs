// Pointer drag is confined to the grip, so touch scrolling and editing stay native elsewhere.
export function menuPointerDrag(event, id, canDrop, move, announce, resolveDrop) {
  if (event.button !== 0) return () => {}
  const handle = event.currentTarget
  const root = handle.closest('[data-menu-editor]')
  const doc = handle.ownerDocument
  const win = doc.defaultView
  const startX = event.clientX,
    startY = event.clientY
  let target = null,
    mode = 'before',
    active = false,
    frame = null,
    y = startY
  event.preventDefault()
  handle.setPointerCapture?.(event.pointerId)
  const clear = () =>
    root.querySelectorAll('[data-menu-drop]').forEach((row) => {
      row.removeAttribute('data-menu-drop')
    })
  const scroll = () => {
    if (!root.isConnected) {
      cancel()
      return
    }
    if (active) {
      if (y < 70) win.scrollBy(0, -12)
      else if (y > win.innerHeight - 70) win.scrollBy(0, 12)
    }
    frame = win.requestAnimationFrame(scroll)
  }
  const pointerMove = (e) => {
    if (e.pointerId !== event.pointerId) return
    y = e.clientY
    if (!active && Math.hypot(e.clientX - startX, y - startY) < 6) return
    active = true
    clear()
    let row = doc.elementFromPoint(e.clientX, y)?.closest('[data-menu-item]')
    // An outdent crosses the item's empty left margin; retain the row by vertical position.
    if (!row) {
      const tree = root.querySelector('.website-menu-structure')
      const bounds = tree?.getBoundingClientRect()
      if (bounds && e.clientX >= bounds.left && e.clientX <= bounds.right)
        row = [...tree.querySelectorAll('[data-menu-item]')].find((item) => {
          const rect = item.getBoundingClientRect()
          return y >= rect.top && y <= rect.bottom
        })
    }
    target = row && root.contains(row) ? row.dataset.menuItem : null
    if (!target) return
    const box = row.getBoundingClientRect()
    const ratio = (y - box.top) / box.height
    mode = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside'
    const plan = resolveDrop
      ? resolveDrop(target, mode, e.clientX - startX)
      : { targetId: target, placement: mode, label: row.dataset.menuLabel }
    if (!plan || !canDrop(id, plan.targetId)) {
      target = null
      return
    }
    target = plan.targetId
    mode = plan.placement
    const indicator =
      target === row.dataset.menuItem
        ? row
        : [...root.querySelectorAll('[data-menu-item]')].find((item) => item.dataset.menuItem === target)
    if (indicator) indicator.dataset.menuDrop = mode
    announce(mode, plan.label)
  }
  const cleanup = () => {
    clear()
    win.cancelAnimationFrame(frame)
    win.removeEventListener('pointermove', pointerMove)
    win.removeEventListener('pointerup', end)
    win.removeEventListener('pointercancel', cancel)
    win.removeEventListener('keydown', key)
    if (handle.hasPointerCapture?.(event.pointerId)) handle.releasePointerCapture(event.pointerId)
  }
  const cancel = () => {
    cleanup()
    announce(null)
  }
  const end = (e) => {
    if (e.pointerId !== event.pointerId) return
    cleanup()
    if (active && target) move(id, target, mode)
    announce(null)
  }
  const key = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      cancel()
    }
  }
  win.addEventListener('pointermove', pointerMove)
  win.addEventListener('pointerup', end)
  win.addEventListener('pointercancel', cancel)
  win.addEventListener('keydown', key)
  frame = win.requestAnimationFrame(scroll)
  return cleanup
}

const KEY_STEPS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'out', ArrowRight: 'in' }
// The rows re-render in their new order, so focus would stay on whichever grip now sits where
// the moved one was and the next arrow would move a different item. Follow the moved item.
export function menuKeyboardMove(event, id, step) {
  const direction = KEY_STEPS[event.key]
  if (!direction) return false
  event.preventDefault()
  const root = event.currentTarget.closest('[data-menu-editor]')
  step(id, direction)
  root?.ownerDocument.defaultView.requestAnimationFrame(() => {
    const row = [...root.querySelectorAll('[data-menu-item]')].find((el) => el.dataset.menuItem === id)
    row?.querySelector('.website-menu-grip button')?.focus({ preventScroll: true })
  })
  return true
}
