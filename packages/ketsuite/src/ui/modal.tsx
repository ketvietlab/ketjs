// URL-addressable modal workspace. The route owns whether it is open; this
// component only provides the accessible overlay and sheet hierarchy.

import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { icon } from './icons.ts'

export const HOOKS = [
  'modal-layer',
  'modal-backdrop',
  'modal-sheet',
  'modal-head',
  'modal-title',
  'modal-close',
  'modal-body',
] as const

export const modalSheet = (options: {
  title: string
  closeHref: string
  closeLabel: string
  body: JSXChild
}): TemplateResult => (
  <div data-ui="modal-layer">
    <a data-ui="modal-backdrop" href={options.closeHref} aria-label={options.closeLabel}>
      <span>{options.closeLabel}</span>
    </a>
    <section data-ui="modal-sheet" role="dialog" aria-modal="true" aria-labelledby="modal-workspace-title">
      <header data-ui="modal-head">
        <h2 data-ui="modal-title" id="modal-workspace-title">
          {options.title}
        </h2>
        <a
          data-ui="modal-close"
          href={options.closeHref}
          aria-label={options.closeLabel}
          title={options.closeLabel}
        >
          {icon('x')}
        </a>
      </header>
      <div data-ui="modal-body">{options.body}</div>
    </section>
  </div>
)
