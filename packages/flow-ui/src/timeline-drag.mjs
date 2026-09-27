/** Gantt gesture geometry only; consumers own dates, permissions and persistence.
 * @param {HTMLElement} root @param {AbortSignal} signal */
export function attachTimelineDrag(root, signal) {
  /** @type {{source:HTMLElement,scroll:HTMLElement,pointer:number,x:number,y:number,left:number,width:number,start:number,span:number,mode:'move'|'start'|'end',active:boolean,days:number,style:string}|null} */
  let gesture = null
  /** @type {HTMLElement|null} */
  let hint = null
  let frame = 0,
    suppress = false
  const clear = () => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    if (gesture) {
      gesture.source.setAttribute('style', gesture.style)
      gesture.source.removeAttribute('data-adjusting')
      if (gesture.source.hasPointerCapture(gesture.pointer))
        gesture.source.releasePointerCapture(gesture.pointer)
    }
    hint?.remove()
    hint = null
    gesture = null
  }
  const paint = () => {
    const g = gesture
    if (!g?.active) return
    if (!g.source.isConnected || g.source.dataset.editable !== 'true') {
      clear()
      return
    }
    const box = g.scroll.getBoundingClientRect()
    const label = g.scroll.querySelector('[data-flow="timeline-label"]')?.getBoundingClientRect().width ?? 0
    if (g.x > box.right - 32) g.scroll.scrollLeft += 12
    else if (g.x < box.left + label + 24) g.scroll.scrollLeft -= 12
    const initialX = Number(g.source.dataset.gestureX)
    let delta = Math.round((g.x - initialX + g.scroll.scrollLeft - g.left) / g.width)
    if (g.mode === 'start') delta = Math.min(delta, g.span - 1)
    if (g.mode === 'end') delta = Math.max(delta, 1 - g.span)
    g.days = delta
    const start = g.start + (g.mode === 'end' ? 0 : delta)
    const span = g.span + (g.mode === 'move' ? 0 : g.mode === 'start' ? -delta : delta)
    const count = g.scroll.querySelectorAll('[data-flow="timeline-days"] > span').length
    const lower = Math.max(1, start),
      upper = Math.min(count, start + span - 1)
    g.source.style.gridColumn = `${Math.min(count, lower)} / span ${Math.max(1, upper - lower + 1)}`
    const first = g.scroll.querySelector('[data-flow="timeline-days"] > span')?.getAttribute('data-date')
    const dayLabel = (/** @type {number} */ index) => {
      const date = new Date(`${first}T00:00:00Z`)
      date.setUTCDate(date.getUTCDate() + index - 1)
      return Number.isFinite(+date) ? date.toISOString().slice(0, 10) : String(index)
    }
    if (hint) {
      hint.textContent = `${dayLabel(start)} → ${dayLabel(start + span - 1)}`
      hint.style.left = `${Math.max(8, Math.min(g.x - 100, window.innerWidth - 260))}px`
      hint.style.top = `${Math.max(8, g.y - 44)}px`
    }
    frame = requestAnimationFrame(paint)
  }
  root.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0 || !(event.target instanceof Element)) return
      const control = event.target.closest('[data-timeline-mode]')
      const source = control?.closest('[data-flow="timeline-range"][data-editable="true"]')
      const scroll = source?.closest('[data-flow="timeline"]')
      const day = scroll?.querySelector('[data-flow="timeline-days"] > span')
      if (
        !(source instanceof HTMLElement) ||
        !(scroll instanceof HTMLElement) ||
        !(day instanceof HTMLElement)
      )
        return
      const mode = control?.getAttribute('data-timeline-mode')
      gesture = {
        source,
        scroll,
        pointer: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: scroll.scrollLeft,
        width: day.getBoundingClientRect().width,
        start: Number(source.dataset.rawStart),
        span: Number(source.dataset.rawSpan),
        mode: mode === 'start' || mode === 'end' ? mode : 'move',
        active: false,
        days: 0,
        style: source.getAttribute('style') ?? '',
      }
      source.dataset.gestureX = String(event.clientX)
      suppress = false
    },
    { signal },
  )
  root.addEventListener(
    'dragstart',
    (event) => {
      if (gesture) event.preventDefault()
    },
    { signal, capture: true },
  )
  root.ownerDocument.addEventListener(
    'pointermove',
    (event) => {
      const g = gesture
      if (!g || event.pointerId !== g.pointer) return
      g.x = event.clientX
      g.y = event.clientY
      if (!g.active && Math.abs(g.x - Number(g.source.dataset.gestureX)) < 5) return
      event.preventDefault()
      if (!g.active) {
        g.active = true
        g.source.setPointerCapture(g.pointer)
        g.source.dataset.adjusting = 'true'
        hint = root.ownerDocument.createElement('div')
        hint.dataset.flow = 'timeline-drag-hint'
        hint.setAttribute('role', 'status')
        root.append(hint)
        paint()
      }
    },
    { signal, passive: false },
  )
  root.ownerDocument.addEventListener(
    'pointerup',
    (event) => {
      const g = gesture
      if (!g || event.pointerId !== g.pointer) return
      suppress = g.active
      clear()
      if (g.active && g.days && g.source.isConnected && g.source.dataset.editable === 'true')
        g.source.dispatchEvent(
          new CustomEvent('flowtimelineschedule', { bubbles: true, detail: { mode: g.mode, days: g.days } }),
        )
      setTimeout(() => {
        suppress = false
      }, 0)
    },
    { signal },
  )
  root.addEventListener(
    'click',
    (event) => {
      if (suppress) {
        event.preventDefault()
        event.stopImmediatePropagation()
        suppress = false
      }
    },
    { signal, capture: true },
  )
  root.ownerDocument.addEventListener('pointercancel', clear, { signal })
  root.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape' && gesture) {
        event.preventDefault()
        suppress = gesture.active
        clear()
      }
    },
    { signal },
  )
  signal.addEventListener('abort', clear, { once: true })
  return clear
}
