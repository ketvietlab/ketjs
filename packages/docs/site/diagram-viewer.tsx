import { ActionGroup, Button, ModalSheet, Text } from '@ketvietlab/design-system'
import { renderToStaticString } from '@ketvietlab/ketjs-view'
import { fitDiagram, panDiagram, zoomDiagram, MIN_ZOOM, MAX_ZOOM } from './diagram-camera.ts'
import type { Camera, Point, Size } from './diagram-camera.ts'

export const DiagramViewer = () => (
  <dialog class="diagram-dialog" id="diagram-dialog" aria-labelledby="diagram-viewer-title">
    <ModalSheet
      id="diagram-viewer"
      title="Diagram"
      closeLabel="Close diagram"
      mode="client"
      presentation="dialog"
      size="large"
      height="fixed"
      dialogSemantics="parent"
      body={
        <div class="diagram-workspace">
          <div class="diagram-toolbar">
            <ActionGroup
              label="Diagram controls"
              actions={[
                <Button id="diagram-zoom-out" label="Zoom out" icon="minus" />,
                <Button id="diagram-zoom-in" label="Zoom in" icon="plus" />,
                <Button id="diagram-fit" label="Fit" />,
                <Button id="diagram-reset" label="Reset" />,
              ]}
            />
            <output aria-live="polite">
              <Text id="diagram-zoom-level" variant="bodySm">
                100%
              </Text>
            </output>
          </div>
          <div
            class="diagram-viewport"
            id="diagram-viewport"
            tabindex={0}
            role="region"
            aria-label="Interactive diagram"
            aria-describedby="diagram-help"
          >
            <div class="diagram-drawing" id="diagram-drawing" />
          </div>
          <Text id="diagram-help" variant="bodySm" tone="muted">
            Drag to pan · Scroll or pinch to zoom · + / − to zoom · Arrow keys to pan · 0 to fit · 1 to reset
          </Text>
        </div>
      }
    />
  </dialog>
)

let cloneId = 0
function cloneDrawing(source: SVGSVGElement) {
  const clone = source.cloneNode(true) as SVGSVGElement
  const ids = new Map<string, string>()
  for (const node of [clone, ...clone.querySelectorAll('[id]')])
    if (node.id) ids.set(node.id, `diagram-viewer-${++cloneId}`)
  for (const node of [clone, ...clone.querySelectorAll('*')]) {
    for (const attr of [...node.attributes]) {
      let value = attr.value
      for (const [old, replacement] of ids) {
        if (attr.name === 'id' && value === old) value = replacement
        value = value.replaceAll(`url(#${old})`, `url(#${replacement})`)
        if (['href', 'xlink:href'].includes(attr.name) && value === `#${old}`) value = `#${replacement}`
        if (['aria-labelledby', 'aria-describedby'].includes(attr.name))
          value = value
            .split(' ')
            .map((id) => (id === old ? replacement : id))
            .join(' ')
      }
      node.setAttribute(attr.name, value)
    }
  }
  // Mermaid's generated style selectors also refer to its root id.
  for (const style of clone.querySelectorAll('style')) {
    for (const [old, replacement] of ids)
      style.textContent = style.textContent!.replaceAll(`#${old}`, `#${replacement}`)
  }
  clone.removeAttribute('tabindex')
  return clone
}

