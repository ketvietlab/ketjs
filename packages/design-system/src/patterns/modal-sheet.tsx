import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

export const HOOKS = [
  'modal-backdrop',
  'modal-sheet',
  'modal-head',
  'modal-title',
  'modal-close',
  'modal-body',
] as const

export const ModalSheet = (props: {
  id: string
  title: string
  body: JSXChild
  closeHref: string
  closeLabel: string
  mode?: 'overlay' | 'embedded'
}): TemplateResult => (
  <div data-ui="modal-backdrop" data-mode={props.mode ?? 'overlay'}>
    <section
      data-ui="modal-sheet"
      role="dialog"
      aria-modal={props.mode === 'embedded' ? 'false' : 'true'}
      aria-labelledby={`${props.id}-title`}
    >
      <header data-ui="modal-head">
        <h2 data-ui="modal-title" id={`${props.id}-title`}>
          {props.title}
        </h2>
        <a
          data-ui="modal-close"
          href={props.closeHref}
          aria-label={props.closeLabel}
          title={props.closeLabel}
        >
          ×
        </a>
      </header>
      <div data-ui="modal-body">{props.body}</div>
    </section>
  </div>
)
