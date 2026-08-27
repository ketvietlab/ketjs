// URL-addressable modal workspace. The route owns whether it is open; this
// component only provides the accessible overlay and sheet hierarchy.

import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'
import { icon } from './icons.ts'
import { recordForm, type RecordFormOptions } from './form.tsx'

export const HOOKS = [
  'modal-layer',
  'modal-backdrop',
  'modal-sheet',
  'modal-head',
  'modal-heading',
  'modal-title',
  'modal-description',
  'modal-close',
  'modal-body',
] as const

export const modalSheet = (options: {
  id?: string
  title: string
  description?: string
  closeHref: string
  closeLabel: string
  body: JSXChild
  presentation?: 'sheet' | 'dialog'
  size?: 'default' | 'large'
}): TemplateResult => (
  <div data-ui="modal-layer" data-route-modal="true" data-presentation={options.presentation ?? 'sheet'}>
    <a data-ui="modal-backdrop" href={options.closeHref} aria-label={options.closeLabel}>
      <span>{options.closeLabel}</span>
    </a>
    <section
      data-ui="modal-sheet"
      data-size={options.size ?? 'default'}
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${options.id ?? 'modal-workspace'}-title`}
      aria-describedby={options.description ? `${options.id ?? 'modal-workspace'}-description` : undefined}
      tabindex="-1"
    >
      <header data-ui="modal-head">
        <div data-ui="modal-heading">
          <h2 data-ui="modal-title" id={`${options.id ?? 'modal-workspace'}-title`}>
            {options.title}
          </h2>
          <p
            data-ui="modal-description"
            id={`${options.id ?? 'modal-workspace'}-description`}
            hidden={!options.description}
          >
            {options.description ?? ''}
          </p>
        </div>
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

export const modalForm = (options: {
  id: string
  title: string
  description?: string
  closeHref: string
  closeLabel: string
  form: RecordFormOptions
  presentation?: 'sheet' | 'dialog'
  size?: 'default' | 'large'
}): TemplateResult =>
  modalSheet({
    id: options.id,
    title: options.title,
    description: options.description,
    closeHref: options.closeHref,
    closeLabel: options.closeLabel,
    presentation: options.presentation,
    size: options.size,
    body: recordForm(options.form),
  })

/** Keep collection/detail context mounted while a URL-owned modal is open. */
export const modalWorkspace = (background: JSXChild, modal: JSXChild): TemplateResult => (
  <>
    {background}
    {modal}
  </>
)
