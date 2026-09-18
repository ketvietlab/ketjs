// A Fancybox-style image viewer, as a ketjs-view island: a thumbnail (or a row of
// them) that opens a full-screen stage over several images, with zoom (buttons,
// wheel, keyboard, tap), pan (drag), pinch-to-zoom (two fingers), previous/next
// (buttons, arrow keys) and a counter.
//
// Like relation-select, it owns reactive state rather than being a static control
// wired by the shared delegator — zoom level, pan offset and the open item all
// change on every pointer move. A consuming app mounts it through its own island
// runtime; everything it needs (the images, the labels) arrives as JSON props.

import { each, signal } from '@ketvietlab/ketjs-view'
import type { IslandController, IslandProps, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'lightbox',
  'lightbox-thumbs',
  'lightbox-thumb',
  'lightbox-empty',
  'lightbox-layer',
  'lightbox-backdrop',
  'lightbox-toolbar',
  'lightbox-counter',
  'lightbox-tool',
  'lightbox-stage',
  'lightbox-image',
  'lightbox-nav',
  'lightbox-caption',
] as const

export type LightboxItem = {
  src: string
  alt: string
  /** A smaller rendition for the trigger; the full `src` is used when omitted. */
  thumbnail?: string | null
  caption?: string | null
}

export type LightboxLabels = {
  /** The trigger's accessible name, `{alt}` interpolated. */
  open: string
  close: string
  previous: string
  next: string
  zoomIn: string
  zoomOut: string
  /** `{index}` and `{total}` interpolated. */
  counter: string
  /** Shown in place of a thumbnail when there are no items. */
  empty?: string
}

export type LightboxConfig = {
  items: readonly LightboxItem[]
  labels: LightboxLabels
  /** `first` shows one thumbnail that opens the whole set; `all` shows one per item. */
  thumbnails?: 'first' | 'all'
  size?: 'small' | 'medium' | 'large'
}

export type LightboxIslandProps = { id: string; config: LightboxConfig }

const MIN_ZOOM = 1
const MAX_ZOOM = 4
const ZOOM_STEP = 0.5

