import { diagramTheme } from './diagram-theme.ts'
import { attachDiagramViewer } from './diagram-viewer.tsx'

type MermaidConfig = Record<string, unknown>
type Mermaid = {
  initialize(config: MermaidConfig): void
  render(id: string, source: string): Promise<{ svg: string }>
}

let engine: Promise<Mermaid> | undefined
let sequence = 0

export function attachDiagrams(lifetime: AbortSignal) {
  const viewer = attachDiagramViewer(lifetime)
  let revision = 0
  let queue = Promise.resolve()
  const probe = document.createElement('span')
  probe.hidden = true
  document.body.append(probe)
  const colorCanvas = document.createElement('canvas')
  colorCanvas.width = colorCanvas.height = 1
  const colorContext = colorCanvas.getContext('2d')!
  const token = (name: string) => {
    probe.style.color = `var(${name})`
    colorContext.fillStyle = getComputedStyle(probe).color
    colorContext.clearRect(0, 0, 1, 1)
    colorContext.fillRect(0, 0, 1, 1)
    const channels = Array.from(colorContext.getImageData(0, 0, 1, 1).data).slice(0, 3)
    return '#' + channels.map((channel) => Math.round(Number(channel)).toString(16).padStart(2, '0')).join('')
  }
  const refresh = () => {
    const current = ++revision
    queue = queue
      .catch(() => {})
      .then(async () => {
        const figures = Array.from(document.querySelectorAll<HTMLElement>('.mermaid-diagram'))
        if (!figures.length || lifetime.aborted || current !== revision) return
        // The official Tiny IIFE exposes one global; it is loaded only for diagram pages.
        const mermaid = await (engine ??= new Promise<Mermaid>((resolve, reject) => {
          const script = document.createElement('script')
          script.src = '/_vendor/mermaid/mermaid.tiny.js'
          script.onload = () => resolve((globalThis as typeof globalThis & { mermaid: Mermaid }).mermaid)
          script.onerror = () => {
            engine = undefined
            reject(new Error('Mermaid unavailable'))
          }
          document.head.append(script)
        }))
        await document.fonts.ready
        if (lifetime.aborted || current !== revision) return
        mermaid.initialize(diagramTheme(token))
        for (const figure of figures) {
          const source = figure.querySelector('code')?.textContent ?? ''
          const canvas = figure.querySelector<HTMLElement>('.mermaid-canvas')!
          try {
            const { svg } = await mermaid.render(`ketjs-diagram-${++sequence}`, source)
            if (lifetime.aborted || current !== revision || !figure.isConnected) return
            canvas.innerHTML = svg
            const drawing = canvas.querySelector('svg')
            const naturalWidth = drawing?.viewBox.baseVal.width
            if (drawing && naturalWidth) {
              drawing.style.width = `${naturalWidth}px`
              drawing.style.maxWidth = 'none'
            }
            canvas.tabIndex = 0
            canvas.setAttribute('role', 'img')
            canvas.setAttribute('aria-label', 'Mermaid diagram')
            if (drawing) viewer.updated(figure, drawing)
            figure.querySelector<HTMLDetailsElement>('details')!.open = false
            figure.removeAttribute('data-error')
          } catch {
            figure.dataset.error = 'true'
            canvas.textContent = 'Diagram unavailable. Read its source below.'
            figure.querySelector<HTMLDetailsElement>('details')!.open = true
          }
        }
      })
      .catch(() => {
        for (const canvas of document.querySelectorAll<HTMLElement>('.mermaid-canvas'))
          canvas.textContent = 'Diagram engine unavailable. Read its source below.'
      })
  }
  document.addEventListener('ketjs:doc-navigation', refresh, { signal: lifetime })
  document.addEventListener('ketjs:theme-change', refresh, { signal: lifetime })
  const media = matchMedia('(prefers-color-scheme: dark)')
  media.addEventListener('change', refresh, { signal: lifetime })
  lifetime.addEventListener(
    'abort',
    () => {
      revision++
      probe.remove()
    },
    { once: true },
  )
  refresh()
}
