import type { JSXChild, TemplateResult } from '@ketvietlab/ketjs-view'

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
  'modal-actions',
] as const

export const ModalSheet = (props: {
  id: string
  title: string
  body: JSXChild
  closeHref: string
  closeLabel: string
  description?: string | null
  actions?: JSXChild
  presentation?: 'sheet' | 'dialog'
  size?: 'default' | 'large'
  mode?: 'overlay' | 'embedded'
  unsavedPrompt?: string | null
}): TemplateResult => (
  <div
    data-ui="modal-layer"
    data-mode={props.mode ?? 'overlay'}
    data-route-modal={props.mode === 'embedded' ? null : 'true'}
    data-presentation={props.presentation ?? 'sheet'}
    data-unsaved-prompt={props.unsavedPrompt ?? null}
  >
    <a data-ui="modal-backdrop" href={props.closeHref} aria-label={props.closeLabel}>
      <span>{props.closeLabel}</span>
    </a>
    <section
      id={props.id}
      data-ui="modal-sheet"
      data-size={props.size ?? 'default'}
      role="dialog"
      aria-modal={props.mode === 'embedded' ? 'false' : 'true'}
      aria-labelledby={`${props.id}-title`}
      aria-describedby={props.description ? `${props.id}-description` : null}
      tabindex={props.mode === 'embedded' ? null : '-1'}
    >
      <header data-ui="modal-head">
        <div data-ui="modal-heading">
          <h2 data-ui="modal-title" id={`${props.id}-title`}>
            {props.title}
          </h2>
          {!!props.description && (
            <p data-ui="modal-description" id={`${props.id}-description`}>
              {props.description}
            </p>
          )}
        </div>
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
      {props.actions !== undefined && <footer data-ui="modal-actions">{props.actions}</footer>}
    </section>
  </div>
)