const fill = (template: string, params: Record<string, unknown>): string =>
  template.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`))

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

/**
 * The viewer without a trigger of its own: whatever renders thumbnails (a record's
 * image field, the rows of a variant editor) calls `open` with the set to show and
 * places `layer()` anywhere in its own view. `attach` wires the keyboard once, for
 * the lifetime of the island that owns it.
 */
export type LightboxController = {
  open: (items: readonly LightboxItem[], at: number, trigger: EventTarget | null) => void
  close: () => void
  isOpen: () => boolean
  layer: () => TemplateResult | null
  attach: (lifetime: AbortSignal) => void
}

export function createLightbox(labels: LightboxLabels, id = 'lightbox'): LightboxController {
  const items = signal<readonly LightboxItem[]>([])
  const open = signal(false)
  const index = signal(0)
  const zoom = signal(MIN_ZOOM)
  const pan = signal({ x: 0, y: 0 })
  let returnFocus: HTMLElement | null = null
  // Every pointer down on the stage, so two fingers read as a pinch and one as a pan.
  const pointers = new Map<number, { x: number; y: number }>()
  let gesture: {
    start: { x: number; y: number }
    origin: { x: number; y: number }
    zoom: number
    distance: number | null
    moved: boolean
  } | null = null

  const resetView = (): void => {
    zoom.set(MIN_ZOOM)
    pan.set({ x: 0, y: 0 })
  }

  const show = (set: readonly LightboxItem[], at: number, trigger: EventTarget | null): void => {
    if (!set.length) return
    returnFocus = trigger instanceof HTMLElement ? trigger : null
    items.set(set)
    index.set(clamp(at, 0, set.length - 1))
    resetView()
    open.set(true)
    queueMicrotask(() => {
      if (typeof document === 'undefined') return
      document.getElementById(`${id}-lightbox-close`)?.focus()
    })
  }

  const hide = (): void => {
    if (!open()) return
    open.set(false)
    resetView()
    pointers.clear()
    gesture = null
    returnFocus?.focus()
    returnFocus = null
  }

  const step = (delta: number): void => {
    const total = items().length
    if (total < 2) return
    index.set((index() + delta + total) % total)
    resetView()
  }

  const zoomTo = (next: number): void => {
    const value = clamp(next, MIN_ZOOM, MAX_ZOOM)
    zoom.set(value)
    // Back at fit size there is nothing to pan across.
    if (value === MIN_ZOOM) pan.set({ x: 0, y: 0 })
  }

  const centerOf = (): { x: number; y: number } => {
    const points = [...pointers.values()]
    if (!points.length) return { x: 0, y: 0 }
    return {
      x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
      y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
    }
  }

  const distanceOf = (): number => {
    const [a, b] = [...pointers.values()]
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0
  }

  const endPointer = (event: PointerEvent, completed: boolean): void => {
    // At fit size a horizontal swipe with one finger moves to the neighbouring image.
    if (completed && gesture && pointers.size === 1 && zoom() === MIN_ZOOM && gesture.distance === null) {
      const dx = event.clientX - gesture.start.x
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(event.clientY - gesture.start.y)) step(dx < 0 ? 1 : -1)
    }
    pointers.delete(event.pointerId)
    ;(event.currentTarget as Element | null)?.releasePointerCapture?.(event.pointerId)
    if (!pointers.size) {
      // Keep `moved` until the click that follows this pointerup has been read.
      const finished = gesture
      if (finished && completed) setTimeout(() => (gesture === finished ? (gesture = null) : null), 0)
      else gesture = null
      return
    }
    // One finger lifted from a pinch: carry on as a pan from where things are now.
    if (gesture) gesture = { ...gesture, start: centerOf(), origin: pan(), zoom: zoom(), distance: null }
  }

  const layer = (): TemplateResult | null => {
    const set = items()
    const item = set[index()]
    if (!open() || !item) return null
    const scale = zoom()
    const offset = pan()
    const many = set.length > 1
    return (
      <div
        data-ui="lightbox-layer"
        role="dialog"
        aria-modal="true"
        aria-label={item.alt}
        id={`${id}-lightbox`}
      >
        <div data-ui="lightbox-backdrop" aria-hidden="true" onClick={hide} />
        <div data-ui="lightbox-toolbar">
          <span data-ui="lightbox-counter" aria-live="polite">
            {many ? fill(labels.counter, { index: index() + 1, total: set.length }) : ''}
          </span>
          <button
            type="button"
            data-ui="lightbox-tool"
            data-tool="zoom-out"
            aria-label={labels.zoomOut}
            title={labels.zoomOut}
            disabled={scale <= MIN_ZOOM}
            onClick={() => zoomTo(scale - ZOOM_STEP)}
          >
            −
          </button>
          <button
            type="button"
            data-ui="lightbox-tool"
            data-tool="zoom-in"
            aria-label={labels.zoomIn}
            title={labels.zoomIn}
            disabled={scale >= MAX_ZOOM}
            onClick={() => zoomTo(scale + ZOOM_STEP)}
          >
            +
          </button>
          <button
            type="button"
            data-ui="lightbox-tool"
            data-tool="close"
            id={`${id}-lightbox-close`}
            aria-label={labels.close}
            title={labels.close}
            onClick={hide}
          >
            ×
          </button>
        </div>
        {/* biome-ignore lint/a11y/noStaticElementInteractions: pointer gestures on the picture; the keyboard equivalents (+, -, arrows, Escape) are bound on the document while open */}
        <div
          role="presentation"
          data-ui="lightbox-stage"
          data-zoomed={String(scale > MIN_ZOOM)}
          onClick={(event) => {
            // A click on the empty stage around the picture closes, like the backdrop.
            if (event.target === event.currentTarget && !gesture?.moved) hide()
          }}
          onWheel={(event: WheelEvent) => {
            event.preventDefault()
            zoomTo(zoom() * (event.deltaY < 0 ? 1.15 : 1 / 1.15))
          }}
          onPointerDown={(event: PointerEvent) => {
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
            ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
            gesture = {
              start: centerOf(),
              origin: pan(),
              zoom: zoom(),
              distance: pointers.size > 1 ? distanceOf() : null,
              moved: gesture?.moved === true && pointers.size > 1,
            }
          }}
          onPointerMove={(event: PointerEvent) => {
            if (!gesture || !pointers.has(event.pointerId)) return
            pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
            const center = centerOf()
            const dx = center.x - gesture.start.x
            const dy = center.y - gesture.start.y
            if (Math.abs(dx) + Math.abs(dy) > 4) gesture.moved = true
            if (pointers.size > 1 && gesture.distance) {
              // Pinch: scale by how far the fingers spread since they both came down.
              zoomTo(gesture.zoom * (distanceOf() / gesture.distance))
              gesture.moved = true
            }
            if (zoom() > MIN_ZOOM) pan.set({ x: gesture.origin.x + dx, y: gesture.origin.y + dy })
          }}
          onPointerUp={(event: PointerEvent) => endPointer(event, true)}
          onPointerCancel={(event: PointerEvent) => endPointer(event, false)}
        >
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: + and - zoom from the keyboard while the viewer is open */}
          <img
            data-ui="lightbox-image"
            src={item.src}
            alt={item.alt}
            draggable="false"
            style={`transform: translate(${offset.x}px, ${offset.y}px) scale(${scale})`}
            onClick={() => {
              // A tap (not the end of a pan or pinch) toggles between fit and 2×.
              if (!gesture?.moved) zoomTo(zoom() > MIN_ZOOM ? MIN_ZOOM : 2)
            }}
          />
        </div>
        {many ? (
          <button
            type="button"
            data-ui="lightbox-nav"
            data-direction="previous"
            aria-label={labels.previous}
            title={labels.previous}
            onClick={() => step(-1)}
          >
            ‹
          </button>
        ) : null}
        {many ? (
          <button
            type="button"
            data-ui="lightbox-nav"
            data-direction="next"
            aria-label={labels.next}
            title={labels.next}
            onClick={() => step(1)}
          >
            ›
          </button>
        ) : null}
        {item.caption ? <p data-ui="lightbox-caption">{item.caption}</p> : null}
      </div>
    )
  }

  const attach = (lifetime: AbortSignal): void => {
    // Capture phase: an enclosing record modal also closes on Escape, and the
    // viewer on top of it must be the only layer that answers.
    document.addEventListener(
      'keydown',
      (event) => {
        if (!open()) return
        if (event.key === 'Escape') hide()
        else if (event.key === 'ArrowLeft') step(-1)
        else if (event.key === 'ArrowRight') step(1)
        else if (event.key === '+' || event.key === '=') zoomTo(zoom() + ZOOM_STEP)
        else if (event.key === '-') zoomTo(zoom() - ZOOM_STEP)
        else return
        event.preventDefault()
        event.stopImmediatePropagation()
      },
      { signal: lifetime, capture: true },
    )
    lifetime.addEventListener('abort', () => {
      open.set(false)
      pointers.clear()
      gesture = null
    })
  }

  return { open: show, close: hide, isOpen: () => open(), layer, attach }
}

/** A thumbnail — or one per item — that opens the whole set in the viewer. */
export function createLightboxView(props: LightboxIslandProps): IslandController {
  const { id, config } = props
  const labels = config.labels
  const items = config.items
  const viewer = createLightbox(labels, id)

  const thumbs = (): TemplateResult => {
    const shown = config.thumbnails === 'all' ? items : items.slice(0, 1)
    if (!shown.length)
      return (
        <span data-ui="lightbox-empty" data-size={config.size ?? 'medium'}>
          {labels.empty ?? ''}
        </span>
      )
    return (
      <div data-ui="lightbox-thumbs">
        {each(
          [...shown],
          (item) => item.src,
          (item) =>
            LightboxThumb({
              item,
              labels,
              size: config.size,
              onOpen: (trigger) => viewer.open(items, items.indexOf(item), trigger),
            }),
        )}
      </div>
    )
  }

  return {
    view: () => (
      <div data-ui="lightbox" id={id}>
        {thumbs()}
        {viewer.layer()}
      </div>
    ),
    mount: ({ lifetime }) => viewer.attach(lifetime),
  }
}

/** One thumbnail button, for a view that drives its own `createLightbox` controller. */
export const LightboxThumb = (props: {
  item: LightboxItem
  labels: Pick<LightboxLabels, 'open'>
  size?: 'small' | 'medium' | 'large'
  onOpen: (trigger: EventTarget | null) => void
}): TemplateResult => (
  <button
    type="button"
    data-ui="lightbox-thumb"
    data-size={props.size ?? 'medium'}
    aria-label={fill(props.labels.open, { alt: props.item.alt })}
    aria-haspopup="dialog"
    onClick={(event) => props.onOpen(event.currentTarget)}
  >
    <img src={props.item.thumbnail ?? props.item.src} alt="" loading="lazy" decoding="async" />
  </button>
)

export const lightbox = (props: IslandProps): IslandController =>
  createLightboxView(props as unknown as LightboxIslandProps)
