// Where reactivity meets rendering.
//
// The renderer and the signal graph were built separately on purpose — one knows
// nothing about the other, and each is testable alone. This is the twenty lines
// that join them: an effect that re-renders, so reading a signal inside a view
// subscribes the view to it. Nothing else in the framework depends on this file,
// so a caller who wants to drive renders by hand still can.

import { createRoot, hydrateRoot } from './render.ts'
import type { Root, TemplateResult } from './render.ts'
import { effect } from './signal.ts'
import type { Host, HostNode } from './host.ts'

export type Mounted = {
  /** Stop re-rendering. The DOM is left as it is. */
  dispose(): void
  /** Render once, outside the reactive graph. */
  refresh(): void
}

function drive(root: Root, view: () => TemplateResult): Mounted {
  const stop = effect(() => {
    root.render(view())
  })
  return {
    dispose: () => {
      stop()
      root.dispose()
    },
    refresh: () => root.render(view()),
  }
}

/** Render into a container and keep it in sync with whatever signals the view reads. */
export function mount(host: Host, container: HostNode, view: () => TemplateResult): Mounted {
  return drive(createRoot(host, container), view)
}

/** The same, but adopting server-rendered markup rather than building it. */
export function mountHydrated(host: Host, container: HostNode, view: () => TemplateResult): Mounted {
  let root: Root | null = null
  const stop = effect(() => {
    const result = view()
    if (root) root.render(result)
    else root = hydrateRoot(host, container, result)
  })
  return {
    dispose: () => {
      stop()
      root?.dispose()
    },
    refresh: () => root?.render(view()),
  }
}