export function attachDiagramViewer(lifetime: AbortSignal) {
  const dialog = document.querySelector<HTMLDialogElement>('#diagram-dialog')!
  const viewport = dialog.querySelector<HTMLElement>('#diagram-viewport')!
  const drawing = dialog.querySelector<HTMLElement>('#diagram-drawing')!
  const output = dialog.querySelector<HTMLOutputElement>('#diagram-zoom-level')!
  const pointers = new Map<number, Point>()
  let camera: Camera = { x: 0, y: 0, scale: 1 }
  let size: Size = { width: 1, height: 1 }
  let active: HTMLElement | undefined
  let opener: HTMLElement | null = null
  let fitted = true
  let previousOverflow = ''
  const viewportSize = () => ({ width: viewport.clientWidth, height: viewport.clientHeight })
  const center = () => ({ x: viewport.clientWidth / 2, y: viewport.clientHeight / 2 })
  const paint = () => {
    drawing.style.transform = `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})`
    output.textContent = `${Math.round(camera.scale * 100)}%`
    dialog.querySelector<HTMLButtonElement>('#diagram-zoom-out')!.disabled = camera.scale <= MIN_ZOOM
    dialog.querySelector<HTMLButtonElement>('#diagram-zoom-in')!.disabled = camera.scale >= MAX_ZOOM
  }
  const fit = () => {
    fitted = true
    camera = fitDiagram(size, viewportSize())
    paint()
  }
  const zoom = (factor: number, anchor = center()) => {
    fitted = false
    camera = zoomDiagram(camera, factor, anchor)
    paint()
  }
  const reset = () => {
    fitted = false
    camera = {
      scale: 1,
      x: (viewport.clientWidth - size.width) / 2,
      y: (viewport.clientHeight - size.height) / 2,
    }
    paint()
  }
  const load = (svg: SVGSVGElement) => {
    size = {
      width: svg.viewBox.baseVal.width || svg.clientWidth,
      height: svg.viewBox.baseVal.height || svg.clientHeight,
    }
    const clone = cloneDrawing(svg)
    clone.style.width = `${size.width}px`
    clone.style.height = `${size.height}px`
    clone.style.maxWidth = 'none'
    drawing.replaceChildren(clone)
  }
  const close = () => {
    if (dialog.open) dialog.close()
  }
  document.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return
      const button = event.target.closest<HTMLButtonElement>('.mermaid-tools button')
      const figure = button?.closest<HTMLElement>('.mermaid-diagram')
      const svg = figure?.querySelector<SVGSVGElement>('.mermaid-canvas svg')
      if (!button || !figure || !svg) return
      active = figure
      opener = button
      load(svg)
      dialog.querySelector('#diagram-viewer-title')!.textContent =
        `${document.querySelector('main h1')?.textContent ?? 'Mermaid'} — Diagram`
      previousOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
      dialog.showModal()
      fit()
      viewport.focus()
    },
    { signal: lifetime },
  )
  dialog.addEventListener(
    'click',
    (event) => {
      if (
        event.target instanceof Element &&
        event.target.closest('[data-ui="modal-close"], [data-ui="modal-backdrop"]')
      )
        close()
    },
    { signal: lifetime },
  )
  dialog.addEventListener(
    'close',
    () => {
      document.body.style.overflow = previousOverflow
      pointers.clear()
      viewport.removeAttribute('data-dragging')
      drawing.replaceChildren()
      active = undefined
      if (opener?.isConnected) opener.focus()
      opener = null
    },
    { signal: lifetime },
  )
  for (const [id, action] of Object.entries({
    'diagram-zoom-in': () => zoom(1.25),
    'diagram-zoom-out': () => zoom(0.8),
    'diagram-fit': fit,
    'diagram-reset': reset,
  }))
    dialog.querySelector(`#${id}`)!.addEventListener('click', action, { signal: lifetime })
  viewport.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault()
      const rect = viewport.getBoundingClientRect()
      zoom(Math.exp(-event.deltaY * 0.002), { x: event.clientX - rect.left, y: event.clientY - rect.top })
    },
    { signal: lifetime, passive: false },
  )
  viewport.addEventListener(
    'keydown',
    (event) => {
      const distance = event.shiftKey ? 100 : 40
      const deltas: Record<string, Point> = {
        ArrowLeft: { x: distance, y: 0 },
        ArrowRight: { x: -distance, y: 0 },
        ArrowUp: { x: 0, y: distance },
        ArrowDown: { x: 0, y: -distance },
      }
      if (deltas[event.key]) {
        fitted = false
        camera = panDiagram(camera, deltas[event.key])
        paint()
      } else if (event.key === '+' || event.key === '=') zoom(1.25)
      else if (event.key === '-') zoom(0.8)
      else if (event.key === '0') fit()
      else if (event.key === '1') reset()
      else return
      event.preventDefault()
    },
    { signal: lifetime },
  )
  const local = (event: PointerEvent): Point => {
    const rect = viewport.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  viewport.addEventListener(
    'pointerdown',
    (event) => {
      if (event.button !== 0) return
      event.preventDefault()
      pointers.set(event.pointerId, local(event))
      viewport.setPointerCapture(event.pointerId)
      viewport.dataset.dragging = 'true'
      viewport.focus()
    },
    { signal: lifetime },
  )
  viewport.addEventListener(
    'pointermove',
    (event) => {
      const previous = pointers.get(event.pointerId)
      if (!previous) return
      const before = [...pointers.values()]
      const next = local(event)
      pointers.set(event.pointerId, next)
      fitted = false
      if (pointers.size === 2) {
        const after = [...pointers.values()]
        const midpoint = (points: Point[]) => ({
          x: (points[0].x + points[1].x) / 2,
          y: (points[0].y + points[1].y) / 2,
        })
        const distance = (points: Point[]) => Math.hypot(points[1].x - points[0].x, points[1].y - points[0].y)
        const oldCenter = midpoint(before),
          newCenter = midpoint(after)
        camera = zoomDiagram(camera, distance(after) / Math.max(1, distance(before)), oldCenter)
        camera = panDiagram(camera, { x: newCenter.x - oldCenter.x, y: newCenter.y - oldCenter.y })
      } else camera = panDiagram(camera, { x: next.x - previous.x, y: next.y - previous.y })
      paint()
    },
    { signal: lifetime },
  )
  const release = (event: PointerEvent) => {
    pointers.delete(event.pointerId)
    if (!pointers.size) viewport.removeAttribute('data-dragging')
  }
  viewport.addEventListener('pointerup', release, { signal: lifetime })
  viewport.addEventListener('pointercancel', release, { signal: lifetime })
  viewport.addEventListener('lostpointercapture', release, { signal: lifetime })
  document.addEventListener(
    'ketjs:doc-navigation',
    () => {
      opener = null
      close()
    },
    { signal: lifetime },
  )
  const resize = new ResizeObserver(() => {
    if (dialog.open && fitted) fit()
  })
  resize.observe(viewport)
  lifetime.addEventListener(
    'abort',
    () => {
      if (dialog.open) {
        dialog.close()
        document.body.style.overflow = previousOverflow
      }
      resize.disconnect()
    },
    { once: true },
  )
  return {
    updated(figure: HTMLElement, svg: SVGSVGElement) {
      if (!figure.querySelector('.mermaid-tools')) {
        const tools = document.createElement('div')
        tools.className = 'mermaid-tools'
        tools.innerHTML = renderToStaticString(<Button label="Open diagram" variant="tertiary" />)
        figure.prepend(tools)
      }
      if (active === figure && dialog.open) {
        load(svg)
        if (fitted) fit()
        else paint()
      }
    },
  }
}
