import {
  dragThresholdReached,
  edgeVelocity,
  keyboardPlacementTarget,
  placementPosition,
  placementSlots,
  planPlacementMove,
} from './builder-placement.ts'
import type { PlacementTarget, Point } from './builder-placement.ts'
import type { Placement, Translate } from './types.ts'

/** A drop position and the surface (tree or canvas) the pointer is over. */
export type DropTarget = PlacementTarget & { surface?: string }
export type DragState = { key: string; layout: Placement[]; editable: boolean }
export type BuilderDragOptions = {
  getState: () => DragState | null
  commit: (id: string, target: DropTarget) => void
  label: (placement: Placement | undefined) => string
  tr: Translate
  onError?: (error: unknown) => void
  /** Tests drive frames and time; the browser uses its own. */
  platform?: { raf?: (fn: FrameRequestCallback) => number; caf?: (id: number) => void; now?: () => number }
}
type DragMode = 'pointer' | 'keyboard'
type DragSession = {
  root: HTMLElement
  id: string
  key: string
  layout: Placement[]
  fingerprint: string
  surface: string | undefined
  control: HTMLElement | null
  sourceElement: HTMLElement | undefined
  name: string
  mode: DragMode
  started: boolean
  dirty: boolean
  point: Point
  origin: Point
  pointerId: number | undefined
  target: DropTarget | null
}
type Edge = 'top' | 'bottom'

const ROOT = '[data-builder-drag-root]'
const HANDLE = '[data-builder-drag-id]'
const NODE = '[data-builder-drop-node]'
const SLOT = '[data-builder-drop-slot]'
const surfaceOf = (element: Element | null | undefined) =>
  element?.closest<HTMLElement>('[data-builder-surface]')?.dataset.builderSurface
const elements = (root: ParentNode, selector: string) => [...root.querySelectorAll<HTMLElement>(selector)]
const box = (element: Element) => (element.closest('[role="treeitem"]') ?? element).getBoundingClientRect()
const elementFor = (
  root: ParentNode,
  selector: string,
  key: string,
  value: string,
  surface: string | undefined,
) => elements(root, selector).find((el) => el.dataset[key] === value && surfaceOf(el) === surface)

/** Pure hit selection over current client rectangles; CSS zoom is already included in these. */
export function dropTargetAt(
  root: Element,
  doc: Document,
  point: Point,
  layout: Placement[],
  source: string,
): DropTarget | null {
  const hit = doc.elementFromPoint(point.x, point.y)
  if (!hit || !root.contains(hit)) return null
  const treeItem = hit.closest('[role="treeitem"]')
  const node = hit.closest<HTMLElement>(NODE) ?? treeItem?.querySelector<HTMLElement>(NODE)
  const slot = treeItem?.querySelector<HTMLElement>(SLOT) ?? hit.closest<HTMLElement>(SLOT)
  if (treeItem && !treeItem.querySelector(NODE) && !treeItem.querySelector(SLOT)) return null
  const surface = surfaceOf(hit)
  let target: PlacementTarget | undefined
  if (node && (!slot || !node.contains(slot))) {
    const position = placementPosition(layout, node.dataset.builderDropNode!)
    if (!position) return null
    const rect = box(node)
    target = { ...position, index: position.index + (point.y >= rect.top + rect.height / 2 ? 1 : 0) }
  } else if (slot) {
    const region = placementSlots(layout, source).find((s) => s.destination === slot.dataset.builderDropSlot)
    if (!region) return null
    const visibleNodes = new Map(
      elements(root, NODE)
        .filter((el) => surfaceOf(el) === surface)
        .map((el) => [el.dataset.builderDropNode, el] as const),
    )
    const index = region.list.findIndex((p) => {
      const element = visibleNodes.get(p.id)
      if (!element) return false
      const rect = box(element)
      return rect.width > 0 && rect.height > 0 && point.y < rect.top + rect.height / 2
    })
    target = { destination: region.destination, index: index < 0 ? region.list.length : index }
  }
  return target && planPlacementMove(layout, source, target) ? { ...target, surface } : null
}

export function targetRectangle(root: ParentNode, layout: Placement[], target: DropTarget) {
  const slot = placementSlots(layout).find((s) => s.destination === target.destination)
  if (!slot) return null
  const nodes = new Map(
    elements(root, NODE)
      .filter((el) => surfaceOf(el) === target.surface)
      .map((el) => [el.dataset.builderDropNode, el] as const),
  )
  const candidates: [Placement, Edge][] = [
    ...slot.list.slice(target.index).map((node): [Placement, Edge] => [node, 'top']),
    ...slot.list
      .slice(0, target.index)
      .reverse()
      .map((node): [Placement, Edge] => [node, 'bottom']),
  ]
  for (const [node, edge] of candidates) {
    const el = nodes.get(node.id)
    if (!el) continue
    const rect = box(el)
    if (rect.width > 0 && rect.height > 0)
      return { left: rect.left, top: rect[edge], width: rect.width, anchor: el }
  }
  const el = elementFor(root, SLOT, 'builderDropSlot', target.destination, target.surface)
  if (!el) return null
  const rect = box(el)
  return { left: rect.left, top: rect.top + rect.height / 2, width: rect.width, anchor: el }
}

/** Drag state never lives in Placement data. Pointer moves only paint a fixed marker once per frame. */
export function createBuilderDrag({
  getState,
  commit,
  label,
  tr,
  onError = () => {},
  platform = {},
}: BuilderDragOptions) {
  let doc: Document | null = null,
    win: Window | null = null,
    session: DragSession | null = null,
    frameId: number | null = null,
    marker: HTMLDivElement | null = null,
    badge: HTMLDivElement | null = null,
    previousTime = 0
  let suppressedUntil = 0,
    suppressedControl: HTMLElement | null = null,
    focusFrame: number | null = null
  const raf = (fn: FrameRequestCallback) => (platform.raf ?? win!.requestAnimationFrame.bind(win))(fn)
  const caf = (id: number) => (platform.caf ?? win!.cancelAnimationFrame.bind(win))(id)
  const now = () => platform.now?.() ?? Date.now()
  const speak = (root: Element, message: string) => {
    const live = root.querySelector('[data-builder-drag-status]')
    if (live) live.textContent = message
  }
  const current = () => {
    const state = getState()
    return session && state?.editable && state.key === session.key && session.root.isConnected ? state : null
  }
  const focus = (s: DragSession) => {
    if (focusFrame !== null) caf(focusFrame)
    focusFrame = raf(() => {
      focusFrame = null
      if (!s.root.isConnected) return
      const handle = elementFor(s.root, HANDLE, 'builderDragId', s.id, s.surface)
      const control =
        handle?.closest<HTMLElement>('[role="treeitem"]') ?? handle?.querySelector<HTMLElement>('button')
      control?.focus({ preventScroll: true })
    })
  }
  function clear(restoreFocus = true) {
    const s = session
    session = null
    if (frameId !== null) caf(frameId)
    frameId = null
    previousTime = 0
    marker?.remove()
    badge?.remove()
    marker = null
    badge = null
    if (!s) return null
    s.root.classList.remove('website-builder-dragging')
    s.sourceElement?.classList.remove('website-builder-drag-source')
    if (s.control?.tagName === 'BUTTON') s.control.removeAttribute('aria-pressed')
    try {
      if (s.pointerId !== undefined && s.control?.hasPointerCapture?.(s.pointerId))
        s.control.releasePointerCapture(s.pointerId)
    } catch {
      /* The element may have left the document. */
    }
    if (restoreFocus) focus(s)
    return s
  }
  const cancel = (restoreFocus = true) => {
    const s = clear(restoreFocus)
    if (s?.started) speak(s.root, tr('website.drag.cancelled'))
  }
  const destinationName = (target: DropTarget, layout: Placement[]) => {
    const region = placementSlots(layout).find((s) => s.destination === target.destination)
    return region?.parent
      ? `${label(region.parent)} · ${tr(region.slot === 'left' ? 'website.builder.slotLeft' : region.slot === 'right' ? 'website.builder.slotRight' : 'website.drag.slot')}`
      : tr('website.builder.structure')
  }
  const targetMessage = (s: DragSession, target: DropTarget | null) =>
    target
      ? tr('website.drag.target', {
          region: destinationName(target, s.layout),
          position: (planPlacementMove(s.layout, s.id, target)?.index ?? target.index) + 1,
        })
      : tr('website.drag.invalid')
  const activate = () => {
    const s = session
    if (!s || s.started) return
    s.started = true
    s.root.classList.add('website-builder-dragging')
    s.sourceElement?.classList.add('website-builder-drag-source')
    if (s.control?.tagName === 'BUTTON') s.control.setAttribute('aria-pressed', 'true')
    marker = doc!.createElement('div')
    marker.className = 'website-builder-drop-marker'
    marker.setAttribute('aria-hidden', 'true')
    badge = doc!.createElement('div')
    badge.className = 'website-builder-drag-badge'
    badge.setAttribute('aria-hidden', 'true')
    doc!.body.append(marker, badge)
    speak(s.root, tr('website.drag.picked', { name: s.name }))
  }
  const paint = () => {
    const s = session
    if (!s?.started) return
    const rect = s.target && targetRectangle(s.root, s.layout, s.target)
    const [line, tag, view] = [marker!, badge!, win!]
    line.hidden = !rect
    tag.hidden = !rect
    if (!rect) return
    // Marker is viewport-relative, outside the zoomed canvas; no scaling or layout shifts.
    line.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;`
    tag.style.cssText = `left:${Math.max(8, Math.min(rect.left, view.innerWidth - 250))}px;top:${Math.max(8, Math.min(rect.top - 30, view.innerHeight - 36))}px;`
    tag.textContent = targetMessage(s, s.target)
  }
  const autoScroll = (point: Point, dt: number) => {
    const [page, view] = [doc!, win!]
    let hit = page.elementFromPoint(point.x, point.y)
    if (!hit || !session!.root.contains(hit)) return false
    const scrolling = page.scrollingElement
    while (hit) {
      const isPage = hit === scrolling
      const style = isPage ? null : view.getComputedStyle(hit)
      if (isPage || /auto|scroll/.test(style?.overflowY ?? '')) {
        const rect = isPage
          ? { left: 0, right: view.innerWidth, top: 0, bottom: view.innerHeight }
          : hit.getBoundingClientRect()
        if (point.x >= rect.left && point.x <= rect.right) {
          const speed = edgeVelocity(point.y, rect.top, rect.bottom)
          const next = Math.max(
            0,
            Math.min(hit.scrollHeight - hit.clientHeight, hit.scrollTop + (speed * dt) / 1000),
          )
          if (speed && Math.abs(next - hit.scrollTop) > 0.1) {
            hit.scrollTop = next
            return true
          }
        }
      }
      hit = hit.parentElement
    }
    return false
  }
  const tick = (time: number) => {
    frameId = null
    if (!current()) {
      cancel(false)
      return
    }
    const s = session!
    if (!s.started) return
    const dt = previousTime ? Math.min(32, Math.max(0, time - previousTime)) : 16
    previousTime = time
    if (s.mode === 'pointer') {
      s.dirty = autoScroll(s.point, dt) || s.dirty
      if (s.dirty) {
        s.target = dropTargetAt(s.root, doc!, s.point, s.layout, s.id)
        paint()
        s.dirty = false
      }
    } else if (s.dirty) {
      paint()
      s.dirty = false
    }
    frameId = raf(tick)
  }
  const schedule = () => {
    if (frameId === null && session?.started) frameId = raf(tick)
  }
  const begin = (event: PointerEvent | KeyboardEvent, mode: DragMode) => {
    const from = event.target as Element | null
    // A key press has no coordinates; its session starts without them, as the keyboard moves it.
    const { clientX, clientY, pointerId } = event as PointerEvent
    const root = from?.closest?.<HTMLElement>(ROOT)
    const treeItem = from?.closest?.('[role="treeitem"]')
    const handle =
      from?.closest?.<HTMLElement>(HANDLE) ??
      (mode === 'keyboard' ? treeItem?.querySelector<HTMLElement>(HANDLE) : null)
    const state = getState()
    if (!root || !handle || !root.contains(handle) || !state?.editable) return false
    const id = handle.dataset.builderDragId!,
      position = placementPosition(state.layout, id)
    if (!position) return false
    cancel(false)
    if (focusFrame !== null) {
      caf(focusFrame)
      focusFrame = null
    }
    const control =
      handle.closest<HTMLElement>('[role="treeitem"]') ??
      handle.querySelector<HTMLElement>('button') ??
      from!.closest<HTMLElement>('button')
    const sourceElement = elementFor(root, NODE, 'builderDropNode', id, surfaceOf(handle))
    const placement = placementSlots(state.layout)
      .flatMap((s) => s.list)
      .find((p) => p.id === id)
    session = {
      root,
      id,
      key: state.key,
      layout: state.layout,
      fingerprint: JSON.stringify(state.layout),
      surface: surfaceOf(handle),
      control,
      sourceElement,
      name: label(placement),
      mode,
      started: false,
      dirty: true,
      point: { x: clientX, y: clientY },
      origin: { x: clientX, y: clientY },
      pointerId: mode === 'pointer' ? pointerId : undefined,
      target: { ...position, surface: surfaceOf(handle) },
    }
    control?.focus({ preventScroll: true })
    if (mode === 'pointer') {
      try {
        control?.setPointerCapture?.(pointerId)
      } catch {
        /* Document listeners also cover capture loss. */
      }
    } else {
      activate()
      paint()
      schedule()
    }
    event.preventDefault()
    event.stopPropagation()
    return true
  }
  const finish = () => {
    const state = current(),
      s = session
    if (!s) return
    const plan =
      state &&
      s.target &&
      state.layout === s.layout &&
      JSON.stringify(state.layout) === s.fingerprint &&
      planPlacementMove(state.layout, s.id, s.target)
    clear(true)
    if (!plan || !s.started) {
      if (s.started) speak(s.root, tr('website.drag.cancelled'))
      return
    }
    if (plan.noop) {
      speak(s.root, tr('website.drag.unchanged'))
      return
    }
    try {
      commit(s.id, s.target!)
      speak(
        s.root,
        tr('website.drag.moved', { name: s.name, region: destinationName(s.target!, state!.layout) }),
      )
    } catch (error) {
      speak(s.root, tr('website.drag.cancelled'))
      onError(error)
    }
  }
  const pointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.isPrimary === false || event.ctrlKey || event.metaKey || event.altKey)
      return
    if (session) cancel(false)
    begin(event, 'pointer')
  }
  const pointerMove = (event: PointerEvent) => {
    const s = session
    if (s?.mode !== 'pointer' || event.pointerId !== s.pointerId) return
    if (event.pointerType === 'mouse' && event.buttons === 0) {
      cancel()
      return
    }
    const sample = event.getCoalescedEvents?.().at(-1) ?? event
    s.point = { x: sample.clientX, y: sample.clientY }
    s.dirty = true
    if (!s.started && dragThresholdReached(s.origin, s.point)) activate()
    if (s.started) {
      event.preventDefault()
      schedule()
    }
  }
  const pointerUp = (event: PointerEvent) => {
    if (session?.mode !== 'pointer' || event.pointerId !== session.pointerId) return
    if (session.started) {
      session.target = dropTargetAt(
        session.root,
        doc!,
        { x: event.clientX, y: event.clientY },
        session.layout,
        session.id,
      )
      suppressedUntil = now() + 250
      suppressedControl = session.control
      event.preventDefault()
      event.stopPropagation()
    }
    finish()
  }
  const pointerCancel = (event: PointerEvent) => {
    if (session?.mode === 'pointer' && event.pointerId === session.pointerId) cancel()
  }
  const keyDown = (event: KeyboardEvent) => {
    if (!session) {
      if (event.key === ' ' && !event.repeat && !event.ctrlKey && !event.metaKey) begin(event, 'keyboard')
      return
    }
    if (event.key === 'Tab' || event.ctrlKey || event.metaKey) {
      cancel(false)
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      cancel()
      return
    }
    if (session.mode !== 'keyboard') return
    if (['Enter', ' '].includes(event.key)) {
      event.preventDefault()
      event.stopPropagation()
      if (!event.repeat) finish()
      return
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    event.stopPropagation()
    if (!current()) {
      cancel(false)
      return
    }
    const next = keyboardPlacementTarget(session.layout, session.id, session.target!, event.key)
    if (next) {
      session.target = { ...next, surface: session.surface }
      session.dirty = true
      targetRectangle(session.root, session.layout, session.target)?.anchor.scrollIntoView?.({
        block: 'nearest',
        inline: 'nearest',
        behavior: 'instant',
      })
      speak(session.root, targetMessage(session, session.target))
      schedule()
    }
  }
  const click = (event: MouseEvent) => {
    if (suppressedUntil > now() && suppressedControl?.contains(event.target as Node)) {
      suppressedUntil = 0
      suppressedControl = null
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (session?.started) cancel(false)
  }
  const scroll = () => {
    if (session) session.dirty = true
  }
  const blur = () => cancel(false)
  const visibility = () => {
    if (doc!.hidden) cancel(false)
  }
  const listeners: [string, EventListener][] = [
    ['pointerdown', pointerDown as EventListener],
    ['pointermove', pointerMove as EventListener],
    ['pointerup', pointerUp as EventListener],
    ['pointercancel', pointerCancel as EventListener],
    ['lostpointercapture', pointerCancel as EventListener],
    ['keydown', keyDown as EventListener],
    ['click', click as EventListener],
    ['scroll', scroll],
    ['visibilitychange', visibility],
  ]
  return {
    attach(document: Document | undefined) {
      if (doc || !document) return
      doc = document
      win = doc.defaultView!
      for (const [name, fn] of listeners) doc.addEventListener(name, fn, { capture: true, passive: false })
      win.addEventListener('blur', blur)
      win.addEventListener('pagehide', blur)
      win.addEventListener('resize', scroll)
    },
    cancel,
    active: () => !!session,
    dispose() {
      cancel(false)
      if (focusFrame !== null) caf(focusFrame)
      focusFrame = null
      if (!doc) return
      for (const [name, fn] of listeners) doc.removeEventListener(name, fn, true)
      win!.removeEventListener('blur', blur)
      win!.removeEventListener('pagehide', blur)
      win!.removeEventListener('resize', scroll)
      doc = null
      win = null
    },
  }
}
